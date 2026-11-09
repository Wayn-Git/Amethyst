import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getBase, getAuthHeaders, API_ORIGIN } from '../../api.js'
import { usePairingStatus } from '../pairingVault.js'
import PairPrompt from './PairPrompt.jsx'

const XTERM_THEME = {
  background: '#111113',
  foreground: '#E4E4E7',
  cursor: '#FFFFFF',
  cursorAccent: '#111113',
  selectionBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#18181B',
  red: '#EF4444',
  green: '#22C55E',
  yellow: '#EAB308',
  blue: '#3B82F6',
  magenta: '#A855F7',
  cyan: '#06B6D4',
  white: '#E4E4E7',
  brightBlack: '#52525B',
  brightRed: '#F87171',
  brightGreen: '#4ADE80',
  brightYellow: '#FDE047',
  brightBlue: '#60A5FA',
  brightMagenta: '#C084FC',
  brightCyan: '#22D3EE',
  brightWhite: '#FFFFFF',
}

function getWsOrigin() {
  if (API_ORIGIN) {
    return API_ORIGIN.replace(/^http/, 'ws')
  }
  const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost:8000'
  return `${proto}//${host}`
}

export default function MobileTerminal({ onBack, isOnline }) {
  const { isPaired, isRejected, token, markRejected, clearRejected } = usePairingStatus()

  const [session, setSession] = useState(null)
  const [connected, setConnected] = useState(false)
  const [currentCwd, setCurrentCwd] = useState('~')
  const [statusMsg, setStatusMsg] = useState('Connecting to PC terminal…')
  const [command, setCommand] = useState('')
  const [rescanModalOpen, setRescanModalOpen] = useState(false)

  const containerRef = useRef(null)
  const xtermRef = useRef(null)
  const fitAddonRef = useRef(null)
  const wsRef = useRef(null)

  useEffect(() => {
    if (!isPaired || isRejected) return

    let unmounted = false
    let term = null
    let ws = null
    let fitAddon = null

    async function initTerminal() {
      try {
        const base = getBase()
        const auth = getAuthHeaders()

        // 1. Create or join terminal session
        const res = await fetch(`${base}/terminal/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...auth,
          },
          body: JSON.stringify({}),
        })

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            markRejected(`Session rejected (${res.status})`)
          }
          if (!unmounted) {
            setStatusMsg(`Session unavailable (${res.status}). Verify PC is online.`)
          }
          return
        }

        const data = await res.json()
        if (unmounted) return
        setSession(data)
        if (data.cwd) setCurrentCwd(data.cwd.replace(/.*\/([^/]+)$/, '~/$1'))

        // 2. Initialize xterm instance
        if (!containerRef.current) return
        containerRef.current.innerHTML = ''

        term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'block',
          fontFamily: "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.4,
          theme: XTERM_THEME,
          allowTransparency: true,
          convertEol: true,
          scrollback: 2000,
        })

        fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(containerRef.current)

        xtermRef.current = term
        fitAddonRef.current = fitAddon

        try {
          fitAddon.fit()
        } catch {}

        // 3. Connect WebSocket with arraybuffer support
        const wsOrigin = getWsOrigin()
        const wsUrl = `${wsOrigin}/api/terminal/ws?session_id=${data.id}${token ? `&token=${encodeURIComponent(token)}` : ''}`

        ws = new WebSocket(wsUrl)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onopen = () => {
          if (unmounted) return
          setConnected(true)
          setStatusMsg('')
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
          if (unmounted || !term) return
          if (event.data instanceof ArrayBuffer) {
            term.write(new Uint8Array(event.data))
          } else if (typeof event.data === 'string') {
            try {
              const msg = JSON.parse(event.data)
              if (msg.type === 'session_init' && msg.cwd) {
                setCurrentCwd(msg.cwd.replace(/.*\/([^/]+)$/, '~/$1'))
              } else if (msg.type === 'cwd' && msg.cwd) {
                setCurrentCwd(msg.cwd.replace(/.*\/([^/]+)$/, '~/$1'))
              }
            } catch {
              term.write(event.data)
            }
          }
        }

        ws.onerror = () => {
          if (!unmounted) setStatusMsg('Terminal connection error')
        }

        ws.onclose = (event) => {
          if (event?.code === 1008) {
            markRejected('WebSocket rejected (1008)')
          }
          if (!unmounted) {
            setConnected(false)
            setStatusMsg('Session closed')
          }
        }

        // Forward keyboard input from xterm to websocket
        term.onData((data) => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data)
          }
        })

        // Resize observer to refit on layout changes
        const resizeObserver = new ResizeObserver(() => {
          try {
            if (fitAddon && term && ws && ws.readyState === WebSocket.OPEN) {
              fitAddon.fit()
              ws.send(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows,
              }))
            }
          } catch {}
        })
        if (containerRef.current) {
          resizeObserver.observe(containerRef.current)
        }

        return () => {
          resizeObserver.disconnect()
        }
      } catch (err) {
        if (!unmounted) {
          setStatusMsg(`Failed to connect: ${err.message}`)
        }
      }
    }

    initTerminal()

    return () => {
      unmounted = true
      if (ws) ws.close()
      if (term) term.dispose()
    }
  }, [token, isPaired, isRejected, markRejected])

  const sendCommand = (cmdStr) => {
    const toSend = (cmdStr || command).trim()
    if (!toSend) return

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(`${toSend}\n`)
    } else if (xtermRef.current) {
      xtermRef.current.writeln(`\r\n\x1b[31m[PC offline — command not sent]\x1b[0m`)
    }

    setCommand('')
  }

  // 1. UNPAIRED STATE: Lazy PairPrompt appears, no mock data, no broken connection
  if (!isPaired) {
    return (
      <motion.div
        className="s"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 120,
          background: '#F2F2F7',
          maxWidth: 480,
          margin: '0 auto',
        }}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="b" style={{ paddingBottom: 20, gap: 14 }}>
          {/* Header */}
          <div className="r sp">
            {onBack && (
              <button
                type="button"
                className="ib"
                aria-label="Back"
                onClick={onBack}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            )}
            <div className="ttl" style={{ fontSize: 17 }}>
              Terminal
            </div>
            <span className="ch">
              <span className="d w" />
              Unpaired
            </span>
          </div>

          <PairPrompt />
        </div>
      </motion.div>
    )
  }

  // 2. PAIRED STATE: Interactive PTY + Re-scan QR banner if rejected
  return (
    <motion.div
      className="s"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 120,
        background: '#F2F2F7',
        maxWidth: 480,
        margin: '0 auto',
      }}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="b" style={{ paddingBottom: 20, gap: 14 }}>
        {/* Header */}
        <div className="r sp">
          <button
            type="button"
            className="ib"
            aria-label="Back"
            onClick={onBack}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="ttl" style={{ fontSize: 17 }}>
            Terminal
          </div>
          <span className="ch">
            <span className={`d ${connected ? '' : 'w'}`} />
            {isRejected ? 'Rejected' : connected ? 'Live' : isOnline ? 'Ready' : 'Offline'}
          </span>
        </div>

        {/* Rejected Token Re-scan Banner on these screens only */}
        {isRejected && (
          <aside
            className="rescan-banner"
            role="alert"
            style={{
              background: 'rgba(217, 84, 30, 0.12)',
              border: '1px solid rgba(217, 84, 30, 0.3)',
              borderRadius: 16,
              padding: '12px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: '#D9541E', fontSize: 13 }}>
                Pairing token rejected
              </div>
              <div style={{ fontSize: 12, color: '#6E6E73', marginTop: 2 }}>
                Your PC rejected the pairing token. Re-scan the QR code to reconnect.
              </div>
            </div>
            <button
              type="button"
              className="bt l"
              style={{
                height: 36,
                minHeight: 36,
                padding: '0 14px',
                fontSize: 12,
                flexShrink: 0,
                background: '#D9541E',
              }}
              onClick={() => setRescanModalOpen(true)}
              aria-label="Re-scan QR"
            >
              Re-scan QR
            </button>
          </aside>
        )}

        {/* CWD & Status Bar */}
        <div className="r sp" style={{ padding: '0 4px', fontSize: 12 }}>
          <span className="mono" style={{ color: '#6E6E73' }}>
            {currentCwd}
          </span>
          {statusMsg && (
            <span style={{ color: isRejected ? '#D9541E' : '#FF9500', fontSize: 11 }}>
              {isRejected ? 'Token rejected by PC' : statusMsg}
            </span>
          )}
        </div>

        {/* Terminal Window Box (xterm.js mounted canvas) */}
        <div
          style={{
            flex: 1,
            minHeight: 280,
            borderRadius: 24,
            background: '#111113',
            padding: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            ref={containerRef}
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              overflow: 'hidden',
            }}
          />
        </div>

        {/* Quick Command Chips */}
        <div className="r" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none', padding: '2px 0' }}>
          <button
            type="button"
            className="ch"
            onClick={() => sendCommand('git status')}
          >
            git status
          </button>
          <button
            type="button"
            className="ch"
            onClick={() => sendCommand('git pull')}
          >
            git pull
          </button>
          <button
            type="button"
            className="ch"
            onClick={() => sendCommand('npm run dev')}
          >
            npm run dev
          </button>
          <button
            type="button"
            className="ch"
            onClick={() => sendCommand('df -h')}
          >
            df -h
          </button>
          <button
            type="button"
            className="ch"
            onClick={() => sendCommand('clear')}
          >
            clear
          </button>
        </div>

        {/* Command Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendCommand()
          }}
          className="r"
          style={{
            background: '#FFFFFF',
            borderRadius: 999,
            padding: '6px 6px 6px 18px',
            boxShadow: '0 8px 24px rgba(0,0,0,.08)',
          }}
        >
          <span className="mono" style={{ color: '#6E6E73', fontWeight: 600 }}>
            $
          </span>
          <input
            className="in mono"
            aria-label="Command"
            placeholder="Run terminal command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          <button
            type="submit"
            disabled={!command.trim()}
            className="ib k"
            aria-label="Run command"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m5 12 7-7 7 7" />
              <path d="M12 19V5" />
            </svg>
          </button>
        </form>

        <div className="m" style={{ textAlign: 'center', fontSize: 11 }}>
          Interactive PTY session running on your PC.
        </div>
      </div>

      {/* Re-scan QR Modal */}
      <AnimatePresence>
        {rescanModalOpen && (
          <PairPrompt
            isRejected
            onPaired={() => {
              clearRejected()
              setRescanModalOpen(false)
            }}
            onScan={() => {}}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
