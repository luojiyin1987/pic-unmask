import React, { useRef, useCallback } from 'react'

interface Props {
  onImageLoaded: (url: string) => void
}

export default function UploadPanel({ onImageLoaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

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
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0])
      }
    },
    [handleFile]
  )

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      style={{
        border: '2px dashed #ccc',
        borderRadius: 8,
        padding: 24,
        textAlign: 'center',
        cursor: 'pointer',
        background: '#fafafa',
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onChange}
      />
      <div>Click or drop image here</div>
      <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Recommended: ~512×512 or larger</div>
    </div>
  )
}
