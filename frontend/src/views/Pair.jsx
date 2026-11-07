import { useCallback, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui/bento/index.jsx'
import QrScanner from '../components/QrScanner.jsx'
import { decodeAndValidateQr, pairDevice } from '../mobile/pairingClient.js'
import { loadFixtureBundle } from '../mobile/bundle.js'
import './pair.css'

export default function Pair({ onPaired, onDesktop }) {
  // Phases: 'idle' | 'scanning' | 'connecting' | 'waiting_approval' | 'paired' | 'trouble'
  const [phase, setPhase] = useState('idle')
  const [trouble, setTrouble] = useState(null)
  const [loadingFixture, setLoadingFixture] = useState(false)

  const handleBack = () => {
    if (phase === 'scanning' || phase === 'trouble') {
      setPhase('idle')
      setTrouble(null)
      return
    }
    if (onDesktop) {
      onDesktop()
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    }
  }

  const handleScan = useCallback(async (raw) => {
    setTrouble(null)

    let qrPayload
    try {
      qrPayload = decodeAndValidateQr(raw)
    } catch (err) {
      setTrouble({
        title: err.code === 'EXPIRED_QR'
          ? 'That code has expired'
          : err.code === 'WRONG_VERSION'
            ? 'Unsupported pairing version'
            : 'Invalid QR code',
        body: err.message,
        retry: 'Scan new code',
      })
      setPhase('trouble')
      return
    }

    setPhase('connecting')
    try {
      await pairDevice({
        qrPayload,
        onStatusChange: (nextState) => {
          if (nextState === 'waiting_approval') {
            setPhase('waiting_approval')
          }
        },
      })

      setPhase('paired')
      setTimeout(() => onPaired?.(), 600)
    } catch (err) {
      const msg = err.message || 'Could not complete pairing with PC.'
      setTrouble({
        title: err.code === 'NO_HOST_RESPONDED'
          ? 'Connection Failed'
          : err.code === 'DENIED'
            ? 'Pairing Denied'
            : err.code === 'APPROVAL_TIMEOUT'
              ? 'Approval Timed Out'
              : 'Connection Failed',
        body: msg,
        retry: 'Try again',
      })
      setPhase('trouble')
    }
  }, [onPaired])

  const handleLoadFixture = async () => {
    if (loadingFixture) return
    setLoadingFixture(true)
    try {
      await loadFixtureBundle()
      setPhase('paired')
      setTimeout(() => onPaired?.(), 500)
    } finally {
      setLoadingFixture(false)
    }
  }

  return (
    <div className={`pair-screen ${phase === 'idle' ? 'is-flow-lime' : ''}`}>
      {/* Top Bar with Circular Back Button */}
      <header className="pair-top-bar">
        <Button
          type="button"
          className="pair-back-btn"
          onClick={handleBack}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Button>
      </header>

      {/* Main Center Area */}
      <main className="pair-center-content">
        {phase === 'scanning' ? (
          <div className="pair-scan-card">
            <QrScanner
              onScan={handleScan}
              onCancel={() => setPhase('idle')}
            />
          </div>
        ) : phase === 'connecting' ? (
          <div className="pair-dialog-card">
            <div className="pair-monitor-icon is-pulsing" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2.5" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <h1 className="pair-prompt-title">Connecting to PC…</h1>
            <p className="pair-prompt-desc">
              Establishing a secure, pinned TLS connection to your computer.
            </p>
          </div>
        ) : phase === 'waiting_approval' ? (
          <div className="pair-dialog-card">
            <div className="pair-monitor-icon is-pulsing" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2.5" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <h1 className="pair-prompt-title">Waiting for approval on your PC…</h1>
            <p className="pair-prompt-desc">
              Look at your computer screen and click <strong>Approve</strong> to pair this phone.
            </p>
          </div>
        ) : phase === 'paired' ? (
          <div className="pair-dialog-card">
            <div className="pair-status-glyph is-ok" aria-hidden="true">
              <Icon name="check-circle" size={44} />
            </div>
            <h1 className="pair-prompt-title">Connected</h1>
            <p className="pair-prompt-desc">Your phone is now securely paired with your PC.</p>
          </div>
        ) : phase === 'trouble' ? (
          <div className="pair-dialog-card">
            <div className="pair-status-glyph is-bad" aria-hidden="true">
              <Icon name="alert" size={38} />
            </div>
            <h1 className="pair-prompt-title">{trouble?.title || 'Connection Failed'}</h1>
            <p className="pair-prompt-desc">{trouble?.body}</p>
          </div>
        ) : (
          /* Default IDLE Screen */
          <>
            <div style={{ margin: '20px 0 10px', display: 'flex', justifyContent: 'center' }} aria-hidden="true">
              <svg viewBox="0 0 300 300" width="220" height="220" fill="none" stroke="#111113" strokeWidth="1.5">
                <circle cx="150" cy="150" r="16" stroke="#111113" strokeWidth="1.5" />
                <ellipse cx="150" cy="150" rx="120" ry="48" transform="rotate(0 150 150)" />
                <ellipse cx="150" cy="150" rx="120" ry="48" transform="rotate(45 150 150)" />
                <ellipse cx="150" cy="150" rx="120" ry="48" transform="rotate(90 150 150)" />
                <ellipse cx="150" cy="150" rx="120" ry="48" transform="rotate(135 150 150)" />
                <path d="M70 215 L74 225 L84 229 L74 233 L70 243 L66 233 L56 229 L66 225 Z" fill="#111113" />
                <path d="M225 65 L229 75 L239 79 L229 83 L225 93 L221 83 L211 79 L221 75 Z" fill="#111113" />
              </svg>
            </div>

            <h1 className="pair-prompt-title" style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
              Connect your PC to Amethyst
            </h1>
            <p className="pair-prompt-desc" style={{ color: '#141414', opacity: 0.8, fontSize: 15, margin: '8px 0 24px' }}>
              Open Amethyst on your PC, click Pair Device, and scan the QR code. Both devices must be on the same Wi-Fi network.
            </p>
          </>
        )}
      </main>

      {/* Bottom Action Area */}
      <footer className="pair-bottom-actions">
        {phase === 'trouble' ? (
          <Button
            type="button"
            className="pair-auth-btn"
            onClick={() => setPhase('scanning')}
          >
            {trouble?.retry || 'Try again'}
          </Button>
        ) : phase === 'idle' ? (
          <>
            <Button
              type="button"
              className="pair-auth-btn"
              style={{
                background: '#111113',
                color: '#fff',
                borderRadius: 999,
                minHeight: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 24px',
              }}
              onClick={() => setPhase('scanning')}
            >
              <span>Scan QR Code</span>
              <span aria-hidden="true">→</span>
            </Button>

            {/* Test fixture button for sessions D & E */}
            <Button
              type="button"
              className="pair-sub-action"
              style={{
                marginTop: 8,
                border: '1px dashed #111113',
                borderRadius: 999,
                minHeight: 40,
                color: '#111113',
                fontWeight: 500,
                fontSize: 13,
                background: 'transparent',
                cursor: 'pointer',
              }}
              onClick={handleLoadFixture}
              disabled={loadingFixture}
            >
              {loadingFixture ? 'Loading fixture…' : 'Use test bundle (sessions D & E)'}
            </Button>
          </>
        ) : null}

        {onDesktop && phase === 'idle' && (
          <Button type="button" className="pair-desktop-link" onClick={onDesktop} style={{ marginTop: 12 }}>
            Use desktop interface
          </Button>
        )}
      </footer>
    </div>
  )
}
