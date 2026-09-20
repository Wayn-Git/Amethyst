import { useState, useRef, useEffect } from 'react'
import Icon from './Icon.jsx'
import { copyText } from '../api.js'

export default function ResponseMessageActions({
  text,
  item,
  onRegenerate,
  onPin,
  onExportDocx,
  onViewSources,
  onBranchInNewChat,
}) {
  const [copied, setCopied] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const shareRef = useRef(null)
  const moreRef = useRef(null)

  useEffect(() => {
    const handleDown = (e) => {
      if (shareRef.current && !shareRef.current.contains(e.target)) {
        setShareOpen(false)
      }
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [])

  const handleCopy = async () => {
    const ok = await copyText(text)
    setCopied(ok)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleExport = (format) => {
    setShareOpen(false)
    const baseName = `amethyst-response-${item.rowId || 'doc'}`
    if (format === 'docx' && onExportDocx) {
      onExportDocx(text, baseName)
    } else if (format === 'md') {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } else if (format === 'txt') {
      const plain = text.replace(/#+\s+/g, '').replace(/(\*\*|\*|`)/g, '')
      const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.txt`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } else if (format === 'html') {
      const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title><style>body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;max-width:800px;margin:40px auto;padding:0 24px;color:#18181b;background:#fafafa;}pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow-x:auto;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #e4e4e7;padding:8px 12px;text-align:left;}</style></head><body><pre style="white-space:pre-wrap;font-family:inherit;">${text}</pre></body></html>`
      const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${baseName}.html`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  const handleReadAloud = () => {
    if (!('speechSynthesis' in window)) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      setMoreOpen(false)
      return
    }
    window.speechSynthesis.cancel()
    const cleanText = text.replace(/[`#*_\[\]]/g, '')
    const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 4000))
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
    setMoreOpen(false)
  }

  // Format timestamp like "Today, 8:17 PM"
  const getFormattedTime = () => {
    const d = item.created_at || item.timestamp ? new Date(item.created_at || item.timestamp) : new Date()
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const isToday = new Date().toDateString() === d.toDateString()
    return isToday ? `Today, ${timeStr}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`
  }

  const hasSources = Boolean(item.sources?.length || (item.toolCalls && item.toolCalls.some(c => c.name?.includes('search'))))

  return (
    <div className="response-message-actions-row" role="toolbar" aria-label="Response message actions">
      {/* 1. Copy */}
      <button
        type="button"
        className="msg-action-icon-btn"
        title={copied ? 'Copied!' : 'Copy'}
        aria-label="Copy response"
        onClick={handleCopy}
      >
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </button>

      {/* 2. Share / Export */}
      <div className="msg-action-menu-anchor" ref={shareRef}>
        <button
          type="button"
          className={`msg-action-icon-btn${shareOpen ? ' is-active' : ''}`}
          title="Share & Export"
          aria-label="Share and export"
          onClick={() => { setShareOpen((v) => !v); setMoreOpen(false) }}
        >
          <Icon name="share" size={15} />
        </button>

        {shareOpen && (
          <div className="response-popover-dropdown export-dropdown">
            <button type="button" onClick={() => handleExport('docx')}>
              <Icon name="page" size={14} />
              <span>Word Document (.docx)</span>
            </button>
            <button type="button" onClick={() => handleExport('md')}>
              <Icon name="code" size={14} />
              <span>Markdown (.md)</span>
            </button>
            <button type="button" onClick={() => handleExport('html')}>
              <Icon name="globe" size={14} />
              <span>Standalone HTML (.html)</span>
            </button>
            <button type="button" onClick={() => handleExport('txt')}>
              <Icon name="type" size={14} />
              <span>Plain Text (.txt)</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Regenerate */}
      {onRegenerate && (
        <button
          type="button"
          className="msg-action-icon-btn"
          title="Regenerate"
          aria-label="Regenerate response"
          onClick={onRegenerate}
        >
          <Icon name="refresh" size={15} />
        </button>
      )}

      {/* 4. More actions (...) */}
      <div className="msg-action-menu-anchor" ref={moreRef}>
        <button
          type="button"
          className={`msg-action-icon-btn${moreOpen ? ' is-active' : ''}`}
          title="More"
          aria-label="More actions"
          onClick={() => { setMoreOpen((v) => !v); setShareOpen(false) }}
        >
          <Icon name="more" size={15} />
        </button>

        {moreOpen && (
          <div className="response-popover-dropdown more-dropdown">
            <div className="popover-timestamp-header">
              {getFormattedTime()}
            </div>

            {hasSources && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  onViewSources?.()
                }}
              >
                <Icon name="book" size={14} />
                <span>View sources</span>
              </button>
            )}

            {onBranchInNewChat && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  onBranchInNewChat?.(item)
                }}
              >
                <Icon name="branch" size={14} />
                <span>Branch in new chat</span>
              </button>
            )}

            <button type="button" onClick={handleReadAloud}>
              <Icon name="speaker" size={14} />
              <span>{speaking ? 'Stop reading' : 'Read aloud'}</span>
            </button>

            {onPin && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  onPin(item, !item.pinned)
                }}
              >
                <Icon name="pin" size={14} />
                <span>{item.pinned ? 'Unpin message' : 'Pin message'}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
