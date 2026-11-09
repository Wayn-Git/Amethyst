/* Motion system — Framer Motion & GSAP unified tokens, respecting prefers-reduced-motion.
 *
 * Provides consistent physics-based easing, micro-interactions, layout transitions,
 * and staggered reveals across the entire Amethyst application.
 *
 * Rules:
 * - Only animate `transform` and `opacity` (GPU-safe, never reflow layout properties).
 * - Fast interactions: 160ms-320ms duration range.
 * - Respect `prefers-reduced-motion: reduce` unconditionally.
 */

import { useEffect, useRef } from 'react'
import gsap from 'gsap'

export const REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ─── Easing and Physics Tokens ────────────────────────────────────────── */
export const EASE_PREMIUM = [0.16, 1, 0.3, 1]
export const EASE_ACCELERATE = [0.4, 0, 1, 1]
export const EASE_DECELERATE = [0, 0, 0.2, 1]

export const SPRING_TACTILE = {
  type: 'spring',
  stiffness: 460,
  damping: 32,
  mass: 0.8,
}

export const SPRING_SMOOTH = {
  type: 'spring',
  stiffness: 340,
  damping: 28,
  mass: 0.9,
}

export const TRANSITION_FAST = {
  duration: REDUCED_MOTION ? 0.01 : 0.16,
  ease: EASE_PREMIUM,
}

export const TRANSITION_BASE = {
  duration: REDUCED_MOTION ? 0.01 : 0.24,
  ease: EASE_PREMIUM,
}

export const TRANSITION_SMOOTH = {
  duration: REDUCED_MOTION ? 0.01 : 0.36,
  ease: EASE_PREMIUM,
}

/* ─── Framer Motion Variants ───────────────────────────────────────────── */

/** Page & Route Swap Animation */
export const pageVariants = {
  initial: {
    opacity: 0,
    y: REDUCED_MOTION ? 0 : 6,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: TRANSITION_BASE,
  },
  exit: {
    opacity: 0,
    y: REDUCED_MOTION ? 0 : -4,
    transition: TRANSITION_FAST,
  },
}

/** Stagger Container & Items */
export const staggerContainerVariants = {
  hidden: { opacity: 0 },
  show: (delay = 0.02) => ({
    opacity: 1,
    transition: {
      staggerChildren: REDUCED_MOTION ? 0 : 0.04,
      delayChildren: delay,
    },
  }),
}

export const staggerItemVariants = {
  hidden: {
    opacity: 0,
    y: REDUCED_MOTION ? 0 : 8,
    scale: REDUCED_MOTION ? 1 : 0.985,
  },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: TRANSITION_BASE,
  },
}

/** Dropdowns, Popovers, and Menus */
export const popoverVariants = {
  initial: {
    opacity: 0,
    scale: REDUCED_MOTION ? 1 : 0.95,
    y: REDUCED_MOTION ? 0 : -4,
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: REDUCED_MOTION ? 0.01 : 0.18,
      ease: EASE_PREMIUM,
    },
  },
  exit: {
    opacity: 0,
    scale: REDUCED_MOTION ? 1 : 0.96,
    y: REDUCED_MOTION ? 0 : -2,
    transition: {
      duration: REDUCED_MOTION ? 0.01 : 0.12,
      ease: EASE_ACCELERATE,
    },
  },
}

/** Modals & Dialogs */
export const modalOverlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: TRANSITION_FAST },
  exit: { opacity: 0, transition: { duration: 0.12 } },
}

export const modalContentVariants = {
  initial: {
    opacity: 0,
    scale: REDUCED_MOTION ? 1 : 0.96,
    y: REDUCED_MOTION ? 0 : 8,
  },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: SPRING_TACTILE,
  },
  exit: {
    opacity: 0,
    scale: REDUCED_MOTION ? 1 : 0.97,
    y: REDUCED_MOTION ? 0 : 4,
    transition: { duration: 0.12, ease: EASE_ACCELERATE },
  },
}

/** Mobile Sheet / Drawer */
export const drawerVariants = {
  initial: {
    x: '-100%',
    opacity: 0.6,
  },
  animate: {
    x: '0%',
    opacity: 1,
    transition: {
      duration: REDUCED_MOTION ? 0.01 : 0.32,
      ease: EASE_PREMIUM,
    },
  },
  exit: {
    x: '-100%',
    opacity: 0,
    transition: {
      duration: REDUCED_MOTION ? 0.01 : 0.22,
      ease: EASE_ACCELERATE,
    },
  },
}

/** Interactive Button Physics */
export const buttonPressProps = REDUCED_MOTION
  ? {}
  : {
      whileHover: { scale: 1.015, y: -1 },
      whileTap: { scale: 0.975, y: 0.5 },
      transition: { duration: 0.14, ease: EASE_PREMIUM },
    }

export const chipPressProps = REDUCED_MOTION
  ? {}
  : {
      whileHover: { scale: 1.02, y: -1 },
      whileTap: { scale: 0.98 },
      transition: { duration: 0.14, ease: EASE_PREMIUM },
    }

/* ─── GSAP Orchestration Helpers ────────────────────────────────────────── */

export function useViewEntrance(rootRef, deps = []) {
  const didRun = useRef(false)
  useEffect(() => {
    const nodes = rootRef.current?.querySelectorAll('[data-enter]')
    if (!nodes?.length) return

    if (REDUCED_MOTION) {
      nodes.forEach((node) => {
        node.style.opacity = '1'
        node.style.visibility = 'inherit'
      })
      return
    }

    if (didRun.current) return
    didRun.current = true

    gsap.from(nodes, {
      autoAlpha: 0,
      y: 8,
      duration: 0.42,
      stagger: { each: 0.045, from: 'start' },
      ease: 'power2.out',
      clearProps: 'transform',
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function animateIn(el, { delay = 0, y = 8 } = {}) {
  if (!el || REDUCED_MOTION) {
    if (el) { el.style.opacity = '1'; el.style.visibility = 'inherit' }
    return
  }
  gsap.from(el, {
    autoAlpha: 0,
    y,
    duration: 0.35,
    delay,
    ease: 'power2.out',
    clearProps: 'transform',
  })
}

export function staggerIn(els, { each = 0.035, y = 6 } = {}) {
  if (!els?.length) return
  if (REDUCED_MOTION) {
    els.forEach((el) => { el.style.opacity = '1'; el.style.visibility = 'inherit' })
    return
  }
  gsap.from(els, {
    autoAlpha: 0,
    y,
    duration: 0.32,
    stagger: { each, from: 'start' },
    ease: 'power2.out',
    clearProps: 'transform',
  })
}

export function panelIn(el) {
  if (!el) return
  if (REDUCED_MOTION) {
    gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.012, clearProps: 'all' })
    return
  }
  gsap.fromTo(
    el,
    { autoAlpha: 0, x: 16 },
    { autoAlpha: 1, x: 0, duration: 0.32, ease: 'expo.out', clearProps: 'transform' },
  )
}

export function pulseCount(el) {
  if (!el || REDUCED_MOTION) return
  gsap.fromTo(
    el,
    { scale: 1 },
    { scale: 1.15, duration: 0.12, ease: 'out', yoyo: true, repeat: 1, clearProps: 'transform' },
  )
}

export function streamIn(el) {
  if (!el) return
  if (REDUCED_MOTION) {
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.012, clearProps: 'all' })
    return
  }
  gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: 'power1.out', clearProps: 'opacity' })
}
