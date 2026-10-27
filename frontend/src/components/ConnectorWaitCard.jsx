import { Button as HouseButton } from './ui/bento/index.jsx'
/* A connector card for a turn suspended mid-answer.

   A tool call that failed for want of a connected app parks the whole turn on
   this card, the way a tool call that needed permission parks on the approval
   card: the answer continues from the moment the app is actually wired up,
   and nothing the model does between here and there has to be redone.

   Connect hands the account flow to a browser tab, then watches the toolkits
   list until the app is really connected — the target is `slug` in
   `composioToolkits()` reporting `connected`, not the tab closing. When it is,
   the wait is resolved and the turn picks up on the far end of the same
   stream. Dismiss hands the turn its original error, and it reports the gap
   the way it always has.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import Icon from './Icon'
import { api } from '../api'

const POLL_ATTEMPTS = 40
const POLL_MS = 3000

export default function ConnectorWaitCard({ waitId, toolkit, service, settled, onResolve, onDismiss }) {
  const [phase, setPhase] = useState('idle') // idle | connecting | connected | failed
  const mounted = useRef(true)
  const pollRef = useRef(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const checkConnected = useCallback(async () => {
    const data = await api.composioToolkits()
    const row = (data?.toolkits ?? []).find((t) => (t.slug || '').toLowerCase() === toolkit.toLowerCase())
    return Boolean(row?.connected)
  }, [toolkit])

  const handleConnect = useCallback(async () => {
    setPhase('connecting')
    try {
      const res = await api.connectComposioToolkit(toolkit)
      if (res?.redirect_url) window.open(res.redirect_url, '_blank')
    } catch (err) {
      if (mounted.current) setPhase('failed')
      throw err
    }

    let attempts = 0
    const interval = setInterval(async () => {
      attempts += 1
      try {
        if (await checkConnected()) {
          clearInterval(interval)
          pollRef.current = null
          if (!mounted.current) return
          setPhase('connected')
          // The card is what the turn is parked on: resolving it is what wakes
          // the call, not just what recolors the row.
          try {
            await api.resolveConnectorWait(waitId, 'resume')
            if (onResolve) onResolve()
          } catch {
            if (mounted.current) setPhase('failed')
          }
          return
        }
      } catch {
        /* a failed poll is a poll that did not happen; the count still ticks */
      }
      if (attempts >= POLL_ATTEMPTS) {
        clearInterval(interval)
        pollRef.current = null
        if (mounted.current) setPhase('failed')
      }
    }, POLL_MS)
    pollRef.current = interval
  }, [toolkit, waitId, checkConnected, onResolve])

  const handleDismiss = useCallback(async () => {
    // Stop the watch first: failing the OAuth tab should not also race the
    // dismissal into a settled wait.
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (onDismiss) onDismiss()
    try {
      await api.resolveConnectorWait(waitId, 'dismiss')
    } catch {
      /* the wait may already be settled; the card still marks itself given up */
    }
  }, [waitId, onDismiss])

  if (settled) {
    return (
      <div className="connector-wait connector-wait--settled">
        <Icon name="check" size={13} />
        <span>{service || toolkit} connected — the request continues</span>
      </div>
    )
  }

  if (phase === 'connected') {
    return (
      <div className="connector-wait connector-wait--settled">
        <Icon name="check" size={13} />
        <span>{service || toolkit} connected</span>
      </div>
    )
  }

  return (
    <div className={`connector-wait${phase === 'failed' ? ' connector-wait--failed' : ''}`}>
      <Icon name={phase === 'failed' ? 'x' : 'plug'} size={14} />
      <div className="connector-wait__body">
        <div className="connector-wait__title">
          {service || toolkit} needs to be connected
        </div>
        <div className="connector-wait__note">
          {phase === 'connecting' && 'Open the browser tab that just opened and finish the sign-in. This request resumes on its own the moment it is done.'}
          {phase === 'failed' && 'Still waiting on the sign-in. Press connect to try again, or skip it.'}
          {phase === 'idle' && 'Finishing this request needs this app. Connecting it resumes the request; skipping hands it back as a refused step.'}
        </div>
      </div>
      <div className="connector-wait__actions">
        <HouseButton type="button" className="btn btn--small" onClick={() => handleConnect()} disabled={phase === 'connecting'}>
          {phase === 'connecting' ? 'Waiting…' : phase === 'failed' ? 'Connect again' : 'Connect'}
        </HouseButton>
        <HouseButton type="button" className="btn btn--small btn--ghost" onClick={() => handleDismiss()} disabled={phase === 'connecting'}>
          Skip
        </HouseButton>
      </div>
    </div>
  )
}
