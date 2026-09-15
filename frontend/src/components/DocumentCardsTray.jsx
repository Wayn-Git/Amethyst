import Icon from './Icon.jsx'

/* Miniature visual mockups for uploaded file types matching Image 2 */
function CsvMiniPreview() {
  return (
    <div className="doc-preview doc-preview--csv" aria-hidden="true">
      <div className="doc-preview-table-head">
        <span>Platform</span>
        <span>Person</span>
        <span>Status</span>
      </div>
      <div className="doc-preview-table-row">
        <span className="doc-preview-cell">Amethyst</span>
        <span className="doc-preview-cell">Bilal</span>
        <span className="doc-preview-status"><i /> Running</span>
      </div>
      <div className="doc-preview-table-row doc-preview-table-row--muted">
        <span className="doc-preview-cell">Nova</span>
        <span className="doc-preview-cell">Wayne</span>
        <span className="doc-preview-status"><i /> Active</span>
      </div>
    </div>
  )
}

function PdfMiniPreview() {
  return (
    <div className="doc-preview doc-preview--pdf" aria-hidden="true">
      <div className="doc-preview-doc-head">
        <Icon name="doc" size={11} />
        <span>Transcript</span>
      </div>
      <div className="doc-preview-doc-lines">
        <span className="doc-line doc-line--long" />
        <span className="doc-line doc-line--med" />
        <span className="doc-line doc-line--short" />
        <span className="doc-line doc-line--med" />
      </div>
    </div>
  )
}

function CodeMiniPreview({ ext }) {
  return (
    <div className="doc-preview doc-preview--code" aria-hidden="true">
      <div className="doc-preview-code-head">
        <span className="doc-code-dot" />
        <span className="doc-code-dot" />
        <span className="doc-code-dot" />
        <span className="doc-code-lang">{ext}</span>
      </div>
      <div className="doc-preview-code-lines">
        <span className="doc-line doc-line--accent" style={{ width: '45%' }} />
        <span className="doc-line" style={{ width: '70%', marginLeft: '12px' }} />
        <span className="doc-line" style={{ width: '55%', marginLeft: '12px' }} />
        <span className="doc-line" style={{ width: '30%' }} />
      </div>
    </div>
  )
}

function GenericMiniPreview({ ext }) {
  return (
    <div className="doc-preview doc-preview--generic" aria-hidden="true">
      <Icon name="doc" size={20} className="doc-preview-generic-icon" />
      <span className="doc-preview-generic-ext">{ext}</span>
    </div>
  )
}

export default function DocumentCardsTray({ attachments = [], uploadingCount = 0, onRemove }) {
  if (attachments.length === 0 && uploadingCount === 0) return null

  const totalCount = attachments.length + uploadingCount

  return (
    <div className="doc-cards-tray">
      <div className="doc-cards-header">
        <Icon name="doc" size={12} />
        <span className="doc-cards-count">
          {totalCount} {totalCount === 1 ? 'source' : 'sources'}
        </span>
      </div>

      <div className="doc-cards-scroll">
        {/* In-progress uploading cards (Matching Image 2 left card) */}
        {Array.from({ length: uploadingCount }).map((_, i) => (
          <div className="doc-card doc-card--uploading" key={`uploading-${i}`}>
            <div className="doc-card-preview doc-card-preview--loading">
              <div className="doc-spinner" />
            </div>
            <div className="doc-card-info">
              <span className="doc-card-status">Uploading...</span>
            </div>
          </div>
        ))}

        {/* Uploaded attachments cards (Matching Image 2 CSV and PDF cards) */}
        {attachments.map((file) => {
          const parts = file.name.split('.')
          const ext = (parts.length > 1 ? parts.pop() : 'FILE').toUpperCase()
          const isCsv = ['CSV', 'TSV', 'XLS', 'XLSX'].includes(ext)
          const isPdf = ext === 'PDF'
          const isCode = ['JS', 'TS', 'JSX', 'TSX', 'PY', 'JSON', 'HTML', 'CSS', 'SH', 'RS', 'GO'].includes(ext)

          return (
            <div className="doc-card" key={file.path || file.name}>
              {/* Floating remove button at top right */}
              <button
                type="button"
                className="doc-card-remove-btn"
                onClick={() => onRemove(file)}
                title={`Remove ${file.name}`}
                aria-label={`Remove ${file.name}`}
              >
                <Icon name="x" size={10} />
              </button>

              <div className="doc-card-preview">
                {isCsv ? (
                  <CsvMiniPreview />
                ) : isPdf ? (
                  <PdfMiniPreview />
                ) : isCode ? (
                  <CodeMiniPreview ext={ext} />
                ) : (
                  <GenericMiniPreview ext={ext} />
                )}
              </div>

              <div className="doc-card-info">
                <span className="doc-card-name" title={file.name}>
                  {file.name}
                </span>
                <span className={`doc-card-badge doc-card-badge--${ext.toLowerCase()}`}>
                  {ext}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
