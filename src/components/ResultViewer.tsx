interface Props {
  resultUrl: string | null
  originalUrl: string | null
}

export default function ResultViewer({ resultUrl, originalUrl }: Props) {
  return (
    <div>
      {resultUrl ? (
        <div>
          <img
            src={resultUrl}
            alt="inpainted result"
            style={{ maxWidth: '100%', border: '1px solid #ddd', display: 'block' }}
          />
          <a
            href={resultUrl}
            download="migan-inpainting-result.png"
            style={{
              display: 'inline-block',
              marginTop: 12,
              padding: '8px 14px',
              border: '1px solid #bbb',
              borderRadius: 6,
              color: '#111',
              textDecoration: 'none',
              background: '#f5f5f5',
            }}
          >
            Download PNG
          </a>
        </div>
      ) : originalUrl ? (
        <div style={{ color: '#888', padding: '40px 0', textAlign: 'center' }}>
          Click “Run Inpainting” to generate result
        </div>
      ) : null}
    </div>
  )
}
