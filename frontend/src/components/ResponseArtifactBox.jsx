import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ThumbsUp, ThumbsDown } from 'lucide-react'
import Icon from './Icon.jsx'
import Markdown from './markdown/Markdown.jsx'
import ResponseEditor from './ResponseEditor.jsx'
import SelectionActionMenu, { cleanAiTransformOutput } from './SelectionActionMenu.jsx'
import { extractSourcesFromMessage } from './SourcesSidePanel.jsx'
import { replaceSelectedInMarkdown } from './markdown/parse.js'
import { api, copyText } from '../api.js'

function extractFollowUps(item, text) {
  if (Array.isArray(item?.followUps) && item.followUps.length > 0) return item.followUps
  if (Array.isArray(item?.suggestions) && item.suggestions.length > 0) return item.suggestions

  if (typeof text !== 'string') return []
  const followUpMatch = text.match(/(?:(?:###\s*|(?:\*\*))?(?:Follow-up[s]?|Suggested questions|Next steps)(?:\*\*)?:?\s*\n)([\s\S]+?)$/i)
  if (followUpMatch) {
    const lines = followUpMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter((l) => l.length > 5 && l.length < 120 && (l.endsWith('?') || !l.includes('.')))
    if (lines.length > 0) return lines.slice(0, 3)
  }
  return []
}

export default function ResponseArtifactBox({
  text,
  item,
  minimalToolbar = false,
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
  onFollowUp,
  onRefer,
  onAskQuote,
}) {
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [vote, setVote] = useState(null)
  const [artifact, setArtifact] = useState(null)
  const [copied, setCopied] = useState(false)
  const [justUpdated, setJustUpdated] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  const docRef = useRef(null)
  const versionRef = useRef(null)
  const exportRef = useRef(null)
  const moreRef = useRef(null)

  const sources = useMemo(() => extractSourcesFromMessage(item), [item])
  const followUps = useMemo(() => extractFollowUps(item, text), [item, text])

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

// Helper to toggle markdown formatting (bold, italic, code, strike) without stacking asterisks
function toggleMarkdownFormat(fullMarkdown, selectedText, formatType) {
  if (!fullMarkdown || !selectedText) return fullMarkdown

  const clean = selectedText.replace(/^[*_`~]+|[*_`~]+$/g, '').trim()
  if (!clean) return fullMarkdown

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escaped = escapeRegExp(clean)

  if (formatType === 'bold') {
    const anyBoldPattern = new RegExp(`(\\*{2,}|_{2,})\\s*${escaped}\\s*(\\*{2,}|_{2,})`)
    if (anyBoldPattern.test(fullMarkdown)) {
      return fullMarkdown.replace(anyBoldPattern, clean)
    }
    return replaceSelectedInMarkdown(fullMarkdown, selectedText, `**${clean}**`)
  }

  if (formatType === 'italic') {
    const italicPattern = new RegExp(`(?<!\\*)\\*(?!\\*)\\s*${escaped}\\s*(?<!\\*)\\*(?!\\*)|(?<!_)\\b_(?!_)\\s*${escaped}\\s*(?<!_)\\b_(?!_)`)
    if (italicPattern.test(fullMarkdown)) {
      return fullMarkdown.replace(italicPattern, clean)
    }
    return replaceSelectedInMarkdown(fullMarkdown, selectedText, `*${clean}*`)
  }

  if (formatType === 'code') {
    const codePattern = new RegExp(`\`+\\s*${escaped}\\s*\`+`)
    if (codePattern.test(fullMarkdown)) {
      return fullMarkdown.replace(codePattern, clean)
    }
    return replaceSelectedInMarkdown(fullMarkdown, selectedText, `\`${clean}\``)
  }

  if (formatType === 'strike') {
    const strikePattern = new RegExp(`~{2,}\\s*${escaped}\\s*~{2,}`)
    if (strikePattern.test(fullMarkdown)) {
      return fullMarkdown.replace(strikePattern, clean)
    }
    return replaceSelectedInMarkdown(fullMarkdown, selectedText, `~~${clean}~~`)
  }

  return fullMarkdown
}

  // Handle AI Transformation requested from floating selection menu
  const handleApplyAiChanges = useCallback(async (selectedText, promptOrResult, isAlreadyTransformed = false) => {
    if (!selectedText || !promptOrResult) return
    try {
      let transformed = ''
      if (isAlreadyTransformed) {
        transformed = cleanAiTransformOutput(promptOrResult, selectedText)
      } else {
        const res = await api.aiTransform({
          text: selectedText,
          instruction: promptOrResult,
          action: 'improve',
        })
        transformed = cleanAiTransformOutput(res.result || res.transformed, selectedText)
      }
      if (transformed && transformed !== selectedText) {
        const updatedFullText = replaceSelectedInMarkdown(text, selectedText, transformed)
        if (updatedFullText !== text && onSaveEdit) {
          setJustUpdated(true)
          setTimeout(() => setJustUpdated(false), 1200)
          await onSaveEdit(item, updatedFullText)
        }
        if (conversationId && item.rowId) {
          const fresh = await api.messageArtifact(conversationId, item.rowId)
          if (fresh) setArtifact(fresh)
        }
      }
    } catch (err) {
      console.error('Failed to apply inline AI changes:', err)
    }
  }, [text, item, onSaveEdit, conversationId])

  // Handle format actions (Bold, Italic, Code, Links, Block formatting) from selection menu
  const handleFormat = useCallback(async (type, selectedText) => {
    if (!selectedText) return
    let updated = text

    if (['bold', 'italic', 'code', 'strike'].includes(type)) {
      updated = toggleMarkdownFormat(text, selectedText, type)
    } else if (type === 'link') {
      const url = window.prompt('Enter link destination URL:', 'https://')
      if (!url) return
      updated = replaceSelectedInMarkdown(text, selectedText, `[${selectedText}](${url})`)
    } else if (type === 'h1') {
      updated = replaceSelectedInMarkdown(text, selectedText, `\n# ${selectedText.replace(/^#+\s*/, '')}\n`)
    } else if (type === 'h2') {
      updated = replaceSelectedInMarkdown(text, selectedText, `\n## ${selectedText.replace(/^#+\s*/, '')}\n`)
    } else if (type === 'h3') {
      updated = replaceSelectedInMarkdown(text, selectedText, `\n### ${selectedText.replace(/^#+\s*/, '')}\n`)
    } else if (type === 'ol') {
      updated = replaceSelectedInMarkdown(text, selectedText, `\n1. ${selectedText}\n`)
    } else if (type === 'ul') {
      updated = replaceSelectedInMarkdown(text, selectedText, `\n- ${selectedText}\n`)
    } else if (type === 'check') {
      updated = replaceSelectedInMarkdown(text, selectedText, `\n- [ ] ${selectedText}\n`)
    } else if (type === 'p') {
      const cleanP = selectedText.replace(/^(\#{1,6}\s+|-\s+\[[\sx]\]\s+|-\s+|\d+\.\s+)/i, '')
      updated = replaceSelectedInMarkdown(text, selectedText, cleanP)
    }

    if (updated !== text && onSaveEdit) {
      setJustUpdated(true)
      setTimeout(() => setJustUpdated(false), 1200)
      await onSaveEdit(item, updated)
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

  const hasSources = sources.length > 0

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
      {/* Floating selection capsule for AI transformations & formatting */}
      <SelectionActionMenu
        containerRef={docRef}
        onFormat={handleFormat}
        onApplyChanges={handleApplyAiChanges}
        allowFormatting={true}
        onRefer={onRefer}
        onAskQuote={onAskQuote}
      />

      {/* Modern Prose Body */}
      <div
        className={`chat-assistant-prose${justUpdated ? ' is-ai-updated' : ''}`}
        ref={docRef}
      >
        <Markdown text={text} />
      </div>

      {/* Action Toolbar */}
      {minimalToolbar ? (
        <div className="chat-assistant-toolbar chat-assistant-toolbar--minimal" role="toolbar" aria-label="Step actions">
          <button
            type="button"
            className="resp-action-btn resp-action-btn--subtle"
            title={copied ? 'Copied!' : 'Copy'}
            aria-label="Copy step text"
            onClick={handleCopyDocument}
          >
            <Icon name={copied ? 'check' : 'copy'} size={14} />
          </button>
        </div>
      ) : (
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

          {/* Thumbs up */}
          <button
            type="button"
            className={`resp-action-btn${vote === 'up' ? ' is-active text-emerald-500' : ''}`}
            title="Good response"
            aria-label="Thumbs up"
            onClick={() => setVote((v) => (v === 'up' ? null : 'up'))}
          >
            <ThumbsUp size={14} strokeWidth={vote === 'up' ? 2.4 : 1.8} />
          </button>

          {/* Thumbs down */}
          <button
            type="button"
            className={`resp-action-btn${vote === 'down' ? ' is-active text-rose-500' : ''}`}
            title="Bad response"
            aria-label="Thumbs down"
            onClick={() => setVote((v) => (v === 'down' ? null : 'down'))}
          >
            <ThumbsDown size={14} strokeWidth={vote === 'down' ? 2.4 : 1.8} />
          </button>

          {/* Sources Toggle Button with avatar stack */}
          {hasSources && (
            <button
              type="button"
              className={`resp-sources-toggle-btn${sourcesOpen ? ' is-active' : ''}`}
              onClick={() => setSourcesOpen((o) => !o)}
              title={`${sources.length} sources (Click to view)`}
              aria-expanded={sourcesOpen}
            >
              <span className="flex -space-x-1.5 overflow-hidden">
                {sources.slice(0, 3).map((s, idx) => (
                  <img
                    key={idx}
                    src={`https://www.google.com/s2/favicons?domain=${s.domain}&sz=32`}
                    alt=""
                    className="size-3.5 rounded-full ring-1 ring-white dark:ring-[#101114] bg-neutral-200 dark:bg-neutral-700"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                ))}
              </span>
              <span className="font-mono text-[11px]">{sources.length} {sources.length === 1 ? 'source' : 'sources'}</span>
            </button>
          )}

          {/* Version History Pill & Undo/Redo */}
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

                {onViewSources && hasSources && (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false)
                      onViewSources?.(item)
                    }}
                  >
                    <Icon name="book" size={14} />
                    <span>Open in sources panel</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Collapsible Sources Accordion */}
      {hasSources && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
          style={{
            gridTemplateRows: sourcesOpen ? '1fr' : '0fr',
            opacity: sourcesOpen ? 1 : 0,
          }}
        >
          <div className="overflow-hidden">
            <div className="resp-sources-container">
              {sources.map((source, i) => (
                <a
                  key={source.url || i}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="resp-source-item group"
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=32`}
                    alt=""
                    className="resp-source-favicon"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  <span className="resp-source-title">{source.title}</span>
                  <span className="resp-source-domain">{source.domain}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Follow-ups Section */}
      {followUps.length > 0 && (
        <div className="mt-3.5 pt-2.5 border-t border-neutral-200/50 dark:border-white/[0.06]">
          <p className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">Follow-ups</p>
          <div className="flex flex-col gap-0.5">
            {followUps.map((promptText, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onFollowUp?.(promptText, i)}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/[0.05] transition-colors cursor-pointer group"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-neutral-400 dark:text-neutral-500 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors"
                >
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                <span className="truncate">{promptText}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
