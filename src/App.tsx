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

const STEPS = [
  { id: 0, label: 'Upload', key: 'upload' },
  { id: 1, label: 'Mask', key: 'mask' },
  { id: 2, label: 'Result', key: 'result' },
] as const

export default function App() {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<string>('Ready')
  const [busy, setBusy] = useState(false)
  const [statusType, setStatusType] = useState<'ready' | 'busy' | 'error'>('ready')

  const workerRef = useRef<Worker | null>(null)

  useEffect(() => {
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
        setStatusType('ready')
        setStatus('Inpainting complete')
      } else if (msg.type === 'ERROR') {
        setStatusType('error')
        setStatus(msg.message)
        setBusy(false)
      }
    }

    worker.onerror = (err) => {
      setStatusType('error')
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
    setStatusType('busy')
    setStatus('Preprocessing...')

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

  const getStepState = (stepId: number) => {
    if (stepId === 0) {
      if (imageUrl) return 'completed'
      return 'active'
    }
    if (stepId === 1) {
      if (maskCanvas && resultUrl) return 'completed'
      if (imageUrl) return 'active'
      return 'pending'
    }
    if (stepId === 2) {
      if (resultUrl) return 'completed'
      if (imageUrl && maskCanvas) return 'active'
      return 'pending'
    }
    return 'pending'
  }

  const handleReset = useCallback(() => {
    setImageUrl(null)
    setResultUrl(null)
    setMaskCanvas(null)
    setStatus('Ready')
    setStatusType('ready')
  }, [])

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <h1>MIGAN Inpainting</h1>
          </div>
          <div className="app-meta">
            <span className={`status-badge ${statusType}`}>{status}</span>
            {resultUrl && (
              <button className="btn btn-ghost" onClick={handleReset} title="Start over">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                New
              </button>
            )}
          </div>
        </div>

        {/* Step Indicator */}
        <div className="steps-bar">
          {STEPS.map((step, index) => {
            const state = getStepState(step.id)
            return (
              <div key={step.key} className="steps-bar-item">
                <div className={`step-dot ${state}`}>
                  {state === 'completed' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    step.id + 1
                  )}
                </div>
                <span className={`steps-bar-label ${state}`}>{step.label}</span>
                {index < STEPS.length - 1 && (
                  <div className={`step-line ${state === 'completed' ? 'completed' : ''}`} />
                )}
              </div>
            )
          })}
        </div>
      </header>

      {/* Main Content */}
      <main className="app-main">
        {/* Step 1: Upload */}
        <section className={`app-section ${getStepState(0) === 'active' ? 'section-active' : ''}`}>
          <div className="section-header">
            <h2>
              <span className="section-num">01</span>
              Upload Image
            </h2>
            <p className="text-secondary">Choose a photo to remove objects or restore damaged areas</p>
          </div>
          <UploadPanel onImageLoaded={setImageUrl} hasImage={!!imageUrl} />
        </section>

        {/* Step 2: Mask */}
        <section className={`app-section ${getStepState(1) === 'active' ? 'section-active' : ''}`}>
          <div className="section-header">
            <h2>
              <span className="section-num">02</span>
              Draw Mask
            </h2>
            <p className="text-secondary">Paint over the area you want to inpaint</p>
          </div>
          {imageUrl ? (
            <MaskEditor imageUrl={imageUrl} onMaskChange={setMaskCanvas} />
          ) : (
            <div className="placeholder-card">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                <path d="M2 2l7.586 7.586" />
                <circle cx="11" cy="11" r="2" />
              </svg>
              <p>Upload an image first to start masking</p>
            </div>
          )}
        </section>

        {/* Step 3: Result */}
        <section className={`app-section ${getStepState(2) === 'active' ? 'section-active' : ''}`}>
          <div className="section-header">
            <h2>
              <span className="section-num">03</span>
              Result
            </h2>
            <p className="text-secondary">AI-powered image restoration</p>
          </div>

          <div className="result-actions">
            <button
              className="btn btn-primary"
              onClick={handleRun}
              disabled={!imageUrl || !maskCanvas || busy}
            >
              {busy ? (
                <>
                  <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Run Inpainting
                </>
              )}
            </button>
          </div>

          <ResultViewer resultUrl={resultUrl} originalUrl={imageUrl} />
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          Powered by <span className="text-accent">ONNX Runtime Web</span> with{' '}
          <span className="text-accent">WebGPU</span> / <span className="text-accent">WASM</span> fallback
        </p>
      </footer>

      <style>{`
        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .app-header {
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-subtle);
          padding: 20px 24px;
          position: sticky;
          top: 0;
          z-index: 100;
        }
        .app-header-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .app-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          color: var(--accent);
        }
        .app-brand h1 {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          background: linear-gradient(135deg, var(--accent), #818cf8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .app-meta {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .steps-bar {
          max-width: 1200px;
          margin: 20px auto 0;
          display: flex;
          align-items: center;
          gap: 0;
        }
        .steps-bar-item {
          display: flex;
          align-items: center;
          flex: 1;
          gap: 10px;
        }
        .steps-bar-label {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-muted);
          white-space: nowrap;
        }
        .steps-bar-label.active {
          color: var(--accent);
        }
        .steps-bar-label.completed {
          color: var(--success);
        }
        .app-main {
          flex: 1;
          max-width: 1200px;
          width: 100%;
          margin: 0 auto;
          padding: 32px 24px;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .app-section {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: 24px;
          transition: border-color 300ms ease, box-shadow 300ms ease;
        }
        .app-section.section-active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent), 0 8px 30px -8px var(--accent-glow), var(--shadow-lg);
        }
        .section-header {
          margin-bottom: 20px;
        }
        .section-header h2 {
          margin: 0 0 6px;
          font-size: 18px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .section-num {
          font-family: 'SF Mono', Monaco, monospace;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-muted);
          background: var(--bg-input);
          padding: 2px 8px;
          border-radius: 4px;
        }
        .section-header p {
          margin: 0;
          font-size: 14px;
        }
        .placeholder-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 48px 24px;
          color: var(--text-muted);
          background: var(--bg-input);
          border-radius: var(--radius-md);
          border: 1px dashed var(--border);
        }
        .placeholder-card p {
          margin: 0;
          font-size: 14px;
        }
        .result-actions {
          margin-bottom: 20px;
        }
        .app-footer {
          text-align: center;
          padding: 20px;
          border-top: 1px solid var(--border);
          color: var(--text-muted);
          font-size: 13px;
          background: var(--bg-secondary);
        }
        .app-footer p {
          margin: 0;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          .app-header-inner {
            flex-direction: column;
            align-items: flex-start;
          }
          .steps-bar {
            margin-top: 16px;
          }
          .steps-bar-label {
            display: none;
          }
          .app-main {
            padding: 16px;
            gap: 20px;
          }
          .app-section {
            padding: 16px;
          }
        }
      `}</style>
    </div>
  )
}
