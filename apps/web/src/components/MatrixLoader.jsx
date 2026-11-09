export default function MatrixLoader({ phase = 'thinking' }) {
  return (
    <span className={`matrix-loader matrix-loader--${phase}`} aria-hidden="true">
      <span className="matrix-dot" style={{ animationDelay: '0s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.14s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.28s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.14s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.28s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.42s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.28s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.42s' }} />
      <span className="matrix-dot" style={{ animationDelay: '0.56s' }} />
    </span>
  )
}
