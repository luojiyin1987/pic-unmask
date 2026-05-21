import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0, // never inline wasm or large files
  },
  resolve: {
    conditions: ['onnxruntime-web-use-extern-wasm'],
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Ensure cross-origin isolation headers for SharedArrayBuffer (WASM threads)
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  },
  worker: {
    format: 'es'
  }
})
