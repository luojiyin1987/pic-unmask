import { useCallback, useRef, useState, useEffect } from 'react'
import UploadPanel from './components/UploadPanel'
import MaskEditor from './components/MaskEditor'
import ResultViewer from './components/ResultViewer'
import { useI18n } from './lib/I18nContext'
import type { PreparedInputs } from './lib/preprocess'

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
  const { lang, setLang, t } = useI18n()

  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [maskCanvas, setMaskCanvas] = useState<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<string>(t('statusReady'))
  const [busy, setBusy] = useState(false)
  const [statusType, setStatusType] = useState<'ready' | 'busy' | 'error'>('ready')

  const workerRef = useRef<Worker | null>(null)
  const preparedRef = useRef<PreparedInputs | null>(null)
  const imageUrlRef = useRef<string | null>(null)

  // Keep status text in sync when lang changes
  useEffect(() => {
    if (!busy && statusType === 'ready' && !resultUrl) {
      setStatus(t('statusReady'))
    }
    if (resultUrl && !busy) {
      setStatus(t('statusDone'))
    }
  }, [lang, busy, statusType, resultUrl, t])

  useEffect(() => {
    imageUrlRef.current = imageUrl
  }, [imageUrl])

  useEffect(() => {
    const worker = new Worker(new URL('./workers/inference.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = async (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'STATUS') {
        setStatus(msg.message)
      } else if (msg.type === 'RESULT') {
        try {
          const prepared = preparedRef.current
          if (!prepared || !imageUrlRef.current) {
            throw new Error('Missing crop metadata for compositing.')
          }

          const { composeResultImage } = await import('./lib/preprocess')
          const composedUrl = await composeResultImage(imageUrlRef.current, prepared.crop, msg.imageData)
          setResultUrl(composedUrl)
          setBusy(false)
          setStatusType('ready')
          setStatus(t('statusDone'))
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to compose result image.'
          setStatusType('error')
          setStatus(message)
          setBusy(false)
        }
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
  }, [t])

  const handleRun = useCallback(async () => {
    if (!imageUrl || !maskCanvas || busy) return
    try {
      setBusy(true)
      setStatusType('busy')
      setStatus(t('statusPreprocessing'))

      const { prepareInferenceInputs } = await import('./lib/preprocess')
      const prepared = await prepareInferenceInputs(imageUrl, maskCanvas, 512, 512)
      preparedRef.current = prepared

      setStatus(t('statusRunning'))
      workerRef.current!.postMessage({
        type: 'INFER',
        modelUrl: MODEL_URL,
        wasmBaseUrl: WASM_BASE_URL,
        imageBytes: prepared.image.buffer,
        maskBytes: prepared.mask.buffer,
        width: prepared.width,
        height: prepared.height,
      }, [prepared.image.buffer, prepared.mask.buffer])
    } catch (error) {
      const message =
        error instanceof Error && error.message === 'Please draw a mask before running inpainting.'
          ? t('statusMaskRequired')
          : error instanceof Error
            ? error.message
            : t('statusError')
      preparedRef.current = null
      setStatusType('error')
      setStatus(message)
      setBusy(false)
    }
  }, [imageUrl, maskCanvas, busy, t])

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
    preparedRef.current = null
    setStatus(t('statusReady'))
    setStatusType('ready')
  }, [t])

  useEffect(() => {
    preparedRef.current = null
    setResultUrl(null)
  }, [imageUrl])

  const switchLang = useCallback(
    (next: 'en' | 'zh') => {
      if (next !== lang) setLang(next)
    },
    [lang, setLang]
  )

  const STEPS = [
    { id: 0, label: t('stepUpload'), key: 'upload' },
    { id: 1, label: t('stepMask'), key: 'mask' },
    { id: 2, label: t('stepResult'), key: 'result' },
  ] as const

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
            <h1>{t('appTitle')}</h1>
            <span className="privacy-badge" title={t('privacyUploadHint')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              {t('privacyBadge')}
            </span>
          </div>
          <div className="app-meta">
            <span className={`status-badge ${statusType}`}>{status}</span>
            <div className="lang-switcher">
              <button
                className={`lang-btn ${lang === 'zh' ? 'lang-active' : ''}`}
                onClick={() => switchLang('zh')}
              >
                中文
              </button>
              <span className="lang-divider" />
              <button
                className={`lang-btn ${lang === 'en' ? 'lang-active' : ''}`}
                onClick={() => switchLang('en')}
              >
                English
              </button>
            </div>
            {resultUrl && (
              <button className="btn btn-ghost" onClick={handleReset} title="Start over">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" />
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                {t('btnNew')}
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
              {t('uploadTitle')}
            </h2>
            <p className="text-secondary">{t('uploadDesc')}</p>
          </div>
          <UploadPanel onImageLoaded={setImageUrl} hasImage={!!imageUrl} />
        </section>

        {/* Step 2: Mask */}
        <section className={`app-section ${getStepState(1) === 'active' ? 'section-active' : ''}`}>
          <div className="section-header">
            <h2>
              <span className="section-num">02</span>
              {t('maskTitle')}
            </h2>
            <p className="text-secondary">{t('maskDesc')}</p>
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
              <p>{t('maskPlaceholder')}</p>
            </div>
          )}
        </section>

        {/* Step 3: Result */}
        <section className={`app-section ${getStepState(2) === 'active' ? 'section-active' : ''}`}>
          <div className="section-header">
            <h2>
              <span className="section-num">03</span>
              {t('resultTitle')}
            </h2>
            <p className="text-secondary">{t('resultDesc')}</p>
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
                  {t('btnProcessing')}
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {t('btnRunInpainting')}
                </>
              )}
            </button>
          </div>

          <ResultViewer resultUrl={resultUrl} originalUrl={imageUrl} />
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>{t('footer')}</p>
        <p className="privacy-footer">{t('privacyFooter')}</p>
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
        .lang-switcher {
          display: inline-flex;
          align-items: center;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          padding: 3px;
          gap: 2px;
        }
        .lang-btn {
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 500;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          transition: all var(--transition);
          line-height: 1;
        }
        .lang-btn:hover {
          color: var(--text-primary);
        }
        .lang-btn.lang-active {
          background: var(--bg-card);
          color: var(--accent);
          font-weight: 600;
          box-shadow: var(--shadow);
        }
        .lang-divider {
          width: 1px;
          height: 14px;
          background: var(--border);
          margin: 0 1px;
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
          margin: 0 0 6px;
        }
        .app-footer p:last-child {
          margin-bottom: 0;
        }
        .privacy-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 600;
          color: #15803d;
          background: rgba(34, 197, 94, 0.12);
          border: 1px solid rgba(34, 197, 94, 0.25);
          letter-spacing: 0.02em;
          cursor: help;
          margin-left: 6px;
        }
        .privacy-footer {
          font-size: 12px;
          color: var(--text-muted);
          opacity: 0.8;
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
