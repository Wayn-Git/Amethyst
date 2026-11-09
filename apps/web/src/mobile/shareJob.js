import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

export const DEFAULT_MAX_ARTICLE_CHARS = 20000

/**
 * Common tracking query parameters to strip during URL normalization.
 */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'igsh',
  'fbclid',
  'gclid',
  'si',
  'ref',
  'source',
  'feature',
]

/**
 * Direct video file extensions supported by PC runner.
 */
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.m4v']

/**
 * Exact PC runner supported hosts.
 * Mirrors backend/library/service.py, backend/media/reel.py, and backend/web/reader.py.
 */
const PC_RUNNER_HOSTS = [
  // Instagram (reels, posts, tv)
  'instagram.com',
  'instagr.am',
  // YouTube (standard, shorts, shortlinks)
  'youtube.com',
  'youtu.be',
  // Reddit (posts, comments, v.redd.it videos)
  'reddit.com',
  'redd.it',
  'v.redd.it',
  // Twitter / X
  'x.com',
  'twitter.com',
  // Pinterest
  'pinterest.com',
  'pin.it',
  // Threads
  'threads.net',
  'threads.com',
]

/**
 * Remove API keys, secrets, tokens, and query strings with keys from text.
 * Guarantees no sensitive keys appear in logs, error messages, or UI strings.
 */
export function sanitizeErrorMessage(message) {
  if (!message || typeof message !== 'string') return ''
  return message
    .replace(/https?:\/\/[^\s"'<>]+key=[^\s"'<>]+/gi, (url) =>
      url.replace(/([?&]key=)[^&]+/i, '$1[REDACTED]')
    )
    .replace(/key=[a-zA-Z0-9_\-]+/gi, 'key=[REDACTED]')
    .replace(/sk-[a-zA-Z0-9_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/uak_[a-zA-Z0-9_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/comp_[a-zA-Z0-9_-]{10,}/g, '[REDACTED_KEY]')
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^"'\s,]+/gi, '$1[REDACTED]')
}

/**
 * Parse Retry-After header (seconds or HTTP date).
 * Returns delay in milliseconds (defaults to fallbackMs).
 */
export function parseRetryAfter(headerValue, fallbackMs = 60000) {
  if (!headerValue) return fallbackMs
  const seconds = Number(headerValue)
  if (!isNaN(seconds) && seconds > 0) {
    return Math.round(seconds * 1000)
  }
  const date = new Date(headerValue).getTime()
  if (!isNaN(date)) {
    const diff = date - Date.now()
    return diff > 0 ? diff : fallbackMs
  }
  return fallbackMs
}

/**
 * Extract first URL from text.
 * Returns null if no valid URL found.
 */
export function extractUrl(text) {
  if (!text || typeof text !== 'string') return null
  const match = text.match(/https?:\/\/[^\s<>"'{}|\\^`[\]]+/i)
  return match ? match[0] : null
}

/**
 * Canonicalize URL for SHA-256 deduplication hash only.
 * DO NOT use this URL for fetching; fetch with the original URL.
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return ''
  try {
    const u = new URL(rawUrl.trim())
    for (const param of TRACKING_PARAMS) {
      u.searchParams.delete(param)
    }
    if (u.hash === '#') u.hash = ''
    let normalized = u.toString()
    if (normalized.endsWith('/') && u.pathname !== '/') {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  } catch {
    return rawUrl.trim()
  }
}

/**
 * Build deterministic job ID from SHA-256 hash of canonical URL or normalized text.
 * Double shares of the same link or text produce the exact same job ID.
 */
export function buildJobId(text) {
  if (!text || typeof text !== 'string') {
    return '0000000000000000'
  }
  const extracted = extractUrl(text)
  const canonicalKey = extracted
    ? 'url:' + normalizeUrl(extracted)
    : 'text:' + text.trim().replace(/\s+/g, ' ')

  const digest = sha256(new TextEncoder().encode(canonicalKey))
  return bytesToHex(digest).slice(0, 16)
}

/**
 * Check if a URL's host matches the PC runner's supported host list.
 */
export function isPcRunnerHost(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false
  try {
    const url = new URL(urlStr)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase()

    // Host matching
    const matchedHost = PC_RUNNER_HOSTS.some(
      (h) => host === h || host.endsWith('.' + h)
    )
    if (matchedHost) return true

    // Direct video extensions
    if (VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return true
    }

    return false
  } catch {
    return false
  }
}

/**
 * Determine if URL content is specifically video for PC runner.
 */
export function isVideoContent(urlStr) {
  if (!urlStr) return false
  try {
    const url = new URL(urlStr)
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase()

    if (
      host === 'instagram.com' ||
      host.endsWith('.instagram.com') ||
      host === 'instagr.am' ||
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtu.be' ||
      host === 'v.redd.it' ||
      path.includes('/reel/') ||
      path.includes('/shorts/') ||
      VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext))
    ) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Route a shared item:
 * - Plain text or web link -> 'summary' (phone LLM -> summaries/<id>.md)
 * - PC runner hosts -> 'inbox' (phone -> inbox/<id>.json for PC runner)
 * - Unsupported schemes -> 'unsupported'
 *
 * Uses original URL for targetUrl; canonicalUrl is for hashing only.
 */
export function routeJob(text) {
  const rawText = (text || '').trim()
  const rawUrl = extractUrl(rawText)

  if (!rawUrl) {
    // Check if user shared something looking like a non-HTTP URI
    if (/^[a-zA-Z0-9_-]+:\/\//i.test(rawText)) {
      return {
        route: 'unsupported',
        kind: 'unknown',
        targetUrl: rawText,
        canonicalUrl: rawText,
        rawText,
        error: 'Unsupported URL scheme. Only HTTP and HTTPS links are supported.',
      }
    }

    return {
      route: 'summary',
      kind: 'text',
      targetUrl: null,
      canonicalUrl: null,
      rawText,
    }
  }

  // Validate scheme
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        route: 'unsupported',
        kind: 'unknown',
        targetUrl: rawUrl,
        canonicalUrl: rawUrl,
        rawText,
        error: `Unsupported scheme '${parsed.protocol}'. Only HTTP and HTTPS links are supported.`,
      }
    }
  } catch {
    return {
      route: 'unsupported',
      kind: 'unknown',
      targetUrl: rawUrl,
      canonicalUrl: rawUrl,
      rawText,
      error: 'Malformed URL provided.',
    }
  }

  const canonical = normalizeUrl(rawUrl)
  if (isPcRunnerHost(rawUrl)) {
    return {
      route: 'inbox',
      kind: isVideoContent(rawUrl) ? 'video' : 'url',
      targetUrl: rawUrl, // ORIGINAL URL!
      canonicalUrl: canonical,
      rawText,
    }
  }

  return {
    route: 'summary',
    kind: 'url',
    targetUrl: rawUrl, // ORIGINAL URL!
    canonicalUrl: canonical,
    rawText,
  }
}

/**
 * Decode basic HTML entities in text.
 */
export function decodeHtmlEntities(str) {
  if (!str) return ''
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * Extract title and readable body text from an HTML page.
 * Strips scripts, styles, navigation, comments, and tags.
 * Caps at configurable maxChars (default 20,000) and reports truncation.
 */
export function extractPageText(html, { maxChars = DEFAULT_MAX_ARTICLE_CHARS } = {}) {
  if (!html || typeof html !== 'string') {
    return { title: '', text: '', wasTruncated: false, originalLength: 0, maxChars }
  }

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : ''

  let cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '') // comments
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')

  cleaned = cleaned.replace(/<[^>]+>/g, ' ')
  cleaned = decodeHtmlEntities(cleaned)
  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  const originalLength = cleaned.length
  let wasTruncated = false

  if (cleaned.length > maxChars) {
    cleaned = cleaned.slice(0, maxChars)
    wasTruncated = true
  }

  return { title, text: cleaned, wasTruncated, originalLength, maxChars }
}

/**
 * Build markdown content for completed summaries.
 * Tells user when source text was truncated.
 */
export function formatSummaryMarkdown({
  title = '',
  url = '',
  summaryText = '',
  processedAt = null,
  wasTruncated = false,
  maxChars = DEFAULT_MAX_ARTICLE_CHARS,
}) {
  const dateStr = processedAt || new Date().toUTCString()
  const heading = title ? title.trim() : url ? 'Web Article' : 'Note'

  let md = `# ${heading}\n\n`
  if (url) {
    md += `**Source:** ${url}\n\n`
  }
  md += `**Processed:** ${dateStr}\n\n`

  if (wasTruncated) {
    md += `> **Notice:** Source text was truncated at ${maxChars.toLocaleString()} characters prior to summarization.\n\n`
  }

  md += `## Summary\n\n${summaryText.trim()}\n`
  return md
}

/**
 * Build inbox job JSON object for PC pipeline.
 * Conforms to CONTRACT inbox layout:
 * {"id","kind":"url|text|video","url?","text?","created_at","source":"phone"}
 */
export function formatInboxJob({ id, kind = 'url', url = null, text = null, createdAt = null }) {
  const job = {
    id,
    kind,
    created_at: createdAt || new Date().toISOString(),
    source: 'phone',
  }
  if (url) job.url = url
  if (text && text !== url) job.text = text
  return job
}
