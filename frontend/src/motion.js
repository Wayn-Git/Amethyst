/* Motion helpers — GSAP-powered, respecting prefers-reduced-motion.

   Replaces the CSS-only animation approach with GSAP for richer easing,
   stagger patterns, and smoother orchestration. Falls back to instant
   visibility when reduced motion is preferred.

   Every animation here targets `opacity` and `transform` only — no
   layout-heavy properties. GSAP's `autoAlpha` handles the visibility
   swap so invisible elements don't block clicks. */

import { useEffect, useRef } from 'react'
import gsap from 'gsap'

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Stagger `[data-enter]` children in once, on mount.
 *
 *  Uses GSAP's `from()` for a polished orchestrated entrance with custom
 *  easing. Falls back to instant visibility when reduced motion is requested.
 *  Capped at 8 stagger slots so a long list doesn't take forever.
 */
export function useViewEntrance(rootRef, deps = []) {
  const didRun = useRef(false)
  useEffect(() => {
    const nodes = rootRef.current?.querySelectorAll('[data-enter]')
    if (!nodes?.length) return

    if (REDUCED) {
      // Respect the user's preference — show everything instantly
      nodes.forEach((node) => {
        node.style.opacity = '1'
        node.style.visibility = 'inherit'
      })
      return
    }

    // Prevent re-running entrance on HMR or dep changes after first mount
    if (didRun.current) return
    didRun.current = true

    gsap.from(nodes, {
      autoAlpha: 0,
      y: 10,
      duration: 0.45,
      stagger: { each: 0.05, from: 'start' },
      ease: 'power2.out',
      clearProps: 'transform',
    })

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Animate a single element in. Useful for items that appear after initial
 *  mount — a new conversation row, a new message, a card that loads late. */
export function animateIn(el, { delay = 0, y = 8 } = {}) {
  if (!el || REDUCED) {
    if (el) { el.style.opacity = '1'; el.style.visibility = 'inherit' }
    return
  }
  gsap.from(el, {
    autoAlpha: 0,
    y,
    duration: 0.38,
    delay,
    ease: 'power2.out',
    clearProps: 'transform',
  })
}

/** Stagger a list of elements (e.g. sidebar conversation rows, stat cards). */
export function staggerIn(els, { each = 0.04, y = 6 } = {}) {
  if (!els?.length) return
  if (REDUCED) {
    els.forEach((el) => { el.style.opacity = '1'; el.style.visibility = 'inherit' })
    return
  }
  gsap.from(els, {
    autoAlpha: 0,
    y,
    duration: 0.35,
    stagger: { each, from: 'start' },
    ease: 'power2.out',
    clearProps: 'transform',
  })
}

/** The panel's own entrance, the one piece of motion that is about the panel
 *  rather than what is inside it.
 *
 *  A panel appearing is a *column* appearing, which moves everything beside
 *  it; the vestibular-safe read of that is to animate the column and not its
 *  contents. Under reduced motion the whole thing is a 12ms opacity settle:
 *  the panel still arrives (teleporting a column into existence is its own
 *  disorientation) but nothing moves.
 */
export function panelIn(el) {
  if (!el) return
  if (REDUCED) {
    gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.012, clearProps: 'all' })
    return
  }
  gsap.fromTo(
    el,
    { autoAlpha: 0, x: 16 },
    { autoAlpha: 1, x: 0, duration: 0.34, ease: 'expo.out', clearProps: 'transform' },
  )
}

/** A count that changed, seen to change. Text scale, not layout: the element
 *  is inline and reflowing it would shove the whole header row. */
export function pulseCount(el) {
  if (!el || REDUCED) return
  gsap.fromTo(
    el,
    { scale: 1 },
    { scale: 1.18, duration: 0.14, ease: 'out', yoyo: true, repeat: 1, clearProps: 'transform' },
  )
}

/** Live-streaming content: fade a fresh block in without moving it. Streaming
 *  already implies change; moving it too is the double that reads as jitter. */
export function streamIn(el) {
  if (!el) return
  if (REDUCED) {
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.012, clearProps: 'all' })
    return
  }
  gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.18, ease: 'power1.out', clearProps: 'opacity' })
}
