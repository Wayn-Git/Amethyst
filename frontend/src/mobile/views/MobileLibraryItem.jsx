import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, appendAuthToken, getBase, copyText } from '../../api.js'
import { safeStorage } from '../../lib/storage.js'
import Markdown from '../../components/markdown/Markdown.jsx'
import Icon from '../../components/Icon.jsx'

function getResolvedBase() {
  const base = getBase().replace(/\/api$/, '')
  if (base) return base
  try {
    const pcHost = safeStorage.getItem('amethyst.pc_host')
    if (pcHost && !pcHost.includes('localhost')) {
      return pcHost.replace(/\/+$/, '')
    }
  } catch {}
  return ''
}

function getItemDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function getAppFromItem(item) {
  if (item?.app) return item.app
  const url = (item?.url || '').toLowerCase()
  if (url.includes('pinterest.') || url.includes('pin.it')) return 'pinterest'
  if (url.includes('youtube.') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('instagram.') || url.includes('instagr.am')) return 'instagram'
  if (url.includes('threads.net') || url.includes('threads.com')) return 'threads'
  if (url.includes('tiktok.')) return 'tiktok'
  if (url.includes('x.com') || url.includes('twitter.')) return 'x'
  if (url.includes('github.')) return 'github'
  if (url.includes('reddit.')) return 'reddit'
  if (url.includes('spotify.')) return 'spotify'
  return null
}

export default function MobileLibraryItem({ item, onBack, onAskAgent, onDeleteItem }) {
  const [detailItem, setDetailItem] = useState(item)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [tab, setTab] = useState('overview') // 'overview' | 'links' | 'notes'
  const [isPlaying, setIsPlaying] = useState(false)
  const [useEmbedFallback, setUseEmbedFallback] = useState(false)
  const [isFavorited, setIsFavorited] = useState(Boolean(item?.favorited || item?.starred || item?.is_pinned))
  const [enriching, setEnriching] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [toastNotice, setToastNotice] = useState('')
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

  const [tags, setTags] = useState(
    Array.isArray(item?.tags) && item.tags.length > 0
      ? item.tags
      : ['ai', 'tools', 'references']
  )
  const [privateNote, setPrivateNote] = useState(item?.private_notes || '')
  const [savingNote, setSavingNote] = useState(false)

  const showToast = (msg) => {
    setToastNotice(msg)
    setTimeout(() => setToastNotice(''), 3000)
  }

  useEffect(() => {
    let unmounted = false
    async function fetchDetail() {
      if (!item?.id && !item?.uuid) return
      setLoadingDetail(true)
      try {
        const full = await api.libraryItem(item.id || item.uuid)
        if (!unmounted && full) {
          setDetailItem(full)
          if (Array.isArray(full.tags)) setTags(full.tags)
          if (full.private_notes) setPrivateNote(full.private_notes)
          if (full.is_pinned !== undefined || full.favorited !== undefined) {
            setIsFavorited(Boolean(full.is_pinned || full.favorited))
          }
        }
      } catch (err) {
        console.warn('[MobileLibraryItem] Fetch failed:', err.message)
      } finally {
        if (!unmounted) setLoadingDetail(false)
      }
    }
    fetchDetail()
    return () => {
      unmounted = true
    }
  }, [item?.id, item?.uuid])

  const activeItem = detailItem || item
  const title = activeItem?.title || 'Untitled Item'
  const app = getAppFromItem(activeItem)
  const author = activeItem?.author || activeItem?.channel || getItemDomain(activeItem?.url) || 'Amethyst'
  const kind = activeItem?.kind ? activeItem.kind.charAt(0).toUpperCase() + activeItem.kind.slice(1) : 'Resource'
  const duration = activeItem?.duration || activeItem?.reading_time || (activeItem?.duration_seconds ? `${Math.round(activeItem.duration_seconds)}s` : '')

  const isPost = activeItem?.kind === 'post' ||
    ['x', 'twitter', 'threads', 'reddit'].includes(app) ||
    Boolean(activeItem?.url && /x\.com|twitter\.com|threads\.net|threads\.com|reddit\.com/i.test(activeItem.url))

  const parsedResources = useMemo(() => {
    let res = activeItem?.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    return Array.isArray(res) ? res : []
  }, [activeItem?.resources])

  // Extract author avatar
  const authorAvatar = useMemo(() => {
    const avatarRes = parsedResources.find((r) => r && r.type === 'avatar')
    if (avatarRes?.url) return avatarRes.url
    if (app === 'x' && activeItem?.author) {
      const handle = activeItem.author.replace(/.*@([A-Za-z0-9_]+).*/, '$1')
      if (handle && handle !== activeItem.author) return `https://unavatar.io/x/${handle}`
    }
    if (app === 'github' && activeItem?.author) {
      return `https://github.com/${activeItem.author.replace(/^@/, '')}.png?size=64`
    }
    return null
  }, [parsedResources, app, activeItem?.author])

  // Multi-image slides / photos
  const slides = useMemo(() => {
    const hostBase = getResolvedBase()
    return parsedResources
      .filter((r) => r && typeof r === 'object' && (r.type === 'slide' || r.type === 'image'))
      .map((s, idx) => {
        const slideIdx = s.index !== undefined ? s.index : idx
        let sUrl = s.url
        if (!sUrl || (!sUrl.startsWith('http') && !sUrl.startsWith('/api/'))) {
          sUrl = hostBase ? appendAuthToken(`${hostBase}/api/library/${activeItem?.id}/slides/${slideIdx}`) : (api.slideUrl ? api.slideUrl(activeItem?.id, slideIdx) : '')
        } else if (sUrl.startsWith('/api/')) {
          sUrl = appendAuthToken(`${hostBase}${sUrl}`)
        }
        return {
          url: sUrl,
          remoteUrl: s.remote_url || (s.url && s.url.startsWith('http') ? s.url : null),
          index: slideIdx,
        }
      })
  }, [activeItem?.id, parsedResources])

  // Accurate video and embed detection
  const videoInfo = useMemo(() => {
    const it = activeItem
    if (!it) return null

    // 1. YouTube embed detection
    if (it.url && /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/i.test(it.url)) {
      const match = it.url.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([\w-]{11})/)
      if (match) {
        return {
          type: 'youtube',
          embedUrl: `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0`,
          isVertical: Boolean(it.url.includes('/shorts/')),
        }
      }
    }

    // 2. TikTok embed
    if (it.url && /tiktok\.com\/.*\/video\/(\d+)/i.test(it.url)) {
      const match = it.url.match(/tiktok\.com\/.*\/video\/(\d+)/i)
      if (match) {
        return {
          type: 'tiktok',
          embedUrl: `https://www.tiktok.com/embed/v2/${match[1]}`,
          isVertical: true,
        }
      }
    }

    // 3. Instagram Reel embed
    if (it.url && /instagram\.com\/(?:reel|p)\/([\w-]+)/i.test(it.url)) {
      const match = it.url.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/i)
      if (match) {
        const shortcode = match[1]
        const canStream = Boolean(it.media_path && /\.(mp4|webm|mov)(\?|$)/i.test(it.media_path))
        const hostBase = getResolvedBase()
        const directStreamUrl = canStream ? (hostBase ? appendAuthToken(`${hostBase}/api/library/${it.id}/media`) : (api.mediaUrl ? api.mediaUrl(it.id) : null)) : null
        return {
          type: 'instagram',
          url: directStreamUrl,
          embedUrl: `https://www.instagram.com/reel/${shortcode}/embed/`,
          isVertical: true,
        }
      }
    }

    // 4. Direct local media file path or stream from server
    const hasLocalMedia = Boolean(it.media_path && /\.(mp4|webm|mov)(\?|$)/i.test(it.media_path))
    if (hasLocalMedia && it.id) {
      const hostBase = getResolvedBase()
      return {
        type: 'direct',
        url: hostBase ? appendAuthToken(`${hostBase}/api/library/${it.id}/media`) : (api.mediaUrl ? api.mediaUrl(it.id) : ''),
        isVertical: Boolean(it.is_reel || it.url?.includes('/reel/') || it.url?.includes('/shorts/')),
      }
    }

    // 5. Direct playable video in resources (excluding blocked twimg hotlinks)
    const directRes = parsedResources.find(
      (r) => r && (r.type === 'video' || r.type === 'mp4' || (typeof r.url === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(r.url)))
    )
    if (directRes && !directRes.url?.includes('twimg.com')) {
      const hostBase = getResolvedBase()
      let vUrl = directRes.remote_url || directRes.url
      if (vUrl && vUrl.startsWith('/api/')) {
        vUrl = hostBase ? appendAuthToken(`${hostBase}${vUrl}`) : vUrl
      }
      return {
        type: 'direct',
        url: vUrl,
        embedUrl: directRes.embed_url || null,
        isVertical: Boolean(it.is_reel || it.url?.includes('/reel/') || it.url?.includes('/shorts/')),
      }
    }

    // 6. Generic direct video URL
    if (it.kind === 'video' && it.url && /\.(mp4|webm|mov)(\?|$)/i.test(it.url) && !it.url.includes('twimg.com')) {
      return {
        type: 'direct',
        url: it.url,
        isVertical: Boolean(it.is_reel || it.url?.includes('/reel/') || it.url?.includes('/shorts/')),
      }
    }

    return null
  }, [activeItem, parsedResources])

  const isVertical = useMemo(() => {
    if (activeItem?.is_reel || videoInfo?.isVertical) return true
    const u = (activeItem?.url || '').toLowerCase()
    return u.includes('/reel/') || u.includes('/reels/') || u.includes('/shorts/') || u.includes('tiktok.com')
  }, [activeItem, videoInfo])

  // Resolve thumbnail
  const thumbnailUrl = useMemo(() => {
    const it = activeItem
    if (!it) return ''

    // 1. YouTube direct thumbnail fallback
    if (it.url) {
      const ytMatch = it.url.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([\w-]{11})/)
      if (ytMatch && (!it.thumbnail_path || it.thumbnail_path.includes('default'))) {
        return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`
      }
    }

    const hostBase = getResolvedBase()
    // 2. Direct external thumbnail URL (never token-corrupt external URLs)
    if (it.thumbnail_url) {
      if (it.thumbnail_url.startsWith('http')) return it.thumbnail_url
      if (it.thumbnail_url.startsWith('/api')) {
        return appendAuthToken(`${hostBase}${it.thumbnail_url}`)
      }
      return api.thumbnailUrl ? api.thumbnailUrl(it.id) : it.thumbnail_url
    }

    // 3. Amethyst local thumbnail endpoint
    if (it.thumbnail_path || it.has_thumbnail || it.id) {
      if (hostBase) {
        return appendAuthToken(`${hostBase}/api/library/${it.id}/thumbnail`)
      }
      return api.thumbnailUrl ? api.thumbnailUrl(it.id) : ''
    }
    return ''
  }, [activeItem])

  const postBody = useMemo(() => {
    if (activeItem?.caption && activeItem.caption.trim()) return activeItem.caption.trim()
    if (activeItem?.notes && !activeItem.notes.startsWith('http') && activeItem.notes.trim()) {
      return activeItem.notes.trim()
    }
    if (activeItem?.content && activeItem.content.trim()) return activeItem.content.trim()
    if (activeItem?.excerpt && activeItem.excerpt.trim()) return activeItem.excerpt.trim()
    return ''
  }, [activeItem])

  const summary = activeItem?.summary || ''

  // Extracted outbound resources & links (with unshortened URLs and clean domains, video streams excluded)
  const links = useMemo(() => {
    const rawList = Array.isArray(parsedResources) && parsedResources.length > 0
      ? parsedResources
      : Array.isArray(activeItem?.metadata?.links) && activeItem.metadata.links.length > 0
        ? activeItem.metadata.links
        : activeItem?.url
          ? [{ title: activeItem.title || 'Original Source', url: activeItem.url, type: 'source' }]
          : []

    const seen = new Set()
    const cleanList = []

    for (const r of rawList) {
      if (!r) continue
      // Filter out video files and avatar image streams
      if (r.type === 'video' || r.type === 'mp4' || r.type === 'avatar') continue
      const rawUrl = r.resolved_url || r.url || r.link || ''
      if (!rawUrl || !rawUrl.startsWith('http')) continue
      if (/\.(mp4|mov|webm)(\?|$)/i.test(rawUrl)) continue

      // Strip common tracking queries
      const cleanUrl = rawUrl.replace(/([?&])(utm_[^&]+|fbclid=[^&]+|igsh=[^&]+|srtk=[^&]+)/gi, '').replace(/\?$/, '')
      if (seen.has(cleanUrl)) continue
      seen.add(cleanUrl)

      const rawDomain = getItemDomain(cleanUrl) || 'web'
      const isTool = r.type === 'tool' || cleanUrl.includes('github.com')
      cleanList.push({
        title: r.name || r.title || r.detail || rawDomain,
        detail: r.detail && r.detail !== r.name ? r.detail : '',
        url: cleanUrl,
        domain: rawDomain,
        type: r.type || (isTool ? 'tool' : 'link'),
      })
    }
    return cleanList
  }, [parsedResources, activeItem])

  const handleEnrich = async () => {
    if (!activeItem?.id && !activeItem?.uuid) return
    setEnriching(true)
    showToast('Enriching with AI…')
    try {
      await api.enrichLibraryItem(activeItem.id || activeItem.uuid)
      const updated = await api.libraryItem(activeItem.id || activeItem.uuid)
      if (updated) {
        setDetailItem(updated)
        showToast('Enrichment complete!')
      }
    } catch (err) {
      showToast(`Enrich error: ${err.message}`)
    } finally {
      setEnriching(false)
    }
  }

  const handlePlayToggle = () => {
    if (videoInfo) {
      setIsPlaying((prev) => !prev)
    } else if (activeItem?.url) {
      window.open(activeItem.url, '_blank')
    }
  }

  const handleSavePrivateNote = async () => {
    if (!activeItem?.id) return
    setSavingNote(true)
    try {
      await api.updateLibraryItem(activeItem.id, { private_notes: privateNote })
      showToast('Note saved!')
    } catch (err) {
      showToast(`Save failed: ${err.message}`)
    } finally {
      setSavingNote(false)
    }
  }

  const handleCopyLink = async () => {
    if (!activeItem?.url) return
    try {
      await copyText(activeItem.url)
      showToast('Link copied to clipboard!')
    } catch {
      showToast('Could not copy link')
    }
    setActionSheetOpen(false)
  }

  const handleToggleFavorite = async () => {
    const next = !isFavorited
    setIsFavorited(next)
    if (activeItem?.id) {
      try {
        await api.updateLibraryItem(activeItem.id, { is_pinned: next ? 1 : 0 })
        showToast(next ? 'Saved to Favorites' : 'Removed from Favorites')
      } catch {}
    }
  }

  const handleDeleteItem = async () => {
    if (!activeItem?.id) return
    try {
      await api.deleteLibraryItem(activeItem.id)
      setConfirmDeleteOpen(false)
      setActionSheetOpen(false)
      if (onDeleteItem) onDeleteItem(activeItem.id)
      else onBack()
    } catch (err) {
      showToast(`Delete failed: ${err.message}`)
    }
  }

  const activeMediaUrl = slides.length > 0 && currentSlideIndex > 0 ? slides[currentSlideIndex].url : thumbnailUrl

  return (
    <motion.div
      className="b"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{ paddingBottom: 'max(150px, calc(env(safe-area-inset-bottom, 24px) + 130px))' }}
    >
      {/* Toast Notification */}
      <AnimatePresence>
        {toastNotice && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'fixed',
              top: 16,
              left: 20,
              right: 20,
              zIndex: 300,
              background: '#111113',
              color: '#FFFFFF',
              borderRadius: 999,
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
            }}
          >
            {toastNotice}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header Bar: Perfect 38px alignment across Back, Center, and More buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
          padding: '4px 0 8px',
          position: 'relative',
        }}
      >
        <button
          type="button"
          className="ch glass"
          style={{
            height: 38,
            padding: '0 16px',
            fontSize: 13,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            zIndex: 2,
            border: 'none',
            cursor: 'pointer',
          }}
          onClick={onBack}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Library
        </button>

        <span
          className="ch glass"
          style={{
            height: 38,
            padding: '0 16px',
            fontSize: 13,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}
        >
          Saved
        </span>

        <button
          type="button"
          className="ch glass"
          aria-label="More options"
          style={{
            width: 38,
            height: 38,
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2,
            border: 'none',
            cursor: 'pointer',
          }}
          onClick={() => setActionSheetOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
            <circle cx="5" cy="12" r="1.5" />
          </svg>
        </button>
      </div>

      {/* Hero Media / Playable Video & Image Box */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: isVertical ? '9 / 16' : '16 / 9',
          maxHeight: isVertical ? '440px' : '230px',
          maxWidth: isVertical ? '320px' : undefined,
          margin: isVertical ? '0 auto 12px' : '0 0 12px',
          borderRadius: 24,
          background: 'linear-gradient(135deg, #1C1C1E 0%, #101012 100%)',
          overflow: 'hidden',
          color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.25s ease',
        }}
      >
        {/* Fallback Graphic Card (always rendered behind image) */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            textAlign: 'center',
            background: 'linear-gradient(135deg, #222226 0%, #121214 100%)',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 16,
              background: 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
            }}
          >
            <Icon name={videoInfo ? 'play' : isPost ? 'chat' : 'bookmark'} size={24} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 4 }}>
            {author} · {kind}
          </div>
        </div>

        {isPlaying && videoInfo ? (
          videoInfo.type === 'direct' && !useEmbedFallback ? (
            <video
              src={videoInfo.url}
              controls
              playsInline
              autoPlay
              poster={activeMediaUrl}
              style={{ width: '100%', height: '100%', objectFit: isVertical ? 'cover' : 'contain', background: '#000', zIndex: 5 }}
              onError={() => {
                if (videoInfo.embedUrl) setUseEmbedFallback(true)
              }}
            />
          ) : (
            <iframe
              src={videoInfo.embedUrl || videoInfo.url}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ width: '100%', height: '100%', border: 0, zIndex: 5 }}
            />
          )
        ) : (
          <>
            {activeMediaUrl && !thumbFailed && (
              <img
                src={activeMediaUrl}
                alt={title}
                loading="lazy"
                style={{ position: 'relative', width: '100%', height: '100%', objectFit: 'cover', zIndex: 2 }}
                onError={() => setThumbFailed(true)}
              />
            )}

            {/* Center Play Button Disc (when video is available) */}
            {videoInfo && (
              <motion.button
                type="button"
                className="glass dk"
                aria-label="Play video"
                whileTap={{ scale: 0.92 }}
                style={{
                  position: 'absolute',
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.65)',
                  backdropFilter: 'blur(10px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  border: '1.5px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  zIndex: 4,
                  boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
                }}
                onClick={handlePlayToggle}
              >
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 3 }}>
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              </motion.button>
            )}

            {/* Slide Navigation if multi-image carousel */}
            {slides.length > 1 && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  zIndex: 3,
                  background: 'rgba(0,0,0,0.55)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 999,
                  padding: '4px 10px',
                  fontSize: 11.5,
                  fontWeight: 600,
                }}
              >
                <button
                  type="button"
                  style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0 }}
                  onClick={() => setCurrentSlideIndex((p) => (p > 0 ? p - 1 : slides.length - 1))}
                >
                  ◀
                </button>
                <span>{currentSlideIndex + 1} / {slides.length}</span>
                <button
                  type="button"
                  style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0 }}
                  onClick={() => setCurrentSlideIndex((p) => (p < slides.length - 1 ? p + 1 : 0))}
                >
                  ▶
                </button>
              </div>
            )}

            {/* Bottom info banner */}
            <div
              className="glass dk r"
              style={{
                position: 'absolute',
                right: 10,
                bottom: 10,
                borderRadius: 999,
                padding: '6px 12px',
                gap: 8,
                zIndex: 3,
              }}
            >
              <span className="mono" style={{ fontSize: 11 }}>
                {videoInfo ? 'Tap to play' : duration || kind}
              </span>
              {activeItem?.url && (
                <span
                  style={{ fontSize: 11, color: '#A1A1A6', cursor: 'pointer' }}
                  onClick={() => window.open(activeItem.url, '_blank')}
                >
                  Source ↗
                </span>
              )}
            </div>
          </>
        )}

        {/* Close active player overlay button */}
        {isPlaying && (
          <button
            type="button"
            className="ch glass dk"
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              padding: '6px 12px',
              fontSize: 11.5,
              fontWeight: 600,
              zIndex: 10,
              border: 0,
              color: '#fff',
              cursor: 'pointer',
            }}
            onClick={() => {
              setIsPlaying(false)
              setUseEmbedFallback(false)
            }}
          >
            ✕ Close
          </button>
        )}
      </div>

      {/* Title & Metadata */}
      <div>
        <h1 className="h" style={{ fontSize: 23, letterSpacing: '-0.035em', lineHeight: 1.2 }}>
          {title}
        </h1>
        <div className="m" style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{author}</span>
          <span>·</span>
          <span>{kind}</span>
          {duration ? <span>· {duration}</span> : null}
        </div>
      </div>

      {/* Segmented Tabs: Overview, Links, Notes */}
      <div className="tabs">
        <span
          className={tab === 'overview' ? 'on' : ''}
          onClick={() => setTab('overview')}
        >
          Overview
        </span>
        <span
          className={tab === 'links' ? 'on' : ''}
          onClick={() => setTab('links')}
        >
          Links <span className="cnt">{links.length}</span>
        </span>
        <span
          className={tab === 'notes' ? 'on' : ''}
          onClick={() => setTab('notes')}
        >
          Notes <span className="cnt">{privateNote ? 1 : 0}</span>
        </span>
      </div>

      {/* Tab 1: Overview */}
      {tab === 'overview' && (
        <div className="col" style={{ gap: 14 }}>
          {/* Post Card: Displays full social post text, handle, and platform source */}
          {(Boolean(postBody) || isPost) && (
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 20,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div className="r" style={{ alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: '#1C1C1E',
                    color: '#FFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 14,
                    overflow: 'hidden',
                    flex: 'none',
                  }}
                >
                  {authorAvatar ? (
                    <img
                      src={authorAvatar}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    author.charAt(0).toUpperCase()
                  )}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.2, color: '#1D1D1F' }}>
                    {author}
                  </div>
                  <div className="m" style={{ fontSize: 12, marginTop: 2 }}>
                    {app ? app.toUpperCase() : getItemDomain(activeItem?.url) || 'Post'}
                    {activeItem?.consumed_on ? ` · ${activeItem.consumed_on}` : ''}
                  </div>
                </div>

                {activeItem?.url && (
                  <a
                    href={activeItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ch"
                    style={{
                      fontSize: 11,
                      padding: '4px 10px',
                      textDecoration: 'none',
                      background: '#F2F2F7',
                      color: '#0071E3',
                      fontWeight: 600,
                    }}
                  >
                    Open ↗
                  </a>
                )}
              </div>

              {postBody && (
                <div style={{ fontSize: 15, lineHeight: 1.55, color: '#1D1D1F' }}>
                  <Markdown text={postBody} />
                </div>
              )}
            </div>
          )}

          {/* Structured AI Summary Section */}
          <div className="col" style={{ gap: 8 }}>
            <div className="r sp" style={{ alignItems: 'center' }}>
              <span className="st" style={{ fontSize: 17, fontWeight: 700 }}>
                Summary
              </span>
              <button
                type="button"
                className="ch glass"
                style={{ fontSize: 11, padding: '5px 12px', border: 0, cursor: 'pointer' }}
                disabled={enriching}
                onClick={handleEnrich}
              >
                {enriching ? 'Enriching…' : 'Re-enrich'}
              </button>
            </div>

            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 20,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                fontSize: 14.5,
                lineHeight: 1.6,
                color: '#1D1D1F',
              }}
            >
              {summary ? (
                <div style={{ color: '#1D1D1F' }}>
                  <Markdown text={summary} />
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '16px 0', color: '#8E8E93' }}>
                  <div>No summary generated yet.</div>
                  <button
                    type="button"
                    className="ch"
                    style={{ marginTop: 10, background: '#0071E3', color: '#fff', padding: '6px 16px', border: 0 }}
                    onClick={handleEnrich}
                  >
                    Generate AI Summary
                  </button>
                </div>
              )}
            </div>

            {activeItem?.storage_provider === 'google_drive' && (
              <div className="r" style={{ gap: 8, padding: '8px 12px', background: 'rgba(52,199,89,0.08)', borderRadius: 12, color: '#248A3D', fontSize: 12.5, fontWeight: 500 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>Stored & synced on Google Drive</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Outbound Links & Resources */}
      {tab === 'links' && (
        <div className="col" style={{ gap: 10 }}>
          <div className="st" style={{ fontSize: 17, fontWeight: 700 }}>
            Referenced Resources ({links.length})
          </div>

          {links.length > 0 ? (
            links.map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="c r act"
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                  padding: '12px 14px',
                  gap: 12,
                  alignItems: 'center',
                  background: '#FFFFFF',
                  borderRadius: 18,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                {/* Platform / Site Favicon */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#F2F1F6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: 'none',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${link.domain}&sz=64`}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: 4 }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {link.title}
                  </div>
                  {link.detail ? (
                    <div className="m" style={{ marginTop: 2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {link.detail}
                    </div>
                  ) : null}
                  <div className="m" style={{ marginTop: 2, fontSize: 11.5, color: '#0071E3' }}>
                    {link.domain} {link.type ? `· ${link.type}` : ''}
                  </div>
                </div>

                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#8E8E93" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 7h10v10" />
                  <path d="M7 17 17 7" />
                </svg>
              </a>
            ))
          ) : (
            <div className="c m" style={{ textAlign: 'center', padding: 24, background: '#FFFFFF', borderRadius: 18 }}>
              No referenced links extracted from this item.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Notes & Personal Tags */}
      {tab === 'notes' && (
        <div className="col" style={{ gap: 12 }}>
          <div className="st" style={{ fontSize: 17, fontWeight: 700 }}>
            Tags
          </div>
          <div className="r" style={{ flexWrap: 'wrap', gap: 8 }}>
            {tags.map((t, idx) => (
              <span key={idx} className="ch on" style={{ fontSize: 12 }}>
                #{t}
              </span>
            ))}
          </div>

          <div className="r sp" style={{ alignItems: 'center', marginTop: 8 }}>
            <span className="st" style={{ fontSize: 17, fontWeight: 700 }}>
              Private Notes
            </span>
            <button
              type="button"
              className="ch"
              style={{
                fontSize: 12,
                background: '#0071E3',
                color: '#fff',
                padding: '6px 14px',
                border: 0,
                cursor: 'pointer',
              }}
              disabled={savingNote}
              onClick={handleSavePrivateNote}
            >
              {savingNote ? 'Saving…' : 'Save Note'}
            </button>
          </div>

          <div className="c" style={{ minHeight: 120, background: '#FFFFFF', borderRadius: 18, padding: 14 }}>
            <textarea
              value={privateNote}
              onChange={(e) => setPrivateNote(e.target.value)}
              placeholder="Add your personal thoughts or private notes here…"
              style={{
                width: '100%',
                border: 0,
                outline: 0,
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 14.5,
                lineHeight: 1.55,
                resize: 'none',
                minHeight: 100,
                color: '#1D1D1F',
              }}
            />
          </div>
        </div>
      )}

      {/* Three Dots (•••) Action Sheet */}
      <AnimatePresence>
        {actionSheetOpen && (
          <motion.div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              maxWidth: 480,
              margin: '0 auto',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActionSheetOpen(false)}
          >
            <motion.div
              style={{
                background: '#FFFFFF',
                borderRadius: '28px 28px 0 0',
                padding: '20px 16px max(24px, env(safe-area-inset-bottom, 24px))',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                boxShadow: '0 -10px 40px rgba(0,0,0,0.18)',
              }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ textAlign: 'center', marginBottom: 6 }}>
                <div style={{ width: 36, height: 4, background: '#D1D1D6', borderRadius: 999, margin: '0 auto 12px' }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1D1D1F' }}>Item Actions</div>
              </div>

              {activeItem?.url && (
                <button
                  type="button"
                  className="bt"
                  style={{
                    width: '100%',
                    height: 50,
                    borderRadius: 16,
                    background: '#F2F2F7',
                    color: '#1D1D1F',
                    justifyContent: 'flex-start',
                    padding: '0 16px',
                    fontSize: 15,
                    gap: 12,
                  }}
                  onClick={() => {
                    window.open(activeItem.url, '_blank')
                    setActionSheetOpen(false)
                  }}
                >
                  <Icon name="arrow-up-right" size={18} />
                  <span>Open in Browser</span>
                </button>
              )}

              {activeItem?.url && (
                <button
                  type="button"
                  className="bt"
                  style={{
                    width: '100%',
                    height: 50,
                    borderRadius: 16,
                    background: '#F2F2F7',
                    color: '#1D1D1F',
                    justifyContent: 'flex-start',
                    padding: '0 16px',
                    fontSize: 15,
                    gap: 12,
                  }}
                  onClick={handleCopyLink}
                >
                  <Icon name="copy" size={18} />
                  <span>Copy Link</span>
                </button>
              )}

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 50,
                  borderRadius: 16,
                  background: '#F2F2F7',
                  color: '#1D1D1F',
                  justifyContent: 'flex-start',
                  padding: '0 16px',
                  fontSize: 15,
                  gap: 12,
                }}
                onClick={() => {
                  setActionSheetOpen(false)
                  handleEnrich()
                }}
              >
                <Icon name="sparkle" size={18} />
                <span>Re-enrich with AI</span>
              </button>

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 50,
                  borderRadius: 16,
                  background: '#F2F2F7',
                  color: '#1D1D1F',
                  justifyContent: 'flex-start',
                  padding: '0 16px',
                  fontSize: 15,
                  gap: 12,
                }}
                onClick={() => {
                  setActionSheetOpen(false)
                  handleToggleFavorite()
                }}
              >
                <Icon name="star" size={18} />
                <span>{isFavorited ? 'Remove from Favorites' : 'Add to Favorites'}</span>
              </button>

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 50,
                  borderRadius: 16,
                  background: '#FFF0F0',
                  color: '#FF3B30',
                  justifyContent: 'flex-start',
                  padding: '0 16px',
                  fontSize: 15,
                  gap: 12,
                }}
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Icon name="trash" size={18} />
                <span>Delete from Library</span>
              </button>

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 48,
                  borderRadius: 16,
                  background: '#FFFFFF',
                  color: '#8E8E93',
                  justifyContent: 'center',
                  fontSize: 15,
                  fontWeight: 600,
                  marginTop: 4,
                  border: '1px solid #E5E5EA',
                }}
                onClick={() => setActionSheetOpen(false)}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDeleteOpen && (
          <motion.div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 300,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              style={{
                background: '#FFFFFF',
                borderRadius: 24,
                padding: '24px 20px',
                width: '100%',
                maxWidth: 340,
                textAlign: 'center',
                boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
              }}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
            >
              <div style={{ fontWeight: 700, fontSize: 18, color: '#1D1D1F' }}>Delete Item?</div>
              <div style={{ fontSize: 14, color: '#8E8E93', marginTop: 8, lineHeight: 1.4 }}>
                Are you sure you want to remove &ldquo;{title}&rdquo; from your library?
              </div>
              <div className="r" style={{ gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="bt"
                  style={{ flex: 1, height: 44, borderRadius: 14, background: '#F2F2F7', color: '#1D1D1F' }}
                  onClick={() => setConfirmDeleteOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bt"
                  style={{ flex: 1, height: 44, borderRadius: 14, background: '#FF3B30', color: '#FFF' }}
                  onClick={handleDeleteItem}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Bottom Action Dock: Discuss with Agent */}
      <div
        className="glass hi r"
        style={{
          position: 'fixed',
          left: 16,
          right: 16,
          bottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          height: 60,
          borderRadius: 999,
          padding: 6,
          gap: 8,
          zIndex: 100,
          maxWidth: 448,
          margin: '0 auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        }}
      >
        <button
          type="button"
          className="ib"
          aria-label="Favorite"
          style={{
            background: isFavorited ? '#111113' : '#FFFFFF',
            color: isFavorited ? '#FFD60A' : '#1D1D1F',
            width: 48,
            height: 48,
          }}
          onClick={handleToggleFavorite}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>

        <button
          type="button"
          className="bt"
          style={{ flex: 1, borderRadius: 999, height: 48, gap: 8 }}
          onClick={() => {
            if (onAskAgent) {
              onAskAgent({
                title: `Discuss: ${title}`,
                initialMessage: `I want to discuss "${title}":\n${summary || postBody || ''}`,
              })
            }
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
            <path d="M20 3v4" />
            <path d="M22 5h-4" />
          </svg>
          Discuss with Agent
        </button>
      </div>
    </motion.div>
  )
}
