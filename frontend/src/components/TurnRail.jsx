import { useCallback, useEffect, useRef, useState } from 'react'

import Icon from './Icon.jsx'

/* A map of the conversation down the right edge.

   A long conversation is a scrollbar with no landmarks: every position looks
   the same, and finding the answer about the deploy error means dragging and
   reading until it appears. One tick per turn gives the column landmarks --
   where the questions are, how long each answer ran, where you are now -- and
   the chevrons step between them so moving a turn at a time never involves the
   scroll wheel at all.

   Ticks are sized by the length of what they mark, so the shape of the
   conversation is legible before anything is hovered: a run of short exchanges
   looks different from one long answer.

   Everything here is `transform` and `opacity`. Scroll is read in a rAF, and
   the read is a `getBoundingClientRect` per turn done in one batch, never
   interleaved with a write. */

const MAX_TICKS = 60

export default function TurnRail({ items, scrollRef, onJump }) {
  const [current, setCurrent] = useState(0)
  const [hover, setHover] = useState(null)
  const railRef = useRef(null)
  const frame = useRef(0)

  /* Only the things a person would navigate to. Notes, traces and cost lines
     are machinery, and a tick for each would make the rail a picture of how
     much the agent did rather than of what was said. */
  const turns = items.filter((i) => (i.kind === 'user' || i.kind === 'assistant') && i.text)
  const shown = turns.length > MAX_TICKS ? turns.slice(-MAX_TICKS) : turns

  const measure = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller || shown.length === 0) return
    const top = scroller.getBoundingClientRect().top
    // One batched read pass. Nothing is written to the DOM inside this loop, so
    // it cannot thrash layout.
    let best = 0
    let bestDistance = Infinity
    for (let i = 0; i < shown.length; i += 1) {
      const el = scroller.querySelector(`[data-item="${shown[i].id}"]`)
      if (!el) continue
      const distance = Math.abs(el.getBoundingClientRect().top - top - 80)
      if (distance < bestDistance) { bestDistance = distance; best = i }
    }
    setCurrent(best)
  }, [scrollRef, shown])

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return undefined
    const onScroll = () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(measure)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame.current)
    }
  }, [scrollRef, measure])

  const jump = useCallback((index) => {
    const target = shown[index]
    if (!target) return
    setCurrent(index)
    onJump?.(target.id)
  }, [shown, onJump])

  if (shown.length < 2) return null

  const step = (delta) => jump(Math.min(shown.length - 1, Math.max(0, current + delta)))
  const peek = hover === null ? null : shown[hover]

  return (
    <div className="rail" ref={railRef} aria-hidden={false}>
      <button
        type="button"
        className="rail-step"
        onClick={() => step(-1)}
        disabled={current === 0}
        title="Previous message"
        aria-label="Previous message"
      >
        <Icon name="chevron" size={12} className="rail-step-up" />
      </button>

      <div className="rail-ticks" onMouseLeave={() => setHover(null)}>
        {shown.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={`rail-tick rail-tick--${item.kind}${i === current ? ' is-current' : ''}`}
            style={{ '--len': lengthOf(item.text) }}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => jump(i)}
            title={`Jump to this ${item.kind === 'user' ? 'question' : 'answer'}`}
            aria-label={`Jump to ${item.kind === 'user' ? 'question' : 'answer'} ${i + 1} of ${shown.length}`}
          />
        ))}

        {peek && (
          /* Inside the tick column, so `--at` is a straight offset from the
             first tick rather than a share of a box that also holds the two
             chevrons. */
          <div className="rail-peek" style={{ '--at': `${hover * 16 + 8}px` }}>
            <span className="rail-peek-who">{peek.kind === 'user' ? 'you' : 'amethyst'}</span>
            <span className="rail-peek-text">{firstLine(peek.text)}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        className="rail-step"
        onClick={() => step(1)}
        disabled={current === shown.length - 1}
        title="Next message"
        aria-label="Next message"
      >
        <Icon name="chevron" size={12} className="rail-step-down" />
      </button>
    </div>
  )
}

// Tick length as a coarse bucket, not a continuous scale: the rail should say
// "short, medium, long", and a pixel-accurate mapping just makes noise.
function lengthOf(text) {
  const n = String(text || '').length
  if (n < 120) return 1
  if (n < 400) return 2
  if (n < 1200) return 3
  return 4
}

function firstLine(text) {
  const line = String(text || '').trim().replace(/\s+/g, ' ')
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}
