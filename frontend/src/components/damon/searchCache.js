/**
 * Memory for the palette's external searches.
 *
 * Typing re-asks: a corrected typo retypes the word that was just deleted, a
 * palette closed and reopened asks the same thing again, and the web strip
 * under a question is the same search the web mode would run. Every one of
 * those used to pay the full scrape price for bytes the last keystroke already
 * bought. This is the other half of the answer to "make it feel instant":
 * a fresh entry paints with no request at all, and a stale one paints right
 * away while the network refills it behind the next keystroke.
 *
 * Kept outside React on purpose. Search results are meant to survive the
 * palette closing, and an unmount is exactly when they used to be lost.
 */

const FRESH_MS = 4 * 60 * 1000
const STALE_MS = 30 * 60 * 1000
const MAX = 160

const store = new Map()

const keyFor = (kind, q) => `${kind}:${q.trim().toLowerCase()}`

/** The stored answer for a query, or null. `fresh` means trust it outright;
 *  a stale hit is worth painting now and refreshing behind. */
export function peek(kind, q) {
  const key = keyFor(kind, q)
  const hit = store.get(key)
  if (!hit) return null
  const age = Date.now() - hit.at
  if (age > STALE_MS) {
    store.delete(key)
    return null
  }
  return { value: hit.value, fresh: age < FRESH_MS }
}

/** Remember an answer. An empty list or null is stored too -- the engine
 *  really did say nothing, and re-asking it every keystroke is how a
 *  rate limit turns into a cooldown. */
export function put(kind, q, value) {
  const key = keyFor(kind, q)
  store.set(key, { at: Date.now(), value })
  if (store.size > MAX) {
    // Map iterates in insertion order, so the first key is the oldest entry.
    const oldest = store.keys().next().value
    if (oldest !== undefined && oldest !== key) store.delete(oldest)
  }
}
