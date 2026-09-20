import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import * as syncClient from '../lib/sync/client.js'
import RemotePC from './remote/RemotePC.jsx'
import RemoteMedia from './remote/RemoteMedia.jsx'
import RemoteCamera from './remote/RemoteCamera.jsx'
import RemoteFiles from './remote/RemoteFiles.jsx'
import RemoteAgent from './remote/RemoteAgent.jsx'
import RemoteTerminal from './remote/RemoteTerminal.jsx'

export default function Remote({ onUnpair, onDesktop }) {
  const { setView } = useApp()
  const [paired, setPaired] = useState(() => syncClient.paired())
  const [activeTab, setActiveTab] = useState('pc')
  const [syncStatus, setSyncStatus] = useState(null)
  const identity = syncClient.identity()

  useEffect(() => {
    const handleSync = () => {
      setPaired(syncClient.paired())
    }
    window.addEventListener('amethyst:synced', handleSync)
    return () => window.removeEventListener('amethyst:synced', handleSync)
  }, [])

  const doSync = async () => {
    try {
      const res = await syncClient.sync()
      setSyncStatus(res)
    } catch {}
  }

  if (!paired) {
    return (
      <div className="rc" style={{ padding: 24, textAlign: 'center' }}>
        <div className="rc-empty" style={{ margin: '40px auto', maxWidth: 380 }}>
          <Icon name="link" size={36} />
          <h2 style={{ marginTop: 12 }}>Device Not Paired</h2>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', lineHeight: 1.5, margin: '8px 0 24px' }}>
            To connect to your computer, open <strong>Settings → Devices</strong> on your PC and scan the
            pairing code with this device.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              className="pair-go"
              onClick={() => setView('pair')}
            >
              Scan Pairing Code
            </button>
            <button
              type="button"
              className="set-btn-sm"
              onClick={() => setPaired(syncClient.paired())}
            >
              Check Connection
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isMixedContent = typeof window !== 'undefined'
    && window.location.protocol === 'https:'
    && identity?.hostUrl
    && identity.hostUrl.startsWith('http:')

  return (
    <div
      className="rc"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '100dvh',
        background: 'var(--bg, #0b0c10)',
        paddingBottom: 76, // room for bottom nav
      }}
    >
      {/* Companion Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 16px',
          borderBottom: '1px solid var(--hairline-strong)',
          background: 'var(--bg-inset)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isMixedContent ? '#f59e0b' : '#22c55e',
                boxShadow: isMixedContent ? '0 0 6px #f59e0b' : '0 0 6px #22c55e',
              }}
            />
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {identity?.name || 'PC Companion'}
            </h1>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2 }}>
            {isMixedContent
              ? 'Web (Cloudflare) · Local Wi-Fi available'
              : (identity?.hostUrl ? 'Direct LAN (Local Network)' : 'Relay connection')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="set-btn-sm"
            onClick={doSync}
            aria-label="Synchronize now"
            title="Sync"
            style={{ padding: '6px 10px' }}
          >
            <Icon name="refresh" size={14} />
          </button>
          {onUnpair && (
            <button
              type="button"
              className="set-btn-sm"
              onClick={onUnpair}
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.4)', padding: '6px 10px', fontSize: 11 }}
            >
              Unpair
            </button>
          )}
        </div>
      </header>

      {/* Mixed Content / LAN Switch Suggestion */}
      {isMixedContent && (
        <div
          style={{
            margin: '12px 14px 0',
            padding: '14px 16px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(99, 102, 241, 0.08))',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.2)',
                display: 'grid',
                placeItems: 'center',
                color: '#f59e0b',
                flexShrink: 0,
              }}
            >
              <Icon name="wifi" size={18} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>
                Local Network Available
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-sub)', marginTop: 2, lineHeight: 1.4 }}>
                Mobile browsers block live touchpad, audio, and screen streaming from HTTPS pages to local PC. Tap below to switch to Direct LAN:
              </div>
            </div>
          </div>
          <a
            href={`${identity.hostUrl.replace(/\/+$/, '')}/#token=${encodeURIComponent(identity.token || '')}&deviceId=${encodeURIComponent(identity.deviceId || '')}&name=${encodeURIComponent(identity.name || '')}&relayUrl=${encodeURIComponent(identity.relayUrl || '')}&hostUrl=${encodeURIComponent(identity.hostUrl || '')}&permissions=${encodeURIComponent(JSON.stringify(identity.permissions || {}))}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: '10px',
              background: '#f59e0b',
              color: '#000',
              fontWeight: 700,
              fontSize: 12,
              textDecoration: 'none',
              boxShadow: '0 2px 10px rgba(245, 158, 11, 0.3)',
            }}
          >
            <span>Open Direct LAN ({identity.hostUrl})</span>
            <span>→</span>
          </a>
        </div>
      )}

      {/* Main Tab Body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'pc' && <RemotePC />}
        {activeTab === 'media' && <RemoteMedia />}
        {activeTab === 'camera' && <RemoteCamera />}
        {activeTab === 'files' && <RemoteFiles />}
        {activeTab === 'amethyst' && <RemoteAgent />}
        {activeTab === 'terminal' && <RemoteTerminal />}
      </div>

      {/* Mobile-First Bottom Navigation Bar */}
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 64,
          background: 'var(--raised, #111218)',
          borderTop: '1px solid var(--hairline-strong)',
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          zIndex: 50,
          backdropFilter: 'blur(12px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {[
          { id: 'pc', label: 'PC', icon: 'dash' },
          { id: 'media', label: 'Media', icon: 'music' },
          { id: 'camera', label: 'Camera', icon: 'camera' },
          { id: 'files', label: 'Files', icon: 'folder' },
          { id: 'amethyst', label: 'Agent', icon: 'sparkle' },
          { id: 'terminal', label: 'Terminal', icon: 'term' },
        ].map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                background: 'transparent',
                border: 'none',
                color: isActive ? 'var(--accent, #6366f1)' : 'var(--text-sub)',
                cursor: 'pointer',
                padding: '4px 0',
                transition: 'color 0.15s ease',
              }}
            >
              <Icon name={tab.icon} size={20} />
              <span
                style={{
                  fontSize: 10,
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: '0.02em',
                }}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
