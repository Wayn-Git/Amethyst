/* Pairing, as the first thing a phone sees.
 *
 * This screen exists because the one before it was unreachable. The pairing
 * controls used to live inside Settings, behind a desktop layout and behind a
 * ninety-second wait for a backend that -- on a phone, with the machine at home
 * behind a router -- was never going to answer.
 *
 * So: not paired is not a broken install. It is a device that has not been told
 * what it belongs to yet, and the right thing to show is the question.
 *
 * What changed since the first version of this screen is how much the person
 * has to know. It used to ask for a relay address and a thirty-two character
 * code, both typed, which meant pairing was a configuration exercise. Now the
 * machine's QR code carries both, and there are three ways in, in descending
 * order of how little they ask:
 *
 *   1. The phone's own camera app opens the link. Nothing is typed, and this
 *      screen comes up already knowing everything -- see `fromLink`.
 *   2. The scanner here reads the same code, where the browser has a decoder.
 *   3. The code is typed, which still works and always will, because a camera
 *      that will not focus at 11pm is a real thing.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import Icon from '../components/Icon.jsx'
import QrScanner from '../components/QrScanner.jsx'
import * as syncClient from '../lib/sync/client.js'

/** Whether a scan is possible here at all.
 *
 * Checked before the camera button is drawn rather than on tap, because the
 * answer is "no" on every iPhone and a button that fails when pressed is worse
 * than one that was never offered. iOS does not need it: the machine's code is
 * an https link, so the system camera app opens the pairing screen directly --
 * one fewer tap than an in-app scanner, not one more.
 */
function canScan() {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window
    && Boolean(navigator.mediaDevices?.getUserMedia)
}

/* What went wrong, in the words somebody can act on.
 *
 * Each of these used to be the same two-minute wait ending in "the machine
 * never answered", which is the right message for exactly one of them and sends
 * you to check the wrong thing for the rest. */
const TROUBLE = {
  /* The one failure that is not worth retrying, and the only one whose fix is
     on the other machine rather than on this phone. */
  insecure: {
    title: 'This address cannot pair',
    body: 'Browsers only allow the encryption this needs on an https address. '
      + 'Open Amethyst over https and scan the code again — on your computer, '
      + '`cloudflared tunnel --url http://localhost:8000` gives you one in a second.',
    retry: 'Try again',
  },
  expired: {
    title: 'That code has expired',
    body: 'Codes last five minutes. Show a new one on your computer and scan it again.',
    retry: 'Try another code',
  },
  invalid: {
    title: "That code didn't work",
    body: 'It may have been mistyped, or already used — each code pairs one device, once.',
    retry: 'Try again',
  },
  offline: {
    title: 'No connection',
    body: 'This device could not reach the relay. Check your signal and try again.',
    retry: 'Retry',
  },
  relay: {
    title: 'The relay turned this down',
    body: 'It is reachable but would not take the request. It may be busy — try again in a moment.',
    retry: 'Retry',
  },
  timeout: {
    title: 'Your computer never answered',
    body: 'It completes pairing while it is running. Check that Amethyst is open on it and that its relay is switched on.',
    retry: 'Try again',
  },
}

/** Is there a code in the address bar waiting to be used?
 *
 *  A pure read, safe to call while rendering. Taking it is `takeLink` below,
 *  which is not. */
function linkWaiting() {
  return typeof window !== 'undefined' && (window.location.hash || '').includes('s=')
}

/** Read a link the camera app opened, and take it out of the address bar.
 *
 *  Consumed rather than merely read, and once: the code is single use, so a
 *  remount that found it still there would retry a spent one. The secret
 *  arrives in the fragment, which never reached a server -- and it should not
 *  linger in the URL bar or the back stack either, where the next person to
 *  pick up the phone can read it. */
function takeLink() {
  if (!linkWaiting()) return null
  const read = syncClient.readPayload(window.location.href)
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch { /* no history to rewrite; the value read above is still usable */ }
  return read.secret ? read : null
}

export default function Pair({ onPaired, onDesktop }) {
  const held = syncClient.identity()

  // Opening straight into "pairing" when a link brought us here, so the idle
  // screen does not flash first. The link itself is consumed in the effect
  // below -- reading it is pure, taking it rewrites history, and that does not
  // belong in a render.
  const [phase, setPhase] = useState(() => (linkWaiting() ? 'pairing' : 'idle'))
  const [trouble, setTrouble] = useState(null)
  const [typing, setTyping] = useState(false)
  const [relayUrl, setRelayUrl] = useState(() => held?.relayUrl || '')
  const [code, setCode] = useState('')

  const run = useCallback(async (relay, secret) => {
    setPhase('pairing')
    setTrouble(null)
    try {
      await syncClient.pair(relay, secret, deviceName())
      setPhase('paired')
      // A beat on the confirmation, so pairing reads as having happened rather
      // than as the screen blinking into a different app.
      setTimeout(() => onPaired?.(), 700)
    } catch (err) {
      setTrouble(TROUBLE[err?.reason] || {
        title: "That didn't work",
        body: err?.message || 'Something went wrong. Try again.',
        retry: 'Try again',
      })
      setPhase('trouble')
    }
  }, [onPaired])

  /* A link the camera opened pairs on its own: everything it needs is in it,
     and asking somebody to press a button after they already pointed a camera
     at the thing is a step for the sake of having one.

     Once, on mount. `run` is deliberately not a dependency -- it is stable, and
     re-running this would replay a code that is already spent. */
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const start = takeLink()
    if (!start) {
      // The hash was there when this rendered and is not usable now. Only
      // reachable if it was malformed; fall back to asking.
      setPhase((was) => (was === 'pairing' ? 'idle' : was))
      return
    }
    setCode(start.secret)
    if (start.relayUrl) setRelayUrl(start.relayUrl)
    if (start.relayUrl) run(start.relayUrl, start.secret)
    else { setPhase('idle'); setTyping(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scanned = useCallback((raw) => {
    const read = syncClient.readPayload(raw)
    if (!read.secret) { setPhase('idle'); return }
    const relay = read.relayUrl || relayUrl
    setCode(read.secret)
    if (read.relayUrl) setRelayUrl(read.relayUrl)
    // A code with no relay in it is an older machine's. Fall back to asking,
    // rather than failing on something the person can still supply.
    if (relay) run(relay, read.secret)
    else { setPhase('idle'); setTyping(true) }
  }, [relayUrl, run])

  if (phase === 'scanning') {
    return (
      <Shell>
        <QrScanner onScan={scanned} onCancel={() => setPhase('idle')} />
      </Shell>
    )
  }

  if (phase === 'pairing') {
    return (
      <Shell>
        <div className="pair-state">
          <div className="pair-spinner" aria-hidden="true" />
          <h1>Pairing…</h1>
          <p className="pair-sub">Waiting for your computer to answer.</p>
        </div>
      </Shell>
    )
  }

  if (phase === 'paired') {
    return (
      <Shell>
        <div className="pair-state pair-state--ok">
          <Icon name="check" size={32} />
          <h1>Paired</h1>
          <p className="pair-sub">This device is connected to your computer.</p>
        </div>
      </Shell>
    )
  }

  if (phase === 'trouble') {
    return (
      <Shell>
        <div className="pair-state pair-state--bad">
          <Icon name="alert" size={30} />
          <h1>{trouble.title}</h1>
          <p className="pair-sub">{trouble.body}</p>
          <button type="button" className="pair-go" onClick={() => { setPhase('idle'); setTyping(true) }}>
            {trouble.retry}
          </button>
        </div>
      </Shell>
    )
  }

  const ready = relayUrl.trim().startsWith('http')
    && syncClient.readPayload(code).secret.length >= 16

  return (
    <Shell onDesktop={onDesktop}>
      <Icon name="link" size={26} />
      <h1>Connect to your computer</h1>
      <p className="pair-sub">
        Your computer keeps your files and runs your work. This device shows what it
        publishes and can send it more. Everything between them is sealed — the relay
        carrying it cannot read any of it.
      </p>

      {!syncClient.canPair() ? (
        <p className="pair-error">
          This page is on <code>{typeof window !== 'undefined' ? window.location.protocol : ''}</code>,
          and browsers only allow the encryption pairing needs over <strong>https</strong>.
          Nothing below will work until Amethyst is opened over an https address.
        </p>
      ) : null}

      <ol className="pair-steps">
        <li>On your computer, open <strong>Settings → Devices</strong></li>
        <li>Press <strong>Pair a device</strong></li>
        <li>{canScan() ? 'Scan the code it shows' : 'Point your camera at the code it shows'}</li>
      </ol>

      {canScan() ? (
        <button type="button" className="pair-go" onClick={() => setPhase('scanning')}>
          <Icon name="camera" size={18} />
          Scan the code
        </button>
      ) : null}

      {typing ? (
        <div className="pair-manual">
          <label className="pair-label" htmlFor="pair-relay">Relay address</label>
          <input
            id="pair-relay"
            className="pair-input"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://your-relay.workers.dev"
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
          />

          <label className="pair-label" htmlFor="pair-code">Pairing code</label>
          <input
            id="pair-code"
            className="pair-input pair-input--code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXX XXXX XXXX XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ready) run(relayUrl.trim(), code)
            }}
          />

          <button
            type="button"
            className="pair-go"
            onClick={() => run(relayUrl.trim(), code)}
            disabled={!ready}
          >
            Pair
          </button>
        </div>
      ) : (
        <button type="button" className="pair-secondary" onClick={() => setTyping(true)}>
          Enter the code instead
        </button>
      )}
    </Shell>
  )
}

/* The frame every state shares. Full height, one column, and its own scroll --
   a phone keyboard opening must not push the card off the top of the screen. */
function Shell({ children, onDesktop }) {
  return (
    <div className="pair">
      <div className="pair-card">{children}</div>
      {onDesktop ? (
        <button type="button" className="pair-escape" onClick={onDesktop}>
          Use the desktop interface
        </button>
      ) : null}
    </div>
  )
}

/** Something recognisable in `amethyst device`'s list, without asking. */
function deviceName() {
  const ua = navigator.userAgent || ''
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return 'Android phone'
  if (/Mac/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows PC'
  return 'a browser'
}
