import { useRef, useCallback, useState } from 'react'
import { useI18n } from '../lib/I18nContext'

interface Props {
  onImageLoaded: (url: string) => void
  hasImage: boolean
}

export default function UploadPanel({ onImageLoaded, hasImage }: Props) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return
      const url = URL.createObjectURL(file)
      onImageLoaded(url)
    },
    [onImageLoaded]
  )

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
        handleFile(e.target.files[0])
      }
    },
    [handleFile]
  )

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOver(false)
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0])
      }
    },
    [handleFile]
  )

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => {
    setIsDragOver(false)
  }, [])

  return (
    <div
      className={`upload-zone ${isDragOver ? 'drag-over' : ''} ${hasImage ? 'has-image' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={onChange} />

      <div className="upload-content">
        <div className="upload-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="upload-text">
          <p className="upload-title">{t('uploadHint')}</p>
          <p className="upload-hint">{t('uploadSubHint')}</p>
        </div>
      </div>

      <div className="upload-privacy">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
        <span>{t('privacyUploadHint')}</span>
      </div>

      <style>{`
        .upload-zone {
          position: relative;
          border: 2px dashed var(--border);
          border-radius: var(--radius-lg);
          padding: 40px 24px;
          text-align: center;
          cursor: pointer;
          background: var(--bg-input);
          transition: all var(--transition);
          overflow: hidden;
        }
        .upload-zone::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, var(--accent-dim), transparent 60%);
          opacity: 0;
          transition: opacity var(--transition);
        }
        .upload-zone:hover {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }
        .upload-zone:hover::before {
          opacity: 1;
        }
        .upload-zone.drag-over {
          border-color: var(--accent);
          background: var(--accent-dim);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }
        .upload-zone.drag-over::before {
          opacity: 1;
        }
        .upload-zone input {
          display: none;
        }
        .upload-content {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        .upload-icon {
          width: 64px;
          height: 64px;
          border-radius: var(--radius-md);
          background: var(--bg-card);
          border: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent);
          transition: transform var(--transition), box-shadow var(--transition);
        }
        .upload-zone:hover .upload-icon {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px var(--accent-glow);
        }
        .upload-title {
          margin: 0;
          font-size: 15px;
          font-weight: 500;
          color: var(--text-primary);
        }
        .upload-hint {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
        }
        .upload-privacy {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-top: 16px;
          font-size: 12px;
          color: #15803d;
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}
