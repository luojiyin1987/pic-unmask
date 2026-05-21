import * as ort from 'onnxruntime-web/webgpu'
import { detectBackend } from '../lib/ort-env'

let session: ort.InferenceSession | null = null
let currentModelUrl = ''
const MODEL_CACHE_NAME = 'migan-model-cache-v2'

type InferMessage = {
  type: 'INFER'
  modelUrl: string
  wasmBaseUrl: string
  imageBytes: ArrayBuffer
  maskBytes: ArrayBuffer
  width: number
  height: number
}

type TensorMeta = ort.InferenceSession.ValueMetadata & { isTensor: true }
type WorkerHost = Worker

const workerHost = self as unknown as WorkerHost

const postStatus = (message: string) => {
  workerHost.postMessage({ type: 'STATUS', message })
}

const resolveAbsoluteUrl = (value: string): string => {
  try {
    return new URL(value).toString()
  } catch {
    return new URL(value, self.location.href).toString()
  }
}

const isTensorMeta = (value: ort.InferenceSession.ValueMetadata): value is TensorMeta => value.isTensor

const tensorMetaAt = (activeSession: ort.InferenceSession, index: number): TensorMeta => {
  const meta = activeSession.inputMetadata[index]
  if (!meta || !isTensorMeta(meta)) {
    throw new Error(`Input ${index} is missing or is not a tensor`)
  }
  return meta
}

const toConcreteShape = (shape: ReadonlyArray<number | string>, width: number, height: number): number[] =>
  shape.map((dim, index) => {
    if (typeof dim === 'number' && Number.isFinite(dim) && dim > 0) {
      return dim
    }
    const fallbackIndex = shape.length - index
    if (fallbackIndex === 1) return width
    if (fallbackIndex === 2) return height
    return 1
  })

const floatToHalf = (value: number): number => {
  const buffer = new ArrayBuffer(4)
  const floatView = new Float32Array(buffer)
  const intView = new Uint32Array(buffer)
  floatView[0] = value
  const x = intView[0]
  const sign = (x >> 16) & 0x8000
  const mantissa = x & 0x007fffff
  const exponent = (x >> 23) & 0xff

  if (exponent === 0xff) {
    return sign | (mantissa ? 0x7e00 : 0x7c00)
  }

  const halfExponent = exponent - 127 + 15
  if (halfExponent >= 0x1f) {
    return sign | 0x7c00
  }
  if (halfExponent <= 0) {
    if (halfExponent < -10) {
      return sign
    }
    const shiftedMantissa = (mantissa | 0x00800000) >> (1 - halfExponent)
    return sign | ((shiftedMantissa + 0x00001000) >> 13)
  }

  return sign | (halfExponent << 10) | ((mantissa + 0x00001000) >> 13)
}

const halfToFloat = (value: number): number => {
  const sign = (value & 0x8000) << 16
  let exponent = (value >> 10) & 0x1f
  let mantissa = value & 0x03ff

  if (exponent === 0) {
    if (mantissa === 0) {
      const bits = sign
      return new Float32Array(new Uint32Array([bits]).buffer)[0]
    }
    while ((mantissa & 0x0400) === 0) {
      mantissa <<= 1
      exponent -= 1
    }
    exponent += 1
    mantissa &= ~0x0400
  } else if (exponent === 0x1f) {
    const bits = sign | 0x7f800000 | (mantissa << 13)
    return new Float32Array(new Uint32Array([bits]).buffer)[0]
  }

  const bits = sign | ((exponent + (127 - 15)) << 23) | (mantissa << 13)
  return new Float32Array(new Uint32Array([bits]).buffer)[0]
}

const packFloatData = (type: 'float16' | 'float32', values: Float32Array): Float32Array | Uint16Array => {
  if (type === 'float32') {
    return values
  }
  const packed = new Uint16Array(values.length)
  for (let i = 0; i < values.length; i++) {
    packed[i] = floatToHalf(values[i])
  }
  return packed
}

const unpackFloatData = (type: ort.Tensor.Type, data: ort.Tensor.DataTypeMap[ort.Tensor.Type]): Float32Array => {
  if (type === 'float32') {
    return data as Float32Array
  }
  if (type === 'float16') {
    const source = data as Uint16Array
    const unpacked = new Float32Array(source.length)
    for (let i = 0; i < source.length; i++) {
      unpacked[i] = halfToFloat(source[i])
    }
    return unpacked
  }
  throw new Error(`Unsupported float tensor output type: ${type}`)
}

const rgbToNchwFloats = (image: Uint8Array, width: number, height: number, masked: Uint8Array): Float32Array => {
  const numPixels = width * height
  const data = new Float32Array(4 * numPixels)

  for (let i = 0; i < numPixels; i++) {
    const mask = masked[i]
    const keep = mask ? 0 : 1
    const r = (image[i * 3 + 0] / 255) * 2 - 1
    const g = (image[i * 3 + 1] / 255) * 2 - 1
    const b = (image[i * 3 + 2] / 255) * 2 - 1
    data[i] = r * keep
    data[numPixels + i] = g * keep
    data[2 * numPixels + i] = b * keep
    data[3 * numPixels + i] = mask
  }

  return data
}

const rgbToNchwImage = (image: Uint8Array, width: number, height: number): Float32Array => {
  const numPixels = width * height
  const data = new Float32Array(3 * numPixels)

  for (let i = 0; i < numPixels; i++) {
    data[i] = (image[i * 3 + 0] / 255) * 2 - 1
    data[numPixels + i] = (image[i * 3 + 1] / 255) * 2 - 1
    data[2 * numPixels + i] = (image[i * 3 + 2] / 255) * 2 - 1
  }

  return data
}

const maskToFloats = (masked: Uint8Array, width: number, height: number): Float32Array => {
  const numPixels = width * height
  const data = new Float32Array(numPixels)
  for (let i = 0; i < numPixels; i++) {
    data[i] = masked[i]
  }
  return data
}

const createUint8ImageTensor = (
  type: 'uint8',
  shape: number[],
  image: Uint8Array,
  width: number,
  height: number,
): ort.Tensor => {
  if (shape.length === 4 && shape[1] === 3) {
    const numPixels = width * height
    const data = new Uint8Array(3 * numPixels)
    for (let i = 0; i < numPixels; i++) {
      data[i] = image[i * 3 + 0]
      data[numPixels + i] = image[i * 3 + 1]
      data[2 * numPixels + i] = image[i * 3 + 2]
    }
    return new ort.Tensor(type, data, [1, 3, height, width])
  }

  if (shape.length === 4 && shape[3] === 3) {
    return new ort.Tensor(type, image, [1, height, width, 3])
  }

  if (shape.length === 3 && shape[0] === 3) {
    const numPixels = width * height
    const data = new Uint8Array(3 * numPixels)
    for (let i = 0; i < numPixels; i++) {
      data[i] = image[i * 3 + 0]
      data[numPixels + i] = image[i * 3 + 1]
      data[2 * numPixels + i] = image[i * 3 + 2]
    }
    return new ort.Tensor(type, data, [3, height, width])
  }

  if (shape.length === 3 && shape[2] === 3) {
    return new ort.Tensor(type, image, [height, width, 3])
  }

  throw new Error(`Unsupported uint8 image input shape: ${shape.join('x')}`)
}

const createUint8MaskTensor = (
  type: 'uint8',
  shape: number[],
  masked: Uint8Array,
  width: number,
  height: number,
): ort.Tensor => {
  const numPixels = width * height
  const knownMask = new Uint8Array(numPixels)
  for (let i = 0; i < numPixels; i++) {
    knownMask[i] = masked[i] ? 0 : 255
  }

  if (shape.length === 4 && shape[1] === 1) {
    return new ort.Tensor(type, knownMask, [1, 1, height, width])
  }
  if (shape.length === 4 && shape[3] === 1) {
    return new ort.Tensor(type, knownMask, [1, height, width, 1])
  }
  if (shape.length === 3 && shape[0] === 1) {
    return new ort.Tensor(type, knownMask, [1, height, width])
  }
  if (shape.length === 3 && shape[2] === 1) {
    return new ort.Tensor(type, knownMask, [height, width, 1])
  }
  if (shape.length === 2) {
    return new ort.Tensor(type, knownMask, [height, width])
  }

  throw new Error(`Unsupported uint8 mask input shape: ${shape.join('x')}`)
}

const createFloatTensor = (
  type: 'float16' | 'float32',
  shape: number[],
  values: Float32Array,
) => new ort.Tensor(type, packFloatData(type, values) as never, shape)

const getChannelCount = (shape: number[]): number => {
  if (shape.length === 4) {
    if (shape[1] <= 8) return shape[1]
    if (shape[3] <= 8) return shape[3]
  }
  if (shape.length === 3) {
    if (shape[0] <= 8) return shape[0]
    if (shape[2] <= 8) return shape[2]
  }
  return 0
}

const loadModelBuffer = async (modelUrl: string): Promise<ArrayBuffer> => {
  const request = new Request(modelUrl, { mode: 'cors', credentials: 'omit' })

  try {
    const cache = await caches.open(MODEL_CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) {
      postStatus('Loading model from browser cache...')
      return await cached.arrayBuffer()
    }

    postStatus('Downloading model...')
    const response = await fetch(request, { cache: 'force-cache' })
    if (!response.ok) {
      throw new Error(`Model download failed: HTTP ${response.status}`)
    }

    await cache.put(request, response.clone())
    return await response.arrayBuffer()
  } catch (error) {
    postStatus('Cache unavailable, downloading model directly...')
    const response = await fetch(request, { cache: 'force-cache' })
    if (!response.ok) {
      throw new Error(`Model download failed: HTTP ${response.status}`)
    }
    return await response.arrayBuffer()
  }
}

const createSingleInputTensor = (meta: TensorMeta, image: Uint8Array, masked: Uint8Array, width: number, height: number) => {
  const shape = toConcreteShape(meta.shape, width, height)
  const channels = getChannelCount(shape)

  if (meta.type !== 'float16' && meta.type !== 'float32') {
    throw new Error(`Single-input model expects unsupported type: ${meta.type}`)
  }
  if (channels !== 4) {
    throw new Error(`Single-input MI-GAN model should expose 4 channels, got shape ${shape.join('x')}`)
  }

  const nchw = rgbToNchwFloats(image, width, height, masked)
  if (shape.length === 4 && shape[1] === 4) {
    return createFloatTensor(meta.type, [1, 4, height, width], nchw)
  }
  if (shape.length === 4 && shape[3] === 4) {
    const nhwc = new Float32Array(width * height * 4)
    const numPixels = width * height
    for (let i = 0; i < numPixels; i++) {
      nhwc[i * 4 + 0] = nchw[i]
      nhwc[i * 4 + 1] = nchw[numPixels + i]
      nhwc[i * 4 + 2] = nchw[2 * numPixels + i]
      nhwc[i * 4 + 3] = nchw[3 * numPixels + i]
    }
    return createFloatTensor(meta.type, [1, height, width, 4], nhwc)
  }
  if (shape.length === 3 && shape[0] === 4) {
    return createFloatTensor(meta.type, [4, height, width], nchw)
  }
  if (shape.length === 3 && shape[2] === 4) {
    const nhwc = new Float32Array(width * height * 4)
    const numPixels = width * height
    for (let i = 0; i < numPixels; i++) {
      nhwc[i * 4 + 0] = nchw[i]
      nhwc[i * 4 + 1] = nchw[numPixels + i]
      nhwc[i * 4 + 2] = nchw[2 * numPixels + i]
      nhwc[i * 4 + 3] = nchw[3 * numPixels + i]
    }
    return createFloatTensor(meta.type, [height, width, 4], nhwc)
  }

  throw new Error(`Unsupported single-input tensor layout: ${shape.join('x')}`)
}

const createDualInputTensors = (
  imageMeta: TensorMeta,
  maskMeta: TensorMeta,
  image: Uint8Array,
  masked: Uint8Array,
  width: number,
  height: number,
): [ort.Tensor, ort.Tensor] => {
  const imageShape = toConcreteShape(imageMeta.shape, width, height)
  const maskShape = toConcreteShape(maskMeta.shape, width, height)

  if (imageMeta.type === 'uint8' && maskMeta.type === 'uint8') {
    return [
      createUint8ImageTensor('uint8', imageShape, image, width, height),
      createUint8MaskTensor('uint8', maskShape, masked, width, height),
    ]
  }

  if (
    (imageMeta.type === 'float16' || imageMeta.type === 'float32') &&
    (maskMeta.type === 'float16' || maskMeta.type === 'float32')
  ) {
    const imageTensor = createFloatTensor(imageMeta.type, [1, 3, height, width], rgbToNchwImage(image, width, height))
    const maskTensor = createFloatTensor(maskMeta.type, [1, 1, height, width], maskToFloats(masked, width, height))
    return [imageTensor, maskTensor]
  }

  throw new Error(`Unsupported dual-input types: ${imageMeta.type}, ${maskMeta.type}`)
}

const tensorFloatsToImageData = (tensorData: Float32Array, height: number, width: number): ImageData => {
  const numPixels = height * width
  const rgba = new Uint8ClampedArray(numPixels * 4)
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(((value + 1) / 2) * 255)))

  for (let i = 0; i < numPixels; i++) {
    rgba[i * 4 + 0] = clamp(tensorData[i])
    rgba[i * 4 + 1] = clamp(tensorData[numPixels + i])
    rgba[i * 4 + 2] = clamp(tensorData[2 * numPixels + i])
    rgba[i * 4 + 3] = 255
  }

  return new ImageData(rgba, width, height)
}

const packedRgbToImageData = (rgb: Uint8Array, width: number, height: number): ImageData => {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4 + 0] = rgb[i * 3 + 0]
    rgba[i * 4 + 1] = rgb[i * 3 + 1]
    rgba[i * 4 + 2] = rgb[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return new ImageData(rgba, width, height)
}

const outputTensorToImageData = (tensor: ort.Tensor): ImageData => {
  const dims = tensor.dims as number[]
  const type = tensor.type

  if (type === 'float16' || type === 'float32') {
    const floats = unpackFloatData(type, tensor.data as never)

    if (dims.length === 4 && dims[0] === 1 && dims[1] === 3) {
      return tensorFloatsToImageData(floats, dims[2], dims[3])
    }
    if (dims.length === 3 && dims[0] === 3) {
      return tensorFloatsToImageData(floats, dims[1], dims[2])
    }
    if (dims.length === 4 && dims[0] === 1 && dims[3] === 3) {
      const rgb = new Uint8Array(dims[1] * dims[2] * 3)
      for (let i = 0; i < dims[1] * dims[2]; i++) {
        rgb[i * 3 + 0] = Math.max(0, Math.min(255, Math.round(floats[i * 3 + 0] * 255)))
        rgb[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(floats[i * 3 + 1] * 255)))
        rgb[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(floats[i * 3 + 2] * 255)))
      }
      return packedRgbToImageData(rgb, dims[2], dims[1])
    }
  }

  if (type === 'uint8') {
    const data = tensor.data as Uint8Array
    if (dims.length === 4 && dims[0] === 1 && dims[1] === 3) {
      const numPixels = dims[2] * dims[3]
      const rgb = new Uint8Array(numPixels * 3)
      for (let i = 0; i < numPixels; i++) {
        rgb[i * 3 + 0] = data[i]
        rgb[i * 3 + 1] = data[numPixels + i]
        rgb[i * 3 + 2] = data[2 * numPixels + i]
      }
      return packedRgbToImageData(rgb, dims[3], dims[2])
    }
    if (dims.length === 4 && dims[0] === 1 && dims[3] === 3) {
      return packedRgbToImageData(data, dims[2], dims[1])
    }
    if (dims.length === 3 && dims[0] === 3) {
      const numPixels = dims[1] * dims[2]
      const rgb = new Uint8Array(numPixels * 3)
      for (let i = 0; i < numPixels; i++) {
        rgb[i * 3 + 0] = data[i]
        rgb[i * 3 + 1] = data[numPixels + i]
        rgb[i * 3 + 2] = data[2 * numPixels + i]
      }
      return packedRgbToImageData(rgb, dims[2], dims[1])
    }
    if (dims.length === 3 && dims[2] === 3) {
      return packedRgbToImageData(data, dims[1], dims[0])
    }
  }

  throw new Error(`Unsupported output tensor: type=${type}, dims=${dims.join('x')}`)
}

self.onmessage = async (event: MessageEvent<InferMessage>) => {
  const { modelUrl, wasmBaseUrl, imageBytes, maskBytes, width, height } = event.data

  try {
    postStatus('Initializing ONNX Runtime...')

    const wasmBase = resolveAbsoluteUrl(wasmBaseUrl)
    ort.env.wasm.wasmPaths = {
      wasm: new URL('ort-wasm-simd-threaded.jsep.wasm', wasmBase).toString(),
      mjs: new URL('ort-wasm-simd-threaded.jsep.mjs', wasmBase).toString(),
    }
    ort.env.wasm.numThreads = 4

    if (!session || currentModelUrl !== modelUrl) {
      postStatus('Loading model...')
      const backends = await detectBackend()
      const modelBuffer = await loadModelBuffer(modelUrl)
      session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: backends as ort.InferenceSession.SessionOptions['executionProviders'],
        graphOptimizationLevel: 'all',
      })
      currentModelUrl = modelUrl
      postStatus(`Model loaded (${session.inputNames.join(', ')} -> ${session.outputNames.join(', ')})`)
    }

    const image = new Uint8Array(imageBytes)
    const masked = new Uint8Array(maskBytes)
    const feeds: Record<string, ort.Tensor> = {}

    if (session.inputNames.length === 1) {
      const inputMeta = tensorMetaAt(session, 0)
      feeds[session.inputNames[0]] = createSingleInputTensor(inputMeta, image, masked, width, height)
    } else if (session.inputNames.length >= 2) {
      const [imageTensor, maskTensor] = createDualInputTensors(
        tensorMetaAt(session, 0),
        tensorMetaAt(session, 1),
        image,
        masked,
        width,
        height,
      )
      feeds[session.inputNames[0]] = imageTensor
      feeds[session.inputNames[1]] = maskTensor
    } else {
      throw new Error('Model does not expose any inputs')
    }

    postStatus('Running inference...')
    const results = await session.run(feeds)
    const output = results[session.outputNames[0]] as ort.Tensor
    const imageData = outputTensorToImageData(output)

    workerHost.postMessage({ type: 'RESULT', imageData }, [imageData.data.buffer])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    workerHost.postMessage({ type: 'ERROR', message })
  }
}
