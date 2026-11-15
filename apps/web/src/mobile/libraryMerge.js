/**
 * Merge a freshly pulled library list with cards the user just created.
 *
 * A created card has a server id, so it is not `is_optimistic`. Without this
 * guard the first stale sync response drops it and the card only returns on a
 * later sync — the "processing disappears and comes back" bug.
 */
export function mergeOptimisticItems(currentItems, incomingItems) {
  if (!incomingItems || !incomingItems.length) return currentItems || []
  const now = Date.now()
  const ageMs = (item) => {
    const ts = new Date(item.created_at).getTime()
    return Number.isFinite(ts) ? now - ts : Infinity
  }
  const recentPending = (currentItems || []).filter((it) => {
    if (it.is_optimistic) return ageMs(it) < 120000
    const pending = it.status === 'processing' || it.status === 'pending' || it.status === 'received' || it.status === 'enriching'
    return pending && ageMs(it) < 600000
  })
  if (!recentPending.length) return incomingItems

  // Drop a pending card as soon as the sync response carries the same item.
  const unmerged = recentPending.filter(
    (opt) => !incomingItems.some((inc) => (inc.url && opt.url && inc.url === opt.url) || inc.id === opt.id)
  )
  return [...unmerged, ...incomingItems]
}
