import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { api, appendAuthToken, getBase } from '../../api.js'

function getItemDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export default function MobileLibraryItem({ item, onBack, onAskAgent }) {
  const [detailItem, setDetailItem] = useState(item)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [tab, setTab] = useState('overview') // 'overview' | 'links' | 'notes'
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFavorited, setIsFavorited] = useState(Boolean(item?.favorited || item?.starred))
  const [enriching, setEnriching] = useState(false)
  const [tags, setTags] = useState(
    Array.isArray(item?.tags) && item.tags.length > 0
      ? item.tags
      : ['ai', 'tools', 'references']
  )
  const [privateNote, setPrivateNote] = useState(item?.notes || '')

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
          if (full.notes) setPrivateNote(full.notes)
          if (full.favorited !== undefined) setIsFavorited(Boolean(full.favorited))
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
  const author = activeItem?.author || activeItem?.channel || getItemDomain(activeItem?.url) || 'Amethyst'
  const kind = activeItem?.kind ? activeItem.kind.charAt(0).toUpperCase() + activeItem.kind.slice(1) : 'Video'
  const duration = activeItem?.duration || activeItem?.reading_time || ''

  // Video resolution matching desktop LibraryDetailModal: Prioritize local stream over blocked external hotlinks
  const videoInfo = useMemo(() => {
    const it = activeItem
    if (!it) return null

    // 1. Direct media file path or stream from local server (Highest Priority!)
    if (it.media_path || (it.kind === 'video' || it.is_reel) || it.media_url) {
      if (api.mediaUrl && it.id) {
        return {
          type: 'direct',
          url: api.mediaUrl(it.id),
        }
      }
      if (it.media_path) {
        return {
          type: 'direct',
          url: it.media_path,
        }
      }
    }

    // 2. Direct playable video in resources (excluding twimg which blocks external hotlinking)
    const resList = Array.isArray(it.resources) ? it.resources : []
    const directRes = resList.find(
      (r) => r && (r.type === 'video' || r.type === 'mp4' || (typeof r.url === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(r.url)))
    )
    if (directRes && !directRes.url?.includes('twimg.com')) {
      return {
        type: 'direct',
        url: directRes.remote_url || directRes.url,
      }
    }

    // 3. YouTube embed detection
    if (it.url && /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/i.test(it.url)) {
      const match = it.url.match(/(?:watch\?v=|shorts\/|youtu\.be\/)([\w-]{11})/)
      if (match) {
        return {
          type: 'youtube',
          url: `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0`,
        }
      }
    }

    // 4. TikTok embed
    if (it.url && /tiktok\.com\/.*\/video\/(\d+)/i.test(it.url)) {
      const match = it.url.match(/tiktok\.com\/.*\/video\/(\d+)/i)
      if (match) {
        return {
          type: 'tiktok',
          url: `https://www.tiktok.com/embed/v2/${match[1]}`,
        }
      }
    }

    // 5. Instagram Reel embed
    if (it.url && /instagram\.com\/(?:reel|p)\/([\w-]+)/i.test(it.url)) {
      const match = it.url.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/i)
      if (match) {
        return {
          type: 'instagram',
          url: `https://www.instagram.com/reel/${match[1]}/embed/`,
        }
      }
    }

    // 6. Generic video URL (if not twimg.com)
    if (it.kind === 'video' && it.url && /\.(mp4|webm|mov)(\?|$)/i.test(it.url) && !it.url.includes('twimg.com')) {
      return {
        type: 'direct',
        url: it.url,
      }
    }

    return null
  }, [activeItem])

  const thumbnailUrl = useMemo(() => {
    if (activeItem?.thumbnail_url) {
      if (activeItem.thumbnail_url.startsWith('http')) return appendAuthToken(activeItem.thumbnail_url)
      if (activeItem.thumbnail_url.startsWith('/api')) {
        return appendAuthToken(`${getBase().replace(/\/api$/, '')}${activeItem.thumbnail_url}`)
      }
      return api.thumbnailUrl ? api.thumbnailUrl(activeItem.id) : activeItem.thumbnail_url
    }
    if (activeItem?.thumbnail_path || activeItem?.has_thumbnail) {
      return api.thumbnailUrl ? api.thumbnailUrl(activeItem.id) : ''
    }
    return ''
  }, [activeItem])

  const summary = activeItem?.summary || activeItem?.content || activeItem?.text || 'No summary available for this item.'

  // Extracted outbound resources & links (with unshortened URLs and clean domain)
  const links = useMemo(() => {
    const rawList = Array.isArray(activeItem?.resources) && activeItem.resources.length > 0
      ? activeItem.resources
      : Array.isArray(activeItem?.metadata?.links) && activeItem.metadata.links.length > 0
        ? activeItem.metadata.links
        : activeItem?.url
          ? [{ title: activeItem.title || 'Original Source', url: activeItem.url, type: 'source' }]
          : []

    return rawList
      .filter((r) => r && (r.url || r.link))
      .map((r) => {
        const u = r.resolved_url || r.url || r.link || ''
        const rawDomain = getItemDomain(u) || 'web'
        const isToolOrCode = r.type === 'tool' || u.includes('github.com')
        return {
          title: r.name || r.title || r.detail || u,
          url: u,
          domain: rawDomain,
          type: r.type || (isToolOrCode ? 'tool' : 'link'),
        }
      })
  }, [activeItem])

  const handleEnrich = async () => {
    if (!activeItem?.id && !activeItem?.uuid) return
    setEnriching(true)
    try {
      await api.enrichLibraryItem(activeItem.id || activeItem.uuid)
      const updated = await api.libraryItem(activeItem.id || activeItem.uuid)
      if (updated) setDetailItem(updated)
    } catch (err) {
      console.warn('[MobileLibraryItem] Enrich error:', err.message)
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

  return (
    <motion.div
      className="b"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{ paddingBottom: 'max(150px, calc(env(safe-area-inset-bottom, 24px) + 130px))' }}
    >
      {/* Top Header Bar with optically centered Saved chip */}
      <div
        className="r sp"
        style={{
          position: 'relative',
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          type="button"
          className="ch glass"
          style={{ font: "600 13px 'Inter', sans-serif", padding: '10px 16px', zIndex: 2 }}
          onClick={onBack}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Library
        </button>

        <span
          className="ch glass"
          style={{
            font: "600 13px 'Inter', sans-serif",
            padding: '10px 18px',
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
          className="ib"
          aria-label="More"
          style={{ zIndex: 2 }}
          onClick={() => {
            if (activeItem?.url) window.open(activeItem.url, '_blank')
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        </button>
      </div>

      {/* Hero Media / Playable Video Box */}
      <div
        style={{
          position: 'relative',
          height: isPlaying ? 220 : 190,
          borderRadius: 24,
          background: '#0B0B0C',
          overflow: 'hidden',
          color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'height 0.25s ease',
        }}
      >
        {isPlaying && videoInfo ? (
          videoInfo.type === 'direct' ? (
            <video
              src={videoInfo.url}
              controls
              playsInline
              autoPlay
              poster={thumbnailUrl}
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
            />
          ) : (
            <iframe
              src={videoInfo.url}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ width: '100%', height: '100%', border: 0 }}
            />
          )
        ) : (
          <>
            {thumbnailUrl && (
              <img
                src={thumbnailUrl}
                alt={title}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  if (e.currentTarget.nextElementSibling) {
                    e.currentTarget.nextElementSibling.style.display = 'block'
                  }
                }}
              />
            )}
            <div
              style={{
                display: thumbnailUrl ? 'none' : 'block',
                position: 'absolute',
                left: 18,
                top: 22,
                fontSize: 32,
                lineHeight: 0.95,
                fontWeight: 800,
                letterSpacing: '-0.05em',
              }}
            >
              <div>AMETHYST</div>
              <div style={{ opacity: 0.6 }}>SAVED</div>
            </div>

            {/* Play Button */}
            <motion.button
              type="button"
              className="glass dk"
              aria-label={videoInfo ? 'Play video' : 'Open link'}
              whileTap={{ scale: 0.92 }}
              style={{
                position: 'absolute',
                right: 18,
                top: 18,
                width: 52,
                height: 52,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                border: 0,
                color: '#fff',
              }}
              onClick={handlePlayToggle}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="6 3 20 12 6 21 6 3" />
              </svg>
            </motion.button>

            {/* Bottom info banner */}
            <div
              className="glass dk r"
              style={{
                position: 'absolute',
                left: 10,
                right: 10,
                bottom: 10,
                borderRadius: 999,
                padding: '8px 14px',
                gap: 10,
              }}
            >
              <span style={{ display: 'flex' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              </span>
              <span className="mono" style={{ fontSize: 11 }}>
                {videoInfo ? 'Play video in app' : duration || 'Saved item'}
              </span>
              <span style={{ flex: 1 }} />
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
              right: 10,
              top: 10,
              padding: '6px 12px',
              fontSize: 11,
              zIndex: 10,
              border: 0,
              color: '#fff',
            }}
            onClick={() => setIsPlaying(false)}
          >
            Close video
          </button>
        )}
      </div>

      {/* Title & Metadata */}
      <div>
        <h1 className="h" style={{ fontSize: 24, letterSpacing: '-0.035em', lineHeight: 1.15 }}>
          {title}
        </h1>
        <div className="m" style={{ marginTop: 6 }}>
          {author} · {kind} {duration ? `· ${duration}` : ''}
        </div>
      </div>

      {/* Status Chip & External Link */}
      <div className="r sp">
        <span className="ch" style={{ background: '#E5F0FF', color: '#0058B8', fontWeight: 600 }}>
          {kind === 'Video' ? 'Video resource' : 'Reading item'}
        </span>
        {activeItem?.url && (
          <a
            href={activeItem.url}
            target="_blank"
            rel="noopener noreferrer"
            className="m r"
            style={{ gap: 4, color: '#0058B8', textDecoration: 'none' }}
          >
            Open on {getItemDomain(activeItem.url) || 'web'}
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 7h10v10" />
              <path d="M7 17 17 7" />
            </svg>
          </a>
        )}
      </div>

      {/* Segmented Tabs */}
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
          Notes <span className="cnt">{tags.length}</span>
        </span>
      </div>

      {/* Tab 1: Overview */}
      {tab === 'overview' && (
        <div className="col" style={{ gap: 12 }}>
          <div className="r sp">
            <span className="st" style={{ fontSize: 17 }}>
              Summary
            </span>
            <button
              type="button"
              className="ch"
              style={{ fontSize: 11, padding: '5px 12px' }}
              disabled={enriching}
              onClick={handleEnrich}
            >
              {enriching ? 'Enriching…' : 'Re-enrich'}
            </button>
          </div>

          <div
            className="c"
            style={{
              lineHeight: 1.6,
              fontSize: 14.5,
              color: '#1D1D1F',
              whiteSpace: 'pre-line',
            }}
          >
            {summary}
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
      )}

      {/* Tab 2: Outbound Links & Resources */}
      {tab === 'links' && (
        <div className="col" style={{ gap: 10 }}>
          <div className="st" style={{ fontSize: 17 }}>
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
                }}
              >
                {/* Authentic Platform / Site Favicon */}
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
                      if (e.currentTarget.nextElementSibling) {
                        e.currentTarget.nextElementSibling.style.display = 'flex'
                      }
                    }}
                  />
                  <span
                    style={{
                      display: 'none',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#8E8E93',
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </span>
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {link.title || link.url}
                  </div>
                  <div className="m" style={{ marginTop: 2, fontSize: 12 }}>
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
            <div className="c m" style={{ textAlign: 'center', padding: 24 }}>
              No referenced links extracted from this item.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Notes & Tags */}
      {tab === 'notes' && (
        <div className="col" style={{ gap: 12 }}>
          <div className="st" style={{ fontSize: 17 }}>
            Tags
          </div>
          <div className="r" style={{ flexWrap: 'wrap', gap: 8 }}>
            {tags.map((t, idx) => (
              <span key={idx} className="ch on" style={{ fontSize: 12 }}>
                #{t}
              </span>
            ))}
          </div>

          <div className="st" style={{ fontSize: 17, marginTop: 6 }}>
            Private Notes
          </div>
          <div className="c" style={{ minHeight: 90 }}>
            <textarea
              value={privateNote}
              onChange={(e) => setPrivateNote(e.target.value)}
              placeholder="Add your thoughts or notes here…"
              style={{
                width: '100%',
                border: 0,
                outline: 0,
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 14,
                resize: 'none',
                minHeight: 60,
              }}
            />
          </div>
        </div>
      )}

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
          onClick={() => setIsFavorited(!isFavorited)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>

        <button
          type="button"
          className="bt"
          style={{ flex: 1, borderRadius: 999, height: 48 }}
          onClick={() => {
            if (onAskAgent) {
              onAskAgent({
                title: `Discuss: ${title}`,
                initialMessage: `I want to discuss "${title}":\n${summary}`,
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
