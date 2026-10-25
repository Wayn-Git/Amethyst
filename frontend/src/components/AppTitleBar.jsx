import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../store.jsx'
import { MOD_LABEL } from '../keys.js'
import './AppTitleBar.css'

export default function AppTitleBar() {
  const {
    view, setView, chat, toggleRail,
    togglePanel, toggleTerminal, setOverlay,
    autoHideTopBar,
  } = useApp()

  const [openMenu, setOpenMenu] = useState(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const barRef = useRef(null)

  // Listen for maximize state changes (Electron and browser fullscreen fallback)
  useEffect(() => {
    let unlisten = null
    if (window.amethystDesktop?.isMaximized) {
      window.amethystDesktop.isMaximized().then((max) => setIsMaximized(Boolean(max)))
      if (window.amethystDesktop?.onMaximizedChange) {
        unlisten = window.amethystDesktop.onMaximizedChange((max) => {
          setIsMaximized(Boolean(max))
        })
      }
    }

    const onFullscreenChange = () => {
      setIsMaximized(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)

    return () => {
      if (unlisten) unlisten()
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [])

  // Close menus on click outside or escape key
  useEffect(() => {
    if (!openMenu) return

    const handlePointerDown = (e) => {
      if (!barRef.current || !barRef.current.contains(e.target)) {
        setOpenMenu(null)
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpenMenu(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu])

  // Window control actions
  const handleMinimize = useCallback(() => {
    if (window.amethystDesktop?.minimize) {
      window.amethystDesktop.minimize()
    } else if (window.pywebview?.api?.minimize) {
      window.pywebview.api.minimize()
    }
  }, [])

  const handleMaximize = useCallback(() => {
    if (window.amethystDesktop?.maximize) {
      window.amethystDesktop.maximize()
    } else if (window.pywebview?.api?.maximize) {
      window.pywebview.api.maximize()
    } else {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {})
      } else {
        document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  const handleClose = useCallback(() => {
    if (window.amethystDesktop?.close) {
      window.amethystDesktop.close()
    } else if (window.pywebview?.api?.close) {
      window.pywebview.api.close()
    } else {
      window.close()
    }
  }, [])

  const handleDoubleClickTitlebar = useCallback((e) => {
    if (e.target.closest('button, .app-tb-dropdown')) return
    handleMaximize()
  }, [handleMaximize])

  // Menu item click wrapper: execute action & close menu
  const onItemClick = useCallback((action) => {
    setOpenMenu(null)
    if (typeof action === 'function') {
      action()
    }
  }, [])

  // Menu structure definition
  const menus = [
    {
      id: 'file',
      label: 'File',
      items: [
        {
          label: 'New Chat',
          shortcut: `${MOD_LABEL}+Shift+O`,
          action: () => {
            setView('chat')
            chat.startFresh?.()
          },
        },
        {
          label: 'Settings',
          shortcut: `${MOD_LABEL}+,`,
          action: () => setView('settings'),
        },
        {
          label: 'Command Palette',
          shortcut: `${MOD_LABEL}+K`,
          action: () => setOverlay('palette'),
        },
        { type: 'separator' },
        {
          label: 'Close Window',
          shortcut: `${MOD_LABEL}+W`,
          action: handleClose,
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          shortcut: `${MOD_LABEL}+Z`,
          action: () => document.execCommand('undo'),
        },
        {
          label: 'Redo',
          shortcut: `${MOD_LABEL}+Shift+Z`,
          action: () => document.execCommand('redo'),
        },
        { type: 'separator' },
        {
          label: 'Cut',
          shortcut: `${MOD_LABEL}+X`,
          action: () => document.execCommand('cut'),
        },
        {
          label: 'Copy',
          shortcut: `${MOD_LABEL}+C`,
          action: () => document.execCommand('copy'),
        },
        {
          label: 'Paste',
          shortcut: `${MOD_LABEL}+V`,
          action: async () => {
            try {
              const text = await navigator.clipboard.readText()
              document.execCommand('insertText', false, text)
            } catch {
              document.execCommand('paste')
            }
          },
        },
        {
          label: 'Select All',
          shortcut: `${MOD_LABEL}+A`,
          action: () => document.execCommand('selectAll'),
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          label: 'Toggle Navigation Sidebar',
          shortcut: `${MOD_LABEL}+B`,
          action: toggleRail,
        },
        {
          label: 'Toggle Details Panel',
          action: togglePanel,
        },
        {
          label: 'Toggle Terminal',
          shortcut: 'Ctrl+`',
          action: toggleTerminal,
        },
        { type: 'separator' },
        {
          label: 'Reload App',
          shortcut: `${MOD_LABEL}+R`,
          action: () => window.location.reload(),
        },
        {
          label: isMaximized ? 'Exit Fullscreen' : 'Enter Fullscreen',
          shortcut: 'F11',
          action: handleMaximize,
        },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        {
          label: 'Keyboard Shortcuts',
          shortcut: 'Shift+?',
          action: () => setOverlay('shortcuts'),
        },
        {
          label: 'Command Palette',
          shortcut: `${MOD_LABEL}+K`,
          action: () => setOverlay('palette'),
        },
        { type: 'separator' },
        {
          label: 'Documentation',
          action: () => window.open('https://github.com/amethyst/amethyst#readme', '_blank', 'noopener,noreferrer'),
        },
        {
          label: 'GitHub Repository',
          action: () => window.open('https://github.com/amethyst/amethyst', '_blank', 'noopener,noreferrer'),
        },
        { type: 'separator' },
        {
          label: 'About Amethyst',
          action: () => alert('AMETHYST · Personal Operating System\nVersion 1.0.0'),
        },
      ],
    },
  ]

  return (
    <>
      {autoHideTopBar && <div className="app-tb-hover-trigger" />}
      <header
        ref={barRef}
        className={`app-titlebar${autoHideTopBar ? ' app-titlebar--autohide' : ''}`}
        onDoubleClick={handleDoubleClickTitlebar}
        aria-label="Application titlebar and menu"
      >
      {/* Left: Navigation arrows and Menu dropdowns */}
      <div className="app-tb-left">
        <div className="app-tb-nav-group">
          <button
            type="button"
            className="app-tb-nav-btn"
            onClick={() => window.history.back()}
            title="Back"
            aria-label="Back"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            type="button"
            className="app-tb-nav-btn"
            onClick={() => window.history.forward()}
            title="Forward"
            aria-label="Forward"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <nav className="app-tb-menus" aria-label="Menu bar">
          {menus.map((menu) => {
            const isOpen = openMenu === menu.id
            return (
              <div key={menu.id} className="app-tb-menu-anchor">
                <button
                  type="button"
                  className={`app-tb-menu-btn${isOpen ? ' is-active' : ''}`}
                  onClick={() => setOpenMenu(isOpen ? null : menu.id)}
                  onMouseEnter={() => {
                    if (openMenu && openMenu !== menu.id) {
                      setOpenMenu(menu.id)
                    }
                  }}
                  aria-haspopup="menu"
                  aria-expanded={isOpen}
                >
                  {menu.label}
                </button>

                {isOpen && (
                  <div className="app-tb-dropdown" role="menu">
                    {menu.items.map((item, idx) => {
                      if (item.type === 'separator') {
                        return <div key={`sep-${idx}`} className="app-tb-dropdown-sep" role="separator" />
                      }
                      return (
                        <button
                          key={item.label}
                          type="button"
                          className="app-tb-dropdown-item"
                          role="menuitem"
                          onClick={() => onItemClick(item.action)}
                        >
                          <span className="app-tb-item-label">{item.label}</span>
                          {item.shortcut && (
                            <span className="app-tb-item-shortcut">{item.shortcut}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </div>

      {/* Center: Draggable area */}
      <div className="app-tb-center" />

      {/* Right: Window Controls */}
      <div className="app-tb-right">
        <button
          type="button"
          className="app-tb-win-btn app-tb-minimize"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <svg width="11" height="11" viewBox="0 0 12 12">
            <rect y="5.25" width="12" height="1.5" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          className="app-tb-win-btn app-tb-maximize"
          onClick={handleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M3.5 3.5V1.5h7v7H8.5" />
              <rect x="1.5" y="3.5" width="7" height="7" rx="1" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="app-tb-win-btn app-tb-close"
          onClick={handleClose}
          title="Close"
          aria-label="Close"
        >
          <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3">
            <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" />
            <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" />
          </svg>
        </button>
      </div>
    </header>
    </>
  )
}

