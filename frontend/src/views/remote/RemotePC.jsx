import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api, getBase, getAuthHeaders } from '../../api.js'
import * as syncClient from '../../lib/sync/client.js'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function RemotePC() {
  const [status, setStatus] = useState(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [streaming, setStreaming] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState(null)
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [apps, setApps] = useState([])
  const [showApps, setShowApps] = useState(false)
  const [processes, setProcesses] = useState([])
  const [showProcesses, setShowProcesses] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [keyboardText, setKeyboardText] = useState('')
  const [actionNotice, setActionNotice] = useState(null)

  const token = syncClient.identity()?.token || ''

  // WebSocket for ultra-responsive input
  const wsRef = useRef(null)
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 })

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.remoteStatus()
      setStatus(res)
    } catch {
      // Ignore network hiccup
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const int = setInterval(fetchStatus, 4000)
    return () => clearInterval(int)
  }, [fetchStatus])

  // Setup WebSocket connection for touchpad
  useEffect(() => {
    let ws
    try {
      const base = getBase()
      const proto = base.startsWith('https') ? 'wss:' : 'ws:'
      if (typeof window !== 'undefined' && window.location.protocol === 'https:' && proto === 'ws:') {
        // Prevent insecure WebSocket DOMException when page is on HTTPS
        return
      }
      const host = base.replace(/^https?:\/\//, '').replace(/\/api$/, '')
      const url = `${proto}//${host}/api/remote/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`
      ws = new WebSocket(url)
      wsRef.current = ws
      ws.onerror = () => { /* Silent fallback to REST */ }
    } catch {
      // Fallback to REST
    }
    return () => {
      try {
        ws?.close()
      } catch {}
    }
  }, [token])

  const sendWs = (data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
      return true
    }
    return false
  }

  // Mouse controls
  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() }
    }
  }

  const handleTouchMove = (e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0]
      const dx = (t.clientX - touchStartRef.current.x) * 1.5
      const dy = (t.clientY - touchStartRef.current.y) * 1.5
      touchStartRef.current.x = t.clientX
      touchStartRef.current.y = t.clientY

      if (!sendWs({ type: 'mouse_move', dx, dy })) {
        api.remoteMouse({ action: 'move', dx, dy }).catch(() => {})
      }
    } else if (e.touches.length === 2) {
      // 2 fingers scroll
      const t = e.touches[0]
      const dy = (t.clientY - touchStartRef.current.y) * 2
      touchStartRef.current.y = t.clientY
      if (!sendWs({ type: 'mouse_scroll', dx: 0, dy: Math.round(dy) })) {
        api.remoteMouse({ action: 'scroll', dx: 0, dy: Math.round(dy) }).catch(() => {})
      }
    }
  }

  const handleTouchEnd = () => {
    const elapsed = Date.now() - touchStartRef.current.time
    if (elapsed < 200) {
      // Tap is click
      handleClick('left')
    }
  }

  const handleClick = (button = 'left', double = false) => {
    if (!sendWs({ type: 'mouse_click', button, double })) {
      api.remoteMouse({ action: 'click', button, double }).catch(() => {})
    }
  }

  const handleKey = (key) => {
    if (!sendWs({ type: 'keyboard_press', key })) {
      api.remoteKeyboard({ action: 'press', key }).catch(() => {})
    }
  }

  const handleCombo = (keys) => {
    if (!sendWs({ type: 'keyboard_combo', keys })) {
      api.remoteKeyboard({ action: 'combo', keys }).catch(() => {})
    }
  }

  const handleType = (e) => {
    e.preventDefault()
    if (!keyboardText) return
    if (!sendWs({ type: 'keyboard_type', text: keyboardText })) {
      api.remoteKeyboard({ action: 'type', text: keyboardText }).catch(() => {})
    }
    setKeyboardText('')
  }

  // Screenshot snapshot
  const takeScreenshot = async () => {
    setScreenshotLoading(true)
    try {
      const res = await api.remoteScreenshot()
      if (res?.image) {
        setScreenshotUrl(res.image)
      }
    } catch (err) {
      setActionNotice(`Screenshot failed: ${err.message}`)
    } finally {
      setScreenshotLoading(false)
    }
  }

  // Process & App listings
  const loadApps = async () => {
    try {
      const res = await api.remoteApplications()
      setApps(res.applications || [])
      setShowApps(true)
    } catch (err) {
      setActionNotice(`Failed to list apps: ${err.message}`)
    }
  }

  const launchApp = async (target) => {
    try {
      await api.remoteLaunchApp(target)
      setActionNotice(`Launched ${target}`)
      setShowApps(false)
    } catch (err) {
      setActionNotice(`Launch failed: ${err.message}`)
    }
  }

  const loadProcesses = async () => {
    try {
      const res = await api.remoteProcesses()
      setProcesses(res.processes || [])
      setShowProcesses(true)
    } catch (err) {
      setActionNotice(`Failed to list processes: ${err.message}`)
    }
  }

  const killProc = async (pid) => {
    try {
      await api.remoteKillProcess(pid)
      setProcesses((prev) => prev.filter((p) => p.pid !== pid))
      setActionNotice(`Killed process ${pid}`)
    } catch (err) {
      setActionNotice(`Kill failed: ${err.message}`)
    }
  }

  // Power actions
  const triggerPower = async (action) => {
    try {
      await api.remotePower(action)
      setActionNotice(`Command ${action} sent.`)
      setConfirmAction(null)
    } catch (err) {
      setActionNotice(`Power failed: ${err.message}`)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 12px' }}>
      {actionNotice && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 6,
            background: 'var(--bg-inset)',
            border: '1px solid var(--accent)',
            fontSize: 12,
            color: 'var(--text)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            style={{ background: 'none', border: 'none', color: 'var(--text-sub)', cursor: 'pointer' }}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {/* 1. System Telemetry Gauges */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
        }}
      >
        <div
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--hairline-strong)',
            borderRadius: 8,
            padding: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="cpu" size={16} />
            <span style={{ fontSize: 11, color: 'var(--text-sub)', textTransform: 'uppercase', fontWeight: 600 }}>CPU</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {status?.cpu ? `${status.cpu.usage_percent}%` : '--'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {status?.cpu?.cores ? `${status.cpu.cores} cores` : ''} · {status?.cpu?.temperature_c ? `${status.cpu.temperature_c}°C` : 'Normal'}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--hairline-strong)',
            borderRadius: 8,
            padding: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="dash" size={16} />
            <span style={{ fontSize: 11, color: 'var(--text-sub)', textTransform: 'uppercase', fontWeight: 600 }}>Memory</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {status?.memory ? `${status.memory.used_percent}%` : '--'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {status?.memory ? `${formatBytes(status.memory.used_bytes)} / ${formatBytes(status.memory.total_bytes)}` : ''}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--hairline-strong)',
            borderRadius: 8,
            padding: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="folder" size={16} />
            <span style={{ fontSize: 11, color: 'var(--text-sub)', textTransform: 'uppercase', fontWeight: 600 }}>Disk</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {status?.disk ? `${status.disk.used_percent}%` : '--'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {status?.disk ? `${formatBytes(status.disk.free_bytes)} free` : ''}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-inset)',
            border: '1px solid var(--hairline-strong)',
            borderRadius: 8,
            padding: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Icon name="zap" size={16} />
            <span style={{ fontSize: 11, color: 'var(--text-sub)', textTransform: 'uppercase', fontWeight: 600 }}>Battery</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            {status?.battery?.present ? `${status.battery.percent}%` : 'AC Power'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {status?.battery?.status || status?.uptime || 'Online'}
          </div>
        </div>
      </div>

      {/* 2. Live Screen Stream & Screenshot */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid var(--hairline-strong)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="eye" size={16} />
            <strong style={{ fontSize: 13, color: 'var(--text)' }}>Display Stream</strong>
            {streaming && (
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(239, 68, 68, 0.2)',
                  color: '#ef4444',
                  fontWeight: 700,
                  animation: 'pulse 2s infinite',
                }}
              >
                LIVE
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="set-btn-sm"
              onClick={takeScreenshot}
              disabled={screenshotLoading}
            >
              {screenshotLoading ? 'Capturing…' : 'Snapshot'}
            </button>
            <button
              type="button"
              className="pair-go"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={() => setStreaming((prev) => !prev)}
            >
              {streaming ? 'Stop Live' : 'Live Stream'}
            </button>
          </div>
        </div>

        <div style={{ minHeight: 180, background: '#000', display: 'grid', placeItems: 'center', position: 'relative' }}>
          {streaming ? (
            <img
              src={`${getBase()}/remote/screen/stream?token=${encodeURIComponent(token)}&fps=15&quality=6`}
              alt="Live Screen"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          ) : screenshotUrl ? (
            <img
              src={screenshotUrl}
              alt="Screen Snapshot"
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          ) : (
            <div style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: 24 }}>
              <Icon name="eye" size={28} />
              <div style={{ marginTop: 8 }}>Tap &ldquo;Live Stream&rdquo; for continuous video or &ldquo;Snapshot&rdquo; for a photo.</div>
            </div>
          )}
        </div>
      </div>

      {/* 3. Trackpad Controller & Mouse Buttons */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>Touchpad & Mouse</span>
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>1 finger move · 2 fingers scroll</span>
        </div>

        {/* Trackpad surface */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            height: 140,
            background: 'rgba(0,0,0,0.2)',
            borderRadius: 6,
            border: '1px dashed var(--hairline-strong)',
            display: 'grid',
            placeItems: 'center',
            touchAction: 'none',
            userSelect: 'none',
            cursor: 'crosshair',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-faint)', pointerEvents: 'none' }}>
            Touch surface to move mouse cursor
          </span>
        </div>

        {/* Mouse Click Buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => handleClick('left')}
            style={{ padding: '8px 0', textAlign: 'center' }}
          >
            Left Click
          </button>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => handleClick('left', true)}
            style={{ padding: '8px 0', textAlign: 'center' }}
          >
            Double Click
          </button>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => handleClick('right')}
            style={{ padding: '8px 0', textAlign: 'center' }}
          >
            Right Click
          </button>
        </div>
      </div>

      {/* 4. Virtual Keyboard & Quick Chords */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          Keyboard & Shortcuts
        </div>

        {/* Quick Chords */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          <button type="button" className="set-btn-sm" onClick={() => handleKey('Escape')}>Esc</button>
          <button type="button" className="set-btn-sm" onClick={() => handleKey('Tab')}>Tab</button>
          <button type="button" className="set-btn-sm" onClick={() => handleKey('Return')}>Enter</button>
          <button type="button" className="set-btn-sm" onClick={() => handleKey('BackSpace')}>⌫</button>
          <button type="button" className="set-btn-sm" onClick={() => handleCombo(['Control', 'c'])}>Ctrl+C</button>
          <button type="button" className="set-btn-sm" onClick={() => handleCombo(['Control', 'v'])}>Ctrl+V</button>
          <button type="button" className="set-btn-sm" onClick={() => handleCombo(['Alt', 'Tab'])}>Alt+Tab</button>
          <button type="button" className="set-btn-sm" onClick={() => handleKey('Super_L')}>Super/Win</button>
        </div>

        {/* Text Input Sender */}
        <form onSubmit={handleType} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="pair-input"
            placeholder="Type text to send to PC…"
            value={keyboardText}
            onChange={(e) => setKeyboardText(e.target.value)}
            style={{ flex: 1, padding: '8px 12px', fontSize: 13 }}
          />
          <button type="submit" className="pair-go" style={{ padding: '8px 16px' }} disabled={!keyboardText}>
            Type
          </button>
        </form>
      </div>

      {/* 5. Apps & Processes Quick Launchers */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <button
          type="button"
          className="set-btn-sm"
          onClick={loadApps}
          style={{ padding: '10px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}
        >
          <Icon name="grid" size={16} />
          App Launcher
        </button>
        <button
          type="button"
          className="set-btn-sm"
          onClick={loadProcesses}
          style={{ padding: '10px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}
        >
          <Icon name="list" size={16} />
          Processes
        </button>
      </div>

      {/* Apps Modal */}
      {showApps && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ width: 'min(500px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head">
              <h3 className="modal-title" style={{ fontSize: 18 }}>Launch Application</h3>
              <button type="button" className="modal-close" onClick={() => setShowApps(false)}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {apps.map((app) => (
                <button
                  key={app.id || app.name}
                  type="button"
                  onClick={() => launchApp(app.name)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 6,
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--hairline-strong)',
                    color: 'var(--text)',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{app.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--accent)' }}>Launch →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Processes Modal */}
      {showProcesses && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ width: 'min(540px, 92vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-head">
              <h3 className="modal-title" style={{ fontSize: 18 }}>Active Processes</h3>
              <button type="button" className="modal-close" onClick={() => setShowProcesses(false)}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {processes.slice(0, 35).map((proc) => (
                <div
                  key={proc.pid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 6,
                    background: 'var(--bg-inset)',
                    border: '1px solid var(--hairline-strong)',
                    fontSize: 12,
                  }}
                >
                  <div>
                    <strong style={{ color: 'var(--text)' }}>{proc.name}</strong>
                    <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>PID {proc.pid}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-sub)' }}>
                      CPU: {proc.cpu_percent}% · RAM: {proc.memory_percent}%
                    </div>
                  </div>
                  <button
                    type="button"
                    className="set-btn-sm"
                    onClick={() => killProc(proc.pid)}
                    style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                  >
                    Kill
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. Power Controls */}
      <div
        style={{
          background: 'var(--bg-inset)',
          border: '1px solid var(--hairline-strong)',
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
          Power Management
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => setConfirmAction('lock')}
            style={{ padding: '8px 0', textAlign: 'center', fontSize: 11 }}
          >
            Lock
          </button>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => setConfirmAction('sleep')}
            style={{ padding: '8px 0', textAlign: 'center', fontSize: 11 }}
          >
            Sleep
          </button>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => setConfirmAction('reboot')}
            style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, color: '#eab308' }}
          >
            Reboot
          </button>
          <button
            type="button"
            className="set-btn-sm"
            onClick={() => setConfirmAction('shutdown')}
            style={{ padding: '8px 0', textAlign: 'center', fontSize: 11, color: '#ef4444' }}
          >
            Shut Down
          </button>
        </div>
      </div>

      {/* Power Confirmation Dialog */}
      {confirmAction && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div className="modal" style={{ width: 'min(400px, 92vw)', padding: 20 }}>
            <h3 style={{ margin: '0 0 8px', color: 'var(--text)' }}>Confirm {confirmAction.toUpperCase()}</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-sub)' }}>
              Are you sure you want to {confirmAction} your computer remotely?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="set-btn-sm"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pair-go"
                style={{
                  background: confirmAction === 'shutdown' || confirmAction === 'reboot' ? '#ef4444' : undefined,
                }}
                onClick={() => triggerPower(confirmAction)}
              >
                Confirm {confirmAction}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
