import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { getBase, getAuthHeaders } from '../../api.js'
import * as syncClient from '../../lib/sync/client.js'

export default function MobileTerminal({ onBack, isOnline }) {
  const [session, setSession] = useState(null)
  const [output, setOutput] = useState([])
  const [command, setCommand] = useState('')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const [currentCwd, setCurrentCwd] = useState('~')

  const wsRef = useRef(null)
  const terminalEndRef = useRef(null)
  const token = syncClient.identity()?.token || ''

  useEffect(() => {
    let unmounted = false
    let ws = null

    async function initSession() {
      try {
        const base = getBase()
        const auth = getAuthHeaders()

        // 1. Create or get interactive terminal session
        const res = await fetch(`${base}/terminal/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...auth,
          },
          body: JSON.stringify({}),
        })

        if (!res.ok) {
          throw new Error('Terminal session refused by backend.')
        }

        const data = await res.json()
        if (unmounted) return
        setSession(data)
        if (data.cwd) setCurrentCwd(data.cwd.replace(/.*\/([^/]+)$/, '~/$1'))

        // 2. Connect WebSocket
        const proto = base.startsWith('https') ? 'wss:' : 'ws:'
        const host = base.replace(/^https?:\/\//, '').replace(/\/api$/, '')
        const wsUrl = `${proto}//${host}/api/terminal/ws?session_id=${data.id}${token ? `&token=${encodeURIComponent(token)}` : ''}`

        ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (unmounted) return
          setConnected(true)
          setError(null)
        }

        ws.onmessage = (event) => {
          if (unmounted) return
          if (typeof event.data === 'string') {
            if (event.data.startsWith('{')) {
              try {
                const parsed = JSON.parse(event.data)
                if (parsed.type === 'cwd' && parsed.cwd) {
                  setCurrentCwd(parsed.cwd.replace(/.*\/([^/]+)$/, '~/$1'))
                  return
                }
              } catch {}
            }
            setOutput((prev) => [...prev.slice(-300), event.data])
          } else if (event.data instanceof Blob) {
            const reader = new FileReader()
            reader.onload = () => {
              if (!unmounted && reader.result) {
                setOutput((prev) => [...prev.slice(-300), reader.result])
              }
            }
            reader.readAsText(event.data)
          }
        }

        ws.onerror = (err) => {
          if (!unmounted) setError('WebSocket connection to PC terminal failed.')
        }

        ws.onclose = () => {
          if (!unmounted) setConnected(false)
        }
      } catch (err) {
        if (!unmounted) setError(err.message)
      }
    }

    initSession()

    return () => {
      unmounted = true
      try {
        ws?.close()
      } catch {}
    }
  }, [token])

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [output])

  const sendRaw = (text) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(text)
      return true
    }
    return false
  }

  const handleRun = (cmdToRun) => {
    const cmd = cmdToRun || command
    if (!cmd.trim()) return

    sendRaw(cmd.trim() + '\r')
    setCommand('')
  }

  // Strip ANSI escape codes for clean mobile display
  const formatTerminalLine = (text) => {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
  }

  return (
    <motion.div
      className="m-shell"
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#ECEAE6' }}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.2 }}
    >
      <div className="m-body" style={{ paddingBottom: 20, gap: 12 }}>
        {/* Header */}
        <div className="m-r m-sp">
          <button
            type="button"
            className="m-ib"
            aria-label="Back to PC"
            onClick={onBack}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <div className="m-ttl" style={{ fontSize: 17 }}>
            Terminal
          </div>
          <span className="m-ch">
            <span className={`m-d ${connected ? '' : 'w'}`} />
            {connected ? 'Live' : 'Connecting'}
          </span>
        </div>

        {/* Monospace Terminal Window */}
        <div
          className="m-blk"
          style={{
            flex: 1,
            minHeight: 340,
            background: '#111113',
            color: '#F4F2ED',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12.5,
            lineHeight: 1.5,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            overflow: 'hidden',
          }}
        >
          {/* Prompt header */}
          <div className="m-r m-sp" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
            <span style={{ color: '#D6F23E' }}>amethyst@pc:{currentCwd}$</span>
            <span style={{ color: '#6E6A64', fontSize: 11 }}>{session?.shell || 'bash'}</span>
          </div>

          {/* Terminal output stream */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {error && (
              <div style={{ color: '#ef4444', marginBottom: 8 }}>
                {error}
              </div>
            )}

            {output.length === 0 && !error && (
              <div style={{ color: '#6E6A64' }}>
                Connecting to shell on your PC…
              </div>
            )}

            {output.map((chunk, idx) => (
              <span key={idx}>
                {formatTerminalLine(String(chunk))}
              </span>
            ))}
            <div ref={terminalEndRef} />
          </div>

          {/* Quick Command Pills */}
          <div className="m-r" style={{ gap: 6, overflowX: 'auto', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {['ls -la', 'git status', './run.sh', 'df -h', 'uptime'].map((cmd) => (
              <button
                key={cmd}
                type="button"
                className="m-ch"
                style={{
                  background: '#202024',
                  color: '#ECEAE6',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  padding: '6px 12px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                  flex: 'none',
                }}
                onClick={() => handleRun(cmd)}
              >
                {cmd}
              </button>
            ))}
          </div>
        </div>

        {/* Command Input Box */}
        <form
          className="m-r"
          style={{
            background: '#F6F4F1',
            borderRadius: 999,
            padding: '4px 6px 4px 18px',
            boxShadow: '0 1px 2px rgba(30,25,20,0.05)',
          }}
          onSubmit={(e) => {
            e.preventDefault()
            handleRun()
          }}
        >
          <span style={{ color: '#111113', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>$</span>
          <input
            className="m-in"
            style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}
            placeholder="Type a command and tap Return…"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            disabled={!connected}
          />
          <button
            type="submit"
            className="m-bt l"
            style={{ minHeight: 40, padding: '0 18px', fontSize: 13 }}
            disabled={!connected || !command.trim()}
          >
            Run
          </button>
        </form>
      </div>
    </motion.div>
  )
}
