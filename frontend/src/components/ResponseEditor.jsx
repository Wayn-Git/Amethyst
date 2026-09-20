import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Icon from './Icon.jsx'
import Markdown from './markdown/Markdown.jsx'
import SelectionActionMenu from './SelectionActionMenu.jsx'
import { api, copyText } from '../api.js'

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

const SLASH_COMMANDS = [
  { id: 'generate', label: 'Generate text', icon: 'zap' },
  { id: 'divider', label: 'Divider', icon: 'minus-circle' },
  { id: 'checklist', label: 'Checklist', icon: 'check' },
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'h1', label: 'Heading 1', icon: 'type' },
  { id: 'h2', label: 'Heading 2', icon: 'type' },
  { id: 'h3', label: 'Heading 3', icon: 'type' },
  { id: 'ol', label: 'Numbered list', icon: 'list' },
  { id: 'ul', label: 'Bulleted list', icon: 'list' },
]

export default function ResponseEditor({
  initialText,
  conversationId,
  messageId,
  isFullScreen = false,
  onSave,
  onCancel,
  onCloseFullScreen,
}) {
  const [content, setContent] = useState(initialText || '')
  const [originalContent, setOriginalContent] = useState(initialText || '')
  const [viewMode, setViewMode] = useState(isFullScreen ? 'split' : 'edit') // 'edit' | 'split' | 'preview'
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // Undo / Redo history stacks
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])

  // Version management
  const [artifact, setArtifact] = useState(null)
  const [versionDropdownOpen, setVersionDropdownOpen] = useState(false)

  // Find & Replace
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)

  // AI Transform
  const [aiMenuOpen, setAiMenuOpen] = useState(false)
  const [aiTransforming, setAiTransforming] = useState(false)
  const [aiProposal, setAiProposal] = useState(null) // { original, transformed, range }

  // Export menu
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Slash commands menu state (Image 2)
  const [slashMenu, setSlashMenu] = useState({
    open: false,
    query: '',
    activeIndex: 0,
    cursorPos: 0,
    coords: { top: 60, left: 30 },
  })

  // Inline AI generation prompt (Image 2 - Generate text)
  const [generatePromptOpen, setGeneratePromptOpen] = useState(false)
  const [generatePrompt, setGeneratePrompt] = useState('')
  const [generating, setGenerating] = useState(false)

  const textareaRef = useRef(null)
  const previewRef = useRef(null)
  const editorPaneRef = useRef(null)
  const slashMenuRef = useRef(null)
  const generateInputRef = useRef(null)
  const aiDropdownRef = useRef(null)
  const exportDropdownRef = useRef(null)

  // Click away handlers for dropdowns
  useEffect(() => {
    if (!aiMenuOpen && !exportOpen && !versionDropdownOpen) return
    const handleClickOutside = (e) => {
      if (aiMenuOpen && aiDropdownRef.current && !aiDropdownRef.current.contains(e.target)) {
        setAiMenuOpen(false)
      }
      if (exportOpen && exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [aiMenuOpen, exportOpen, versionDropdownOpen])

  // Load artifact metadata and versions on mount
  useEffect(() => {
    if (!conversationId || !messageId) return
    let active = true
    api.messageArtifact(conversationId, messageId)
      .then((art) => {
        if (!active || !art) return
        setArtifact(art)
        if (art.current_content && !content) {
          setContent(art.current_content)
          setOriginalContent(art.original_content || art.current_content)
        }
      })
      .catch((err) => console.warn('Could not load message artifact:', err))
    return () => { active = false }
  }, [conversationId, messageId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Document metrics
  const stats = useMemo(() => {
    const chars = content.length
    const words = (content.trim().match(/\S+/g) || []).length
    const readingMinutes = Math.max(1, Math.round(words / 200))
    return { chars, words, readingMinutes }
  }, [content])

  // Find matches count
  const matchCount = useMemo(() => {
    if (!findQuery) return 0
    try {
      const flags = matchCase ? 'g' : 'gi'
      const regex = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
      const matches = content.match(regex)
      return matches ? matches.length : 0
    } catch {
      return 0
    }
  }, [content, findQuery, matchCase])

  const handleTextChange = (newVal) => {
    setUndoStack((prev) => [...prev.slice(-30), content])
    setRedoStack([])
    setContent(newVal)
  }

  const handleUndo = () => {
    if (!undoStack.length) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack((r) => [...r, content])
    setUndoStack((u) => u.slice(0, -1))
    setContent(prev)
  }

  const handleRedo = () => {
    if (!redoStack.length) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack((u) => [...u, content])
    setRedoStack((r) => r.slice(0, -1))
    setContent(next)
  }

  // Filter slash commands
  const filteredCommands = useMemo(() => {
    if (!slashMenu.query) return SLASH_COMMANDS
    const q = slashMenu.query.toLowerCase()
    return SLASH_COMMANDS.filter((cmd) => cmd.label.toLowerCase().includes(q))
  }, [slashMenu.query])

  // Execute slash command
  const executeSlashCommand = useCallback((cmdId) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const pos = textarea.selectionStart ?? slashMenu.cursorPos
    // Find line range where / was typed
    const textBefore = content.slice(0, pos)
    const lineStart = textBefore.lastIndexOf('\n') + 1
    const lineEndIdx = content.indexOf('\n', pos)
    const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx

    const lineText = content.slice(lineStart, lineEnd)
    const cleanLine = lineText.replace(/^\/(\w*)/, '').trim()

    setSlashMenu({ open: false, query: '', activeIndex: 0, cursorPos: 0, coords: { top: 0, left: 0 } })

    if (cmdId === 'generate') {
      setGeneratePromptOpen(true)
      setTimeout(() => generateInputRef.current?.focus(), 50)
      return
    }

    if (cmdId === 'divider') {
      const replacement = `\n---\n`
      handleTextChange(content.slice(0, lineStart) + replacement + content.slice(lineEnd))
      return
    }

    let prefix = ''
    if (cmdId === 'checklist') prefix = '- [ ] '
    else if (cmdId === 'text') prefix = ''
    else if (cmdId === 'h1') prefix = '# '
    else if (cmdId === 'h2') prefix = '## '
    else if (cmdId === 'h3') prefix = '### '
    else if (cmdId === 'ol') prefix = '1. '
    else if (cmdId === 'ul') prefix = '- '

    const newLine = `${prefix}${cleanLine}`
    handleTextChange(content.slice(0, lineStart) + newLine + content.slice(lineEnd))
    setTimeout(() => {
      textarea.focus()
      const newCursor = lineStart + newLine.length
      textarea.setSelectionRange(newCursor, newCursor)
    }, 10)
  }, [content, slashMenu.cursorPos])

  // Textarea keydown handler (handles slash command navigation, shortcuts)
  const handleTextareaKeyDown = (e) => {
    // If slash menu is open:
    if (slashMenu.open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashMenu((s) => ({
          ...s,
          activeIndex: (s.activeIndex + 1) % (filteredCommands.length || 1),
        }))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashMenu((s) => ({
          ...s,
          activeIndex: (s.activeIndex - 1 + (filteredCommands.length || 1)) % (filteredCommands.length || 1),
        }))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const selected = filteredCommands[slashMenu.activeIndex]
        if (selected) executeSlashCommand(selected.id)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashMenu({ open: false, query: '', activeIndex: 0, cursorPos: 0, coords: { top: 0, left: 0 } })
        return
      }
    }

    // Save: Cmd+S / Ctrl+S
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      handleSave()
      return
    }
    // Find: Cmd+F / Ctrl+F
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      setFindOpen((prev) => !prev)
      return
    }
    // Undo / Redo shortcuts
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault()
      handleUndo()
      return
    }
    if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
      e.preventDefault()
      handleRedo()
      return
    }
    // Escape
    if (e.key === 'Escape') {
      if (findOpen) {
        setFindOpen(false)
      } else if (generatePromptOpen) {
        setGeneratePromptOpen(false)
      } else if (isFullScreen && onCloseFullScreen) {
        onCloseFullScreen()
      } else if (onCancel) {
        onCancel()
      }
    }
  }

  // Textarea input monitoring for slash command '/'
  const handleTextareaInput = (e) => {
    const val = e.target.value
    const selStart = e.target.selectionStart
    handleTextChange(val)

    // Check if character before cursor is '/'
    const textBefore = val.slice(0, selStart)
    const lastSlashIdx = textBefore.lastIndexOf('/')
    if (lastSlashIdx !== -1) {
      const afterSlash = textBefore.slice(lastSlashIdx + 1)
      const isStartOfLine = lastSlashIdx === 0 || textBefore[lastSlashIdx - 1] === '\n'
      if (isStartOfLine && !afterSlash.includes(' ') && !afterSlash.includes('\n')) {
        // Calculate rough line height for positioning
        const lines = textBefore.split('\n').length
        const top = Math.min(e.target.clientHeight - 240, Math.max(30, lines * 26 - e.target.scrollTop + 14))
        setSlashMenu({
          open: true,
          query: afterSlash,
          activeIndex: 0,
          cursorPos: selStart,
          coords: { top, left: 36 },
        })
        return
      }
    }

    if (slashMenu.open) {
      setSlashMenu((s) => ({ ...s, open: false }))
    }
  }

  // Formatting from SelectionActionMenu
  const handleFormat = (type, selectedText) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = content.slice(0, start)
    const sel = content.slice(start, end)
    const after = content.slice(end)

    if (type === 'bold') {
      const isBold = sel.startsWith('**') && sel.endsWith('**')
      const replaced = isBold ? sel.slice(2, -2) : `**${sel || 'bold text'}**`
      handleTextChange(before + replaced + after)
    } else if (type === 'italic') {
      const isItalic = sel.startsWith('*') && sel.endsWith('*')
      const replaced = isItalic ? sel.slice(1, -1) : `*${sel || 'italic text'}*`
      handleTextChange(before + replaced + after)
    } else if (type === 'link') {
      const url = window.prompt('Enter link destination URL:', 'https://')
      if (url) {
        handleTextChange(before + `[${sel || 'source'}](${url})` + after)
      }
    } else if (type === 'replace') {
      handleTextChange(before + selectedText + after)
    } else {
      // Block format: h1, h2, h3, p, ol, ul, check
      const lineStart = content.lastIndexOf('\n', start - 1) + 1
      const lineEndIdx = content.indexOf('\n', end)
      const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx
      const lineText = content.slice(lineStart, lineEnd)

      const cleanLine = lineText.replace(/^(\#{1,6}\s+|-\s+\[[\sx]\]\s+|-\s+|\d+\.\s+)/i, '')
      let prefix = ''
      if (type === 'h1') prefix = '# '
      else if (type === 'h2') prefix = '## '
      else if (type === 'h3') prefix = '### '
      else if (type === 'ol') prefix = '1. '
      else if (type === 'ul') prefix = '- '
      else if (type === 'check') prefix = '- [ ] '

      const newLine = `${prefix}${cleanLine}`
      handleTextChange(content.slice(0, lineStart) + newLine + content.slice(lineEnd))
    }
  }

  // Handle AI Actions from toolbar
  const handleToolbarAiAction = async (action, customInstruction = '') => {
    setAiMenuOpen(false)
    const textarea = textareaRef.current
    let targetText = ''
    let start = 0
    let end = content.length

    if (textarea && textarea.selectionEnd > textarea.selectionStart) {
      start = textarea.selectionStart
      end = textarea.selectionEnd
      targetText = content.slice(start, end).trim()
    } else {
      targetText = content.trim()
      start = 0
      end = content.length
    }

    if (!targetText) return

    setAiTransforming(true)
    try {
      const res = await api.aiTransform({
        text: targetText,
        action,
        instruction: customInstruction,
      })
      const result = res.result || res.transformed
      if (result) {
        const labels = {
          rewrite: 'Improve & Polish',
          shorten: 'Make Shorter',
          expand: 'Expand & Elaborate',
          fix_grammar: 'Fix Grammar & Typos',
          professional: 'Professional Tone',
          casual: 'Casual Tone',
        }
        setAiProposal({
          original: targetText,
          transformed: result,
          start,
          end,
          actionLabel: labels[action] || 'AI Rewrite',
        })
      }
    } catch (err) {
      console.error('AI transform failed:', err)
    } finally {
      setAiTransforming(false)
    }
  }

  // Accept and apply AI proposal into document
  const handleAcceptAiProposal = () => {
    if (!aiProposal) return
    const { original, transformed, start, end } = aiProposal
    if (start !== undefined && end !== undefined && end <= content.length) {
      handleTextChange(content.slice(0, start) + transformed + content.slice(end))
    } else {
      handleTextChange(content.replace(original, transformed))
    }
    setAiProposal(null)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // Handle AI Changes from floating menu (Image 5)
  const handleApplyAiChanges = async (selected, instruction) => {
    setAiTransforming(true)
    try {
      const res = await api.aiTransform({ text: selected, instruction, action: 'rewrite' })
      const transformed = res.result || res.transformed
      if (transformed) {
        const textarea = textareaRef.current
        let start = undefined
        let end = undefined
        if (textarea && textarea.selectionEnd > textarea.selectionStart) {
          start = textarea.selectionStart
          end = textarea.selectionEnd
        }
        setAiProposal({
          original: selected,
          transformed,
          start,
          end,
          actionLabel: 'Instruction Rewrite',
        })
      }
    } catch (err) {
      console.error('AI transform failed:', err)
    } finally {
      setAiTransforming(false)
    }
  }

  // Generate text at cursor (Image 2)
  const handleGenerateSubmit = async (e) => {
    e?.preventDefault()
    const prompt = generatePrompt.trim()
    if (!prompt || generating) return

    setGenerating(true)
    try {
      const res = await api.aiTransform({
        text: `Context:\n${content.slice(-400)}`,
        instruction: `Generate fresh paragraphs about: ${prompt}`,
        action: 'expand',
      })
      const result = res.result || res.transformed
      if (result) {
        const textarea = textareaRef.current
        const pos = textarea ? textarea.selectionStart : content.length
        const insertion = `\n\n${result}\n\n`
        handleTextChange(content.slice(0, pos) + insertion + content.slice(pos))
      }
      setGeneratePrompt('')
      setGeneratePromptOpen(false)
    } catch (err) {
      console.error('Generate failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (conversationId && messageId) {
        const updated = await api.updateMessageArtifact(
          conversationId,
          messageId,
          content,
          'User edited response'
        )
        setArtifact(updated)
      }
      if (onSave) onSave(content)
    } catch (err) {
      console.error('Failed to save artifact:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleRevertVersion = async (vNum) => {
    if (!conversationId || !messageId) return
    setSaving(true)
    try {
      const updated = await api.revertMessageArtifact(conversationId, messageId, vNum)
      setArtifact(updated)
      setContent(updated.current_content)
      setVersionDropdownOpen(false)
    } catch (err) {
      console.error('Failed to revert version:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = async () => {
    const ok = await copyText(content)
    setCopied(ok)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleReplaceOne = () => {
    if (!findQuery) return
    const flags = matchCase ? '' : 'i'
    const regex = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    setContent((prev) => prev.replace(regex, replaceQuery))
  }

  const handleReplaceAll = () => {
    if (!findQuery) return
    const flags = matchCase ? 'g' : 'gi'
    const regex = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    setContent((prev) => prev.replace(regex, replaceQuery))
  }

  const handleExport = async (format) => {
    setExportOpen(false)
    const baseName = `amethyst-artifact-${messageId || 'doc'}`
    if (format === 'md') {
      exportTextBlob(content, `${baseName}.md`, 'text/markdown')
    } else if (format === 'txt') {
      const plain = content.replace(/#+\s+/g, '').replace(/(\*\*|\*|`)/g, '')
      exportTextBlob(plain, `${baseName}.txt`, 'text/plain')
    } else if (format === 'html') {
      const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${baseName}</title><style>body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;max-width:820px;margin:40px auto;padding:0 24px;color:#18181b;background:#fafafa;}pre{background:#f4f4f5;padding:12px;border-radius:6px;overflow-x:auto;}table{border-collapse:collapse;width:100%;margin:16px 0;}th,td{border:1px solid #e4e4e7;padding:8px 12px;text-align:left;}th{background:#f4f4f5;}</style></head><body><pre style="white-space:pre-wrap;font-family:inherit;">${content}</pre></body></html>`
      exportTextBlob(htmlDoc, `${baseName}.html`, 'text/html')
    } else if (format === 'docx') {
      setExporting(true)
      try {
        const blob = await api.exportDocx(content, baseName)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${baseName}.docx`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (err) {
        console.error('DOCX export failed:', err)
      } finally {
        setExporting(false)
      }
    }
  }

  return (
    <div className={`response-editor-container${isFullScreen ? ' is-fullscreen' : ' is-inline'}`}>
      {/* Top Header Bar */}
      <div className="editor-top-bar">
        <div className="editor-header-left">
          <button
            type="button"
            className="editor-icon-btn"
            title="Close editor"
            onClick={isFullScreen ? onCloseFullScreen : onCancel}
          >
            <Icon name="back" size={14} />
            <span className="btn-label">Back</span>
          </button>

          <span className="editor-title">Response Document</span>

          {/* Version Selector */}
          {artifact && artifact.versions && artifact.versions.length > 0 && (
            <div className="editor-version-picker">
              <button
                type="button"
                className="version-picker-btn"
                onClick={() => setVersionDropdownOpen((v) => !v)}
              >
                <span className="v-tag">v{artifact.version}</span>
                <span className="v-label">{artifact.version === 1 ? 'Original' : 'Edited'}</span>
                <Icon name="chevron-down" size={10} />
              </button>

              {versionDropdownOpen && (
                <div className="version-dropdown-list">
                  <div className="v-list-header">Version History</div>
                  {artifact.versions.map((ver) => (
                    <button
                      key={ver.version}
                      type="button"
                      className={`v-list-item${ver.version === artifact.version ? ' is-active' : ''}`}
                      onClick={() => handleRevertVersion(ver.version)}
                    >
                      <div className="v-item-row">
                        <span className="v-item-badge">v{ver.version}</span>
                        <span className="v-item-author">
                          {ver.author === 'assistant' ? 'AI generated' : ver.author === 'ai_edit' ? 'AI rewrite' : 'User edit'}
                        </span>
                        {ver.version === artifact.version && <span className="v-current-tag">Current</span>}
                      </div>
                      {ver.change_summary && <div className="v-item-summary">{ver.change_summary}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* View Mode Switcher */}
        <div className="editor-view-modes">
          <button
            type="button"
            className={`mode-tab${viewMode === 'edit' ? ' is-active' : ''}`}
            onClick={() => setViewMode('edit')}
          >
            <Icon name="edit" size={12} />
            <span>Edit</span>
          </button>
          <button
            type="button"
            className={`mode-tab${viewMode === 'split' ? ' is-active' : ''}`}
            onClick={() => setViewMode('split')}
          >
            <Icon name="layers" size={12} />
            <span>Split View</span>
          </button>
          <button
            type="button"
            className={`mode-tab${viewMode === 'preview' ? ' is-active' : ''}`}
            onClick={() => setViewMode('preview')}
          >
            <Icon name="eye" size={12} />
            <span>Preview</span>
          </button>
        </div>

        {/* Header Right Actions */}
        <div className="editor-header-right">
          <button
            type="button"
            className="editor-secondary-btn"
            onClick={isFullScreen ? onCloseFullScreen : onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="editor-primary-btn"
            disabled={saving}
            onClick={handleSave}
          >
            <Icon name={saving ? 'clock' : 'check'} size={13} />
            <span>{saving ? 'Saving...' : 'Save & Apply'}</span>
          </button>
        </div>
      </div>

      {/* Editor Tool Bar */}
      <div className="editor-tool-bar">
        <div className="tool-bar-left">
          <button
            type="button"
            className="tool-btn"
            title="Undo (Ctrl+Z)"
            disabled={!undoStack.length}
            onClick={handleUndo}
          >
            <Icon name="back" size={13} />
          </button>
          <button
            type="button"
            className="tool-btn"
            title="Redo (Ctrl+Y)"
            disabled={!redoStack.length}
            onClick={handleRedo}
          >
            <Icon name="chevron-right" size={13} />
          </button>

          <div className="tool-divider" />

          {/* Find & Replace Trigger */}
          <button
            type="button"
            className={`tool-btn${findOpen ? ' is-active' : ''}`}
            title="Find & Replace (Ctrl+F)"
            onClick={() => setFindOpen((f) => !f)}
          >
            <Icon name="search" size={13} />
            <span>Find</span>
          </button>
          <div className="tool-divider" />

          {/* AI Transform Dropdown */}
          <div className="ai-transform-wrapper" ref={aiDropdownRef}>
            <button
              type="button"
              className={`tool-btn ai-tool-btn${aiMenuOpen ? ' active' : ''}`}
              title="AI Assistant Tools"
              onClick={() => setAiMenuOpen((o) => !o)}
              disabled={aiTransforming}
            >
              <Icon name="zap" size={13} />
              <span>Ask AI</span>
              <Icon name="chevron-down" size={10} />
            </button>

            {aiMenuOpen && (
              <div className="ai-dropdown-menu">
                <button type="button" onClick={() => handleToolbarAiAction('rewrite')}>
                  <Icon name="edit" size={12} />
                  <span>Improve & Polish</span>
                </button>
                <button type="button" onClick={() => handleToolbarAiAction('shorten')}>
                  <Icon name="minus-circle" size={12} />
                  <span>Make Shorter</span>
                </button>
                <button type="button" onClick={() => handleToolbarAiAction('expand')}>
                  <Icon name="expand" size={12} />
                  <span>Expand & Elaborate</span>
                </button>
                <button type="button" onClick={() => handleToolbarAiAction('fix_grammar')}>
                  <Icon name="check" size={12} />
                  <span>Fix Grammar & Typos</span>
                </button>
                <button type="button" onClick={() => handleToolbarAiAction('professional')}>
                  <Icon name="file" size={12} />
                  <span>Professional Tone</span>
                </button>
                <button type="button" onClick={() => handleToolbarAiAction('casual')}>
                  <Icon name="message-square" size={12} />
                  <span>Casual Tone</span>
                </button>
                <div className="ai-menu-divider" />
                <button
                  type="button"
                  onClick={() => {
                    setAiMenuOpen(false)
                    setGeneratePromptOpen(true)
                    setTimeout(() => generateInputRef.current?.focus(), 50)
                  }}
                >
                  <Icon name="zap" size={12} />
                  <span>Custom Prompt...</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="tool-bar-right">
          {/* Document Metrics */}
          <span className="doc-metric">{stats.words} words</span>
          <span className="doc-metric">{stats.chars} chars</span>
          <span className="doc-metric">{stats.readingMinutes} min read</span>

          <div className="tool-divider" />

          <button
            type="button"
            className="tool-btn"
            title="Copy markdown"
            onClick={handleCopy}
          >
            <Icon name={copied ? 'check' : 'copy'} size={13} />
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Export Dropdown */}
          <div className="export-menu-wrapper" ref={exportDropdownRef}>
            <button
              type="button"
              className="tool-btn"
              disabled={exporting}
              onClick={() => setExportOpen((o) => !o)}
            >
              <Icon name="download" size={13} />
              <span>{exporting ? 'Exporting...' : 'Export'}</span>
              <Icon name="chevron-down" size={10} />
            </button>

            {exportOpen && (
              <div className="export-dropdown-menu">
                <button type="button" onClick={() => handleExport('md')}>
                  <Icon name="file" size={12} />
                  <span>Markdown (.md)</span>
                </button>
                <button type="button" onClick={() => handleExport('txt')}>
                  <Icon name="type" size={12} />
                  <span>Plain Text (.txt)</span>
                </button>
                <button type="button" onClick={() => handleExport('html')}>
                  <Icon name="globe" size={12} />
                  <span>Standalone HTML (.html)</span>
                </button>
                <button type="button" onClick={() => handleExport('docx')}>
                  <Icon name="doc" size={12} />
                  <span>Word Document (.docx)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Transformation Proposal Diff Banner */}
      {aiProposal && (
        <div className="ai-proposal-banner">
          <div className="proposal-header">
            <Icon name="zap" size={14} />
            <span>AI Proposed Changes</span>
            <span className="proposal-badge">{aiProposal.actionLabel || 'Rewritten'}</span>
          </div>
          <div className="proposal-diff">
            <div className="diff-col original">
              <div className="diff-label">Original</div>
              <div className="diff-body">{aiProposal.original}</div>
            </div>
            <div className="diff-col proposed">
              <div className="diff-label">Proposed</div>
              <div className="diff-body">{aiProposal.transformed}</div>
            </div>
          </div>
          <div className="proposal-actions">
            <button
              type="button"
              className="proposal-btn reject"
              onClick={() => setAiProposal(null)}
            >
              <Icon name="x" size={12} />
              <span>Reject</span>
            </button>
            <button
              type="button"
              className="proposal-btn accept"
              onClick={handleAcceptAiProposal}
            >
              <Icon name="check" size={12} />
              <span>Accept & Apply</span>
            </button>
          </div>
        </div>
      )}

      {/* AI Progress Indicator */}
      {aiTransforming && (
        <div className="ai-transform-progress-bar">
          <span className="ai-pulse-dot" />
          <span>AI is analyzing and rewriting text...</span>
        </div>
      )}

      {/* Find & Replace Drawer */}
      {findOpen && (
        <div className="find-replace-bar">
          <div className="find-inputs">
            <input
              type="text"
              className="find-input"
              placeholder="Find..."
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              className="find-input"
              placeholder="Replace with..."
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
            />
          </div>
          <div className="find-options">
            <label className="find-checkbox">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
              />
              <span>Match Case</span>
            </label>
            <span className="match-counter">{matchCount} matches</span>
          </div>
          <div className="find-actions">
            <button type="button" className="find-btn" onClick={handleReplaceOne} disabled={!matchCount}>
              Replace
            </button>
            <button type="button" className="find-btn" onClick={handleReplaceAll} disabled={!matchCount}>
              Replace All
            </button>
            <button type="button" className="find-btn close" onClick={() => setFindOpen(false)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Inline Generate Text Bar (from slash command) */}
      {generatePromptOpen && (
        <form className="inline-generate-banner" onSubmit={handleGenerateSubmit}>
          <Icon name="zap" size={14} className="generate-banner-icon" />
          <input
            ref={generateInputRef}
            type="text"
            className="generate-banner-input"
            placeholder="Describe what AI should generate..."
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            disabled={generating}
          />
          <button
            type="submit"
            className="generate-banner-btn"
            disabled={!generatePrompt.trim() || generating}
          >
            {generating ? 'Generating...' : 'Generate'}
          </button>
          <button
            type="button"
            className="generate-banner-close"
            onClick={() => setGeneratePromptOpen(false)}
          >
            <Icon name="x" size={12} />
          </button>
        </form>
      )}

      {/* Main Workspace Area */}
      <div className={`editor-workspace view-${viewMode}`} ref={editorPaneRef}>
        {/* Floating selection bubble menu matching Image 4 & Image 5 */}
        <SelectionActionMenu
          containerRef={editorPaneRef}
          onFormat={handleFormat}
          onApplyChanges={handleApplyAiChanges}
        />

        {(viewMode === 'edit' || viewMode === 'split') && (
          <div className="editor-pane">
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={content}
              onChange={handleTextareaInput}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Write or type '/' for commands..."
              spellCheck="false"
            />

            {/* Image 2: Slash command popup menu */}
            {slashMenu.open && filteredCommands.length > 0 && (
              <div
                ref={slashMenuRef}
                className="slash-commands-popover"
                style={{ top: `${slashMenu.coords.top}px`, left: `${slashMenu.coords.left}px` }}
              >
                {filteredCommands.map((cmd, idx) => (
                  <button
                    key={cmd.id}
                    type="button"
                    className={`slash-cmd-item ${idx === slashMenu.activeIndex ? 'is-focused' : ''}`}
                    onClick={() => executeSlashCommand(cmd.id)}
                    onMouseEnter={() => setSlashMenu((s) => ({ ...s, activeIndex: idx }))}
                  >
                    <span className="slash-cmd-label">{cmd.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {(viewMode === 'preview' || viewMode === 'split') && (
          <div className="preview-pane" ref={previewRef}>
            <div className="preview-content">
              <Markdown text={content} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
