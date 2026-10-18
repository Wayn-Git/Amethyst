/**
 * Utilities for partitioning library items into curated editorial shelves.
 * 
 * Shelf categories:
 * - jumpBackIn: Items currently syncing/enriching or captured within the last 48 hours.
 * - essential: Items rated 5 stars or marked as high-value essential reference.
 * - media: Video, Reels, TikTok, podcasts, audio items.
 * - reading: Articles, documentation, newsletters, GitHub repos, and notes.
 */

export function partitionLibraryShelves(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return {
      jumpBackIn: [],
      essential: [],
      media: [],
      reading: [],
    }
  }

  const now = Date.now()
  const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000

  const jumpBackIn = []
  const essential = []
  const media = []
  const reading = []

  const essentialIds = new Set()

  // 1. First pass: Identify fresh / in-flight items and essential 5-star items
  for (const item of items) {
    if (!item) continue

    const isProcessing = Boolean(
      item.isProcessing ||
      item.status === 'processing' ||
      item.status === 'enriching' ||
      item.status === 'received' ||
      item.isOptimistic
    )
    const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0
    const isRecent = createdAt > 0 && (now - createdAt) < FORTY_EIGHT_HOURS_MS

    if ((isProcessing || isRecent) && jumpBackIn.length < 6) {
      jumpBackIn.push(item)
    }

    if (item.rating === 5 && essential.length < 4) {
      essential.push(item)
      essentialIds.add(item.id)
    }
  }

  // 2. Second pass: Partition remaining non-essential items into Media vs Reading
  for (const item of items) {
    if (!item || essentialIds.has(item.id)) continue

    const url = (item.url || '').toLowerCase()
    const app = item.app || ''
    const kind = item.kind || ''

    const isVideo = (
      kind === 'video' ||
      app === 'youtube' ||
      app === 'tiktok' ||
      url.includes('/reel/') ||
      url.includes('/reels/') ||
      url.includes('/shorts/') ||
      url.includes('youtube.com') ||
      url.includes('youtu.be') ||
      Boolean(item.duration_seconds && item.duration_seconds > 0)
    )

    const isAudio = (
      kind === 'music' ||
      kind === 'podcast' ||
      app === 'spotify' ||
      url.includes('spotify.com') ||
      url.includes('apple.com/music') ||
      url.includes('soundcloud.com')
    )

    if (isVideo || isAudio) {
      if (media.length < 8) {
        media.push(item)
      }
    } else {
      if (reading.length < 9) {
        reading.push(item)
      }
    }
  }

  return {
    jumpBackIn,
    essential,
    media,
    reading,
  }
}
