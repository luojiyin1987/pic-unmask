interface Props {
  resultUrl: string | null
  originalUrl: string | null
}

export default function ResultViewer({ resultUrl, originalUrl }: Props) {
  return (
    <div>
      {resultUrl ? (
        <img
          src={resultUrl}
          alt="inpainted result"
          style={{ maxWidth: '100%', border: '1px solid #ddd' }}
        />
      ) : originalUrl ? (
        <div style={{ color: '#888', padding: '40px 0', textAlign: 'center' }}>
          Click “Run Inpainting” to generate result
        </div>
      ) : null}
    </div>
  )
}
