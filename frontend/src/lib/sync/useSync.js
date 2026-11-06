/**
 * The phone's poll, as a hook.
 *
 * Only runs where there is no backend to talk to. A machine running its own
 * server syncs through `RelayPoller` in Python, which is already polling for
 * other reasons; a second poll from the browser on the same machine would be
 * two devices' worth of requests for one device.
 *
 * Paused completely when the tab is hidden (phone screen off), protecting
 * battery life and strictly capping Cloudflare D1 free-tier quota usage.
 */

import { useEffect, useState } from 'react'
import { paired, projectPreferences, queued, sync } from './client.js'

/** Matches the machine's own relay poll. Convergence is one poll either way. */
export const IDLE_MS = 30_000

/**
 * While something is actually in flight -- a request queued, or a turn running
 * on the machine -- the phone asks more often.
 */
export const ACTIVE_MS = 3_000

export const BACKOFF_MIN_MS = 2_000
export const BACKOFF_MAX_MS = 60_000

/**
 * Calculate the next interval based on queue, turn activity, and failure backoff.
 */
export function calculateNextInterval({ queuedCount = 0, applied = 0, synced = true, consecutiveErrors = 0 } = {}) {
  if (consecutiveErrors > 0 || !synced) {
    const exponent = Math.min(consecutiveErrors, 6)
    const base = Math.min(BACKOFF_MIN_MS * Math.pow(2, exponent - 1), BACKOFF_MAX_MS)
    // Add 0-25% jitter
    const jitter = Math.floor(Math.random() * (base * 0.25))
    return Math.min(base + jitter, Math.floor(BACKOFF_MAX_MS * 1.25))
  }

  if (queuedCount > 0 || applied > 0) {
    return ACTIVE_MS
  }

  return IDLE_MS
}

export function useSync(enabled, onPreferences) {
  const [last, setLast] = useState(null)

  useEffect(() => {
    if (!enabled || !paired()) return undefined

    let stopped = false
    let timer = null
    let isPolling = false
    let consecutiveErrors = 0

    const clearSchedule = () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }

    const scheduleNext = (delayMs) => {
      if (stopped) return
      clearSchedule()
      // Never schedule a background timer if page is hidden
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      timer = setTimeout(tick, delayMs)
    }

    const tick = async () => {
      if (stopped || isPolling) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        clearSchedule()
        return
      }

      isPolling = true
      let result
      try {
        result = await sync()
      } catch (err) {
        result = { synced: false, reason: err.message }
      } finally {
        isPolling = false
      }

      if (stopped) return

      if (result.synced) {
        consecutiveErrors = 0
      } else {
        consecutiveErrors += 1
      }

      const nextDelay = calculateNextInterval({
        queuedCount: queued(),
        applied: result.applied || 0,
        synced: result.synced,
        consecutiveErrors,
      })

      scheduleNext(nextDelay)
      setLast(result)

      if (!result.synced && result.reason) {
        window.dispatchEvent(new CustomEvent('amethyst:sync-failed', { detail: result }))
      }

      if (result.synced && result.applied) {
        const changed = projectPreferences()
        if (Object.keys(changed).length) onPreferences?.(changed)
        window.dispatchEvent(new CustomEvent('amethyst:synced', { detail: result }))
      }
    }

    // Immediate first tick on mount
    tick()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Screen turned back on: reset error backoff and wake poll immediately
        consecutiveErrors = 0
        tick()
      } else {
        // Screen turned off: abort any pending timers immediately to save battery & D1 quota
        clearSchedule()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', tick)

    return () => {
      stopped = true
      clearSchedule()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', tick)
    }
  }, [enabled, onPreferences])

  return last
}
