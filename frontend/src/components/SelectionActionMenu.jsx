import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { api } from '../api.js'

const BLOCK_FORMATS = [
  { id: 'p', label: 'Text', shortcut: 'Ctrl + Alt + 0' },
  { id: 'h1', label: 'Heading 1', shortcut: 'Ctrl + Alt + 1' },
  { id: 'h2', label: 'Heading 2', shortcut: 'Ctrl + Alt + 2' },
  { id: 'h3', label: 'Heading 3', shortcut: 'Ctrl + Alt + 3' },
  { id: 'ol', label: 'Numbered list', shortcut: 'Ctrl + Alt + 4' },
  { id: 'ul', label: 'Bulleted list', shortcut: 'Ctrl + Alt + 5' },
  { id: 'check', label: 'Checklist', shortcut: 'Ctrl + Alt + 6' },
]

export default function SelectionActionMenu({
  containerRef,
  onFormat,
  onApplyChanges,
  onTransform,
  onAskQuote,
}) {
  const [coords, setCoords] = useState(null)
  const [selectedText, setSelectedText] = useState('')
  const [mode, setMode] = useState('toolbar') // 'toolbar' | 'ask'
  const [prompt, setPrompt] = useState('')
  const [isTransforming, setIsTransforming] = useState(false)
  const [blockMenuOpen, setBlockMenuOpen] = useState(false)
  const [activeFormat, setActiveFormat] = useState('Heading 1')

  const menuRef = useRef(null)
  const inputRef = useRef(null)
  const blockMenuRef = useRef(null)
  const savedRangeRef = useRef(null)
  const selectedTextRef = useRef('')

  const updatePosition = useCallback(() => {
    // If in ask mode and input is active, keep position pinned
    if (mode === 'ask' && inputRef.current && document.activeElement === inputRef.current) {
      if (savedRangeRef.current) {
        const r = savedRangeRef.current.getBoundingClientRect()
        if (r && (r.width > 0 || r.height > 0)) {
          const menuWidth = 380
          const menuHeight = 40
          let left = r.left + (r.width / 2) - (menuWidth / 2)
          left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, left))
          let top = r.top - menuHeight - 10
          if (top < 10) top = r.bottom + 10
          setCoords({ top, left })
        }
      }
      return
    }

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setCoords(null)
      setSelectedText('')
      selectedTextRef.current = ''
      savedRangeRef.current = null
      setMode('toolbar')
      setBlockMenuOpen(false)
      return
    }

    const container = containerRef?.current
    if (!container) return

    const range = sel.getRangeAt(0)
    // Check if selection belongs to container
    if (!container.contains(range.commonAncestorContainer)) {
      setCoords(null)
      setSelectedText('')
      selectedTextRef.current = ''
      savedRangeRef.current = null
      setMode('toolbar')
      return
    }

    const text = sel.toString().trim()
    if (text.length < 2) {
      setCoords(null)
      setSelectedText('')
      selectedTextRef.current = ''
      savedRangeRef.current = null
      setMode('toolbar')
      return
    }

    const rect = range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setCoords(null)
      return
    }

    // Hide if scrolled completely out of view
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setCoords(null)
      return
    }

    savedRangeRef.current = range.cloneRange()
    selectedTextRef.current = text
    setSelectedText(text)

    const menuWidth = menuRef.current?.offsetWidth || (mode === 'ask' ? 380 : 340)
    const menuHeight = menuRef.current?.offsetHeight || 38

    // Center horizontally over the selection bounding box
    let left = rect.left + (rect.width / 2) - (menuWidth / 2)
    left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, left))

    // Position above selection; flip below if near viewport top
    let top = rect.top - menuHeight - 10
    if (top < 10) {
      top = rect.bottom + 10
    }

    setCoords({ top, left })
  }, [containerRef, mode])

  useEffect(() => {
    const handleMouseUp = () => requestAnimationFrame(updatePosition)
    const handleSelectionChange = () => {
      if (mode === 'ask' && inputRef.current && document.activeElement === inputRef.current) return
      requestAnimationFrame(updatePosition)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [updatePosition, mode])

  // Scroll & resize tracking using capture phase so parent scroll containers update coordinates
  useEffect(() => {
    if (!coords) return
    const onScrollOrResize = () => requestAnimationFrame(updatePosition)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [coords, updatePosition])

  // Click outside block dropdown
  useEffect(() => {
    if (!blockMenuOpen) return
    const handleDown = (e) => {
      if (blockMenuRef.current && !blockMenuRef.current.contains(e.target)) {
        setBlockMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [blockMenuOpen])

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      const text = selectedTextRef.current || selectedText
      if (!text) return

      // Don't intercept formatting shortcuts while typing instructions in the input
      if (document.activeElement === inputRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setMode('toolbar')
        }
        return
      }

      // Ctrl+K / Cmd+K: Open inline "Ask for changes" (Image 4 & 5)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setMode('ask')
        setTimeout(() => inputRef.current?.focus(), 40)
        return
      }

      // Escape: exit ask mode or dismiss
      if (e.key === 'Escape') {
        if (mode === 'ask') {
          setMode('toolbar')
        } else if (blockMenuOpen) {
          setBlockMenuOpen(false)
        } else {
          setCoords(null)
        }
        return
      }

      // Block formatting: Ctrl + Alt + 0..6
      if ((e.ctrlKey || e.metaKey) && e.altKey) {
        const key = e.key
        const formatItem = BLOCK_FORMATS.find((f) => f.shortcut.endsWith(key))
        if (formatItem) {
          e.preventDefault()
          handleSelectFormat(formatItem)
          return
        }
      }

      // Ctrl + B: Bold
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        handleFormatInline('bold')
        return
      }

      // Ctrl + I: Italic
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        handleFormatInline('italic')
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedText, mode, blockMenuOpen])

  if (!coords || (!selectedText && !selectedTextRef.current)) return null

  const handleOpenAsk = (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    setMode('ask')
    setTimeout(() => {
      inputRef.current?.focus()
    }, 40)
  }

  const handleAskSubmit = async (e) => {
    e?.preventDefault()
    const promptText = prompt.trim()
    const targetText = selectedTextRef.current || selectedText
    if (!promptText || !targetText || isTransforming) return

    setIsTransforming(true)
    try {
      if (onApplyChanges) {
        await onApplyChanges(targetText, promptText)
      } else if (onTransform) {
        await onTransform(targetText, 'rewrite', promptText)
      } else {
        const res = await api.aiTransform({
          text: targetText,
          instruction: promptText,
          action: 'rewrite',
        })
        const transformed = res.result || res.transformed
        if (transformed && onFormat) {
          onFormat('replace', transformed, targetText)
        }
      }
      setPrompt('')
      setMode('toolbar')
      setCoords(null)
      window.getSelection()?.removeAllRanges()
    } catch (err) {
      console.error('AI transform failed:', err)
    } finally {
      setIsTransforming(false)
    }
  }

  const handleSelectFormat = (formatItem) => {
    setActiveFormat(formatItem.label)
    setBlockMenuOpen(false)
    const targetText = selectedTextRef.current || selectedText
    if (onFormat && targetText) {
      onFormat(formatItem.id, targetText)
    }
  }

  const handleFormatInline = (type) => {
    const targetText = selectedTextRef.current || selectedText
    if (onFormat && targetText) {
      onFormat(type, targetText)
    }
  }

  const menu = (
    <div
      ref={menuRef}
      className={`floating-selection-bubble ${mode === 'ask' ? 'is-ask-mode' : 'is-toolbar-mode'} ${isTransforming ? 'is-transforming' : ''}`}
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 999999,
      }}
      role="toolbar"
      aria-label="Selection format and editing"
      onMouseDown={(e) => {
        // Prevent clearing the document text selection when clicking toolbar buttons
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
          e.preventDefault()
        }
        e.stopPropagation()
      }}
    >
      {mode === 'ask' ? (
        /* Image 5: Inline "Describe changes" form with circular submit button */
        <form className="inline-describe-form" onSubmit={handleAskSubmit}>
          <input
            ref={inputRef}
            type="text"
            className="inline-describe-input"
            placeholder="Describe changes"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isTransforming}
            autoFocus
          />
          <button
            type="submit"
            className={`inline-describe-submit ${prompt.trim() ? 'is-ready' : ''}`}
            disabled={!prompt.trim() || isTransforming}
            title="Apply changes (Enter)"
          >
            {isTransforming ? (
              <span className="inline-spinner" />
            ) : (
              <span className="circle-action-dot" />
            )}
          </button>
        </form>
      ) : (
        /* Image 4: Floating toolbar: [Ask for changes Ctrl + K] | [link] [B] [I] [Heading 1 v] */
        <div className="selection-toolbar-inner">
          <button
            type="button"
            className="bubble-btn bubble-ask-btn"
            title="Ask AI for changes (Ctrl + K)"
            onClick={handleOpenAsk}
            onMouseDown={(e) => e.preventDefault()}
          >
            <span className="bubble-btn-text">Ask for changes</span>
            <span className="bubble-shortcut-tag">Ctrl + K</span>
          </button>

          <div className="bubble-divider" />

          <button
            type="button"
            className="bubble-btn bubble-icon-btn"
            title="Insert link"
            onClick={() => handleFormatInline('link')}
            onMouseDown={(e) => e.preventDefault()}
          >
            <Icon name="link" size={13} />
          </button>

          <button
            type="button"
            className="bubble-btn bubble-icon-btn"
            title="Bold (Ctrl + B)"
            onClick={() => handleFormatInline('bold')}
            onMouseDown={(e) => e.preventDefault()}
          >
            <strong className="bubble-typography-symbol">B</strong>
          </button>

          <button
            type="button"
            className="bubble-btn bubble-icon-btn"
            title="Italic (Ctrl + I)"
            onClick={() => handleFormatInline('italic')}
            onMouseDown={(e) => e.preventDefault()}
          >
            <em className="bubble-typography-symbol">I</em>
          </button>

          {/* Block type dropdown (Image 4) */}
          <div className="bubble-dropdown-anchor" ref={blockMenuRef}>
            <button
              type="button"
              className={`bubble-btn bubble-select-btn ${blockMenuOpen ? 'is-active' : ''}`}
              onClick={() => setBlockMenuOpen((o) => !o)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <span>{activeFormat}</span>
              <Icon name="chevron-down" size={11} />
            </button>

            {blockMenuOpen && (
              <div className="bubble-dropdown-menu">
                {BLOCK_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`bubble-dropdown-item ${activeFormat === f.label ? 'is-selected' : ''}`}
                    onClick={() => handleSelectFormat(f)}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <span className="dropdown-item-label">{f.label}</span>
                    <span className="dropdown-item-shortcut">{f.shortcut}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(menu, document.body) : null
}
