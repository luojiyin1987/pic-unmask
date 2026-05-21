import { useState, useRef, useCallback } from 'react'

interface Props {
  resultUrl: string | null
  originalUrl: string | null
}

export default function ResultViewer({ resultUrl, originalUrl }: Props) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [sliderPos, setSliderPos] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const handleMouseDown = useCallback(() => {
    isDragging.current = true
  }, [])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging.current || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPos(pct)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.touches[0].clientX - rect.left
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSliderPos(pct)
  }, [])

  const handleTouchStart = useCallback(() => {
    isDragging.current = true
  }, [])

  if (!resultUrl && !originalUrl) {
    return (
      <div className="result-placeholder">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p>Your inpainted image will appear here</p>
      </div>
    )
  }

  return (
    <div className="result-viewer">
      {resultUrl ? (
        <>
          {/* Toggle */}
          <div className="result-toggle-bar">
            <div className="result-toggle-group">
              <button
                className={`toggle-btn ${!showOriginal ? 'toggle-active' : ''}`}
                onClick={() => setShowOriginal(false)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Result
              </button>
              <button
                className={`toggle-btn ${showOriginal ? 'toggle-active' : ''}`}
                onClick={() => setShowOriginal(true)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                </svg>
                Original
              </button>
            </div>

            <a
              href={resultUrl}
              download="migan-inpainting-result.png"
              className="btn btn-ghost btn-sm download-btn"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download
            </a>
          </div>

          {/* Image display */}
          <div className="result-image-wrap">
            {!showOriginal && originalUrl ? (
              <div
                className="compare-container"
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onMouseMove={handleMouseMove}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
              >
                {/* Background: original (before) */}
                <img src={originalUrl} alt="original" className="compare-base" />
                {/* Overlay: result (after) — clipped by slider position */}
                <div
                  className="compare-overlay"
                  style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                >
                  <img src={resultUrl} alt="result" className="compare-top" />
                </div>
                {/* Draggable slider line */}
                <div className="compare-slider" style={{ left: `${sliderPos}%` }}>
                  <div className="compare-slider-handle" />
                </div>
                <div className="compare-label compare-label-before">Before</div>
                <div className="compare-label compare-label-after">After</div>
              </div>
            ) : (
              <img
                src={showOriginal ? originalUrl! : resultUrl}
                alt="result"
                className="result-single-img"
              />
            )}
          </div>
        </>
      ) : (
        <div className="result-placeholder">
          <div className="result-placeholder-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p>Click "Run Inpainting" to generate the result</p>
          {originalUrl && (
            <img src={originalUrl} alt="original preview" className="result-preview-img" />
          )}
        </div>
      )}

      <style>{`
        .result-viewer {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .result-toggle-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
        }
        .result-toggle-group {
          display: flex;
          align-items: center;
          background: var(--bg-input);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px;
          gap: 2px;
        }
        .toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          background: transparent;
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition);
        }
        .toggle-btn:hover {
          color: var(--text-primary);
        }
        .toggle-btn.toggle-active {
          background: var(--bg-card);
          border-color: var(--border);
          color: var(--text-primary);
          box-shadow: var(--shadow);
        }
        .download-btn {
          gap: 6px;
        }
        .result-image-wrap {
          background: var(--bg-input);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          padding: 16px;
          display: flex;
          justify-content: center;
        }
        .result-single-img {
          max-width: 100%;
          max-height: 60vh;
          border-radius: var(--radius-sm);
          box-shadow: var(--shadow);
          display: block;
        }
        .result-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 48px 24px;
          color: var(--text-muted);
        }
        .result-placeholder-icon {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: var(--bg-input);
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .result-placeholder p {
          margin: 0;
          font-size: 14px;
        }
        .result-preview-img {
          max-width: 120px;
          max-height: 120px;
          border-radius: var(--radius-sm);
          opacity: 0.5;
          border: 1px solid var(--border);
        }

        /* Compare slider */
        .compare-container {
          position: relative;
          width: 100%;
          max-width: 720px;
          aspect-ratio: 1 / 1;
          cursor: ew-resize;
          user-select: none;
          border-radius: var(--radius-sm);
          overflow: hidden;
          box-shadow: var(--shadow);
          touch-action: none;
        }
        .compare-base {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
          filter: brightness(0.88) saturate(0.85);
        }
        .compare-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        .compare-top {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .compare-slider {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: var(--accent);
          transform: translateX(-50%);
          cursor: ew-resize;
          z-index: 10;
        }
        .compare-slider-handle {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--bg-card);
          border: 2px solid var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
          color: var(--accent);
          box-shadow: 0 0 12px var(--accent-glow);
        }
        .compare-label {
          position: absolute;
          bottom: 12px;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(4px);
          pointer-events: none;
          border: 1px solid var(--border);
        }
        .compare-label-before {
          left: 12px;
          color: var(--text-muted);
        }
        .compare-label-after {
          right: 12px;
          color: var(--accent);
        }
      `}</style>
    </div>
  )
}
