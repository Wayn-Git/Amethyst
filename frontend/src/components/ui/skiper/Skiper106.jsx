import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils.js'

/**
 * Skiper 106 Smooth Caret Input
 * Features spring-animated caret cursor that smoothly glides between characters.
 */

export function SmoothInput({
  value,
  onChange,
  placeholder = 'Search...',
  className,
  wrapperClassName,
  inputClassName,
  autoFocus,
  onKeyDown,
  // Off by default. Impersonating the caret costs a getComputedStyle and a
  // forced layout read on every keystroke, in a field that is typed into all
  // day. Pass springCaret to opt a field back in.
  springCaret = false,
  ...props
}) {
  const [internalValue, setInternalValue] = useState('')
  const isControlled = value !== undefined
  const inputValue = isControlled ? String(value) : internalValue

  const inputRef = useRef(null)
  const containerRef = useRef(null)
  const measureRef = useRef(null)

  const prefersReducedMotion = useReducedMotion()
  const enabled = springCaret && !prefersReducedMotion

  const caretX = useMotionValue(0)
  const caretOpacity = useMotionValue(0)

  const springCaretX = useSpring(
    caretX,
    prefersReducedMotion
      ? { stiffness: 10000, damping: 100, mass: 0.1 }
      : { stiffness: 450, damping: 32, mass: 0.15 }
  )

  const syncMeasureSpan = () => {
    const input = inputRef.current
    const measureSpan = measureRef.current
    if (!input || !measureSpan) return

    const styles = window.getComputedStyle(input)
    measureSpan.style.font = `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`
    measureSpan.style.letterSpacing = styles.letterSpacing
  }

  const measurePrefixWidth = (text) => {
    const input = inputRef.current
    const measureSpan = measureRef.current
    if (!input || !measureSpan) return null

    syncMeasureSpan()
    measureSpan.textContent = text

    const paddingLeft = parseFloat(window.getComputedStyle(input).paddingLeft) || 0
    return text.length > 0 ? measureSpan.offsetWidth + paddingLeft : paddingLeft
  }

  const updateCaret = (target) => {
    if (!target || !enabled) return
    const selStart = target.selectionStart ?? 0
    const textBefore = target.value.slice(0, selStart)
    const width = measurePrefixWidth(textBefore)
    if (width === null) return

    const styles = window.getComputedStyle(target)
    const paddingLeft = parseFloat(styles.paddingLeft) || 0
    const maxVisibleX = target.clientWidth - (parseFloat(styles.paddingRight) || 0)

    const pos = Math.min(width - target.scrollLeft, maxVisibleX)
    caretX.set(Math.max(paddingLeft, pos))

    if (document.activeElement === target) {
      caretOpacity.set(1)
    }
  }

  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) {
      updateCaret(inputRef.current)
    }
  }, [inputValue])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return

    if (!enabled) return undefined

    const onSelectionChange = () => {
      if (document.activeElement === input) {
        requestAnimationFrame(() => updateCaret(input))
      }
    }

    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [enabled])

  return (
    <div className={cn('skiper106-wrap', wrapperClassName)}>
      <div ref={containerRef} className="skiper106-container">
        <input
          {...props}
          ref={inputRef}
          value={inputValue}
          autoFocus={autoFocus}
          placeholder={placeholder}
          className={cn(
            'skiper106-input',
            enabled && 'skiper106-input--synthetic-caret',
            inputClassName,
            className,
          )}
          onChange={(e) => {
            if (!isControlled) setInternalValue(e.target.value)
            onChange?.(e)
            requestAnimationFrame(() => updateCaret(e.target))
          }}
          onFocus={(e) => {
            updateCaret(e.target)
            if (enabled) caretOpacity.set(1)
          }}
          onBlur={(e) => {
            caretOpacity.set(0)
            props.onBlur?.(e)
          }}
          onKeyDown={onKeyDown}
        />
        <span
          ref={measureRef}
          aria-hidden="true"
          className="skiper106-measure"
        />
        {enabled && (
          <motion.div
            aria-hidden="true"
            className="skiper106-caret"
            style={{ x: springCaretX, opacity: caretOpacity }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Skiper 106 Smooth Caret Textarea
 *
 * Same spring caret, in a field whose text wraps. The single-line version above
 * measures the text before the caret in a hidden span and gets an x offset out
 * of it; that reasoning collapses the moment a line wraps, because the caret's
 * position stops being a function of prefix width alone.
 *
 * So this measures the way a browser does: a mirror div that copies every
 * property affecting layout, the text before the caret inside it, and a marker
 * span at the split. The marker's offsetLeft/offsetTop is where the caret is,
 * on any line, and both axes are sprung.
 *
 * The native caret is hidden while ours is shown, and only while ours is shown:
 * reduced motion and coarse pointers keep the real one, because a synthetic
 * caret that cannot keep up with a system keyboard is worse than no effect.
 */

// Every property that changes where a glyph lands. Copied onto the mirror so
// the measurement is the same layout the textarea is performing.
const MIRRORED_PROPS = [
  'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
  'lineHeight', 'textTransform', 'textIndent', 'wordSpacing', 'tabSize',
]

export function SmoothTextarea({
  value,
  onChange,
  className,
  wrapperClassName,
  textareaClassName,
  // Pulled out of the rest rather than spread: it is ours, and React would
  // otherwise hand `textarearef` to the DOM and complain about it.
  textareaRef: forwardedRef,
  // See SmoothInput: off by default, and this is the composer.
  springCaret = false,
  ...props
}) {
  const [internalValue, setInternalValue] = useState('')
  const isControlled = value !== undefined
  const textValue = isControlled ? String(value) : internalValue

  const textareaRef = useRef(null)
  const mirrorRef = useRef(null)

  const prefersReducedMotion = useReducedMotion()
  // A phone's own caret is driven by the system keyboard and cannot be
  // impersonated convincingly, so on coarse pointers this does nothing at all.
  const [coarsePointer, setCoarsePointer] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(pointer: coarse)')
    const sync = () => setCoarsePointer(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const enabled = springCaret && !prefersReducedMotion && !coarsePointer

  const caretX = useMotionValue(0)
  const caretY = useMotionValue(0)
  const caretH = useMotionValue(18)
  const caretOpacity = useMotionValue(0)

  const spring = { stiffness: 520, damping: 34, mass: 0.14 }
  const springX = useSpring(caretX, spring)
  const springY = useSpring(caretY, spring)

  const updateCaret = useCallback(() => {
    const el = textareaRef.current
    const mirror = mirrorRef.current
    if (!el || !mirror || !enabled) return

    const styles = window.getComputedStyle(el)
    for (const prop of MIRRORED_PROPS) mirror.style[prop] = styles[prop]
    // The textarea's own width is already copied above, but a scrollbar takes
    // from the content box without changing `width`, so measure what is left.
    mirror.style.width = `${el.clientWidth}px`

    const caretIndex = el.selectionStart ?? 0
    mirror.textContent = el.value.slice(0, caretIndex)
    // A trailing newline collapses unless something occupies the next line.
    const marker = document.createElement('span')
    marker.textContent = el.value.slice(caretIndex) || '.'
    mirror.appendChild(marker)

    const lineHeight = parseFloat(styles.lineHeight) || parseFloat(styles.fontSize) * 1.4
    caretX.set(marker.offsetLeft - el.scrollLeft)
    caretY.set(marker.offsetTop - el.scrollTop)
    caretH.set(lineHeight)

    if (document.activeElement === el) caretOpacity.set(1)
  }, [caretH, caretOpacity, caretX, caretY, enabled])

  useEffect(() => { updateCaret() }, [textValue, updateCaret])

  useEffect(() => {
    const el = textareaRef.current
    if (!el || !enabled) return undefined

    const onSelectionChange = () => {
      if (document.activeElement === el) requestAnimationFrame(updateCaret)
    }
    const onScroll = () => requestAnimationFrame(updateCaret)

    document.addEventListener('selectionchange', onSelectionChange)
    el.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(() => requestAnimationFrame(updateCaret))
    observer.observe(el)

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange)
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [enabled, updateCaret])

  // Nothing left to point at once the effect is off.
  useEffect(() => { if (!enabled) caretOpacity.set(0) }, [caretOpacity, enabled])

  return (
    <div className={cn('skiper106-wrap skiper106-wrap--area', wrapperClassName)}>
      <div className="skiper106-container skiper106-container--area">
        <textarea
          {...props}
          ref={(node) => {
            textareaRef.current = node
            if (typeof forwardedRef === 'function') forwardedRef(node)
            else if (forwardedRef) forwardedRef.current = node
          }}
          value={textValue}
          className={cn(
            'skiper106-textarea',
            enabled && 'skiper106-textarea--synthetic-caret',
            textareaClassName,
            className,
          )}
          onChange={(e) => {
            if (!isControlled) setInternalValue(e.target.value)
            onChange?.(e)
            if (enabled) requestAnimationFrame(updateCaret)
          }}
          onFocus={(e) => {
            requestAnimationFrame(updateCaret)
            if (enabled) caretOpacity.set(1)
            props.onFocus?.(e)
          }}
          onBlur={(e) => {
            caretOpacity.set(0)
            props.onBlur?.(e)
          }}
        />
        <div ref={mirrorRef} aria-hidden="true" className="skiper106-mirror" />
        {enabled && (
          <motion.div
            aria-hidden="true"
            className="skiper106-caret skiper106-caret--area"
            style={{ x: springX, y: springY, height: caretH, opacity: caretOpacity }}
          />
        )}
      </div>
    </div>
  )
}
