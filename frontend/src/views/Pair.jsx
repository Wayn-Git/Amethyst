import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import QrScanner from '../components/QrScanner.jsx'
import { AsciiSkeleton } from 'ascii-reveal'
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

  const [phase, setPhase] = useState(() => (linkWaiting() ? 'pairing' : 'idle'))
  const [trouble, setTrouble] = useState(null)
  const [typing, setTyping] = useState(false)
  const [relayUrl, setRelayUrl] = useState(() => held?.relayUrl || '')
  const [hostUrl, setHostUrl] = useState(() => held?.hostUrl || '')
  const [code, setCode] = useState('')

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
    if (!start) {
      setPhase((was) => (was === 'pairing' ? 'idle' : was))
      return
    }
    setCode(start.secret)
    if (start.relayUrl) setRelayUrl(start.relayUrl)
    if (start.hostUrl) setHostUrl(start.hostUrl)
    if (start.relayUrl || start.hostUrl || typeof window !== 'undefined') {
      run({ relay: start.relayUrl, host: start.hostUrl, secret: start.secret })
    } else {
      setPhase('idle')
      setTyping(true)
    }
  }, [run])

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

  if (phase === 'scanning') {
    return (
      <div className="pair-screen">
        <div className="pair-container">
          <div className="pair-status-card">
            <QrScanner onScan={scanned} onCancel={() => setPhase('idle')} />
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'pairing') {
    return (
      <div className="pair-screen">
        <div className="pair-container">
          <div className="pair-status-card">
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0 16px' }} aria-hidden="true">
              <AsciiSkeleton variant="scan" circle width={54} height={54} />
            </div>
            <h1>Pairing with your PC…</h1>
            <p>
              Waiting for authorization from your desktop. Look at your computer screen and click <strong>Approve</strong>.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'paired') {
    return (
      <div className="pair-screen">
        <div className="pair-container">
          <div className="pair-status-card">
            <div className="pair-status-icon-badge pair-status-icon-badge--ok">
              <Icon name="check-circle" size={36} />
            </div>
            <h1>Connected</h1>
            <p>Your phone is now securely paired with your computer.</p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'trouble') {
    return (
      <div className="pair-screen">
        <div className="pair-container">
          <div className="pair-status-card">
            <div className="pair-status-icon-badge pair-status-icon-badge--bad">
              <Icon name="alert" size={32} />
            </div>
            <h1>{trouble.title}</h1>
            <p>{trouble.body}</p>

            <div className="pair-firewall-hint">
              <strong>Tip for Home Wi-Fi:</strong>
              <span>If your computer runs Linux, ensure the firewall allows port 8000:</span>
              <code>sudo ufw allow 8000/tcp</code>
            </div>

            <button
              type="button"
              className="pair-btn-primary"
              onClick={() => { setPhase('idle'); setTyping(true) }}
            >
              {trouble.retry}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const ready = (relayUrl.trim().startsWith('http') || hostUrl.trim().startsWith('http') || (typeof window !== 'undefined' && window.location.origin.startsWith('http')))
    && syncClient.readPayload(code).secret.length >= 16

  return (
    <div className="pair-screen">
      <div className="pair-container">
        {/* Brand Pill */}
        <div className="pair-brand-pill">
          <span>AMETHYST</span>
        </div>

        {/* Hero Title */}
        <h1 className="pair-hero-title">A smarter and more secure experience</h1>
        <p className="pair-hero-sub">
          Connect your phone to access your library, monitor agent tasks, and control your PC from anywhere.
        </p>

        {/* Feature / Value Props List (Inspired by Klarna Screenshot 5) */}
        <div className="pair-features">
          <div className="pair-feature-item">
            <div className="pair-feature-icon">
              <Icon name="shield-check" size={22} />
            </div>
            <div className="pair-feature-text">
              <strong>Private & end-to-end encrypted</strong>
              <p>Your vault stays private. The relay only carries sealed packets and cannot inspect your content.</p>
            </div>
          </div>

          <div className="pair-feature-item">
            <div className="pair-feature-icon">
              <Icon name="lightning" size={22} />
            </div>
            <div className="pair-feature-text">
              <strong>Direct Wi-Fi speed</strong>
              <p>Automatically connects directly over local network with zero cloud delay when at home.</p>
            </div>
          </div>

          <div className="pair-feature-item">
            <div className="pair-feature-icon">
              <Icon name="check-circle" size={22} />
            </div>
            <div className="pair-feature-text">
              <strong>Complete desktop control</strong>
              <p>Review and approve tool runs, send turns to your agent, and capture web content on the go.</p>
            </div>
          </div>
        </div>

        {/* Desktop Instructions Card */}
        <div className="pair-guide-card">
          <div className="pair-guide-header">
            <Icon name="desktop" size={17} />
            <span>How to connect</span>
          </div>
          <ol className="pair-guide-list">
            <li>Open <strong>Amethyst</strong> on your computer</li>
            <li>Go to <strong>Settings → Devices</strong></li>
            <li>Click <strong>Pair a device</strong> and scan the code</li>
          </ol>
        </div>

        {/* Actions Stack */}
        <div className="pair-actions-stack">
          {canScan() ? (
            <button
              type="button"
              className="pair-btn-primary"
              onClick={() => setPhase('scanning')}
            >
              <Icon name="camera" size={20} />
              <span>Scan QR Code</span>
            </button>
          ) : (
            <button
              type="button"
              className="pair-btn-primary"
              onClick={() => setTyping(true)}
            >
              <Icon name="link" size={20} />
              <span>Enter Code Manually</span>
            </button>
          )}

          <button
            type="button"
            className="pair-btn-text"
            onClick={() => setTyping((prev) => !prev)}
          >
            {typing ? 'Hide manual entry' : 'Or enter code manually'}
          </button>
        </div>

        {/* Manual Configuration Box */}
        {typing && (
          <div className="pair-manual-box">
            <label className="pair-input-label" htmlFor="pair-relay">
              Computer or Relay URL
            </label>
            <input
              id="pair-relay"
              className="pair-input-field"
              type="url"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="http://192.168.1.x:8000 or https://..."
              value={relayUrl || hostUrl}
              onChange={(e) => {
                const val = e.target.value
                setRelayUrl(val)
                setHostUrl(val)
              }}
            />

            <label className="pair-input-label" htmlFor="pair-code">
              Pairing Code
            </label>
            <input
              id="pair-code"
              className="pair-input-field pair-input-field--code"
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

            <button
              type="button"
              className="pair-btn-primary"
              onClick={() => run({ relay: relayUrl.trim(), host: hostUrl.trim(), secret: code })}
              disabled={!ready}
            >
              Confirm & Connect
            </button>
          </div>
        )}

        {onDesktop && (
          <button type="button" className="pair-escape-link" onClick={onDesktop}>
            Use the desktop interface
          </button>
        )}
      </div>
    </div>
  )
}
