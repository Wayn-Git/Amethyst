import { useState, useRef, useEffect, useCallback } from 'react'
import Icon from './Icon.jsx'
import Markdown from './markdown/Markdown.jsx'
import ResponseEditor from './ResponseEditor.jsx'
import SelectionActionMenu from './SelectionActionMenu.jsx'
import { replaceSelectedInMarkdown } from './markdown/parse.js'
import { api, copyText } from '../api.js'

export default function ResponseArtifactBox({
  text,
  item,
  conversationId,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onOpenFullScreen,
  onRegenerate,
  onPin,
  onExportDocx,
  onViewSources,
  onBranchInNewChat,
}) {
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [artifact, setArtifact] = useState(null)
  const [copied, setCopied] = useState(false)
  const [justUpdated, setJustUpdated] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const docRef = useRef(null)
  const versionRef = useRef(null)
  const exportRef = useRef(null)
  const moreRef = useRef(null)

  // Load artifact metadata and version history
  useEffect(() => {
    if (!conversationId || !item.rowId) return
    let active = true
    api.messageArtifact(conversationId, item.rowId)
      .then((data) => {
        if (active && data && data.id) setArtifact(data)
      })
      .catch(() => {})
    return () => { active = false }
  }, [conversationId, item.rowId])

  // Click away for dropdowns
  useEffect(() => {
    const handleDown = (e) => {
      if (versionRef.current && !versionRef.current.contains(e.target)) {
        setVersionMenuOpen(false)
      }
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportMenuOpen(false)
      }
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [])

  const handleCopyDocument = async () => {
    const ok = await copyText(text)
    setCopied(ok)
    setTimeout(() => setCopied(false), 1500)
  }

  // Handle AI Transformation requested from floating selection menu
  const handleApplyAiChanges = useCallback(async (selectedText, promptText) => {
    if (!selectedText || !promptText) return
    try {
      const res = await api.aiTransform({
        text: selectedText,
        instruction: promptText,
        action: 'rewrite',
      })
      const transformed = res.result || res.transformed
      if (transformed && transformed !== selectedText) {
        const updatedFullText = replaceSelectedInMarkdown(text, selectedText, transformed)
        if (updatedFullText !== text && onSaveEdit) {
          setJustUpdated(true)
          setTimeout(() => setJustUpdated(false), 1200)
          await onSaveEdit(item, updatedFullText)
        }
        // Reload artifact versions
        if (conversationId && item.rowId) {
          const fresh = await api.messageArtifact(conversationId, item.rowId)
          if (fresh) setArtifact(fresh)
        }
      }
    } catch (err) {
      console.error('Failed to apply inline AI changes:', err)
    }
  }, [text, item, onSaveEdit, conversationId])

  // Handle format actions (Bold, Italic, Links, Block formatting) from selection menu
  const handleFormat = useCallback(async (type, selectedText) => {
    if (!selectedText) return
    let replaced = selectedText
    if (type === 'bold') {
      const isBold = selectedText.startsWith('**') && selectedText.endsWith('**')
      replaced = isBold ? selectedText.slice(2, -2) : `**${selectedText}**`
    } else if (type === 'italic') {
      const isItalic = selectedText.startsWith('*') && selectedText.endsWith('*')
      replaced = isItalic ? selectedText.slice(1, -1) : `*${selectedText}*`
    } else if (type === 'link') {
      const url = window.prompt('Enter link destination URL:', 'https://')
      if (!url) return
      replaced = `[${selectedText}](${url})`
    } else if (type === 'h1') {
      replaced = `\n# ${selectedText.replace(/^#+\s*/, '')}\n`
    } else if (type === 'h2') {
      replaced = `\n## ${selectedText.replace(/^#+\s*/, '')}\n`
    } else if (type === 'h3') {
      replaced = `\n### ${selectedText.replace(/^#+\s*/, '')}\n`
    } else if (type === 'ol') {
      replaced = `\n1. ${selectedText}\n`
    } else if (type === 'ul') {
      replaced = `\n- ${selectedText}\n`
    } else if (type === 'check') {
      replaced = `\n- [ ] ${selectedText}\n`
    } else if (type === 'p') {
      replaced = selectedText.replace(/^(\#{1,6}\s+|-\s+\[[\sx]\]\s+|-\s+|\d+\.\s+)/i, '')
    }

    if (replaced !== selectedText && onSaveEdit) {
      const updated = replaceSelectedInMarkdown(text, selectedText, replaced)
      if (updated !== text) {
        setJustUpdated(true)
        setTimeout(() => setJustUpdated(false), 1200)
        await onSaveEdit(item, updated)
      }
    }
  }, [text, item, onSaveEdit])

  const handleRevertVersion = async (verNum) => {
    if (!conversationId || !item.rowId) return
    setVersionMenuOpen(false)
    try {
      const rev = await api.revertMessageArtifact(conversationId, item.rowId, verNum)
      if (rev && rev.current_content) {
        setArtifact(rev)
        if (onSaveEdit) {
          setJustUpdated(true)
          setTimeout(() => setJustUpdated(false), 1200)
          await onSaveEdit(item, rev.current_content)
        }
      }
    } catch (err) {
      console.error('Revert failed:', err)
    }
  }

  const handleExport = (format) => {
    setExportMenuOpen(false)
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
      setMoreMenuOpen(false)
      return
    }
    window.speechSynthesis.cancel()
    const cleanText = text.replace(/[`#*_\[\]]/g, '')
    const utterance = new SpeechSynthesisUtterance(cleanText.slice(0, 4000))
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    window.speechSynthesis.speak(utterance)
    setSpeaking(true)
    setMoreMenuOpen(false)
  }

  const getFormattedTime = () => {
    const d = item.created_at || item.timestamp ? new Date(item.created_at || item.timestamp) : new Date()
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const isToday = new Date().toDateString() === d.toDateString()
    return isToday ? `Today, ${timeStr}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`
  }

  const hasSources = Boolean(
    item.sources?.length ||
    (item.toolCalls && item.toolCalls.some((c) => c.name?.includes('search') || c.name?.includes('web')))
  )

  // If in edit mode, render the response editor
  if (isEditing) {
    return (
      <div className="chat-assistant-response is-editing-box">
        <ResponseEditor
          initialText={text}
          conversationId={conversationId}
          messageId={item.rowId}
          isFullScreen={false}
          onSave={(newText) => onSaveEdit?.(item, newText)}
          onCancel={onCancelEdit}
        />
      </div>
    )
  }

  const versions = artifact?.versions || []
  const currentVer = artifact?.version || 1
  const canUndo = versions.length > 1 && currentVer > 1
  const canRedo = versions.some((v) => v.version > currentVer)

  return (
    <div className="chat-assistant-response">
      {/* Floating selection bubble menu for AI transformations & formatting */}
      <SelectionActionMenu
        containerRef={docRef}
        onFormat={handleFormat}
        onApplyChanges={handleApplyAiChanges}
        allowFormatting={true}
      />

      {/* Seamless Modern Prose Body (no card border, matching ChatGPT) */}
      <div
        className={`chat-assistant-prose${justUpdated ? ' is-ai-updated' : ''}`}
        ref={docRef}
      >
        <Markdown text={text} />
      </div>

      {/* Modern ChatGPT-Style Bottom Action Toolbar */}
      <div className="chat-assistant-toolbar" role="toolbar" aria-label="Response message actions">
        {/* Copy */}
        <button
          type="button"
          className="resp-action-btn"
          title={copied ? 'Copied!' : 'Copy'}
          aria-label="Copy response"
          onClick={handleCopyDocument}
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} />
        </button>

        {/* Edit */}
        {onStartEdit && (
          <button
            type="button"
            className="resp-action-btn"
            title="Edit response"
            aria-label="Edit response"
            onClick={onStartEdit}
          >
            <Icon name="edit" size={15} />
          </button>
        )}

        {/* Version History Pill & Undo/Redo (when versions exist) */}
        {artifact?.versions?.length > 1 && (
          <div className="resp-version-group" ref={versionRef}>
            <button
              type="button"
              className={`resp-version-pill${versionMenuOpen ? ' is-active' : ''}`}
              title={`Version ${artifact.version} (Click for history)`}
              onClick={() => setVersionMenuOpen((v) => !v)}
            >
              <span className="v-num">v{artifact.version}</span>
              <span className="v-tag">Edited</span>
            </button>

            <button
              type="button"
              className="resp-action-btn resp-action-btn--subtle"
              title="Undo version"
              disabled={!canUndo}
              onClick={() => {
                const prevVer = [...versions].reverse().find((v) => v.version < currentVer)?.version
                if (prevVer) handleRevertVersion(prevVer)
              }}
            >
              <Icon name="undo" size={13} />
            </button>

            <button
              type="button"
              className="resp-action-btn resp-action-btn--subtle"
              title="Redo version"
              disabled={!canRedo}
              onClick={() => {
                const nextVer = versions.find((v) => v.version > currentVer)?.version
                if (nextVer) handleRevertVersion(nextVer)
              }}
            >
              <Icon name="redo" size={13} />
            </button>

            {versionMenuOpen && (
              <div className="artifact-version-popover">
                <div className="version-popover-title">Version History</div>
                {artifact.versions.map((ver) => (
                  <button
                    key={ver.version}
                    type="button"
                    className={`version-popover-item${ver.version === artifact.version ? ' is-current' : ''}`}
                    onClick={() => handleRevertVersion(ver.version)}
                  >
                    <div className="version-meta-row">
                      <span className="v-pill">v{ver.version}</span>
                      <span className="v-author">
                        {ver.author === 'assistant' ? 'Original' : ver.author === 'ai_edit' ? 'AI edit' : 'User edit'}
                      </span>
                      {ver.version === artifact.version && <span className="v-active-pill">Current</span>}
                    </div>
                    {ver.change_summary && (
                      <div className="v-summary-row">{ver.change_summary}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Regenerate */}
        {onRegenerate && (
          <button
            type="button"
            className="resp-action-btn"
            title="Regenerate"
            aria-label="Regenerate response"
            onClick={onRegenerate}
          >
            <Icon name="refresh" size={15} />
          </button>
        )}

        {/* Share & Export */}
        <div className="resp-menu-anchor" ref={exportRef}>
          <button
            type="button"
            className={`resp-action-btn${exportMenuOpen ? ' is-active' : ''}`}
            title="Share & Export"
            aria-label="Share and export"
            onClick={() => { setExportMenuOpen((v) => !v); setMoreMenuOpen(false) }}
          >
            <Icon name="share" size={15} />
          </button>

          {exportMenuOpen && (
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

        {/* Fullscreen Workspace */}
        {onOpenFullScreen && (
          <button
            type="button"
            className="resp-action-btn"
            title="Fullscreen workspace"
            aria-label="Open fullscreen"
            onClick={onOpenFullScreen}
          >
            <Icon name="expand" size={15} />
          </button>
        )}

        {/* View Sources */}
        {hasSources && (
          <button
            type="button"
            className="resp-action-btn"
            title="View sources"
            aria-label="View sources"
            onClick={() => onViewSources?.(item)}
          >
            <Icon name="book" size={15} />
          </button>
        )}

        {/* More Menu (...) */}
        <div className="resp-menu-anchor" ref={moreRef}>
          <button
            type="button"
            className={`resp-action-btn${moreMenuOpen ? ' is-active' : ''}`}
            title="More actions"
            aria-label="More actions"
            onClick={() => { setMoreMenuOpen((v) => !v); setExportMenuOpen(false) }}
          >
            <Icon name="more" size={15} />
          </button>

          {moreMenuOpen && (
            <div className="response-popover-dropdown more-dropdown">
              <div className="popover-timestamp-header">
                {getFormattedTime()}
              </div>

              <button type="button" onClick={handleReadAloud}>
                <Icon name="speaker" size={14} />
                <span>{speaking ? 'Stop reading' : 'Read aloud'}</span>
              </button>

              {onBranchInNewChat && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    onBranchInNewChat?.(item)
                  }}
                >
                  <Icon name="branch" size={14} />
                  <span>Branch in new chat</span>
                </button>
              )}

              {onPin && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false)
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
    </div>
  )
}
