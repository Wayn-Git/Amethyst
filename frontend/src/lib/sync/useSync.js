/**
 * The phone's poll, as a hook.
 *
 * Only runs where there is no backend to talk to. A machine running its own
 * server syncs through `RelayPoller` in Python, which is already polling for
 * other reasons; a second poll from the browser on the same machine would be
 * two devices' worth of requests for one device.
 *
 * Paused when the tab is hidden, like every other poll in this interface. A
 * phone spends most of its life with the screen off, and a timer that kept
 * running there would spend the battery and the relay's free tier on nothing.
 */

import { useEffect, useState } from 'react'

import { paired, projectPreferences, queued, sync } from './client.js'

/** Matches the machine's own relay poll. Convergence is one poll either way. */
const IDLE_MS = 15_000

/**
 * While something is actually in flight -- a request queued, or a turn running
 * on the machine -- the phone asks more often, because that is the only time
 * the difference is visible to anyone.
 *
 * This is deliberately chosen over the Durable Object and WebSocket that would
 * make it genuinely live. That is the upgrade named in ADR-0024 and the trigger
 * for taking it is not "the poll could be faster": a socket is a second
 * transport, a hibernation model and a reconnect path to keep correct, and the
 * machine at the other end still only publishes on *its* fifteen-second poll --
 * so a socket on this side alone would buy a fraction of the latency for all of
 * the complexity. Bursty, and only while someone is watching, keeps the
 * free-tier promise in relay/README.md: this rate sustained by one device would
 * be about 29,000 requests a day, and it is not sustained.
 */
const ACTIVE_MS = 3_000

export function useSync(enabled, onPreferences) {
  const [last, setLast] = useState(null)

  useEffect(() => {
    if (!enabled || !paired()) return undefined

    let stopped = false
    let timer = null
    let interval = IDLE_MS

    const reschedule = (next) => {
      if (stopped || next === interval) return
      interval = next
      clearInterval(timer)
      timer = setInterval(tick, interval)
    }

    const tick = async () => {
      if (stopped || document.visibilityState === 'hidden') return
      const result = await sync()
      if (stopped) return
      // Busy while this device is still owed a send, or the machine is mid-turn
      // -- the two cases where somebody is looking at the screen waiting.
      reschedule(queued() > 0 || result.applied ? ACTIVE_MS : IDLE_MS)
      setLast(result)
      /* A poll that did not happen is worth announcing too.
       *
       * Most reasons are transient and the status line is the right place for
       * them, but `revoked` is not a poll that will work later -- it is the end
       * of this pairing, decided on the machine, and this is the only moment
       * this device can learn about it. Broadcast rather than returned, because
       * the view that has to act on it is not the one that owns this poll. */
      if (!result.synced && result.reason) {
        window.dispatchEvent(new CustomEvent('amethyst:sync-failed', { detail: result }))
      }
      if (result.synced && result.applied) {
        const changed = projectPreferences()
        if (Object.keys(changed).length) onPreferences?.(changed)
        // The replica is a plain object in localStorage, not React state, so
        // nothing re-renders because it changed. An event rather than a shared
        // store because exactly one view reads it and a store would be a
        // subscription mechanism built for a single subscriber.
        window.dispatchEvent(new CustomEvent('amethyst:synced', { detail: result }))
      }
    }

    // Once on mount, so opening the app shows what changed while it was closed
    // rather than making the user wait out a full interval for it.
    tick()
    // `interval`, not a constant: `reschedule` above returns early when the
    // rate has not changed, so on the idle path it never creates the first
    // timer. This is the one that has to exist.
    timer = setInterval(tick, interval)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, onPreferences])

  return last
}
