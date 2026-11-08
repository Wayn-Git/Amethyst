import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { identity, queued } from '../lib/sync/client.js'

export default function ConnectionDiagnosticsModal({ open, onClose, onOpenSettings, transportState, lastSync }) {
  const [copied, setCopied] = useState(false)

  if (!open) return null

  const held = identity() || {}
  const path = transportState?.path || 'offline'
  const isDirect = path === 'direct'
  const isRelayed = path === 'relayed'
  const isReconnecting = path === 'reconnecting'
  const isOffline = path === 'offline'

  const statusLabel = isDirect
    ? 'Connected (Direct LAN)'
    : isRelayed
    ? 'Connected (Cloud Relay)'
    : isReconnecting
    ? 'Reconnecting…'
    : 'Offline'

  const transportLabel = isDirect
    ? 'Direct Local Wi-Fi'
    : isRelayed
    ? 'Encrypted Cloudflare Worker Relay'
    : 'None'

  const pendingCount = queued()

  const copyDiagnostics = async () => {
    const text = [
      '=== Amethyst Connection Diagnostics ===',
      `Status: ${statusLabel}`,
      `Transport Path: ${transportLabel}`,
      `Host Computer: ${held.name || 'Desktop Host'}`,
      `LAN Address: ${held.hostUrl || 'Not configured'}`,
      `Relay URL: ${held.relayUrl || 'Not configured'}`,
      `Latency: ${transportState?.latency >= 0 ? `${transportState.latency}ms` : 'N/A (Relayed)'}`,
      `Pending Outbox Queue: ${pendingCount}`,
      `Last Sync: ${lastSync ? new Date(lastSync).toLocaleString() : 'Never'}`,
      `Device ID: ${held.deviceId || 'Unpaired'}`,
      `Network Online: ${typeof navigator !== 'undefined' ? (navigator.onLine ? 'Yes' : 'No') : 'Unknown'}`,
    ].join('\n')

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className="diag-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Connection diagnostics">
      <div className="diag-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="diag-modal-header">
          <div className="diag-modal-title-row">
            <span
              className={`diag-status-dot diag-status-dot--${
                isDirect ? 'direct' : isRelayed ? 'relayed' : isReconnecting ? 'reconnecting' : 'offline'
              }`}
            />
            <h2>Connection Diagnostics</h2>
          </div>
          <button type="button" className="diag-close-btn" onClick={onClose} aria-label="Close diagnostics">
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="diag-groups">
          <div className="diag-group">
            <div className="diag-row">
              <span className="diag-label">Status</span>
              <span className="diag-val diag-val--badge">{statusLabel}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Transport Path</span>
              <span className="diag-val">{transportLabel}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Host Latency</span>
              <span className="diag-val">
                {transportState?.latency >= 0 ? `${transportState.latency} ms` : isRelayed ? 'Relayed Mailbox' : '—'}
              </span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Pending Outbox</span>
              <span className="diag-val">{pendingCount === 0 ? 'Clear (0 queued)' : `${pendingCount} unsent`}</span>
            </div>
          </div>

          <div className="diag-group">
            <div className="diag-group-title">Endpoints & Identity</div>
            <div className="diag-row">
              <span className="diag-label">Device Name</span>
              <span className="diag-val">{held.name || 'Mobile Companion'}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">LAN Endpoint</span>
              <span className="diag-val diag-val--mono">{held.hostUrl || 'Not set'}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Cloudflare Relay</span>
              <span className="diag-val diag-val--mono">{held.relayUrl ? new URL(held.relayUrl).hostname : 'None'}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Last Synced</span>
              <span className="diag-val">{lastSync ? new Date(lastSync).toLocaleTimeString() : 'Never'}</span>
            </div>
          </div>
        </div>

        <div className="diag-modal-footer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {onOpenSettings && (
            <button
              type="button"
              className="bt"
              style={{
                width: '100%',
                height: 40,
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 600,
                background: '#0071E3',
                color: '#fff',
                cursor: 'pointer',
                border: 0,
              }}
              onClick={() => {
                onClose()
                onOpenSettings()
              }}
            >
              Configure PC Host IP Address
            </button>
          )}
          <button type="button" className="diag-copy-btn" onClick={copyDiagnostics}>
            <Icon name={copied ? 'check' : 'copy'} size={18} />
            <span>{copied ? 'Copied to Clipboard' : 'Copy Diagnostics'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
