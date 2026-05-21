/**
 * ONNX Runtime environment helpers
 * Detect WebGPU support and build execution provider list
 */

export async function detectBackend(): Promise<string[]> {
  // WebGPU detection
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter()
      if (adapter) {
        return ['webgpu', 'wasm']
      }
    } catch {
      // fall through
    }
  }
  // WebNN detection (experimental)
  if (typeof navigator !== 'undefined' && 'ml' in navigator) {
    try {
      const context = await (navigator as any).ml.createContext()
      if (context) {
        return ['webnn', 'wasm']
      }
    } catch {
      // fall through
    }
  }
  return ['wasm']
}
