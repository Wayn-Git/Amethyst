import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Icon from './Icon.jsx'
import { useApp } from '../store.jsx'
import { API_ORIGIN } from '../api.js'

function getWsOrigin() {
  if (API_ORIGIN) {
    return API_ORIGIN.replace(/^http/, 'ws')
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}

const XTERM_THEME = {
  background: '#09090b',
  foreground: '#e4e4e7',
  cursor: '#ffffff',
  cursorAccent: '#09090b',
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#18181b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fde047',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
}

export default function TerminalDrawer() {
  const {
    terminalOpen,
    setTerminalOpen,
    terminalHeight,
    setTerminalHeight,
    terminalMinimized,
    setTerminalMinimized,
    workspace,
  } = useApp()

  const [shells, setShells] = useState([])
  const [defaultCwd, setDefaultCwd] = useState('/home/wayne/Documents/Amethyst')
  const [sessions, setSessions] = useState([])
  const [activeSessionId, setActiveSessionId] = useState(null)
  const [newSessionMenuOpen, setNewSessionMenuOpen] = useState(false)
  const [resizing, setResizing] = useState(false)

  const menuRef = useRef(null)
  const plusBtnRef = useRef(null)
  const containerRef = useRef(null)

  // Map of sessionId -> { term, fitAddon, ws, containerEl }
  const instancesRef = useRef(new Map())

  // Fetch available shells & initial sessions
  useEffect(() => {
    let unmounted = false
    async function init() {
      try {
        const res = await fetch(`${API_ORIGIN}/api/terminal/shells`)
        if (res.ok) {
          const data = await res.json()
          if (!unmounted) {
            setShells(data.shells || [])
            if (data.default_cwd) setDefaultCwd(data.default_cwd)
          }
        }
      } catch (err) {
        console.error('Failed to fetch terminal shells:', err)
      }

      try {
        const sRes = await fetch(`${API_ORIGIN}/api/terminal/sessions`)
        if (sRes.ok) {
          const existing = await sRes.json()
          if (!unmounted && existing.length > 0) {
            setSessions(existing)
            setActiveSessionId(existing[0].id)
            return
          }
        }
      } catch { /* ignore */ }

      // If no sessions yet, create one with default shell
      if (!unmounted && terminalOpen && sessions.length === 0) {
        createSession()
      }
    }

    init()
    return () => {
      unmounted = true
    }
  }, [terminalOpen])

  // Click outside to close New Session dropdown
  useEffect(() => {
    if (!newSessionMenuOpen) return
    const onDown = (e) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target) &&
        plusBtnRef.current &&
        !plusBtnRef.current.contains(e.target)
      ) {
        setNewSessionMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [newSessionMenuOpen])

  // Create a new terminal session
  const createSession = useCallback(async (shellId = null) => {
    try {
      const res = await fetch(`${API_ORIGIN}/api/terminal/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shell: shellId }),
      })
      if (res.ok) {
        const newSession = await res.json()
        setSessions((prev) => [...prev, newSession])
        setActiveSessionId(newSession.id)
        setNewSessionMenuOpen(false)
      }
    } catch (err) {
      console.error('Failed to create terminal session:', err)
    }
  }, [])

  // Close an active session
  const closeSession = useCallback(async (e, sessionId) => {
    e.stopPropagation()
    try {
      await fetch(`${API_ORIGIN}/api/terminal/sessions/${sessionId}`, {
        method: 'DELETE',
      })
    } catch { /* ignore */ }

    // Cleanup instance
    const instance = instancesRef.current.get(sessionId)
    if (instance) {
      try { instance.ws.close() } catch {}
      try { instance.term.dispose() } catch {}
      instancesRef.current.delete(sessionId)
    }

    setSessions((prev) => {
      const remaining = prev.filter((s) => s.id !== sessionId)
      if (remaining.length === 0) {
        setTerminalOpen(false)
        setActiveSessionId(null)
      } else if (activeSessionId === sessionId) {
        setActiveSessionId(remaining[remaining.length - 1].id)
      }
      return remaining
    })
  }, [activeSessionId, setTerminalOpen])

  // Mount xterm instance for a session
  const mountSessionTerm = useCallback((sessionId, wrapperEl) => {
    if (!wrapperEl || instancesRef.current.has(sessionId)) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: "var(--font-mono, 'Geist Mono', monospace)",
      fontSize: 12,
      lineHeight: 1.4,
      theme: XTERM_THEME,
      allowTransparency: true,
      convertEol: true,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(wrapperEl)

    try {
      fitAddon.fit()
    } catch {}

    // Connect WebSocket
    const wsOrigin = getWsOrigin()
    const wsUrl = `${wsOrigin}/api/terminal/ws?session_id=${sessionId}`
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      // Send initial size and request active CWD
      try {
        fitAddon.fit()
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }))
        ws.send(JSON.stringify({ type: 'get_cwd' }))
      } catch {}
    }

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const parsed = JSON.parse(event.data)
          if (parsed.type === 'session_init') {
            if (parsed.cwd) {
              setSessions((prev) =>
                prev.map((s) => (s.id === sessionId ? { ...s, cwd: parsed.cwd } : s))
              )
            }
            return
          }
          if (parsed.type === 'cwd' && parsed.cwd) {
            setSessions((prev) =>
              prev.map((s) => (s.id === sessionId ? { ...s, cwd: parsed.cwd } : s))
            )
            return
          }
          if (parsed.type === 'pong') return
        } catch {}
        term.write(event.data)
      } else if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data))
      }
    }

    ws.onclose = () => {
      // Process closed or disconnected
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }))
      }
    })

    instancesRef.current.set(sessionId, {
      term,
      fitAddon,
      ws,
      containerEl: wrapperEl,
    })
  }, [])

  // Auto-focus active xterm on open or session switch
  const focusActiveTerm = useCallback(() => {
    if (!activeSessionId) return
    const inst = instancesRef.current.get(activeSessionId)
    if (inst?.term) {
      inst.term.focus()
    }
  }, [activeSessionId])

  useEffect(() => {
    if (!terminalOpen || !activeSessionId || terminalMinimized) return
    const timer = setTimeout(() => {
      focusActiveTerm()
    }, 60)
    return () => clearTimeout(timer)
  }, [terminalOpen, activeSessionId, terminalMinimized, focusActiveTerm])

  // Periodic CWD sync while terminal drawer is open
  useEffect(() => {
    if (!terminalOpen || !activeSessionId) return
    const pollCwd = () => {
      const inst = instancesRef.current.get(activeSessionId)
      if (inst?.ws?.readyState === WebSocket.OPEN) {
        try {
          inst.ws.send(JSON.stringify({ type: 'get_cwd' }))
        } catch {}
      }
    }
    // Poll right away and periodically
    pollCwd()
    const interval = setInterval(pollCwd, 1500)
    return () => clearInterval(interval)
  }, [terminalOpen, activeSessionId])

  // Refit active terminal on height/visibility changes
  useLayoutEffect(() => {
    if (!activeSessionId || terminalMinimized) return
    const inst = instancesRef.current.get(activeSessionId)
    if (inst) {
      setTimeout(() => {
        try {
          inst.fitAddon.fit()
          if (inst.ws.readyState === WebSocket.OPEN) {
            inst.ws.send(JSON.stringify({
              type: 'resize',
              cols: inst.term.cols,
              rows: inst.term.rows,
            }))
          }
        } catch {}
      }, 50)
    }
  }, [activeSessionId, terminalHeight, terminalMinimized, terminalOpen])

  // Window resize listener
  useEffect(() => {
    const onResize = () => {
      if (!activeSessionId || terminalMinimized) return
      const inst = instancesRef.current.get(activeSessionId)
      if (inst) {
        try {
          inst.fitAddon.fit()
        } catch {}
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeSessionId, terminalMinimized])

  // Drag-to-resize handle
  const onMouseDownResize = useCallback((e) => {
    e.preventDefault()
    setResizing(true)
    const startY = e.clientY
    const startHeight = terminalHeight

    const onMouseMove = (moveEvent) => {
      const delta = startY - moveEvent.clientY
      const nextH = Math.max(160, Math.min(600, startHeight + delta))
      setTerminalHeight(nextH)
    }

    const onMouseUp = () => {
      setResizing(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [terminalHeight, setTerminalHeight])

  // Active session cwd or default
  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const displayCwd = activeSession?.cwd || defaultCwd || (workspace ? `/home/wayne/Documents/${workspace}` : '/home/wayne/Documents/Amethyst')

  return (
    <AnimatePresence>
      {terminalOpen && (
        <motion.div
          key="terminal-drawer"
          ref={containerRef}
          initial={{ height: 0, opacity: 0, y: 16 }}
          animate={{
            height: terminalMinimized ? 36 : terminalHeight,
            opacity: 1,
            y: 0,
          }}
          exit={{ height: 0, opacity: 0, y: 16 }}
          transition={{
            height: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.22, ease: 'easeOut' },
            y: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
          }}
          className={`terminal-drawer${terminalMinimized ? ' is-minimized' : ''}${resizing ? ' is-resizing' : ''}`}
          style={{ '--term-h': `${terminalMinimized ? 36 : terminalHeight}px` }}
          aria-label="Interactive terminal"
        >
          {/* Top Drag-to-Resize Handle */}
          {!terminalMinimized && (
            <div
              className="terminal-resize-bar"
              onMouseDown={onMouseDownResize}
              title="Drag to resize terminal"
            />
          )}

          {/* Terminal Header Bar (Matching Screenshots) */}
          <div className="terminal-header">
            <div className="terminal-header-left">
              <span className="terminal-header-title">TERMINAL</span>
              <motion.span
                key={displayCwd}
                initial={{ opacity: 0.5, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="terminal-header-path"
                title={displayCwd}
              >
                {displayCwd}
              </motion.span>
            </div>

            <div className="terminal-header-actions">
              {/* New Session Button & Menu */}
              <div className="terminal-plus-wrap">
                <motion.button
                  ref={plusBtnRef}
                  type="button"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  className={`terminal-header-btn terminal-plus-btn${newSessionMenuOpen ? ' is-active' : ''}`}
                  onClick={() => setNewSessionMenuOpen((o) => !o)}
                  title="New terminal session"
                  aria-label="New terminal session"
                  aria-expanded={newSessionMenuOpen}
                >
                  <Icon name="plus" size={12} />
                  <motion.div
                    animate={{ rotate: newSessionMenuOpen ? 180 : 0 }}
                    transition={{ duration: 0.16 }}
                    style={{ display: 'flex', alignItems: 'center' }}
                  >
                    <Icon name="chevron" size={9} className="terminal-chevron-icon" />
                  </motion.div>
                </motion.button>

                <AnimatePresence>
                  {newSessionMenuOpen && (
                    <motion.div
                      ref={menuRef}
                      initial={{ opacity: 0, scale: 0.92, y: -6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.92, y: -6 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      className="terminal-dropdown-menu"
                      role="menu"
                    >
                      <div className="terminal-menu-title">New session</div>
                      {shells.map((sh, idx) => (
                        <motion.button
                          key={sh.id}
                          type="button"
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.03, duration: 0.15 }}
                          whileHover={{ x: 2 }}
                          whileTap={{ scale: 0.97 }}
                          className="terminal-menu-item"
                          role="menuitem"
                          onClick={() => createSession(sh.id)}
                        >
                          <span>{sh.name}</span>
                        </motion.button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Minimize / Expand Toggle with rotating chevron */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.9 }}
                className="terminal-header-btn"
                onClick={() => setTerminalMinimized((m) => !m)}
                title={terminalMinimized ? 'Expand terminal' : 'Minimize terminal'}
                aria-label={terminalMinimized ? 'Expand terminal' : 'Minimize terminal'}
              >
                <motion.div
                  animate={{ rotate: terminalMinimized ? 180 : 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="chevron" size={12} />
                </motion.div>
              </motion.button>

              {/* Close Button */}
              <motion.button
                type="button"
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.9 }}
                className="terminal-header-btn terminal-close-btn"
                onClick={() => setTerminalOpen(false)}
                title="Close terminal"
                aria-label="Close terminal"
              >
                <Icon name="x" size={13} />
              </motion.button>
            </div>
          </div>

          {/* Terminal Body: Left Terminal View + Right Sessions Column (Screenshot 2) */}
          {!terminalMinimized && (
            <div className="terminal-body" onClick={focusActiveTerm}>
              {/* Main Terminal Screen Area */}
              <div className="terminal-viewport-wrap" onClick={focusActiveTerm}>
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    ref={(el) => mountSessionTerm(s.id, el)}
                    className={`terminal-screen-slot${s.id === activeSessionId ? ' is-active' : ' is-hidden'}`}
                  />
                ))}
              </div>

              {/* Right Sessions List Column (Screenshot 2) */}
              <div className="terminal-sessions-panel">
                <div className="terminal-sessions-list">
                  <AnimatePresence initial={false}>
                    {sessions.map((s) => {
                      const isActive = s.id === activeSessionId
                      return (
                        <motion.div
                          key={s.id}
                          initial={{ opacity: 0, x: 12, height: 0 }}
                          animate={{ opacity: 1, x: 0, height: 'auto' }}
                          exit={{ opacity: 0, x: 12, height: 0 }}
                          transition={{ duration: 0.18 }}
                          className={`terminal-session-item${isActive ? ' is-active' : ''}`}
                          onClick={() => {
                            setActiveSessionId(s.id)
                            focusActiveTerm()
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              setActiveSessionId(s.id)
                              focusActiveTerm()
                            }
                          }}
                        >
                          {isActive && (
                            <motion.div
                              layoutId="active-terminal-session-indicator"
                              className="terminal-session-active-indicator"
                              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                            />
                          )}
                          <span className="terminal-session-label">{s.name}</span>
                          {isActive && (
                            <motion.button
                              type="button"
                              initial={{ opacity: 0, scale: 0.7 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.7 }}
                              whileHover={{ scale: 1.15 }}
                              whileTap={{ scale: 0.85 }}
                              className="terminal-session-close-btn"
                              onClick={(e) => closeSession(e, s.id)}
                              title={`Close ${s.name}`}
                              aria-label={`Close ${s.name}`}
                            >
                              <Icon name="x" size={11} />
                            </motion.button>
                          )}
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
