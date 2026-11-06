import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import QrScanner from '../components/QrScanner.jsx'
import * as syncClient from '../lib/sync/client.js'
import './pair.css'

/** Whether a scan is possible here at all. */
function canScan() {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window
    && Boolean(navigator.mediaDevices?.getUserMedia)
}

const TROUBLE = {
  insecure: {
    title: 'This address cannot pair',
    body: 'Browsers require an https connection for end-to-end encryption. Open Amethyst over https and scan again.',
    retry: 'Try again',
  },
  expired: {
    title: 'That code has expired',
    body: 'Pairing codes last five minutes. Click "Pair a device" on your PC to generate a fresh code and scan again.',
    retry: 'Scan new code',
  },
  invalid: {
    title: "That code didn't work",
    body: 'It may have been mistyped, or already used. Each code pairs one device, once.',
    retry: 'Try again',
  },
  offline: {
    title: 'No connection',
    body: 'This device could not reach your PC or the relay. Check that your phone and PC are on the same Wi-Fi, or check your internet connection.',
    retry: 'Retry connection',
  },
  relay: {
    title: 'Relay connection busy',
    body: 'The encrypted mailbox is reachable but busy. Try connecting again in a moment.',
    retry: 'Retry',
  },
  timeout: {
    title: 'Your computer never answered',
    body: 'Check that Amethyst is open on your PC. If on home Wi-Fi, ensure your PC firewall allows port 8000 (sudo ufw allow 8000/tcp).',
    retry: 'Try again',
  },
}

function linkWaiting() {
  return typeof window !== 'undefined' && (window.location.hash || '').includes('s=')
}

function takeLink() {
  if (!linkWaiting()) return null
  const read = syncClient.readPayload(window.location.href)
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {}
  return read.secret ? read : null
}

function deviceName() {
  const ua = navigator.userAgent || ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android phone'
  if (/Mac/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  return 'Mobile phone'
}

export default function Pair({ onPaired, onDesktop }) {
  const held = syncClient.identity()

  const [phase, setPhase] = useState('idle') // 'idle' | 'scanning' | 'pairing' | 'paired' | 'trouble'
  const [trouble, setTrouble] = useState(null)
  const [typing, setTyping] = useState(false)
  const [relayUrl, setRelayUrl] = useState(() => held?.relayUrl || '')
  const [hostUrl, setHostUrl] = useState(() => held?.hostUrl || '')
  const [code, setCode] = useState('')
  const [pendingSecret, setPendingSecret] = useState(null)

  const run = useCallback(async (opts, fallbackCode) => {
    setPhase('pairing')
    setTrouble(null)
    try {
      let params
      if (typeof opts === 'object' && opts !== null) {
        params = {
          relayUrl: opts.relay || opts.relayUrl,
          hostUrl: opts.host || opts.hostUrl,
          secret: opts.secret,
          name: deviceName(),
        }
      } else {
        params = {
          relayUrl: opts,
          hostUrl: hostUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
          secret: fallbackCode,
          name: deviceName(),
        }
      }
      await syncClient.pair(params)
      setPhase('paired')
      setTimeout(() => onPaired?.(), 700)
    } catch (err) {
      setTrouble(TROUBLE[err?.reason] || {
        title: "Connection could not finish",
        body: err?.message || 'Something went wrong. Check that Amethyst is running on your computer.',
        retry: 'Try again',
      })
      setPhase('trouble')
    }
  }, [hostUrl, onPaired])

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const start = takeLink()
    if (!start) return
    setCode(start.secret)
    if (start.relayUrl) setRelayUrl(start.relayUrl)
    if (start.hostUrl) setHostUrl(start.hostUrl)
    setPendingSecret(start)
  }, [])

  const handleAuthorize = () => {
    if (pendingSecret?.secret) {
      run(pendingSecret)
      return
    }
    if (code.trim().length >= 16) {
      run({ relay: relayUrl.trim(), host: hostUrl.trim(), secret: code.trim() })
      return
    }
    if (canScan()) {
      setPhase('scanning')
    } else {
      setTyping(true)
    }
  }

  const handleBack = () => {
    if (phase === 'scanning' || phase === 'trouble' || typing) {
      setPhase('idle')
      setTyping(false)
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

  const scanned = useCallback((raw) => {
    const read = syncClient.readPayload(raw)
    if (!read.secret) { setPhase('idle'); return }
    const relay = read.relayUrl || relayUrl
    const host = read.hostUrl || hostUrl
    setCode(read.secret)
    if (read.relayUrl) setRelayUrl(read.relayUrl)
    if (read.hostUrl) setHostUrl(read.hostUrl)
    run({ relay, host, secret: read.secret })
  }, [relayUrl, hostUrl, run])

  const ready = (relayUrl.trim().startsWith('http') || hostUrl.trim().startsWith('http') || (typeof window !== 'undefined' && window.location.origin.startsWith('http')))
    && syncClient.readPayload(code).secret.length >= 16

  return (
    <div className="pair-screen">
      {/* Top Bar with Circular Back Button */}
      <header className="pair-top-bar">
        <button
          type="button"
          className="pair-back-btn"
          onClick={handleBack}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </header>

      {/* Main Center Area */}
      <main className="pair-center-content">
        {phase === 'scanning' ? (
          <div className="pair-scan-card">
            <QrScanner onScan={scanned} onCancel={() => setPhase('idle')} />
          </div>
        ) : phase === 'pairing' ? (
          <div className="pair-dialog-card">
            <div className="pair-monitor-icon is-pulsing" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2.5" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <h1 className="pair-prompt-title">Authorizing with your computer…</h1>
            <p className="pair-prompt-desc">
              Waiting for authorization from your desktop. Look at your computer screen and click <strong>Approve</strong>.
            </p>
          </div>
        ) : phase === 'paired' ? (
          <div className="pair-dialog-card">
            <div className="pair-status-glyph is-ok" aria-hidden="true">
              <Icon name="check-circle" size={44} />
            </div>
            <h1 className="pair-prompt-title">Connected</h1>
            <p className="pair-prompt-desc">Your phone is now securely paired with your computer.</p>
          </div>
        ) : phase === 'trouble' ? (
          <div className="pair-dialog-card">
            <div className="pair-status-glyph is-bad" aria-hidden="true">
              <Icon name="alert" size={38} />
            </div>
            <h1 className="pair-prompt-title">{trouble?.title || 'Connection Failed'}</h1>
            <p className="pair-prompt-desc">{trouble?.body}</p>
            {trouble?.title?.includes('computer') && (
              <div className="pair-firewall-box">
                <span>Linux firewall hint:</span>
                <code>sudo ufw allow 8000/tcp</code>
              </div>
            )}
          </div>
        ) : (
          /* Default IDLE Screen: Exact match to reference phone screen */
          <>
            <div className="pair-monitor-icon" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2.5" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>

            <h1 className="pair-prompt-title">
              Allow this phone to access Amethyst on your computer?
            </h1>

            {typing && (
              <div className="pair-manual-card">
                <label className="pair-input-label" htmlFor="pair-relay-input">
                  Computer or Relay Address
                </label>
                <input
                  id="pair-relay-input"
                  className="pair-text-input"
                  type="url"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="http://192.168.1.x:8000"
                  value={relayUrl || hostUrl}
                  onChange={(e) => {
                    const val = e.target.value
                    setRelayUrl(val)
                    setHostUrl(val)
                  }}
                />

                <label className="pair-input-label" htmlFor="pair-code-input">
                  Pairing Code
                </label>
                <input
                  id="pair-code-input"
                  className="pair-text-input pair-code-input"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="XXXX XXXX XXXX XXXX"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && ready) run({ relay: relayUrl.trim(), host: hostUrl.trim(), secret: code })
                  }}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* Bottom Action Area */}
      <footer className="pair-bottom-actions">
        {phase === 'trouble' ? (
          <button
            type="button"
            className="pair-auth-btn"
            onClick={() => { setPhase('idle'); setTyping(true) }}
          >
            {trouble?.retry || 'Try again'}
          </button>
        ) : phase === 'idle' ? (
          typing ? (
            <>
              <button
                type="button"
                className="pair-auth-btn"
                onClick={() => run({ relay: relayUrl.trim(), host: hostUrl.trim(), secret: code })}
                disabled={!ready}
              >
                Authorize this phone
              </button>
              <button
                type="button"
                className="pair-sub-action"
                onClick={() => setTyping(false)}
              >
                Cancel manual entry
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="pair-auth-btn"
                onClick={handleAuthorize}
              >
                Authorize this phone
              </button>
              <button
                type="button"
                className="pair-sub-action"
                onClick={() => setTyping(true)}
              >
                Enter code manually
              </button>
            </>
          )
        ) : null}

        {onDesktop && phase === 'idle' && (
          <button type="button" className="pair-desktop-link" onClick={onDesktop}>
            Use desktop interface
          </button>
        )}
      </footer>
    </div>
  )
}
