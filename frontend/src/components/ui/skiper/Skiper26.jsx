import React, { useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../Icon.jsx'
import { cn } from '@/lib/utils.js'

/**
 * Skiper 26 Theme Toggle Button with View Transition API
 * Configuration: circle variant, blur on, bottom-center origin.
 */

const STYLE_ID = 'skiper26-theme-transition-styles'

function getThemeTransitionCSS() {
  const clipPosition = '50% 100%'
  return `
    ::view-transition-group(root) {
      animation-duration: 0.85s;
      animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
    }
    ::view-transition-new(root) {
      animation-name: reveal-light-bottom-center-blur;
      filter: blur(2px);
    }
    ::view-transition-old(root),
    [data-theme='graphite']::view-transition-old(root),
    [data-theme='ink']::view-transition-old(root),
    [data-theme='nocturne']::view-transition-old(root) {
      animation: none;
      z-index: -1;
    }
    [data-theme='graphite']::view-transition-new(root),
    [data-theme='ink']::view-transition-new(root),
    [data-theme='nocturne']::view-transition-new(root) {
      animation-name: reveal-dark-bottom-center-blur;
      filter: blur(2px);
    }
    @keyframes reveal-dark-bottom-center-blur {
      from {
        clip-path: circle(0% at ${clipPosition});
        filter: blur(8px);
      }
      50% {
        filter: blur(4px);
      }
      to {
        clip-path: circle(160% at ${clipPosition});
        filter: blur(0px);
      }
    }
    @keyframes reveal-light-bottom-center-blur {
      from {
        clip-path: circle(0% at ${clipPosition});
        filter: blur(8px);
      }
      50% {
        filter: blur(4px);
      }
      to {
        clip-path: circle(160% at ${clipPosition});
        filter: blur(0px);
      }
    }
  `
}

const DARK_THEMES = ['graphite', 'ink', 'nocturne']

export function useSkiperThemeToggle({ theme, setTheme }) {
  const isDark = theme === 'system'
    ? (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    : DARK_THEMES.includes(theme)

  const ensureStyles = useCallback(() => {
    if (typeof window === 'undefined') return
    let styleEl = document.getElementById(STYLE_ID)
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = STYLE_ID
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = getThemeTransitionCSS()
  }, [])

  const toggleTheme = useCallback(() => {
    const nextTheme = isDark ? 'paper' : 'graphite'
    ensureStyles()

    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => {
        setTheme(nextTheme)
      })
    } else {
      setTheme(nextTheme)
    }
  }, [isDark, setTheme, ensureStyles])

  return { isDark, toggleTheme }
}

export function ThemeToggleButton({ theme, setTheme, className }) {
  const { isDark, toggleTheme } = useSkiperThemeToggle({ theme, setTheme })

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn('skiper26-toggle-btn', className)}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          /* In dark mode: clicking switches to light → show sun */
          <motion.span
            key="sun"
            initial={{ scale: 0.6, rotate: -40, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0.6, rotate: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="skiper26-icon-wrap"
          >
            <Icon name="sun" size={15} />
          </motion.span>
        ) : (
          /* In light mode: clicking switches to dark → show moon */
          <motion.span
            key="moon"
            initial={{ scale: 0.6, rotate: 40, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0.6, rotate: -40, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="skiper26-icon-wrap"
          >
            <Icon name="moon" size={15} />
          </motion.span>
        )}
      </AnimatePresence>
      <span className="skiper26-label">{isDark ? 'Light' : 'Dark'}</span>
    </button>
  )
}
