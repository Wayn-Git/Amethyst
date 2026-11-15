import React, { useState, useEffect } from 'react'
import { initializeCredentials } from '../lib/credentials.js'
import { getAuthToken } from '../api.js'
import { getResolvedBase } from './views/MobileLibrary.jsx'

export const thumbnailBlobCache = new Map()
const MAX_BLOB_CACHE = 150
let hasLoggedFirstThumbnail = false
let hasLoggedColdStartToken = false

/**
 * Fetch thumbnail from PC host with Authorization header, converting blob to an object URL.
 * Never renders raw <img src="http://...">.
 */
export async function fetchHostThumbnail(itemId, hostBase) {
  if (!itemId || !hostBase) return null
  if (thumbnailBlobCache.has(itemId)) {
    return thumbnailBlobCache.get(itemId)
  }
  try {
    await initializeCredentials()
    const token = getAuthToken()
    if (!hasLoggedFirstThumbnail) {
      hasLoggedFirstThumbnail = true
      console.log(`[thumbnail] host thumbnail request for item ${itemId}, token present: ${Boolean(token)} (len: ${token ? token.length : 0})`)
    }
    if (!token) {
      return null
    }

    const cleanHost = hostBase.replace(/\/+$/, '')
    const url = `${cleanHost}/api/library/${itemId}/thumbnail`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Amethyst-Device-Token': token,
      },
    })
    if (!res.ok) return null

    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)

    // LRU eviction
    if (thumbnailBlobCache.size >= MAX_BLOB_CACHE) {
      const firstEntry = thumbnailBlobCache.entries().next().value
      if (firstEntry) {
        URL.revokeObjectURL(firstEntry[1])
        thumbnailBlobCache.delete(firstEntry[0])
      }
    }
    thumbnailBlobCache.set(itemId, blobUrl)
    return blobUrl
  } catch (err) {
    return null
  }
}

/**
 * Hook to resolve thumbnail according to the 4-tier order:
 * 1. data: URL (240px WebP, 8-15KB)
 * 2. Local file
 * 3. PC host (only if paired): fetch with Auth header -> blob object URL
 * 4. Placeholder (returns null)
 */
export function useItemThumbnail(item) {
  if (!hasLoggedColdStartToken && item) {
    hasLoggedColdStartToken = true
    initializeCredentials().then(() => {
      const token = getAuthToken()
      console.log(`[thumbnail] cold-start thumbnail request for item ${item.id || item.title || 'item'}, token present: ${Boolean(token)} (len: ${token ? token.length : 0})`)
    })
  }

  const [thumbSrc, setThumbSrc] = useState(() => {
    if (!item) return null
    // 1. data: URL
    if (item.thumbnail_url?.startsWith('data:')) return item.thumbnail_url
    // 2. Local file
    if (item.local_thumbnail) return item.local_thumbnail
    if (item.thumbnail_path?.startsWith('file:')) return item.thumbnail_path
    // Check blob cache
    if (item.id && thumbnailBlobCache.has(item.id)) return thumbnailBlobCache.get(item.id)
    // Remote absolute URL
    if (item.thumbnail_url && (item.thumbnail_url.startsWith('http://') || item.thumbnail_url.startsWith('https://')) && !item.thumbnail_url.includes('localhost') && !item.thumbnail_url.includes('127.0.0.1')) {
      return item.thumbnail_url
    }
    // Host thumbnail URL fallback
    if (item.id && (item.has_thumbnail || item.thumbnail_path || item.thumbnail_url)) {
      try {
        const u = api?.thumbnailUrl?.(item.id)
        if (u) return u
      } catch {}
    }
    return null
  })

  useEffect(() => {
    if (!item) {
      setThumbSrc(null)
      return
    }

    // 1. data: URL
    if (item.thumbnail_url?.startsWith('data:')) {
      setThumbSrc(item.thumbnail_url)
      return
    }

    // 2. Local file
    if (item.local_thumbnail) {
      setThumbSrc(item.local_thumbnail)
      return
    }
    if (item.thumbnail_path?.startsWith('file:')) {
      setThumbSrc(item.thumbnail_path)
      return
    }

    // Remote absolute URL
    if (item.thumbnail_url && (item.thumbnail_url.startsWith('http://') || item.thumbnail_url.startsWith('https://')) && !item.thumbnail_url.includes('localhost') && !item.thumbnail_url.includes('127.0.0.1')) {
      setThumbSrc(item.thumbnail_url)
      return
    }

    // 3. PC host (only if paired)
    let active = true
    const hostBase = getResolvedBase?.() || ''
    if (hostBase && item.id) {
      if (thumbnailBlobCache.has(item.id)) {
        setThumbSrc(thumbnailBlobCache.get(item.id))
        return
      }
      fetchHostThumbnail(item.id, hostBase).then((url) => {
        if (active && url) {
          setThumbSrc(url)
        }
      })
    } else if (item.id && (item.has_thumbnail || item.thumbnail_path || item.thumbnail_url)) {
      try {
        const u = api?.thumbnailUrl?.(item.id)
        if (u && active) setThumbSrc(u)
      } catch {}
    }

    return () => {
      active = false
    }
  }, [item?.id, item?.thumbnail_url, item?.local_thumbnail, item?.thumbnail_path])

  return thumbSrc
}

/**
 * Thumbnail renderer component enforcing the 4-tier resolution and safe rendering.
 */
export function LibraryThumbnail({ item, alt, style, className }) {
  const src = useItemThumbnail(item)
  const [error, setError] = useState(false)

  useEffect(() => {
    setError(false)
  }, [src])

  if (!src || error) return null

  return React.createElement('img', {
    src,
    alt: alt || item?.title || '',
    loading: 'lazy',
    className,
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      zIndex: 1,
      ...style,
    },
    onError: () => {
      setError(true)
    },
  })
}
