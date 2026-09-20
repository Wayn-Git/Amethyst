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
}) {
  const [versionMenuOpen, setVersionMenuOpen] = useState(false)
  const [artifact, setArtifact] = useState(null)
  const [copied, setCopied] = useState(false)
  const [copyTooltip, setCopyTooltip] = useState(false)
  const [justUpdated, setJustUpdated] = useState(false)

  const docRef = useRef(null)
  const versionRef = useRef(null)

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

  // Click away for version dropdown
  useEffect(() => {
    if (!versionMenuOpen) return
    const handleDown = (e) => {
      if (versionRef.current && !versionRef.current.contains(e.target)) {
        setVersionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [versionMenuOpen])

  const handleCopyDocument = async () => {
    const ok = await copyText(text)
    setCopied(ok)
    setTimeout(() => setCopied(false), 1500)
  }

  // Handle AI Transformation requested from floating selection menu (Image 5)
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

  // If in edit mode, render the response editor
  if (isEditing) {
    return (
      <div className="artifact-box-wrapper is-editing-box">
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
    <div className="artifact-box-wrapper">
      <div className={`artifact-container-card${justUpdated ? ' is-ai-updated' : ''}`}>
        {/* Top Header Bar matching Image 1 & Image 3 */}
        <div className="artifact-card-header">
          <div className="artifact-header-left">
            <button
              type="button"
              className="artifact-edit-pill"
              onClick={onStartEdit}
              title="Edit this response document"
            >
              <Icon name="edit" size={13} />
              <span>Edit</span>
            </button>
          </div>

          <div className="artifact-header-right">
            {/* Version History / Undo */}
            <div className="artifact-header-menu-anchor" ref={versionRef}>
              <button
                type="button"
                className={`artifact-header-btn${versionMenuOpen ? ' is-active' : ''}`}
                title={artifact?.version > 1 ? `Version ${artifact.version} (Click to view history)` : "Undo / Version history"}
                disabled={!canUndo && !artifact?.versions?.length}
                onClick={() => setVersionMenuOpen((v) => !v)}
              >
                <Icon name="undo" size={15} />
              </button>

              {versionMenuOpen && artifact?.versions?.length > 0 && (
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

            {/* Redo icon button */}
            <button
              type="button"
              className="artifact-header-btn"
              title="Redo version"
              disabled={!canRedo}
              onClick={() => {
                const nextVer = versions.find((v) => v.version > currentVer)?.version
                if (nextVer) handleRevertVersion(nextVer)
              }}
            >
              <Icon name="redo" size={15} />
            </button>

            {/* Copy Document with tooltip */}
            <div
              className="artifact-header-btn-wrap"
              onMouseEnter={() => setCopyTooltip(true)}
              onMouseLeave={() => setCopyTooltip(false)}
            >
              <button
                type="button"
                className="artifact-header-btn"
                title="Copy"
                onClick={handleCopyDocument}
              >
                <Icon name={copied ? 'check' : 'copy'} size={15} />
              </button>
              {copyTooltip && (
                <div className="artifact-floating-tooltip">
                  {copied ? 'Copied' : 'Copy'}
                </div>
              )}
            </div>

            {/* Fullscreen Expand */}
            <button
              type="button"
              className="artifact-header-btn"
              title="Fullscreen view"
              onClick={onOpenFullScreen}
            >
              <Icon name="expand" size={15} />
            </button>
          </div>
        </div>

        {/* Floating selection bubble menu matching Image 4 & 5 */}
        <SelectionActionMenu
          containerRef={docRef}
          onFormat={handleFormat}
          onApplyChanges={handleApplyAiChanges}
        />

        {/* Document Body */}
        <div className="artifact-card-body" ref={docRef}>
          <Markdown text={text} />
        </div>
      </div>
    </div>
  )
}
