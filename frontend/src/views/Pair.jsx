/* Pairing, as the first thing a phone sees.
 *
 * This screen exists because the one before it was unreachable. A browser with
 * no backend -- which is every phone, since the machine is at home behind a
 * router -- renders the boot screen and waits ninety seconds for a server that
 * is never going to answer, and the pairing controls were inside Settings,
 * behind that wait, in a desktop layout nobody could get to.
 *
 * So: no backend and not paired is not a broken install. It is a device that
 * has not been told what it belongs to yet, and the right thing to show is the
 * question rather than a spinner.
 *
 * Sized for a phone held in one hand. `type="url"` and `inputMode` pick the
 * right keyboard; 16px type stops iOS zooming on focus; autocapitalize is off
 * because a base32 code is not a sentence.
 */

import { useState } from 'react'

import Icon from '../components/Icon.jsx'
import * as syncClient from '../lib/sync/client.js'

/** Accepts the whole `amethyst://pair?s=…` link or the bare code, in any case,
 *  with or without the spaces the machine prints it in. */
function tidy(entered) {
  return entered.trim().split('s=').pop().replace(/\s+/g, '').toUpperCase()
}

export default function Pair({ onPaired }) {
  const [relayUrl, setRelayUrl] = useState(() => syncClient.identity()?.relayUrl || '')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const ready = relayUrl.trim().startsWith('http') && tidy(code).length >= 16

  const pair = async () => {
    setBusy(true)
    setError(null)
    try {
      await syncClient.pair(relayUrl.trim().replace(/\/+$/, ''), tidy(code), deviceName())
      onPaired?.()
    } catch (err) {
      setError(err.message || 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pair">
      <div className="pair-card">
        <Icon name="link" size={26} />
        <h1>Pair this device</h1>
        <p className="pair-sub">
          Your machine keeps your files and runs your turns. This device shows what it
          publishes and can send it work. Everything between them is sealed — the relay
          carrying it cannot read any of it.
        </p>

        <ol className="pair-steps">
          <li>On your machine, run <code>amethyst device --pair</code></li>
          <li>Leave it running — it finishes on its next poll</li>
          <li>Enter what it printed below</li>
        </ol>

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
          onKeyDown={(e) => { if (e.key === 'Enter' && ready && !busy) pair() }}
        />

        {error ? <p className="pair-error">{error}</p> : null}

        <button type="button" className="pair-go" onClick={pair} disabled={!ready || busy}>
          {busy ? 'Waiting for your machine…' : 'Pair'}
        </button>

        {busy ? (
          <p className="pair-sub">
            This takes up to a minute: your machine answers on its next poll.
          </p>
        ) : null}
      </div>
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
