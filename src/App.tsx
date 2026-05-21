import { useCallback, useRef, useState, useEffect } from 'react'
import UploadPanel from './components/UploadPanel'
import MaskEditor from './components/MaskEditor'
import ResultViewer from './components/ResultViewer'

const ORT_VERSION = '1.26.0'
const DEFAULT_MODEL_URL = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx'
const DEFAULT_WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`
const MODEL_URL = import.meta.env.VITE_MODEL_URL || DEFAULT_MODEL_URL
const WASM_BASE_URL = new URL(import.meta.env.VITE_WASM_BASE_URL || DEFAULT_WASM_BASE_URL, window.location.href).toString()

type WorkerMessage =
  | { type: 'RESULT'; imageData: ImageData }
  | { type: 'ERROR'; message: string }
  | { type: 'STATUS'; message: string }

export default function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<string>('Ready')
  const [busy, setBusy] = useState(false)

  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
    // Create worker on mount
    const worker = new Worker(new URL('./workers/inference.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'STATUS') {
        setStatus(msg.message)
      } else if (msg.type === 'RESULT') {
        const canvas = document.createElement('canvas')
        canvas.width = msg.imageData.width
        canvas.height = msg.imageData.height
        canvas.getContext('2d')!.putImageData(msg.imageData, 0, 0)
        setResultUrl(canvas.toDataURL('image/png'))
        setBusy(false)
        setStatus('Done')
      } else if (msg.type === 'ERROR') {
        setStatus(`Error: ${msg.message}`)
        setBusy(false)
      }
    }

    worker.onerror = (err) => {
      setStatus(`Worker error: ${err.message}`)
      setBusy(false)
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const handleRun = useCallback(async () => {
    if (!imageUrl || !maskCanvas || busy) return
    setBusy(true)
    setStatus('Preprocessing...')

    // DOM-based image work stays on the main thread; the worker adapts to the model format.
    const { prepareInferenceInputs } = await import('./lib/preprocess')
    const prepared = await prepareInferenceInputs(imageUrl, maskCanvas, 512, 512)

    setStatus('Running inference in WebWorker...')
    workerRef.current!.postMessage({
      type: 'INFER',
      modelUrl: MODEL_URL,
      wasmBaseUrl: WASM_BASE_URL,
      imageBytes: prepared.image.buffer,
      maskBytes: prepared.mask.buffer,
      width: prepared.width,
      height: prepared.height,
    }, [prepared.image.buffer, prepared.mask.buffer])
  }, [imageUrl, maskCanvas, busy])

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto' }}>
      <h1>MIGAN Web Inpainting</h1>
      <div style={{ marginBottom: 12, color: '#555' }}>{status}</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <div>
          <h3>1. Upload</h3>
          <UploadPanel onImageLoaded={setImageUrl} />
          {imageUrl && (
            <img
              src={imageUrl}
              alt="source"
              style={{ marginTop: 8, maxWidth: '100%', border: '1px solid #ddd', display: 'block' }}
            />
          )}
        </div>

        <div>
          <h3>2. Mask</h3>
          {imageUrl && (
            <MaskEditor imageUrl={imageUrl} onMaskChange={setMaskCanvas} />
          )}
        </div>

        <div>
          <h3>3. Result</h3>
          <button
            onClick={handleRun}
            disabled={!imageUrl || !maskCanvas || busy}
            style={{ padding: '8px 16px', cursor: busy ? 'not-allowed' : 'pointer' }}
          >
            {busy ? 'Running...' : 'Run Inpainting'}
          </button>
          <ResultViewer resultUrl={resultUrl} originalUrl={imageUrl} />
        </div>
      </div>
    </div>
  )
}
