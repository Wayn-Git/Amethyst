import { useEffect } from 'react'
import { attachLiquidGlass } from './engine.js'

const GLASS_SELECTORS = [
  '.settings-view',
  '.palette.damon-spotlight',
  '.confirm-modal-window',
  '.arc-wizard-bezel',
  '.pairing-approval-modal',
  '.app-tb-dropdown',
  '.plus-menu',
  '.ac-dropdown',
  '.ctx-menu',
  '.dropdown-menu',
  '.menu-popup',
  '.sb-mini-flyout',
  "[data-slot='dialog-content']",
  "[data-slot='dropdown-menu-content']",
  "[data-slot='popover-content']",
  '.model-picker-dropdown',
  '.amethyst-liquid-glass',
  '[data-liquid-glass]',
].join(', ')

class LiquidGlassManager {
  constructor() {
    this.attached = new Map() // element -> cleanup function
    this.mutationObserver = null
    this.debounceTimer = null
    this.active = false
  }

  start() {
    if (this.active || typeof document === 'undefined') return
    this.active = true
    this.scanAndAttach()

    // Debounced observer to pick up newly mounted modals/menus without blocking main thread
    this.mutationObserver = new MutationObserver((mutations) => {
      // Ignore mutations to SVG defs or attributes set by liquid glass
      const hasMeaningfulChange = mutations.some((m) => {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && !node.closest?.('#amethyst-liquid-glass-svg')) {
              return true
            }
          }
        }
        return false
      })

      if (!hasMeaningfulChange) return

      if (this.debounceTimer) clearTimeout(this.debounceTimer)
      this.debounceTimer = setTimeout(() => {
        this.scanAndAttach()
      }, 150)
    })

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    })
  }

  stop() {
    if (!this.active) return
    this.active = false
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }

    for (const [element, cleanup] of this.attached.entries()) {
      try {
        cleanup()
      } catch (err) {
        console.error('Error detaching liquid glass:', err)
      }
    }
    this.attached.clear()
  }

  scanAndAttach() {
    if (!this.active || typeof document === 'undefined') return

    // Clean up disconnected elements
    for (const [element, cleanup] of this.attached.entries()) {
      if (!element.isConnected) {
        try { cleanup() } catch {}
        this.attached.delete(element)
      }
    }

    // Attach to matching elements
    const elements = document.querySelectorAll(GLASS_SELECTORS)
    for (const element of elements) {
      if (this.attached.has(element)) continue
      // Don't attach to zero-dimension hidden elements
      if (element.offsetWidth === 0 && element.offsetHeight === 0) continue

      try {
        const cleanup = attachLiquidGlass(element)
        this.attached.set(element, cleanup)
      } catch (err) {
        console.error('Error attaching liquid glass to element:', element, err)
      }
    }
  }

  updateState(glassMaterial) {
    if (glassMaterial === 'full') {
      this.start()
    } else {
      this.stop()
    }
  }
}

export const liquidGlassManager = new LiquidGlassManager()

export function useLiquidGlassManager(glassMaterial) {
  useEffect(() => {
    liquidGlassManager.updateState(glassMaterial)
    return () => {
      liquidGlassManager.stop()
    }
  }, [glassMaterial])
}
