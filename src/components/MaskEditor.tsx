import { useRef, useEffect, useState, useCallback } from 'react'
import { useI18n } from '../lib/I18nContext'

interface Props {
  imageUrl: string
  onMaskChange: (canvas: HTMLCanvasElement) => void
}

export default function MaskEditor({ imageUrl, onMaskChange }: Props) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [brushSize, setBrushSize] = useState(24)
  const [mode, setMode] = useState<'draw' | 'erase'>('draw')
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const displayCanvas = canvasRef.current!
      const displaySize = 512
      displayCanvas.width = displaySize
      displayCanvas.height = displaySize

      // Center-crop to square (same logic as preprocess)
      const srcAspect = img.width / img.height
      let sx = 0, sy = 0, sw = img.width, sh = img.height
      if (srcAspect > 1) {
        sw = img.height
        sx = (img.width - sw) / 2
      } else {
        sh = img.width
        sy = (img.height - sh) / 2
      }

      const ctx = displayCanvas.getContext('2d')!
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, displaySize, displaySize)

      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = 512
      maskCanvas.height = 512
      const maskCtx = maskCanvas.getContext('2d')!
      maskCtx.clearRect(0, 0, 512, 512)
      maskCanvasRef.current = maskCanvas
      onMaskChange(maskCanvas)
      setHasDrawn(false)
    }
    img.src = imageUrl
  }, [imageUrl, onMaskChange])

  useEffect(() => {
    lastPointRef.current = null
  }, [imageUrl, mode, brushSize])

  const getCoords = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
      }
    },
    []
  )

  const applyStroke = useCallback(
    (
      dctx: CanvasRenderingContext2D,
      mctx: CanvasRenderingContext2D,
      from: { x: number; y: number },
      to: { x: number; y: number }
    ) => {
      const displayComposite = mode === 'draw' ? 'source-over' : 'destination-out'
      const maskComposite = mode === 'draw' ? 'source-over' : 'destination-out'

      dctx.save()
      dctx.globalCompositeOperation = displayComposite
      dctx.strokeStyle = 'rgba(14, 165, 233, 0.65)'
      dctx.lineWidth = brushSize
      dctx.lineCap = 'round'
      dctx.lineJoin = 'round'
      dctx.shadowColor = 'rgba(14, 165, 233, 0.35)'
      dctx.shadowBlur = brushSize / 2
      dctx.beginPath()
      dctx.moveTo(from.x, from.y)
      dctx.lineTo(to.x, to.y)
      dctx.stroke()
      dctx.restore()

      mctx.save()
      mctx.globalCompositeOperation = maskComposite
      mctx.strokeStyle = 'white'
      mctx.lineWidth = brushSize
      mctx.lineCap = 'round'
      mctx.lineJoin = 'round'
      mctx.beginPath()
      mctx.moveTo(from.x, from.y)
      mctx.lineTo(to.x, to.y)
      mctx.stroke()
      mctx.restore()
    },
    [brushSize, mode]
  )

  const paintSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      if (!maskCanvasRef.current || !canvasRef.current) return
      const dctx = canvasRef.current.getContext('2d')!
      const mctx = maskCanvasRef.current.getContext('2d')!
      applyStroke(dctx, mctx, from, to)
      onMaskChange(maskCanvasRef.current)
      if (!hasDrawn) setHasDrawn(true)
    },
    [applyStroke, onMaskChange, hasDrawn]
  )

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !maskCanvasRef.current) return
      const { x, y } = getCoords(e)
      const current = { x, y }
      const previous = lastPointRef.current ?? current
      paintSegment(previous, current)
      lastPointRef.current = current
    },
    [getCoords, isDrawing, paintSegment]
  )

  const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const point = getCoords(e)
    setIsDrawing(true)
    lastPointRef.current = point
    paintSegment(point, point)
  }, [getCoords, paintSegment])

  const stopDrawing = useCallback(() => {
    setIsDrawing(false)
    lastPointRef.current = null
  }, [])

  const clearMask = useCallback(() => {
    if (!maskCanvasRef.current) return
    const mctx = maskCanvasRef.current.getContext('2d')!
    mctx.clearRect(0, 0, 512, 512)

    const displayCanvas = canvasRef.current!
    const dctx = displayCanvas.getContext('2d')!
    dctx.clearRect(0, 0, displayCanvas.width, displayCanvas.height)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const srcAspect = img.width / img.height
      let sx = 0, sy = 0, sw = img.width, sh = img.height
      if (srcAspect > 1) {
        sw = img.height
        sx = (img.width - sw) / 2
      } else {
        sh = img.width
        sy = (img.height - sh) / 2
      }
      dctx.drawImage(img, sx, sy, sw, sh, 0, 0, displayCanvas.width, displayCanvas.height)
    }
    img.src = imageUrl

    onMaskChange(maskCanvasRef.current)
    setHasDrawn(false)
  }, [imageUrl, onMaskChange])

  const cursorSize = Math.max(12, brushSize / 4)

  return (
    <div className="mask-editor">
      {/* Toolbar */}
      <div className="mask-toolbar">
        <div className="mask-toolbar-group">
          <button
            className={`toolbar-btn ${mode === 'draw' ? 'toolbar-active' : ''}`}
            onClick={() => setMode('draw')}
            title="Brush"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13.5c-2.5 2.5-5 5-7.5 7.5l-6-6c2.5-2.5 5-5 7.5-7.5" />
              <path d="M14.5 9.5l-5-5 2.5-2.5 5 5z" />
            </svg>
            <span>{t('brush')}</span>
          </button>
          <button
            className={`toolbar-btn ${mode === 'erase' ? 'toolbar-active' : ''}`}
            onClick={() => setMode('erase')}
            title={t('erase')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 20Z" />
              <path d="M17 17L7 7" />
            </svg>
            <span>{t('erase')}</span>
          </button>
        </div>

        <div className="mask-toolbar-divider" />

        <div className="mask-toolbar-group brush-size-group">
          <span className="toolbar-label">{t('size')}</span>
          <input
            type="range"
            min={4}
            max={80}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
          <span className="toolbar-value">{brushSize}px</span>
          <div
            className="brush-preview"
            style={{
              width: cursorSize,
              height: cursorSize,
              background: mode === 'draw' ? 'var(--accent)' : 'var(--danger)',
            }}
          />
        </div>

        <div className="mask-toolbar-divider" />

        <button className="btn btn-danger btn-sm" onClick={clearMask} title={t('clear')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
          {t('clear')}
        </button>
      </div>

      {/* Canvas */}
      <div className="mask-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="mask-canvas"
          onMouseDown={startDrawing}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onMouseMove={draw}
        />
        <div className="mask-hint">
          <span className="mask-hint-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
            {mode === 'draw' ? t('maskHintDraw') : t('maskHintErase')}
          </span>
        </div>
      </div>

      <style>{`
        .mask-editor {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .mask-toolbar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 12px;
          background: var(--bg-input);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }
        .mask-toolbar-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .mask-toolbar-divider {
          width: 1px;
          height: 24px;
          background: var(--border);
          margin: 0 4px;
        }
        .toolbar-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition);
        }
        .toolbar-btn:hover {
          background: var(--bg-card-hover);
          color: var(--text-primary);
        }
        .toolbar-btn.toolbar-active {
          background: var(--accent-dim);
          border-color: var(--accent);
          color: var(--accent);
        }
        .toolbar-label {
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
          margin-right: 4px;
        }
        .toolbar-value {
          font-size: 12px;
          color: var(--text-secondary);
          font-family: 'SF Mono', Monaco, monospace;
          min-width: 40px;
        }
        .brush-size-group {
          gap: 8px;
        }
        .brush-size-group input[type="range"] {
          width: 100px;
        }
        .brush-preview {
          border-radius: 50%;
          border: 2px solid var(--bg-card);
          box-shadow: 0 0 0 1px var(--border);
          transition: all var(--transition);
        }
        .btn-sm {
          padding: 6px 12px;
          font-size: 13px;
        }
        .mask-canvas-wrap {
          position: relative;
          display: flex;
          justify-content: center;
          background: var(--bg-input);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          padding: 16px;
          overflow: hidden;
        }
        .mask-canvas {
          max-width: 100%;
          max-height: 60vh;
          border-radius: var(--radius-sm);
          cursor: crosshair;
          display: block;
          box-shadow: var(--shadow);
        }
        .mask-hint {
          position: absolute;
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
        }
        .mask-hint-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          box-shadow: var(--shadow);
          font-size: 12px;
          backdrop-filter: blur(8px);
          transition: opacity 300ms ease;
        }
        @media (max-width: 640px) {
          .mask-toolbar {
            justify-content: center;
          }
          .mask-toolbar-divider {
            display: none;
          }
          .brush-size-group input[type="range"] {
            width: 60px;
          }
        }
      `}</style>
    </div>
  )
}
