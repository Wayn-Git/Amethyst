import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui/bento/index.jsx'
import { clearBundle } from '../bundle.js'
import '../../views/pair.css'

export default function MobilePaired({ bundle, onUnpair, onDesktop }) {
  const [unpairing, setUnpairing] = useState(false)

  const handleUnpair = async () => {
    if (unpairing) return
    setUnpairing(true)
    try {
      await clearBundle()
      onUnpair?.()
    } finally {
      setUnpairing(false)
    }
  }

  const modelName = bundle?.llm?.model || 'Configured'
  const modelProvider = bundle?.llm?.provider ? bundle.llm.provider.toUpperCase() : ''
  const driveRoot = bundle?.drive?.root_folder_id || 'Not configured'
  const driveInbox = bundle?.drive?.inbox_folder_id

  return (
    <div className="pair-screen">
      <header className="pair-top-bar" />

      <main className="pair-center-content" style={{ width: '100%', maxWidth: 400 }}>
        <div className="pair-dialog-card" style={{ width: '100%', padding: '28px 24px' }}>
          <div className="pair-status-glyph is-ok" aria-hidden="true" style={{ marginBottom: 16 }}>
            <Icon name="check-circle" size={48} />
          </div>

          <h1 className="pair-prompt-title" style={{ fontSize: 26, fontWeight: 700, margin: '0 0 6px 0' }}>
            Paired with PC
          </h1>
          <p className="pair-prompt-desc" style={{ fontSize: 14, margin: '0 0 24px 0' }}>
            Your mobile app is securely connected to your personal Amethyst server.
          </p>

          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              textAlign: 'left',
              marginBottom: 8,
            }}
          >
            {/* LLM Model Card */}
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                background: 'var(--pair-surface, #fff)',
                border: '1px solid var(--pair-border, rgba(0,0,0,0.1))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Icon name="cpu" size={16} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pair-text-muted)' }}>
                  LANGUAGE MODEL
                </span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, wordBreak: 'break-word' }}>
                {modelName}
              </div>
              {modelProvider && (
                <div style={{ fontSize: 12, color: 'var(--pair-text-faint)', marginTop: 2 }}>
                  Provider: {modelProvider}
                </div>
              )}
            </div>

            {/* Drive Folder Card */}
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                background: 'var(--pair-surface, #fff)',
                border: '1px solid var(--pair-border, rgba(0,0,0,0.1))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Icon name="folder" size={16} />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pair-text-muted)' }}>
                  DRIVE FOLDER
                </span>
              </div>
              <div style={{ fontSize: 14, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {driveRoot}
              </div>
              {driveInbox && (
                <div style={{ fontSize: 12, color: 'var(--pair-text-faint)', marginTop: 4, fontFamily: 'monospace' }}>
                  Inbox: {driveInbox}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="pair-bottom-actions" style={{ width: '100%', maxWidth: 400, marginTop: 24 }}>
        <Button
          type="button"
          className="pair-auth-btn"
          style={{
            background: '#ef4444',
            color: '#ffffff',
            borderRadius: 999,
            minHeight: 48,
            width: '100%',
            fontWeight: 600,
            cursor: 'pointer',
            border: 0,
          }}
          onClick={handleUnpair}
          disabled={unpairing}
        >
          {unpairing ? 'Unpairing…' : 'Unpair Device'}
        </Button>

        {onDesktop && (
          <Button type="button" className="pair-desktop-link" onClick={onDesktop} style={{ marginTop: 12 }}>
            Use desktop interface
          </Button>
        )}
      </footer>
    </div>
  )
}
