/**
 * Image preprocessing for browser inference.
 * Keeps DOM work on the main thread and sends raw pixels to the worker.
 */

export interface PreparedInputs {
  image: Uint8Array
  mask: Uint8Array
  width: number
  height: number
}

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

async function resizeImageToCanvas(
  url: string,
  targetWidth: number,
  targetHeight: number
): Promise<HTMLCanvasElement> {
  const img = await loadImage(url)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!

  // Resize with cover crop: center crop to square then resize
  const srcAspect = img.width / img.height
  const dstAspect = targetWidth / targetHeight
  let sx = 0, sy = 0, sw = img.width, sh = img.height

  if (srcAspect > dstAspect) {
    sw = img.height * dstAspect
    sx = (img.width - sw) / 2
  } else {
    sh = img.width / dstAspect
    sy = (img.height - sh) / 2
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
  return canvas
}

export async function prepareInferenceInputs(
  url: string,
  maskCanvas: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number
): Promise<PreparedInputs> {
  const imageCanvas = await resizeImageToCanvas(url, targetWidth, targetHeight)
  const imageData = imageCanvas.getContext('2d')!.getImageData(0, 0, targetWidth, targetHeight)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(maskCanvas, 0, 0, targetWidth, targetHeight)

  const maskData = ctx.getImageData(0, 0, targetWidth, targetHeight)
  const numPixels = targetWidth * targetHeight
  const image = new Uint8Array(numPixels * 3)
  const rawMask = new Uint8Array(numPixels)

  for (let i = 0; i < numPixels; i++) {
    image[i * 3 + 0] = imageData.data[i * 4 + 0]
    image[i * 3 + 1] = imageData.data[i * 4 + 1]
    image[i * 3 + 2] = imageData.data[i * 4 + 2]

    // 1 means "masked area selected by the user".
    rawMask[i] = maskData.data[i * 4 + 3] > 128 ? 1 : 0
  }

  const mask = dilateBinaryMask(rawMask, targetWidth, targetHeight, 4)

  return { image, mask, width: targetWidth, height: targetHeight }
}
