import { safeStorage } from '../lib/storage.js'
import { putRecord, records } from './storage.js'
import {
  getConnectionStatus,
  getGoogleDriveAccessToken,
  refreshGoogleDriveToken,
  markServiceExpired,
} from './connectionStatus.js'

export const MEDIA_STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
  PLACEHOLDER: 'placeholder',
}

// Built-in lightweight SVG placeholders for crisp rendering without external assets
export const PLACEHOLDER_THUMBNAIL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225" width="100%" height="100%">' +
      '<rect width="100%" height="100%" fill="#1c1c1e"/>' +
      '<circle cx="200" cy="112.5" r="28" fill="#2c2c2e"/>' +
      '<path d="M192 100l22 12.5-22 12.5z" fill="#636366"/>' +
      '</svg>'
  )

export const ERROR_THUMBNAIL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 225" width="100%" height="100%">' +
      '<rect width="100%" height="100%" fill="#1c1c1e"/>' +
      '<circle cx="200" cy="112.5" r="24" fill="#3a1c1c"/>' +
      '<path d="M192 104.5l16 16m0-16l-16 16" stroke="#ff453a" stroke-width="3" stroke-linecap="round"/>' +
      '</svg>'
  )

// Memory cache for active session fast access
const memoryCache = new Map()

/**
 * Convert ArrayBuffer / Blob to base64 data URL.
 */
async function bufferToDataUrl(buffer, mimeType = 'image/jpeg') {
  if (typeof Buffer !== 'undefined') {
    const b64 = Buffer.from(buffer).toString('base64')
    return `data:${mimeType};base64,${b64}`
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return `data:${mimeType};base64,${btoa(binary)}`
}

/**
 * Check disk cache (IndexedDB via storage.js) for thumbnail.
 */
export async function getCachedThumbnail(fileId) {
  if (!fileId) return null
  const cacheKey = `thumb_${fileId}`
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey)
  }

  try {
    const recs = await records(cacheKey)
    if (recs && recs.length > 0 && recs[0].value?.data) {
      const data = recs[0].value.data
      memoryCache.set(cacheKey, data)
      return data
    }
  } catch {}

  // Fallback check in safeStorage
  try {
    const fallback = safeStorage.getItem(`amethyst.thumb.${fileId}`)
    if (fallback) {
      memoryCache.set(cacheKey, fallback)
      return fallback
    }
  } catch {}

  return null
}

/**
 * Save thumbnail to disk cache (IndexedDB and safeStorage).
 */
export async function saveCachedThumbnail(fileId, dataUrl) {
  if (!fileId || !dataUrl) return
  const cacheKey = `thumb_${fileId}`
  memoryCache.set(cacheKey, dataUrl)

  try {
    await putRecord(cacheKey, {
      fileId,
      data: dataUrl,
      cachedAt: new Date().toISOString(),
    })
  } catch {}

  try {
    // Only store first 200KB in localStorage fallback to avoid quota
    if (dataUrl.length < 200_000) {
      safeStorage.setItem(`amethyst.thumb.${fileId}`, dataUrl)
    }
  } catch {}
}

/**
 * Clear thumbnail from cache.
 */
export async function clearCachedThumbnail(fileId) {
  const cacheKey = `thumb_${fileId}`
  memoryCache.delete(cacheKey)
  try {
    safeStorage.removeItem(`amethyst.thumb.${fileId}`)
  } catch {}
}

/**
 * Load authenticated thumbnail from Google Drive.
 * Handles disk cache, 401 token refresh retry, and error states.
 */
export async function loadThumbnail({
  fileId,
  url,
  token: initialToken,
  tokenRefresher = refreshGoogleDriveToken,
  fetchFn = (typeof globalThis !== 'undefined' ? globalThis.fetch : null),
  ignoreCache = false,
} = {}) {
  const targetId = fileId || (url ? (url.match(/id=([\w-]+)/) || [])[1] : null)

  // 1. Check disk cache first unless explicitly ignored
  if (!ignoreCache && targetId) {
    const cached = await getCachedThumbnail(targetId)
    if (cached) {
      return {
        src: cached,
        status: MEDIA_STATUS.READY,
        fromCache: true,
      }
    }
  }

  // 2. Resolve request URL
  let requestUrl = url
  if (!requestUrl && targetId) {
    requestUrl = `https://www.googleapis.com/drive/v3/files/${targetId}?alt=media`
  }

  if (!requestUrl) {
    return {
      src: PLACEHOLDER_THUMBNAIL,
      status: MEDIA_STATUS.PLACEHOLDER,
      fromCache: false,
    }
  }

  // Check if network is offline
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      src: ERROR_THUMBNAIL,
      status: MEDIA_STATUS.ERROR,
      error: 'Network offline',
      isOffline: true,
      fromCache: false,
    }
  }

  // 3. Obtain authentication token
  let token = initialToken
  if (!token && !requestUrl.startsWith('data:')) {
    try {
      token = await getGoogleDriveAccessToken()
    } catch {}
  }

  const makeRequest = async (authToken) => {
    const headers = {}
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }
    return await fetchFn(requestUrl, { headers })
  }

  try {
    let response = await makeRequest(token)

    // Handle 401 or 403 token expiry with automatic token refresh
    if (response.status === 401 || response.status === 403) {
      let newToken = null
      if (tokenRefresher) {
        try {
          const refreshRes = await tokenRefresher()
          newToken = refreshRes?.accessToken || refreshRes
        } catch (refErr) {
          await markServiceExpired('googleDrive')
          return {
            src: ERROR_THUMBNAIL,
            status: MEDIA_STATUS.ERROR,
            error: 'Authentication expired',
            authError: true,
            fromCache: false,
          }
        }
      }

      if (newToken) {
        token = newToken
        response = await makeRequest(newToken)
      } else {
        await markServiceExpired('googleDrive')
        return {
          src: ERROR_THUMBNAIL,
          status: MEDIA_STATUS.ERROR,
          error: 'Authentication expired',
          authError: true,
          fromCache: false,
        }
      }
    }

    if (!response.ok) {
      return {
        src: ERROR_THUMBNAIL,
        status: MEDIA_STATUS.ERROR,
        error: `HTTP ${response.status}`,
        fromCache: false,
      }
    }

    const contentType = response.headers?.get?.('content-type') || 'image/jpeg'
    let dataUrl
    if (typeof response.arrayBuffer === 'function') {
      const buf = await response.arrayBuffer()
      dataUrl = await bufferToDataUrl(buf, contentType)
    } else if (typeof response.blob === 'function') {
      const blob = await response.blob()
      if (typeof URL !== 'undefined' && URL.createObjectURL) {
        dataUrl = URL.createObjectURL(blob)
      } else {
        dataUrl = await bufferToDataUrl(await blob.arrayBuffer(), contentType)
      }
    } else {
      dataUrl = PLACEHOLDER_THUMBNAIL
    }

    // Save to disk cache
    if (targetId && dataUrl && !dataUrl.startsWith('blob:')) {
      await saveCachedThumbnail(targetId, dataUrl)
    }

    return {
      src: dataUrl,
      status: MEDIA_STATUS.READY,
      fromCache: false,
    }
  } catch (err) {
    return {
      src: ERROR_THUMBNAIL,
      status: MEDIA_STATUS.ERROR,
      error: err.message || 'Fetch failed',
      fromCache: false,
    }
  }
}

/**
 * Stream video chunks via authenticated alt=media with Range header requests.
 */
export async function fetchVideoRange({
  fileId,
  start = 0,
  end,
  token: initialToken,
  tokenRefresher = refreshGoogleDriveToken,
  fetchFn = (typeof globalThis !== 'undefined' ? globalThis.fetch : null),
} = {}) {
  if (!fileId) throw new Error('fileId is required for video Range requests')

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  let token = initialToken
  if (!token) {
    try {
      token = await getGoogleDriveAccessToken()
    } catch {}
  }

  const rangeHeader = end !== undefined ? `bytes=${start}-${end}` : `bytes=${start}-`

  const makeRequest = async (authToken) => {
    const headers = {
      Range: rangeHeader,
    }
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`
    }
    return await fetchFn(url, { headers })
  }

  let response = await makeRequest(token)

  // 401/403 Expiry refresh retry
  if ((response.status === 401 || response.status === 403) && tokenRefresher) {
    try {
      const refreshRes = await tokenRefresher()
      const newToken = refreshRes?.accessToken || refreshRes
      if (newToken) {
        token = newToken
        response = await makeRequest(newToken)
      }
    } catch (refErr) {
      await markServiceExpired('googleDrive')
      const err = new Error('Video stream authentication expired')
      err.authError = true
      err.status = 401
      throw err
    }
  }

  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`Video Range request failed: HTTP ${response.status}`)
  }

  const contentRange = response.headers?.get?.('content-range') || response.headers?.get?.('Content-Range')
  const contentLength = response.headers?.get?.('content-length') || response.headers?.get?.('Content-Length')
  const contentType = response.headers?.get?.('content-type') || response.headers?.get?.('Content-Type') || 'video/mp4'

  let data
  if (typeof response.blob === 'function') {
    data = await response.blob()
  } else if (typeof response.arrayBuffer === 'function') {
    data = await response.arrayBuffer()
  }

  return {
    status: response.status,
    isPartial: response.status === 206,
    contentRange,
    contentLength: contentLength ? parseInt(contentLength, 10) : null,
    contentType,
    data,
  }
}

/**
 * Resolve poster frame for video item.
 * Falls back through custom stills, Drive thumbnail preview, YouTube/external, and placeholder.
 */
export function resolvePosterFrame(item) {
  if (!item) return PLACEHOLDER_THUMBNAIL

  // 1. Explicit poster or thumbnail path
  if (item.poster_url) return item.poster_url
  if (item.thumbnail_url) return item.thumbnail_url

  // 2. YouTube cover
  if (item.url) {
    const ytMatch = item.url.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([\w-]{11})/)
    if (ytMatch) {
      return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`
    }
  }

  // 3. Google Drive file thumbnail
  if (item.external_id || item.drive_id || item.file_id) {
    const fid = item.external_id || item.drive_id || item.file_id
    return `https://drive.google.com/thumbnail?id=${fid}&sz=w800`
  }

  return PLACEHOLDER_THUMBNAIL
}
