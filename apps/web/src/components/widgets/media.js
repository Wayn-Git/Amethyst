/* What a media item is allowed to become on screen.
 *
 * Mirrors `backend/agent/media.py`, and deliberately does not trust it. The
 * backend already worked out the embed URL, but the payload reaches this file
 * through the message transcript -- so the URL that ends up in an `<iframe
 * src>` is derived here, from the item's own link, by the same strict rules.
 * A crafted envelope can then put a wrong *video* on screen, which is a bad
 * answer; it cannot put an arbitrary page in a frame, which would be a hole.
 *
 * React-free so it can be tested under bare node, like `envelope.js`. */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com',
  'music.youtube.com', 'youtu.be', 'www.youtu.be',
])

const PLAYABLE = ['.mp4', '.webm', '.ogg', '.ogv', '.m4v']

/** The YouTube video id in `url`, or null. */
export function youtubeId(url) {
  if (!url) return null
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  // `hostname` is the parsed host, so `youtube.com.evil.test` is not a match.
  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null

  let candidate = null
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parsed.hostname.toLowerCase().endsWith('youtu.be')) {
    candidate = parts[0]
  } else if (parsed.pathname === '/watch') {
    candidate = parsed.searchParams.get('v')
  } else if (parts.length >= 2 && ['embed', 'shorts', 'v', 'live'].includes(parts[0])) {
    candidate = parts[1]
  }

  return candidate && YOUTUBE_ID.test(candidate) ? candidate : null
}

/** The official embed URL for an id this module validated. */
export function embedUrl(id) {
  return `https://www.youtube-nocookie.com/embed/${id}`
}

/** Whether a browser can be expected to play this in a `<video>`. */
export function isPlayable(url) {
  if (!url) return false
  try {
    const path = new URL(url).pathname.toLowerCase()
    return PLAYABLE.some((ext) => path.endsWith(ext))
  } catch {
    return false
  }
}

/** Whether this is a URL worth putting in front of the browser at all.
 *
 * The backend checked these against its own SSRF rules already; this is the
 * cheap scheme check that stops a `javascript:` thumbnail from a crafted
 * transcript ever reaching an attribute. */
export function isSafe(url) {
  if (!url) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** One media item, resolved to how it should actually render.
 *
 * Returns null for anything unrenderable, so a bad entry costs its own card
 * rather than the gallery. */
export function normalise(item) {
  if (!item || !isSafe(item.url)) return null

  const base = {
    title: item.title || item.url,
    url: item.url,
    source: item.source || '',
    thumbnail: isSafe(item.thumbnail) ? item.thumbnail : null,
    license: item.license || '',
    snippet: item.snippet || '',
    duration: item.duration || '',
  }

  // A YouTube link gets a player whatever the backend called it, and nothing
  // gets a player that is not one.
  const id = youtubeId(item.url)
  if (id) return { ...base, kind: 'youtube', embed: embedUrl(id) }

  const direct = isSafe(item.direct_url) ? item.direct_url : null
  if (item.kind === 'image' && direct) return { ...base, kind: 'image', direct }
  if (direct && isPlayable(direct)) return { ...base, kind: 'video', direct }
  if (isPlayable(item.url)) return { ...base, kind: 'video', direct: item.url }

  // Everything else is a link, which is the honest fallback: a card that says
  // what this is and goes there, rather than a broken player.
  return { ...base, kind: 'link' }
}

/** The renderable items in `media`, in order. */
export function normaliseAll(media) {
  if (!Array.isArray(media)) return []
  return media.map(normalise).filter(Boolean)
}
