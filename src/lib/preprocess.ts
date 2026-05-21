/**
 * Image preprocessing for browser inference.
 * Keeps DOM work on the main thread and sends raw pixels to the worker.
 */

export interface PreparedInputs {
  image: Uint8Array
  mask: Uint8Array
  width: number
  height: number
  crop: CropRegion
  fullWidth: number
  fullHeight: number
}

export interface CropRegion {
  x: number
  y: number
  size: number
}

interface MaskBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const MASK_DILATION_RADIUS = 4
const MIN_CROP_PADDING = 32
const CROP_PADDING_RATIO = 0.25

function dilateBinaryMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) {
    return mask
  }

  const dilated = new Uint8Array(mask.length)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let active = 0
      for (let dy = -radius; dy <= radius && active === 0; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          if (dx * dx + dy * dy > radius * radius) continue
          if (mask[ny * width + nx] === 1) {
            active = 1
            break
          }
        }
      }
      dilated[y * width + x] = active
    }
  }

  return dilated
}

export async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function findMaskBounds(maskData: ImageData): MaskBounds | null {
  const { width, height, data } = maskData
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 128) {
        continue
      }

      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  return { minX, minY, maxX, maxY }
}

function computeCropRegion(bounds: MaskBounds, imageWidth: number, imageHeight: number): CropRegion {
  const maskWidth = bounds.maxX - bounds.minX + 1
  const maskHeight = bounds.maxY - bounds.minY + 1
  const longestEdge = Math.max(maskWidth, maskHeight)
  const padding = Math.max(MIN_CROP_PADDING, Math.round(longestEdge * CROP_PADDING_RATIO))
  const size = Math.min(Math.max(longestEdge + padding * 2, 1), Math.max(imageWidth, imageHeight))

  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2

  return {
    x: centerX - size / 2,
    y: centerY - size / 2,
    size,
  }
}

function renderCropToCanvas(
  source: CanvasImageSource,
  crop: CropRegion,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!
  const scale = targetWidth / crop.size
  const srcX = Math.max(0, crop.x)
  const srcY = Math.max(0, crop.y)
  const srcRight = Math.min(sourceWidth, crop.x + crop.size)
  const srcBottom = Math.min(sourceHeight, crop.y + crop.size)
  const srcWidth = Math.max(0, srcRight - srcX)
  const srcHeight = Math.max(0, srcBottom - srcY)

  if (srcWidth > 0 && srcHeight > 0) {
    const destX = (srcX - crop.x) * scale
    const destY = (srcY - crop.y) * scale
    const destWidth = srcWidth * scale
    const destHeight = srcHeight * scale

    ctx.drawImage(source, srcX, srcY, srcWidth, srcHeight, destX, destY, destWidth, destHeight)
  }

  return Promise.resolve(canvas)
}

async function createInferenceCanvases(
  image: HTMLImageElement,
  maskCanvas: HTMLCanvasElement,
  crop: CropRegion,
  targetWidth: number,
  targetHeight: number
): Promise<{ imageCanvas: HTMLCanvasElement; maskCropCanvas: HTMLCanvasElement }> {
  const [imageCanvas, maskCropCanvas] = await Promise.all([
    renderCropToCanvas(image, crop, image.width, image.height, targetWidth, targetHeight),
    renderCropToCanvas(maskCanvas, crop, maskCanvas.width, maskCanvas.height, targetWidth, targetHeight),
  ])

  return { imageCanvas, maskCropCanvas }
}

export async function prepareInferenceInputs(
  url: string,
  maskCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): Promise<PreparedInputs> {
  const image = await loadImage(url)
  const maskCtx = maskCanvas.getContext('2d')

  if (!maskCtx) {
    throw new Error('Mask canvas is unavailable.')
  }

  const fullMaskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
  const bounds = findMaskBounds(fullMaskData)

  if (!bounds) {
    throw new Error('Please draw a mask before running inpainting.')
  }

  const crop = computeCropRegion(bounds, image.width, image.height)
  const { imageCanvas, maskCropCanvas } = await createInferenceCanvases(image, maskCanvas, crop, targetWidth, targetHeight)
  const imageData = imageCanvas.getContext('2d')!.getImageData(0, 0, targetWidth, targetHeight)
  const maskData = maskCropCanvas.getContext('2d')!.getImageData(0, 0, targetWidth, targetHeight)
  const numPixels = targetWidth * targetHeight
  const packedImage = new Uint8Array(numPixels * 3)
  const rawMask = new Uint8Array(numPixels)

  for (let i = 0; i < numPixels; i++) {
    packedImage[i * 3 + 0] = imageData.data[i * 4 + 0]
    packedImage[i * 3 + 1] = imageData.data[i * 4 + 1]
    packedImage[i * 3 + 2] = imageData.data[i * 4 + 2]

    // 1 means "masked area selected by the user".
    rawMask[i] = maskData.data[i * 4 + 3] > 128 ? 1 : 0
  }

  const mask = dilateBinaryMask(rawMask, targetWidth, targetHeight, MASK_DILATION_RADIUS)

  return {
    image: packedImage,
    mask,
    width: targetWidth,
    height: targetHeight,
    crop,
    fullWidth: image.width,
    fullHeight: image.height,
  }
}

export async function composeResultImage(
  url: string,
  crop: CropRegion,
  patchImageData: ImageData
): Promise<string> {
  const image = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Unable to compose result image.')
  }

  ctx.drawImage(image, 0, 0)

  const patchCanvas = document.createElement('canvas')
  patchCanvas.width = patchImageData.width
  patchCanvas.height = patchImageData.height
  patchCanvas.getContext('2d')!.putImageData(patchImageData, 0, 0)

  const destX = Math.max(0, crop.x)
  const destY = Math.max(0, crop.y)
  const destRight = Math.min(image.width, crop.x + crop.size)
  const destBottom = Math.min(image.height, crop.y + crop.size)
  const destWidth = Math.max(0, destRight - destX)
  const destHeight = Math.max(0, destBottom - destY)

  if (destWidth > 0 && destHeight > 0) {
    const scale = patchCanvas.width / crop.size
    const srcX = (destX - crop.x) * scale
    const srcY = (destY - crop.y) * scale
    const srcWidth = destWidth * scale
    const srcHeight = destHeight * scale

    ctx.drawImage(patchCanvas, srcX, srcY, srcWidth, srcHeight, destX, destY, destWidth, destHeight)
  }

  return canvas.toDataURL('image/png')
}
