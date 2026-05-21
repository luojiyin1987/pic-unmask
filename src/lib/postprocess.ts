/**
 * Postprocess: Float32 NCHW tensor -> ImageData
 * Assumes values in [-1, 1]
 */

export function tensorToImageData(
  tensorData: Float32Array,
  height: number,
  width: number
): ImageData {
  const numPixels = height * width
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(((v + 1) / 2) * 255)))
  const rgba = new Uint8ClampedArray(numPixels * 4)

  for (let i = 0; i < numPixels; i++) {
    const r = clamp(tensorData[0 * numPixels + i])
    const g = clamp(tensorData[1 * numPixels + i])
    const b = clamp(tensorData[2 * numPixels + i])
    rgba[i * 4 + 0] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = 255
  }

  return new ImageData(rgba, width, height)
}
