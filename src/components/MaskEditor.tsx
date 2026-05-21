import React, { useRef, useEffect, useState, useCallback } from 'react'

interface Props {
  imageUrl: string
  onMaskChange: (canvas: HTMLCanvasElement) => void
}

export default function MaskEditor({ imageUrl, onMaskChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [brushSize, setBrushSize] = useState(20)
  const [mode, setMode] = useState<'draw' | 'erase'>('draw')
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Initialize canvases when image loads
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const displayCanvas = canvasRef.current!
      // Fixed display size for UI consistency; actual mask is always 512×512
      const displaySize = 512
      displayCanvas.width = displaySize
      displayCanvas.height = displaySize

      const ctx = displayCanvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, displaySize, displaySize)

      // Hidden mask canvas at 512×512
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = 512
      maskCanvas.height = 512
      const maskCtx = maskCanvas.getContext('2d')!
      maskCtx.clearRect(0, 0, 512, 512)
      maskCanvasRef.current = maskCanvas
      onMaskChange(maskCanvas)
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
      dctx.strokeStyle = 'rgba(255,0,0,0.5)'
      dctx.lineWidth = brushSize
      dctx.lineCap = 'round'
      dctx.lineJoin = 'round'
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
    },
    [applyStroke, onMaskChange]
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
      dctx.drawImage(img, 0, 0, displayCanvas.width, displayCanvas.height)
    }
    img.src = imageUrl

    onMaskChange(maskCanvasRef.current)
  }, [imageUrl, onMaskChange])

  return (
    <div ref={containerRef}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <button onClick={() => setMode('draw')} style={{ fontWeight: mode === 'draw' ? 'bold' : 'normal' }}>
          Brush
        </button>
        <button onClick={() => setMode('erase')} style={{ fontWeight: mode === 'erase' ? 'bold' : 'normal' }}>
          Erase
        </button>
        <label style={{ fontSize: 12 }}>
          Size: {brushSize}
          <input
            type="range"
            min={4}
            max={100}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            style={{ marginLeft: 4, verticalAlign: 'middle' }}
          />
        </label>
        <button onClick={clearMask}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ border: '1px solid #ccc', maxWidth: '100%', cursor: 'crosshair' }}
        onMouseDown={startDrawing}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onMouseMove={draw}
      />
    </div>
  )
}
