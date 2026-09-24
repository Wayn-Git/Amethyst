import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { copyText } from '../api.js'
import { MOD_LABEL } from '../keys.js'

export default function SelectionActionMenu({
  containerRef,
  onRefer,
  onAskQuote,
  onFormat,
  allowFormatting = false,
}) {
  const [coords, setCoords] = useState(null)
  const [selectedText, setSelectedText] = useState('')
  const [copied, setCopied] = useState(false)

  const menuRef = useRef(null)
  const savedRangeRef = useRef(null)
  const selectedTextRef = useRef('')

  const updatePosition = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setCoords(null)
      setSelectedText('')
      selectedTextRef.current = ''
      savedRangeRef.current = null
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
      return
    }

    // Do not show bubble if selection is inside an input, textarea, or composer
    const node = range.commonAncestorContainer
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (el?.closest('input, textarea, .composer-card, [contenteditable="true"]')) {
      setCoords(null)
      setSelectedText('')
      selectedTextRef.current = ''
      savedRangeRef.current = null
      return
    }

    const text = sel.toString().trim()
    if (text.length < 2) {
      setCoords(null)
      setSelectedText('')
      selectedTextRef.current = ''
      savedRangeRef.current = null
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

    const menuWidth = menuRef.current?.offsetWidth || 180
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
  }, [containerRef])

  useEffect(() => {
    const handleMouseUp = () => requestAnimationFrame(updatePosition)
    const handleSelectionChange = () => requestAnimationFrame(updatePosition)

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [updatePosition])

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

  const handleRefer = useCallback((e) => {
    e?.preventDefault()
    e?.stopPropagation()
    const text = selectedTextRef.current || selectedText
    if (!text) return

    if (onRefer) {
      onRefer(text)
    } else if (onAskQuote) {
      onAskQuote(text)
    }
    // Also dispatch global event in case listener is in parent/sibling view
    window.dispatchEvent(new CustomEvent('amethyst-refer-quote', { detail: { text } }))

    setCoords(null)
    setSelectedText('')
    selectedTextRef.current = ''
    window.getSelection()?.removeAllRanges()
  }, [onRefer, onAskQuote, selectedText])

  const handleCopy = useCallback(async (e) => {
    e?.preventDefault()
    e?.stopPropagation()
    const text = selectedTextRef.current || selectedText
    if (!text) return
    try {
      await copyText(text)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
        setCoords(null)
        window.getSelection()?.removeAllRanges()
      }, 900)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }, [selectedText])

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e) => {
      const text = selectedTextRef.current || selectedText
      if (!text || !coords) return

      // Ctrl+K / Cmd+K: Refer to this in chat
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        handleRefer(e)
        return
      }

      // Escape: dismiss
      if (e.key === 'Escape') {
        e.preventDefault()
        setCoords(null)
        setSelectedText('')
        selectedTextRef.current = ''
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [coords, selectedText, handleRefer])

  if (!coords || (!selectedText && !selectedTextRef.current)) return null

  const menu = (
    <div
      ref={menuRef}
      className="floating-selection-bubble is-toolbar-mode"
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 999999,
      }}
      role="toolbar"
      aria-label="Selection reference and actions"
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="selection-toolbar-inner">
        <button
          type="button"
          className="bubble-btn bubble-ask-btn bubble-refer-btn"
          title={`Refer to this in chat (${MOD_LABEL}+K)`}
          onClick={handleRefer}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Icon name="quote" size={13} />
          <span className="bubble-btn-text">Refer to this</span>
          <span className="bubble-shortcut-tag">{MOD_LABEL}+K</span>
        </button>

        <div className="bubble-divider" />

        <button
          type="button"
          className="bubble-btn bubble-icon-btn"
          title={copied ? "Copied!" : "Copy selection"}
          onClick={handleCopy}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>

        {allowFormatting && onFormat && (
          <>
            <div className="bubble-divider" />
            <button
              type="button"
              className="bubble-btn bubble-icon-btn"
              title="Bold"
              onClick={() => onFormat('bold', selectedTextRef.current || selectedText)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <strong className="bubble-typography-symbol">B</strong>
            </button>
            <button
              type="button"
              className="bubble-btn bubble-icon-btn"
              title="Italic"
              onClick={() => onFormat('italic', selectedTextRef.current || selectedText)}
              onMouseDown={(e) => e.preventDefault()}
            >
              <em className="bubble-typography-symbol">I</em>
            </button>
          </>
        )}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(menu, document.body) : null
}
