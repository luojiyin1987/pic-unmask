import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist')
const targetDir = path.join(projectRoot, 'public', 'ort')

const files = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]

await mkdir(targetDir, { recursive: true })

await Promise.all(
  files.map(async (file) => {
    await copyFile(path.join(sourceDir, file), path.join(targetDir, file))
  }),
)

console.log(`synced ${files.length} ONNX Runtime assets to public/ort`)
