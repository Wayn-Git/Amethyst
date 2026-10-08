import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  Sparkles,
  HelpCircle,
  Scissors,
  Check,
  X,
  RotateCw,
  Copy,
  Quote,
  Code,
  ArrowUp,
  ChevronLeft,
  Sliders,
} from 'lucide-react'
import { copyText, api } from '../api.js'
import { MOD_LABEL } from '../keys.js'

export function cleanAiTransformOutput(result, originalText = '') {
  if (!result || typeof result !== 'string') return originalText
  let ans = result.trim()

  // Strip code fences if whole response is fenced
  if (ans.startsWith('```') && ans.endsWith('```')) {
    const lines = ans.split('\n')
    ans = lines.length >= 3 ? lines.slice(1, -1).join('\n').trim() : ans.replace(/^`+|`+$/g, '').trim()
  }

  // Strip conversational lead-ins: "Here's the refined text:\n\n..."
  ans = ans.replace(/^(?:here(?:’|')?s|here is|revised|improved|polished|corrected)[^\n]*:?\s*\n+/i, '').trim()

  // Cut off optional notes / alternatives
  const optIdx = ans.search(/\n\n\s*(\*\(|\()?(?:optional|note|alternative|option\s*2)/i)
  if (optIdx !== -1) {
    ans = ans.slice(0, optIdx).trim()
  }

  // Strip enclosing bold quotes **"..."** or quotes "..."
  const boldQuoteMatch = ans.match(/^\*\*["“']([\s\S]+?)["”']\*\*$/)
  if (boldQuoteMatch) {
    ans = boldQuoteMatch[1].trim()
  } else if ((ans.startsWith('"') && ans.endsWith('"')) || (ans.startsWith('“') && ans.endsWith('”'))) {
    ans = ans.slice(1, -1).trim()
  } else if (ans.startsWith('**') && ans.endsWith('**') && !(originalText.startsWith('**') && originalText.endsWith('**'))) {
    ans = ans.slice(2, -2).trim()
  }

  return ans || originalText
}

export default function SelectionActionMenu({
  containerRef,
  onRefer,
  onAskQuote,
  onFormat,
  onApplyChanges,
  allowFormatting = false,
}) {
  const [coords, setCoords] = useState(null)
  const [selectedText, setSelectedText] = useState('')
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState('idle') // 'idle' | 'prompt' | 'thinking' | 'result'
  const [currentAction, setCurrentAction] = useState('Improve')
  const [prompt, setPrompt] = useState('')
  const [transformedResult, setTransformedResult] = useState('')

  const menuRef = useRef(null)
  const barRef = useRef(null)
  const inputRef = useRef(null)
  const savedRangeRef = useRef(null)
  const selectedTextRef = useRef('')
  const isInteractingRef = useRef(false)
  const interactTimeoutRef = useRef(null)

  const reset = useCallback(() => {
    setMode('idle')
    setPrompt('')
    setTransformedResult('')
    setCoords(null)
    setSelectedText('')
    selectedTextRef.current = ''
    savedRangeRef.current = null
    isInteractingRef.current = false
    try {
      const sel = window.getSelection()
      if (sel && !sel.isCollapsed) {
        sel.removeAllRanges()
      }
    } catch {}
  }, [])

  const updatePosition = useCallback(() => {
    // If user is currently typing, thinking, or reviewing results, freeze position
    if (mode !== 'idle' || isInteractingRef.current) return

    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      if (mode === 'idle' && !isInteractingRef.current) {
        setCoords(null)
        setSelectedText('')
        selectedTextRef.current = ''
        savedRangeRef.current = null
      }
      return
    }

    const container = containerRef?.current
    if (!container) return

    const range = sel.getRangeAt(0)
    // Check if selection belongs to or intersects container
    const belongs =
      container.contains(range.commonAncestorContainer) ||
      (typeof range.intersectsNode === 'function' && range.intersectsNode(container))
    if (!belongs) {
      if (mode === 'idle' && !isInteractingRef.current) {
        setCoords(null)
        setSelectedText('')
        selectedTextRef.current = ''
        savedRangeRef.current = null
      }
      return
    }

    // Do not show bubble if selection is inside composer input or textarea outside container
    const node = range.commonAncestorContainer
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (el?.closest('.composer-card, [contenteditable="true"]')) {
      if (mode === 'idle' && !isInteractingRef.current) {
        setCoords(null)
        setSelectedText('')
        selectedTextRef.current = ''
        savedRangeRef.current = null
      }
      return
    }

    const text = sel.toString().trim()
    if (text.length < 2) {
      if (mode === 'idle' && !isInteractingRef.current) {
        setCoords(null)
        setSelectedText('')
        selectedTextRef.current = ''
        savedRangeRef.current = null
      }
      return
    }

    const rect = range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setCoords(null)
      return
    }

    // Hide if scrolled out of viewport
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setCoords(null)
      return
    }

    savedRangeRef.current = range.cloneRange()
    selectedTextRef.current = text
    setSelectedText(text)

    const menuWidth = menuRef.current?.offsetWidth || 280
    const menuHeight = menuRef.current?.offsetHeight || 38

    // Center horizontally over the selection bounding box
    let left = rect.left + rect.width / 2
    left = Math.max(menuWidth / 2 + 12, Math.min(window.innerWidth - menuWidth / 2 - 12, left))

    // Position above selection; flip below if near viewport top
    let top = rect.top - menuHeight - 8
    if (top < 12) {
      top = rect.bottom + 8
    }

    setCoords({ top, left })
  }, [containerRef, mode])

  // Mouse up and selection change listener
  useEffect(() => {
    const handleMouseUp = (e) => {
      if (menuRef.current?.contains(e.target)) return
      requestAnimationFrame(updatePosition)
    }
    const handleSelectionChange = () => {
      if (isInteractingRef.current || (menuRef.current && menuRef.current.contains(document.activeElement))) {
        return
      }
      requestAnimationFrame(updatePosition)
    }

    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [updatePosition])

  // Click outside listener
  useEffect(() => {
    const handlePointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        if (mode === 'idle') {
          reset()
        }
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [mode, reset])

  // Scroll or resize listener
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

  const setInteracting = () => {
    isInteractingRef.current = true
    if (interactTimeoutRef.current) clearTimeout(interactTimeoutRef.current)
    interactTimeoutRef.current = setTimeout(() => {
      isInteractingRef.current = false
    }, 400)
  }

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
    window.dispatchEvent(new CustomEvent('amethyst-refer-quote', { detail: { text } }))
    reset()
  }, [onRefer, onAskQuote, selectedText, reset])

  const handleAsk = useCallback((e) => {
    e?.preventDefault()
    e?.stopPropagation()
    const text = selectedTextRef.current || selectedText
    if (!text) return

    if (onAskQuote) {
      onAskQuote(text)
    } else if (onRefer) {
      onRefer(text)
    }
    window.dispatchEvent(new CustomEvent('amethyst-refer-quote', { detail: { text, isQuestion: true } }))
    reset()
  }, [onAskQuote, onRefer, selectedText, reset])

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
        reset()
      }, 700)
    } catch (err) {
      console.error('Failed to copy text:', err)
    }
  }, [selectedText, reset])

  // Keyboard shortcut listener (Cmd/Ctrl+K to quote, Esc to dismiss)
  useEffect(() => {
    const handleKeyDown = (e) => {
      const text = selectedTextRef.current || selectedText
      if (!text || !coords) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        handleRefer(e)
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        reset()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [coords, selectedText, reset, handleRefer])

  // Focus input when entering prompt mode
  useEffect(() => {
    if (mode === 'prompt') {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [mode])



  const runAiAction = useCallback(async (actionName, customInstruction = '') => {
    const text = selectedTextRef.current || selectedText
    if (!text) return

    setCurrentAction(actionName)
    setMode('thinking')

    try {
      const instruction = customInstruction || (actionName === 'Improve' ? 'Rewrite and polish the text to improve clarity, vocabulary, conciseness, and flow while preserving all key facts.' : actionName)
      const res = await api.aiTransform({
        text,
        action: actionName.toLowerCase(),
        instruction,
      })
      const rawResult = res.result || res.transformed || ''
      const result = cleanAiTransformOutput(rawResult, text)
      if (result && result !== text) {
        setTransformedResult(result)
        setMode('result')
        return
      }
      reset()
    } catch (err) {
      console.error('Inline AI action failed:', err)
      reset()
    }
  }, [selectedText, reset])

  const handleKeep = useCallback(() => {
    const text = selectedTextRef.current || selectedText
    if (onApplyChanges && transformedResult) {
      onApplyChanges(text, transformedResult, true)
    }
    reset()
  }, [selectedText, transformedResult, onApplyChanges, reset])

  if (!coords || !selectedText) return null

  const busyLabel =
    currentAction === 'Improve'
      ? 'Improving selection…'
      : currentAction === 'Shorten'
      ? 'Shortening…'
      : currentAction === 'Grammar'
      ? 'Fixing grammar…'
      : 'Transforming…'

  const menu = (
    <div
      ref={menuRef}
      className="selection-action-menu-portal"
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
      }}
      role="toolbar"
      aria-label="Text selection tools"
      onPointerDown={setInteracting}
      onMouseDown={setInteracting}
    >
      <div ref={barRef} className="selection-action-menu">
        {/* Busy / Thinking Mode */}
        {mode === 'thinking' && (
          <div className="selection-menu-content">
            <span className="selection-menu-thinking">
              <span className="selection-menu-spinner" />
              <span>{busyLabel}</span>
            </span>
          </div>
        )}

        {/* Result Mode: Keep / Discard / Retry */}
        {mode === 'result' && (
          <div className="selection-menu-content">
            <button
              type="button"
              onClick={handleKeep}
              className="selection-menu-btn selection-menu-btn--accent"
              title="Apply transformation"
            >
              <Check size={13} strokeWidth={2.4} />
              <span>Keep</span>
            </button>
            <button
              type="button"
              onClick={reset}
              className="selection-menu-btn"
              title="Discard transformation"
            >
              <X size={13} strokeWidth={2} />
              <span>Discard</span>
            </button>
            <span className="selection-menu-divider" />
            <button
              type="button"
              title="Try again"
              aria-label="Try again"
              onClick={() => runAiAction(currentAction, prompt)}
              className="selection-menu-btn selection-menu-btn--icon-only"
            >
              <RotateCw size={13} strokeWidth={2} />
            </button>
          </div>
        )}

        {/* Prompt Input Mode */}
        {mode === 'prompt' && (
          <div className="selection-menu-content">
            <button
              type="button"
              className="selection-menu-btn selection-menu-btn--icon-only"
              onClick={() => setMode('idle')}
              title="Back"
            >
              <ChevronLeft size={14} />
            </button>
            <form
              className="selection-menu-input-form"
              onSubmit={(e) => {
                e.preventDefault()
                if (prompt.trim()) {
                  runAiAction('Rewrite', prompt.trim())
                }
              }}
            >
              <input
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe edits or tone…"
                className="selection-menu-input"
              />
              <button
                type="submit"
                disabled={!prompt.trim()}
                title="Apply edit"
                aria-label="Apply edit"
                className="selection-menu-submit-btn"
              >
                <ArrowUp size={13} strokeWidth={2.4} />
              </button>
            </form>
            <span className="selection-menu-divider" />
            <button
              type="button"
              onClick={() => runAiAction('Shorten')}
              className="selection-menu-chip"
              title="Make concise"
            >
              Shorten
            </button>
            <button
              type="button"
              onClick={() => runAiAction('Grammar')}
              className="selection-menu-chip"
              title="Fix spelling and grammar"
            >
              Grammar
            </button>
          </div>
        )}

        {/* Idle Mode: Clean Primary Actions */}
        {mode === 'idle' && (
          <div className="selection-menu-content">
            {/* Quote / Refer */}
            <button
              type="button"
              title={`Quote selection in chat (${MOD_LABEL}+K)`}
              onClick={handleRefer}
              className="selection-menu-btn selection-menu-btn--highlight"
            >
              <Quote size={13} strokeWidth={2.4} />
              <span>Quote</span>
              <kbd className="selection-menu-kbd">{MOD_LABEL}K</kbd>
            </button>

            {/* Improve with AI - Direct 1-click execution */}
            <button
              type="button"
              title="Improve writing with AI"
              onClick={() => runAiAction('Improve')}
              className="selection-menu-btn"
            >
              <Sparkles size={13} strokeWidth={2.2} style={{ color: 'var(--accent)' }} />
              <span>Improve</span>
            </button>

            {/* Ask / Explain */}
            <button
              type="button"
              title="Ask AI to explain this selection"
              onClick={handleAsk}
              className="selection-menu-btn"
            >
              <HelpCircle size={13} strokeWidth={2} />
              <span>Explain</span>
            </button>

            {/* Custom Instruction Prompt */}
            <button
              type="button"
              title="Custom AI edit instruction"
              onClick={() => setMode('prompt')}
              className="selection-menu-btn selection-menu-btn--icon-only"
              aria-label="Custom edit instruction"
            >
              <Sliders size={13} strokeWidth={2} />
            </button>

            <span className="selection-menu-divider" />

            {/* Copy button */}
            <button
              type="button"
              title="Copy to clipboard"
              onClick={handleCopy}
              className="selection-menu-btn"
            >
              {copied ? (
                <>
                  <Check size={13} strokeWidth={2.4} style={{ color: 'var(--live)' }} />
                  <span style={{ color: 'var(--live)' }}>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={13} strokeWidth={2} />
                  <span>Copy</span>
                </>
              )}
            </button>

            {/* Formatting Chips (if allowed) */}
            {allowFormatting && onFormat && (
              <>
                <span className="selection-menu-divider" />
                <button
                  type="button"
                  title="Bold"
                  onClick={() => onFormat('bold', selectedTextRef.current || selectedText)}
                  className="selection-menu-btn selection-menu-btn--icon-only font-bold"
                >
                  B
                </button>
                <button
                  type="button"
                  title="Italic"
                  onClick={() => onFormat('italic', selectedTextRef.current || selectedText)}
                  className="selection-menu-btn selection-menu-btn--icon-only italic"
                >
                  I
                </button>
                <button
                  type="button"
                  title="Inline code"
                  onClick={() => onFormat('code', selectedTextRef.current || selectedText)}
                  className="selection-menu-btn selection-menu-btn--icon-only"
                >
                  <Code size={13} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(menu, document.body) : null
}
