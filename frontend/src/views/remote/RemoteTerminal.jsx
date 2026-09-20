import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Icon from '../../components/Icon.jsx'
import { getBase, getAuthHeaders } from '../../api.js'
import * as syncClient from '../../lib/sync/client.js'

export default function RemoteTerminal() {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitAddonRef = useRef(null)
  const wsRef = useRef(null)
  const [session, setSession] = useState(null)
  const [error, setError] = useState(null)
  const [connected, setConnected] = useState(false)

  const token = syncClient.identity()?.token || ''

  useEffect(() => {
    let unmounted = false
    let term = null
    let fitAddon = null
    let ws = null
    let sessionId = null

    async function init() {
      try {
        const base = getBase()
        const auth = getAuthHeaders()

        // 1. Create a terminal session
        const res = await fetch(`${base}/terminal/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...auth,
          },
          body: JSON.stringify({}),
        })

        if (!res.ok) {
          throw new Error('Terminal permission required or session refused.')
        }

        const data = await res.json()
        if (unmounted) return
        sessionId = data.id
        setSession(data)

        // 2. Initialize xterm.js
        term = new Terminal({
          cursorBlink: true,
          cursorStyle: 'block',
          fontSize: 12,
          fontFamily: "monospace, 'Geist Mono'",
          theme: {
            background: '#09090b',
            foreground: '#e4e4e7',
            cursor: '#ffffff',
          },
          convertEol: true,
          allowTransparency: true,
          scrollback: 2000,
        })

        fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        termRef.current = term
        fitAddonRef.current = fitAddon

        if (containerRef.current) {
          term.open(containerRef.current)
          try {
            fitAddon.fit()
          } catch {}
        }

        // 3. Connect WebSocket
        const proto = base.startsWith('https') ? 'wss:' : 'ws:'
        if (typeof window !== 'undefined' && window.location.protocol === 'https:' && proto === 'ws:') {
          setError('Interactive terminal requires a Direct LAN connection to your PC over Wi-Fi. Tap the banner above to switch.')
          return
        }
        const host = base.replace(/^https?:\/\//, '').replace(/\/api$/, '')
        const wsUrl = `${proto}//${host}/api/terminal/ws?session_id=${sessionId}${token ? `&token=${encodeURIComponent(token)}` : ''}`

        try {
          ws = new WebSocket(wsUrl)
          wsRef.current = ws
        } catch (wsErr) {
          setError(`Terminal connection failed: ${wsErr.message}`)
          return
        }

        ws.onopen = () => {
          if (unmounted) return
          setConnected(true)
          term.focus()
          try {
            fitAddon.fit()
          } catch {}
        }

        ws.onmessage = (e) => {
          term.write(e.data)
        }

        ws.onclose = () => {
          if (!unmounted) setConnected(false)
        }

        term.onData((input) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(input)
          }
        })

        // Resize observer
        const ro = new ResizeObserver(() => {
          try {
            fitAddon.fit()
            if (ws.readyState === WebSocket.OPEN && term) {
              ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
            }
          } catch {}
        })
        if (containerRef.current) ro.observe(containerRef.current)
      } catch (err) {
        if (!unmounted) setError(err.message || 'Terminal connection failed')
      }
    }

    init()

    return () => {
      unmounted = true
      try {
        ws?.close()
      } catch {}
      try {
        term?.dispose()
      } catch {}
    }
  }, [token])

  const sendKey = (sequence) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(sequence)
      termRef.current?.focus()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '75vh', padding: '12px 8px' }}>
      {/* Top status bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
            }}
          />
          <strong style={{ color: 'var(--text)' }}>Terminal</strong>
          {session && <span style={{ color: 'var(--text-faint)' }}>({session.shell || 'bash'})</span>}
        </div>
        <button
          type="button"
          className="set-btn-sm"
          onClick={() => fitAddonRef.current?.fit()}
          style={{ padding: '2px 8px', fontSize: 11 }}
        >
          Fit Screen
        </button>
      </div>

      {error ? (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #ef4444',
            color: '#ef4444',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      ) : (
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 320,
            background: '#09090b',
            borderRadius: 8,
            padding: 8,
            overflow: 'hidden',
            border: '1px solid var(--hairline-strong)',
          }}
        />
      )}

      {/* Virtual Keys Row */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          padding: '10px 0 2px',
          alignItems: 'center',
        }}
      >
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\x1b')} style={{ minWidth: 42, padding: '6px 0', textAlign: 'center' }}>
          Esc
        </button>
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\t')} style={{ minWidth: 42, padding: '6px 0', textAlign: 'center' }}>
          Tab
        </button>
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\x03')} style={{ minWidth: 54, padding: '6px 0', textAlign: 'center', color: '#ef4444' }}>
          Ctrl+C
        </button>
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\x1a')} style={{ minWidth: 54, padding: '6px 0', textAlign: 'center' }}>
          Ctrl+Z
        </button>
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\x1b[A')} style={{ minWidth: 38, padding: '6px 0', textAlign: 'center' }}>
          ↑
        </button>
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\x1b[B')} style={{ minWidth: 38, padding: '6px 0', textAlign: 'center' }}>
          ↓
        </button>
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\x1b[D')} style={{ minWidth: 38, padding: '6px 0', textAlign: 'center' }}>
          ←
        </button>
        <button type="button" className="set-btn-sm" onClick={() => sendKey('\x1b[C')} style={{ minWidth: 38, padding: '6px 0', textAlign: 'center' }}>
          →
        </button>
      </div>
    </div>
  )
}
