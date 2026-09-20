import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { api } from '../api.js'

const PERMISSION_DEFINITIONS = [
  {
    id: 'screen',
    name: 'Screen Monitoring & Capture',
    desc: 'Low-latency MJPEG live screen stream and on-demand screenshot snapshots.',
    default: true,
    icon: 'monitor',
  },
  {
    id: 'input',
    name: 'Mouse & Keyboard Control',
    desc: 'Virtual trackpad (moving, clicking, scrolling) and keystroke simulation.',
    default: true,
    icon: 'mouse',
  },
  {
    id: 'audio',
    name: 'Media & Audio Playback',
    desc: 'Control volume, switch sinks, MPRIS2 playback, and speaker playback.',
    default: true,
    icon: 'music',
  },
  {
    id: 'files',
    name: 'File Transfers',
    desc: 'Upload and download files securely scoped to ~/Downloads/Amethyst Transfers.',
    default: true,
    icon: 'folder',
  },
  {
    id: 'terminal',
    name: 'Mobile Terminal Access',
    desc: 'Access interactive shell sessions via xterm.js directly from the companion.',
    default: true,
    icon: 'term',
  },
  {
    id: 'agent',
    name: 'Amethyst Agent & Approvals',
    desc: 'Monitor running tasks, prompt completions, and approve/reject tool calls remotely.',
    default: true,
    icon: 'sparkle',
  },
  {
    id: 'power',
    name: 'Power & Session Controls',
    desc: 'Lock screen, put PC to sleep, reboot, or shut down with confirmation.',
    default: true,
    icon: 'power',
  },
  {
    id: 'webcam',
    name: 'Webcam Feed',
    desc: 'Stream live camera video. PC displays prominent on-air privacy badge when active.',
    default: false,
    warning: 'Privacy sensitive',
    icon: 'camera',
  },
  {
    id: 'mic',
    name: 'Push-To-Talk Microphone',
    desc: 'Stream phone microphone audio directly to PC speakers during hold.',
    default: false,
    warning: 'Audio transmission',
    icon: 'mic',
  },
  {
    id: 'root',
    name: 'Sudo / Elevated Execution',
    desc: 'Allow elevated administrative commands in terminal. Leave disabled unless strictly required.',
    default: false,
    danger: 'Security risk',
    icon: 'shield',
  },
]

export default function PairingApprovalModal({ request, onResolved, onDismiss }) {
  const [permissions, setPermissions] = useState(() => {
    const initial = {}
    for (const def of PERMISSION_DEFINITIONS) {
      initial[def.id] = def.default
    }
    return initial
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onDismiss])

  if (!request || typeof document === 'undefined') return null

  const togglePermission = (id) => {
    if (busy) return
    setPermissions((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const handleApprove = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.approvePending(request.request_id, permissions)
      onResolved?.(request.request_id, 'approved')
      onDismiss?.()
    } catch (err) {
      const msg = err.message || 'Failed to approve pairing request'
      if (msg.includes('404')) {
        setError('This pairing request was already processed or has expired. You can safely dismiss this dialog.')
      } else {
        setError(msg)
      }
      setBusy(false)
    }
  }

  const handleReject = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.rejectPending(request.request_id)
      onResolved?.(request.request_id, 'rejected')
    } catch (err) {
      console.warn('Decline pending request:', err)
    } finally {
      setBusy(false)
      onDismiss?.()
    }
  }

  return createPortal(
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss?.()
      }}
    >
      <div
        className="modal"
        style={{
          width: 'min(620px, 96vw)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px',
          background: '#0d0e14',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '20px',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          overflow: 'hidden',
          animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pairing-title"
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 16,
          }}
        >
          <div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#f59e0b',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.25)',
                padding: '3px 8px',
                borderRadius: '9999px',
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#f59e0b',
                  boxShadow: '0 0 8px #f59e0b',
                }}
              />
              Device Pairing Request
            </div>
            <h2
              id="pairing-title"
              style={{
                margin: 0,
                fontSize: 21,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: '#ffffff',
              }}
            >
              Connect & Trust Device?
            </h2>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'rgba(255, 255, 255, 0.6)',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'
              e.currentTarget.style.color = '#fff'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)'
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'rgba(255, 255, 255, 0.65)', lineHeight: 1.5 }}>
          A companion device is requesting access to control and interact with this computer. Select which subsystems
          this device is permitted to use.
        </p>

        {/* Device metadata card */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 12,
            boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.05)',
          }}
        >
          <div>
            <span style={{ display: 'block', color: 'rgba(255, 255, 255, 0.4)', fontSize: 11, marginBottom: 2 }}>
              Device
            </span>
            <strong style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>
              {request.name || 'Remote Companion'}
            </strong>
          </div>
          <div>
            <span style={{ display: 'block', color: 'rgba(255, 255, 255, 0.4)', fontSize: 11, marginBottom: 2 }}>
              Role
            </span>
            <span style={{ color: '#cbd5e1', fontSize: 13 }}>
              {request.role || 'control'}
            </span>
          </div>
          <div>
            <span style={{ display: 'block', color: 'rgba(255, 255, 255, 0.4)', fontSize: 11, marginBottom: 2 }}>
              Connection
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: '#f59e0b',
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              {request.ip_address ? `LAN (${request.ip_address})` : 'LAN / Relay'}
            </span>
          </div>
        </div>

        {/* Permissions list container */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            paddingRight: 4,
            marginBottom: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {PERMISSION_DEFINITIONS.map((def) => {
            const checked = Boolean(permissions[def.id])
            return (
              <div
                key={def.id}
                onClick={() => togglePermission(def.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: checked
                    ? '1px solid rgba(255, 255, 255, 0.14)'
                    : '1px solid rgba(255, 255, 255, 0.05)',
                  background: checked ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.01)',
                  cursor: busy ? 'default' : 'pointer',
                  transition: 'all 0.15s ease',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePermission(def.id)}
                  disabled={busy}
                  style={{
                    marginTop: 3,
                    cursor: 'pointer',
                    width: 16,
                    height: 16,
                    accentColor: '#f59e0b',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: checked ? '#ffffff' : 'rgba(255, 255, 255, 0.7)' }}>
                      {def.name}
                    </span>
                    {def.warning && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: '9999px',
                          background: 'rgba(234, 179, 8, 0.15)',
                          color: '#facc15',
                          border: '1px solid rgba(234, 179, 8, 0.3)',
                          fontWeight: 600,
                          letterSpacing: '0.02em',
                        }}
                      >
                        {def.warning}
                      </span>
                    )}
                    {def.danger && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 7px',
                          borderRadius: '9999px',
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          fontWeight: 600,
                          letterSpacing: '0.02em',
                        }}
                      >
                        {def.danger}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.5)', marginTop: 2, lineHeight: 1.4 }}>
                    {def.desc}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Error notification banner */}
        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: 12,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              animation: 'fadeIn 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="alert-triangle" size={16} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#fff',
                borderRadius: '6px',
                padding: '4px 10px',
                fontSize: 11,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: 600,
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 16,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.45)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '8px 12px',
              borderRadius: '8px',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#fff' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)' }}
          >
            Cancel
          </button>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={handleReject}
              disabled={busy}
              style={{
                padding: '8px 18px',
                borderRadius: '9999px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#e2e8f0',
                fontSize: 13,
                fontWeight: 500,
                cursor: busy ? 'default' : 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!busy) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
              }}
              onMouseLeave={(e) => {
                if (!busy) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
              }}
            >
              Decline
            </button>

            <button
              type="button"
              onClick={handleApprove}
              disabled={busy}
              style={{
                padding: '8px 22px',
                borderRadius: '9999px',
                background: busy
                  ? 'rgba(245, 158, 11, 0.5)'
                  : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                border: 'none',
                color: '#000000',
                fontSize: 13,
                fontWeight: 700,
                cursor: busy ? 'default' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 0 20px rgba(245, 158, 11, 0.3)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!busy) e.currentTarget.style.boxShadow = '0 0 28px rgba(245, 158, 11, 0.5)'
              }}
              onMouseLeave={(e) => {
                if (!busy) e.currentTarget.style.boxShadow = '0 0 20px rgba(245, 158, 11, 0.3)'
              }}
            >
              <Icon name="check" size={16} />
              {busy ? 'Securing…' : 'Approve & Trust Device'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
