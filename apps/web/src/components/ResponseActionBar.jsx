import { Button as HouseButton } from './ui/bento/index.jsx'
import { useState, useRef, useEffect } from 'react'
import Icon from './Icon.jsx'
import { copyText } from '../api.js'

function exportTextBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ResponseActionBar({
  text,
  item,
  artifact,
  onEdit,
  onExpand,
  onRegenerate,
  onPin,
  onExportDocx,
}) {
  const [copied, setCopied] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!exportOpen) return undefined
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [exportOpen])

  const handleCopy = async () => {
    const ok = await copyText(text)
    setCopied(ok)
    setTimeout(() => setCopied(false), 1500)
  }

  const isSubstantial = text && (text.length > 80 || text.includes('\n'))

  const handleExport = async (format) => {
    setExportOpen(false)
    const baseName = `amethyst-response-${item.rowId || 'doc'}`
    if (format === 'md') {
      exportTextBlob(text, `${baseName}.md`, 'text/markdown')
    } else if (format === 'txt') {
      const plain = text.replace(/#+\s+/g, '').replace(/(\*\*|\*|`)/g, '')
      exportTextBlob(plain, `${baseName}.txt`, 'text/plain')
    } else if (format === 'html') {
      const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title><style>body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;max-width:800px;margin:40px auto;padding:0 20px;color:#18181b;background:#fafafa;}pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow-x:auto;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #e4e4e7;padding:8px;text-align:left;}</style></head><body><pre style="white-space:pre-wrap;font-family:inherit;">${text}</pre></body></html>`
      exportTextBlob(htmlDoc, `${baseName}.html`, 'text/html')
    } else if (format === 'docx' && onExportDocx) {
      setExporting(true)
      try {
        await onExportDocx(text, baseName)
      } finally {
        setExporting(false)
      }
    }
  }

  return (
    <div className="response-action-bar" role="toolbar" aria-label="Response actions">
      {artifact && artifact.version > 1 && (
        <HouseButton
          type="button"
          className="response-version-badge"
          title={`Version ${artifact.version} (Edited) — click to inspect`}
          onClick={onEdit}
        >
          <span className="version-tag">v{artifact.version}</span>
          <span className="version-label">Edited</span>
        </HouseButton>
      )}

      {isSubstantial && (
        <>
          <HouseButton
            type="button"
            className="response-action-btn"
            title="Edit this response document"
            aria-label="Edit response"
            onClick={onEdit}
          >
            <Icon name="edit" size={13} />
            <span className="btn-text">Edit</span>
          </HouseButton>

          <HouseButton
            type="button"
            className="response-action-btn"
            title="Open in full-screen workspace"
            aria-label="Full-screen editor"
            onClick={onExpand}
          >
            <Icon name="expand" size={13} />
            <span className="btn-text">Expand</span>
          </HouseButton>
        </>
      )}

      <HouseButton
        type="button"
        className="response-action-btn"
        title={copied ? 'Copied!' : 'Copy response markdown'}
        aria-label="Copy response"
        onClick={handleCopy}
      >
        <Icon name={copied ? 'check' : 'copy'} size={13} />
        <span className="btn-text">{copied ? 'Copied' : 'Copy'}</span>
      </HouseButton>

      {isSubstantial && (
        <div className="response-export-menu" ref={menuRef}>
          <HouseButton
            type="button"
            className="response-action-btn"
            title="Export or download document"
            aria-label="Export response"
            onClick={() => setExportOpen((prev) => !prev)}
            disabled={exporting}
          >
            <Icon name="download" size={13} />
            <span className="btn-text">{exporting ? 'Exporting...' : 'Export'}</span>
            <Icon name="chevron-down" size={10} />
          </HouseButton>

          {exportOpen && (
            <div className="export-dropdown-menu">
              <HouseButton type="button" onClick={() => handleExport('md')}>
                <Icon name="file" size={13} />
                <span>Markdown (.md)</span>
              </HouseButton>
              <HouseButton type="button" onClick={() => handleExport('txt')}>
                <Icon name="type" size={13} />
                <span>Plain Text (.txt)</span>
              </HouseButton>
              <HouseButton type="button" onClick={() => handleExport('html')}>
                <Icon name="globe" size={13} />
                <span>Standalone HTML (.html)</span>
              </HouseButton>
              <HouseButton type="button" onClick={() => handleExport('docx')}>
                <Icon name="doc" size={13} />
                <span>Word Document (.docx)</span>
              </HouseButton>
            </div>
          )}
        </div>
      )}

      {onRegenerate && (
        <HouseButton
          type="button"
          className="response-action-btn"
          title="Regenerate this answer"
          aria-label="Regenerate response"
          onClick={onRegenerate}
        >
          <Icon name="refresh" size={13} />
        </HouseButton>
      )}

      {onPin && (
        <HouseButton
          type="button"
          className={`response-action-btn${item.pinned ? ' is-pinned' : ''}`}
          title={item.pinned ? 'Unpin message' : 'Pin message'}
          aria-label="Pin message"
          onClick={() => onPin(item, !item.pinned)}
        >
          <Icon name="pin" size={13} />
        </HouseButton>
      )}
    </div>
  )
}
