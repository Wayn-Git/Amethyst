import { httpGet } from './nativeHttp.js'

/**
 * Extract Instagram shortcode from any Instagram post, reel, or TV URL.
 * Handles query strings, tracking params, and various path permutations.
 */
export function extractInstagramShortcode(url) {
  if (!url || typeof url !== 'string') return null
  const match = url.match(/(?:instagram\.com|instagr\.am)\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/i)
  return match ? match[1] : null
}

/**
 * Parse Instagram embed HTML payload to extract structured media metadata.
 * Prioritizes window.__contextJSON, then regex JSON fallbacks, then HTML DOM markers.
 */
export function parseInstagramEmbedHtml(html, shortcode) {
  if (!html || typeof html !== 'string') {
    return {
      status: 'error',
      error: 'Empty or invalid HTML response',
      shortcode,
    }
  }

  let media = null

  // 1. Primary Strategy: Extract s.handle() contextJSON
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []
  for (const scriptTag of scripts) {
    if (scriptTag.includes('contextJSON')) {
      const handleIdx = scriptTag.indexOf('s.handle(')
      if (handleIdx !== -1) {
        const raw = scriptTag.slice(handleIdx + 's.handle('.length)
        // Find JSON boundary or use regex extraction
        const contextMatch = raw.match(/"contextJSON"\s*:\s*("(?:\\.|[^"\\])*")/i)
        if (contextMatch && contextMatch[1]) {
          try {
            const unescaped = JSON.parse(contextMatch[1])
            const inner = JSON.parse(unescaped)
            media = inner?.gql_data?.shortcode_media
            if (media) break
          } catch {
            // Continue to fallback
          }
        }
      }
    }
  }

  // 2. Secondary Strategy: Regex match for shortcode_media object
  if (!media) {
    const directMatch = html.match(/"shortcode_media"\s*:\s*(\{[\s\S]*?\})\s*,\s*"hostname"/i)
    if (directMatch && directMatch[1]) {
      try {
        media = JSON.parse(directMatch[1])
      } catch {
        // Fallback
      }
    }
  }

  // If structured JSON was found, build the normalized extraction result
  if (media) {
    const typeName = media.__typename || (media.is_video ? 'GraphVideo' : 'GraphImage')
    const isVideo = Boolean(media.is_video)
    const captionEdges = media.edge_media_to_caption?.edges || []
    const caption = captionEdges[0]?.node?.text || ''
    
    // Music attribution
    const musicInfo = media.clips_music_attribution_info || null
    let music = null
    if (musicInfo) {
      music = {
        songName: musicInfo.song_name || null,
        artistName: musicInfo.artist_name || null,
        usesOriginalAudio: Boolean(musicInfo.uses_original_audio),
        shouldMuteAudio: Boolean(musicInfo.should_mute_audio),
      }
    }

    // Owner metadata (Zero CDN URL persistence for profilePic)
    const owner = {
      id: media.owner?.id || null,
      username: media.owner?.username || null,
      fullName: media.owner?.full_name || null,
      profilePic: null,
    }

    // Carousel children
    const sidecarEdges = media.edge_sidecar_to_children?.edges || []
    const sidecarChildren = sidecarEdges.map((e) => {
      const node = e.node || {}
      return {
        id: node.id || null,
        mediaType: node.__typename === 'GraphVideo' || node.is_video ? 'video' : 'image',
        displayUrl: node.display_url || null,
        videoUrl: node.video_url || null,
      }
    })

    const directVideoUrl = media.video_url || null
    const thumbnailUrl = media.display_url || null

    let mediaType = 'image'
    if (typeName === 'GraphSidecar' || sidecarChildren.length > 0) {
      mediaType = 'sidecar'
    } else if (isVideo || typeName === 'GraphVideo') {
      mediaType = 'video'
    }

    let status = 'ready'
    if (mediaType === 'video' && !directVideoUrl) {
      // Commercial music licensing suppressed direct CDN URL on unauthenticated embed
      status = 'needs_tier2'
    }

    return {
      status,
      shortcode: media.shortcode || shortcode,
      mediaType,
      isVideo,
      caption,
      owner,
      music,
      videoUrl: directVideoUrl,
      thumbnailUrl,
      sidecarChildren,
      duration: media.video_duration || null,
      dimensions: media.dimensions || null,
    }
  }

  // 3. Fallback: Parse basic HTML tags when contextJSON is null (e.g. age-gated/logged-out UI)
  const captionMatch = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i)
  const usernameMatch = html.match(/<a class="CaptionUsername"[^>]*>([^<]+)<\/a>/i)
  const imgMatch = html.match(/<img class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i)

  if (captionMatch || usernameMatch || imgMatch) {
    const rawCaption = captionMatch ? captionMatch[1].replace(/<[^>]+>/g, '').trim() : ''
    return {
      status: 'ready_partial',
      shortcode,
      mediaType: 'unknown',
      isVideo: false,
      caption: rawCaption,
      owner: {
        username: usernameMatch ? usernameMatch[1].trim() : null,
      },
      music: null,
      videoUrl: null,
      thumbnailUrl: imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : null,
      sidecarChildren: [],
    }
  }

  // If page contains explicit unavailable/removed markers
  return {
    status: 'unavailable',
    shortcode,
    error: 'Post unavailable, restricted, or removed',
    caption: '',
    owner: null,
    music: null,
    videoUrl: null,
    thumbnailUrl: null,
    sidecarChildren: [],
  }
}

/**
 * Tier 1 Instagram Extractor:
 * Native HTTP GET request to /p/{code}/embed/captioned/ using CapacitorHttp.
 */
export async function extractInstagramTier1(url, { http = httpGet } = {}) {
  const shortcode = extractInstagramShortcode(url)
  if (!shortcode) {
    return {
      status: 'error',
      error: 'Invalid Instagram URL or shortcode missing',
      shortcode: null,
    }
  }

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept-Language': 'en-US,en;q=0.9',
  }

  try {
    const res = await http({
      url: embedUrl,
      headers,
    })

    if (res.status === 404) {
      return {
        status: 'unavailable',
        shortcode,
        error: 'Instagram post not found (404)',
      }
    }

    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
    const result = parseInstagramEmbedHtml(html, shortcode)
    result.embedUrl = embedUrl
    result.originalUrl = url
    return result
  } catch (err) {
    return {
      status: 'error',
      shortcode,
      error: `Tier 1 HTTP fetch failed: ${err.message}`,
    }
  }
}

