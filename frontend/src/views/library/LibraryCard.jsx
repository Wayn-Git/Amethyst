import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import { memo, useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { AsciiSkeleton } from 'ascii-reveal'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { getRatingTier } from './ratingUtils.js'
import { formatDisplayDate } from './dateUtils.js'
import ProgressSegmentedControl, { shouldShowProgress, isTrackableKind, getProgressLabel, getNextProgress } from './ProgressSegmentedControl.jsx'
import LibraryReminderBanner from './LibraryReminderBanner.jsx'

export const KIND_ICON = {
  article: 'book',
  book: 'book',
  place: 'globe',
  idea: 'spark',
  video: 'image',
  podcast: 'spark',
  music: 'music',
  newsletter: 'mail',
  paper: 'book',
  post: 'chat',
  note: 'edit',
  other: 'link',
}

export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export function cleanSummary(rawText) {
  if (!rawText) return ''
  return String(rawText)
    .replace(/^[-*•]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim()
}

export function renderFormattedSummary(text) {
  if (!text) return null
  const parts = String(text).split(/(\*\*.*?\*\*)/g)
  if (parts.length === 1) return text
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} className="lib-card-summary-strong">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}

export function extractYoutubeId(url) {
  if (!url) return null
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([a-zA-Z0-9_-]{11})/i)
  return m ? m[1] : null
}

export function getDeduplicatedSummary(item) {
  if (!item) return null

  const rawTitle = (item.title || '').trim()
  const titleNorm = rawTitle
    .toLowerCase()
    .replace(/^[@#\s]+/, '')
    .replace(/[\s\-_.:;!?]+$/, '')
    .trim()

  // Prefer summary, then notes, then excerpt
  let candidate = item.summary
  if (!candidate && item.notes) {
    candidate = item.notes
  }
  if (!candidate && item.excerpt) {
    candidate = item.excerpt
  }
  if (!candidate) return null

  let cleaned = cleanSummary(candidate)
  if (!cleaned) return null

  // Remove generic scraper boilerplate
  if (
    cleaned.startsWith('Post by @') &&
    (cleaned.includes('could not be retrieved') || cleaned.includes('formerly Twitter'))
  ) {
    return null
  }

  const cleanedNorm = cleaned
    .toLowerCase()
    .replace(/^[@#\s]+/, '')
    .replace(/[\s\-_.:;!?]+$/, '')
    .trim()

  // 1. Exact match or identical normalized text
  if (titleNorm && (cleanedNorm === titleNorm || titleNorm.startsWith(cleanedNorm) || titleNorm.endsWith(cleanedNorm))) {
    return null
  }

  // 2. Summary starts with exact title text (e.g. Title: "Slop Monster", Summary: "Slop Monster is a tool...")
  if (rawTitle.length >= 5) {
    if (cleaned.toLowerCase().startsWith(rawTitle.toLowerCase())) {
      const remainder = cleaned.slice(rawTitle.length).replace(/^[\s—–:.-]+/, '').trim()
      if (!remainder || remainder.length < 12) {
        return null
      }
      return remainder.charAt(0).toUpperCase() + remainder.slice(1)
    }
  }

  return cleaned
}

export function getDomain(url, site) {
  if (site) return site.replace(/^www\./i, '').toLowerCase()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return (parsed.hostname || '').replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

export function getFaviconUrl(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`
  } catch {
    return null
  }
}

export function getAppFromItem(item) {
  if (item.app) return item.app
  const url = (item.url || '').toLowerCase()
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

function LibraryCardComponent({
  item,
  variant,
  isFeatured = false,
  busy,
  onSelect,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
  onTogglePin,
  onProgressChange,
  onSaveReminder,
  onClearReminder,
  isDraggable = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragOver = false,
  isDragged = false,
}) {
  const cardRef = useRef(null)
  const moreMenuRef = useRef(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  useEffect(() => {
    if (!showMoreMenu) return
    const handleClickOutside = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setShowMoreMenu(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside, true)
    return () => window.removeEventListener('mousedown', handleClickOutside, true)
  }, [showMoreMenu])

  const status = item.status || 'ready'
  const isOptimistic = Boolean(item.isOptimistic)
  const isReceived = status === 'received'
  const isProcessing = Boolean(item.isProcessing) || status === 'processing'
  const isEnriching = status === 'enriching' || busy
  const isLiveProcessing = isOptimistic || isReceived || isProcessing || isEnriching

  const app = getAppFromItem(item)
  const isPost = item.kind === 'post' || app === 'x' || app === 'reddit' || app === 'threads'

  const parsedResources = useMemo(() => {
    let res = item.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    return Array.isArray(res) ? res : []
  }, [item.resources])

  const avatarResource = useMemo(() => {
    return parsedResources.find((r) => r && r.type === 'avatar') || null
  }, [parsedResources])

  const authorAvatar = useMemo(() => {
    if (avatarResource?.url) return avatarResource.url
    if (app === 'x' && item.author) {
      const handle = item.author.replace(/.*@([A-Za-z0-9_]+).*/, '$1')
      if (handle && handle !== item.author) return `https://unavatar.io/x/${handle}`
    }
    if (app === 'github' && item.author) {
      return `https://github.com/${item.author.replace(/^@/, '')}.png?size=64`
    }
    return null
  }, [avatarResource, app, item.author])

  const [thumbFailed, setThumbFailed] = useState(false)
  const [isPlayingVideo, setIsPlayingVideo] = useState(false)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

  // Multi-image slides / carousel extraction
  const slides = useMemo(() => {
    const slideRes = parsedResources.filter((r) => r && typeof r === 'object' && (r.type === 'slide' || r.type === 'image'))
    return slideRes.map((s, idx) => {
      const slideIdx = s.index !== undefined ? s.index : idx
      let sUrl = s.url
      if (!sUrl || (!sUrl.startsWith('http') && !sUrl.startsWith('/api/'))) {
        sUrl = api.slideUrl(item.id, slideIdx)
      }
      return {
        url: sUrl,
        remoteUrl: s.remote_url || (s.url && s.url.startsWith('http') ? s.url : null),
        index: slideIdx,
      }
    })
  }, [item.id, parsedResources])

  const slideCount = slides.length
  const isCarousel = slideCount > 1

  const currentImageUrl = useMemo(() => {
    if (isCarousel && currentSlideIndex > 0 && slides[currentSlideIndex]) {
      return slides[currentSlideIndex].url
    }
    return api.thumbnailUrl(item.id)
  }, [isCarousel, slides, currentSlideIndex, item.id])

  const handleImageError = useCallback((e) => {
    const cur = slides[currentSlideIndex]
    if (cur?.remoteUrl && e.currentTarget.src !== cur.remoteUrl) {
      e.currentTarget.src = cur.remoteUrl
    } else if (e.currentTarget.src !== api.thumbnailUrl(item.id)) {
      e.currentTarget.src = api.thumbnailUrl(item.id)
    } else {
      setThumbFailed(true)
    }
  }, [slides, currentSlideIndex, item.id])

  const hasThumbnail = Boolean((item.thumbnail_path || item.url || slides.length > 0) && !thumbFailed)
  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)
  const favicon = getFaviconUrl(item.url)
  const deduplicatedSummary = useMemo(() => getDeduplicatedSummary(item), [item])

  const hasVideoResource = useMemo(() => {
    return parsedResources.some(
      (r) => r && (r.type === 'video' || r.type === 'mp4' || (typeof r.url === 'string' && /\.(mp4|mov|webm)(\?|$)/i.test(r.url)))
    )
  }, [parsedResources])

  const hasLocalVideo = Boolean(
    (item.media_path && /\.(mp4|mov|webm)(\?|$)/i.test(item.media_path)) ||
    (item.storage_provider === 'google_drive' && (item.kind === 'video' || item.is_reel))
  )
  const urlLower = (item.url || '').toLowerCase()
  const isDirectVideoUrl = /\.(mp4|mov|webm)(\?|$)/i.test(urlLower)
  const isReelOrShort = urlLower.includes('/reel/') || urlLower.includes('/reels/') || urlLower.includes('/shorts/')
  const youtubeId = useMemo(() => extractYoutubeId(item.url), [item.url])
  const isYouTube = app === 'youtube' || Boolean(youtubeId)

  const isVideo = (
    item.kind === 'video' ||
    app === 'youtube' ||
    app === 'tiktok' ||
    isReelOrShort ||
    hasLocalVideo ||
    hasVideoResource ||
    isDirectVideoUrl ||
    (app === 'instagram' && (item.duration_seconds || isReelOrShort)) ||
    (app === 'x' && (hasVideoResource || item.kind === 'video')) ||
    (app === 'reddit' && (urlLower.includes('v.redd.it') || item.kind === 'video')) ||
    (item.duration_seconds > 0 && item.kind !== 'podcast' && item.kind !== 'music')
  )

  const isVertical = (
    isReelOrShort ||
    app === 'tiktok' ||
    app === 'pinterest' ||
    Boolean(item.is_reel) ||
    (app === 'instagram' && (item.duration_seconds > 0 || item.kind === 'video' || hasLocalVideo))
  )

  const isSlidePost = (
    (app === 'instagram' && !isVertical) ||
    item.kind === 'post' ||
    isCarousel
  )

  const isNote = item.kind === 'note' || (!hasThumbnail && !item.url)

  const cardVariant = variant || (
    isFeatured ? 'wide' :
    isNote ? 'note' :
    isVertical ? 'portrait' :
    isSlidePost ? 'square' :
    isVideo ? 'landscape' : 'standard'
  )

  const hasMediaFallback = !hasThumbnail && Boolean(
    hasLocalVideo || isDirectVideoUrl || youtubeId || (item.duration_seconds > 0 && item.kind !== 'podcast' && item.kind !== 'music') || (item.kind === 'video' && item.url)
  )

  // Explicit, reliable dates that are NEVER hidden
  const rawDate = item.consumed_on || item.created_at
  const dateShort = useMemo(() => formatDisplayDate(rawDate, false), [rawDate])
  const dateFull = useMemo(() => formatDisplayDate(rawDate, true), [rawDate])



  // Extract detected song / music track
  const musicResource = useMemo(() => {
    return parsedResources.find(
      (r) => r && typeof r === 'object' && (r.type === 'music' || r.type === 'song') && r.name
    ) || null
  }, [parsedResources])

  // Extract external discovered links
  const linkResources = useMemo(() => {
    return parsedResources
      .filter((r) => r && typeof r === 'object' && Boolean(r.url) && r.type !== 'music')
  }, [parsedResources])

  // Deduplicate and filter tags (max 3 displayed to prevent cutoff, with +N counter)
  const { visibleTags, extraTagsCount } = useMemo(() => {
    if (!item.tags || !Array.isArray(item.tags)) return { visibleTags: [], extraTagsCount: 0 }
    const appLower = (app || '').toLowerCase()
    const catLower = (item.category || '').toLowerCase()
    const kindLower = (item.kind || '').toLowerCase()
    const authorLower = (item.author || '').toLowerCase().replace(/^[@/u/]+/, '')
    const deduped = []
    for (const t of item.tags) {
      if (!t || typeof t !== 'string') continue
      const clean = t.trim().toLowerCase().replace(/^#+/, '')
      if (!clean || clean.length < 2) continue
      if (clean === appLower || clean === catLower || clean === kindLower || clean === authorLower) continue
      if (clean === 'general' || clean === 'post' || clean === 'other' || clean === 'video' || clean === 'article') continue
      if (!deduped.includes(clean)) {
        deduped.push(clean)
      }
    }
    const maxVisible = cardVariant === 'wide' ? 4 : 3
    return {
      visibleTags: deduped.slice(0, maxVisible),
      extraTagsCount: Math.max(0, deduped.length - maxVisible),
    }
  }, [item.tags, app, item.category, item.kind, item.author, cardVariant])

  const sourceLabel = useMemo(() => {
    if (app === 'reddit') {
      if (item.subreddit) return `r/${item.subreddit.replace(/^r\//, '')}`
      return domain || 'reddit.com'
    }
    if (item.author) {
      const a = item.author.trim()
      if (a.startsWith('@') || a.startsWith('/u/')) return a
      if (app === 'x' || app === 'instagram' || app === 'tiktok' || app === 'threads') {
        return `@${a}`
      }
      return a
    }
    if (domain) return domain
    if (item.site) return item.site
    if (isNote) return 'Personal Note'
    return 'Resource'
  }, [app, item.subreddit, item.author, domain, item.site, isNote])

  const handleCardClick = (e) => {
    if (e.target.closest('a, button, input, .lib-tag-pill, .lib-dock-btn, .lib-card-link-chip, .lib-card-tag-badge, .lib-overflow-menu, .lib-card-status-pill')) return
    onSelect?.(item)
  }

  // Reading time or duration
  const readTimeMeta = useMemo(() => {
    if (item.word_count) {
      const mins = Math.max(1, Math.round(item.word_count / 200))
      return `${mins} min read`
    }
    return null
  }, [item.word_count])

  const durationMeta = useMemo(() => {
    if (item.duration) return formatDuration(item.duration)
    return null
  }, [item.duration])

  // Semantic rating tier
  const ratingTier = useMemo(() => getRatingTier(item.rating), [item.rating])

  // Progress handling
  const effectiveKind = isVideo ? 'video' : item.kind || 'article'
  const isTrackable = isTrackableKind(item.kind, isVideo)
  const currentProgress = item.progress || 'unstarted'
  const showProgressBadge = Boolean(item.progress && item.progress !== '')
  const progressLabel = useMemo(
    () => getProgressLabel(effectiveKind, currentProgress),
    [effectiveKind, currentProgress]
  )
  const nextProgress = useMemo(
    () => getNextProgress(currentProgress),
    [currentProgress]
  )
  const nextProgressLabel = useMemo(
    () => getProgressLabel(effectiveKind, nextProgress),
    [effectiveKind, nextProgress]
  )

  return (
    <article
      ref={cardRef}
      data-item-id={item.id}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`lib-card lib-card--${cardVariant} ${isPost ? 'lib-card--post' : ''} ${isLiveProcessing ? 'lib-card--processing' : ''} ${item.rating === 5 ? 'lib-card--essential' : ''} ${isDragOver ? 'lib-card--drag-over' : ''} ${isDragged ? 'lib-card--dragged' : ''}`}
      onClick={handleCardClick}
      aria-label={item.title || 'Knowledge resource'}
    >
      {/* Flush Hero Media with Native Video and Carousel Navigation */}
      {hasThumbnail ? (
        <div className="lib-card-media-wrap">
          <div className="lib-card-media">
            {isPlayingVideo ? (
              <div className="lib-card-video-active-wrap" onClick={(e) => e.stopPropagation()}>
                {isYouTube && youtubeId && !hasLocalVideo ? (
                  <iframe
                    className="lib-card-native-video"
                    src={`https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&rel=0&playsinline=1`}
                    title={item.title || 'Video player'}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <video
                    className="lib-card-native-video"
                    src={api.mediaUrl(item.id)}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    onEnded={() => setIsPlayingVideo(false)}
                  />
                )}
                <HouseButton
                  type="button"
                  className="lib-card-video-close-btn"
                  aria-label="Close video player"
                  title="Close video"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsPlayingVideo(false)
                  }}
                >
                  <Icon name="x" size={12} />
                </HouseButton>
              </div>
            ) : (
              <>
                <img
                  className="lib-card-media-img"
                  src={currentImageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={handleImageError}
                />
                {/* Subtle bottom vignette only */}
                <div className="lib-card-media-scrim" aria-hidden="true" />

                {/* Top-Left Platform Badge */}
                {(app || item.kind) && (
                  <div className="lib-card-platform-pill">
                    <Icon
                      name={
                        app === 'pinterest' ? 'pin' :
                        app === 'youtube' ? 'play' :
                        app === 'instagram' ? 'spark' :
                        app === 'threads' ? 'threads' :
                        app === 'tiktok' ? 'play' :
                        app === 'spotify' ? 'music' :
                        app === 'github' ? 'code' :
                        app === 'x' ? 'chat' :
                        KIND_ICON[item.kind] || 'link'
                      }
                      size={10}
                    />
                    <span>{app ? app.toUpperCase() : item.kind.toUpperCase()}</span>
                  </div>
                )}

                {/* Center Frosted Play Button for Videos / Reels */}
                {(isVideo || duration || hasLocalVideo) && (
                  <HouseButton
                    type="button"
                    className="lib-card-play-btn"
                    aria-label="Play video"
                    title="Play video"
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsPlayingVideo(true)
                    }}
                  >
                    <Icon name="play" size={16} />
                  </HouseButton>
                )}

                {/* Top-Right Multi-Image Carousel Badge & Slide Controls */}
                {isCarousel && (
                  <>
                    <div className="lib-card-carousel-pill" aria-label={`Slide ${currentSlideIndex + 1} of ${slideCount}`}>
                      <Icon name="copy" size={10} />
                      <span>{currentSlideIndex + 1}/{slideCount}</span>
                    </div>

                    {currentSlideIndex > 0 && (
                      <HouseButton
                        type="button"
                        className="lib-card-slide-nav lib-card-slide-nav--prev"
                        aria-label="Previous slide"
                        title="Previous slide"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCurrentSlideIndex((idx) => Math.max(0, idx - 1))
                        }}
                      >
                        <Icon name="chevron-left" size={12} />
                      </HouseButton>
                    )}

                    {currentSlideIndex < slideCount - 1 && (
                      <HouseButton
                        type="button"
                        className="lib-card-slide-nav lib-card-slide-nav--next"
                        aria-label="Next slide"
                        title="Next slide"
                        onClick={(e) => {
                          e.stopPropagation()
                          setCurrentSlideIndex((idx) => Math.min(slideCount - 1, idx + 1))
                        }}
                      >
                        <Icon name="chevron-right" size={12} />
                      </HouseButton>
                    )}

                    {/* Bottom Slide Dots */}
                    <div className="lib-card-slide-dots" onClick={(e) => e.stopPropagation()}>
                      {slides.map((_, idx) => (
                        <HouseButton
                          key={idx}
                          type="button"
                          aria-label={`Slide ${idx + 1}`}
                          className={`lib-card-slide-dot ${idx === currentSlideIndex ? 'lib-card-slide-dot--active' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setCurrentSlideIndex(idx)
                          }}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Bottom-Right Duration Badge */}
                {duration && (
                  <div className="lib-card-media-overlay">
                    <span className="lib-card-duration-badge">{duration}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : hasMediaFallback ? (
        <div className="lib-card-media-wrap">
          <div className="lib-card-media lib-card-media--fallback">
            <div className="lib-card-fallback-glow" />
            <div className="lib-card-fallback-center">
              <span className="lib-card-fallback-icon">
                <Icon
                  name={
                    app === 'youtube' ? 'play' :
                    app === 'instagram' ? 'spark' :
                    app === 'threads' ? 'threads' :
                    app === 'spotify' ? 'music' :
                    app === 'github' ? 'code' :
                    app === 'x' ? 'chat' :
                    KIND_ICON[item.kind] || 'video'
                  }
                  size={24}
                />
              </span>
              <span className="lib-card-fallback-label">
                {item.category && item.category !== 'general' ? item.category : (sourceLabel || 'Media')}
              </span>
            </div>

            {/* Top-Left Platform Badge */}
            <div className="lib-card-platform-pill">
              <Icon
                name={
                  app === 'pinterest' ? 'pin' :
                  app === 'youtube' ? 'play' :
                  app === 'instagram' ? 'spark' :
                  app === 'threads' ? 'threads' :
                  app === 'tiktok' ? 'play' :
                  app === 'spotify' ? 'music' :
                  app === 'github' ? 'code' :
                  app === 'x' ? 'chat' :
                  KIND_ICON[item.kind] || 'link'
                }
                size={10}
              />
              <span>{app ? app.toUpperCase() : item.kind.toUpperCase()}</span>
            </div>

            {duration && (
              <div className="lib-card-media-overlay">
                <span className="lib-card-duration-badge">{duration}</span>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Card Content Core */}
      <div className={`lib-card-body ${!hasThumbnail && !hasMediaFallback ? 'lib-card-body--textonly' : ''} ${isPost ? 'lib-card-body--post' : ''}`}>
        {/* Source metadata strip (prevents duplicate platform mentions) */}
        <div className="lib-card-source-row">
          <div className="lib-card-source-left">
            {authorAvatar ? (
              <img
                className="lib-card-author-avatar"
                src={authorAvatar}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : favicon ? (
              <img
                className="lib-card-favicon"
                src={favicon}
                alt=""
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              <span className="lib-card-kind-icon">
                <Icon name={isNote ? 'file-text' : KIND_ICON[item.kind] || 'link'} size={12} />
              </span>
            )}
            <span className="lib-card-domain">
              {sourceLabel}
            </span>

            {Boolean(item.is_pinned) && (
              <span className="lib-card-pinned-chip" title="Pinned to top">
                <Icon name="pin" size={10} className="text-amber-500" />
              </span>
            )}

            {item.author && app === 'reddit' && (
              <span className="lib-card-author" title={item.author}>
                · {item.author.startsWith('/u/') ? item.author : `/u/${item.author}`}
              </span>
            )}
          </div>

          <div className="lib-card-source-right">
            {!hasThumbnail && (!app || !(domain || '').toLowerCase().includes(app.toLowerCase())) && (
              <span className="lib-card-kind-badge">
                <span>{app ? app.toUpperCase() : (item.kind || 'article').toUpperCase()}</span>
              </span>
            )}

            {!isOptimistic && (
              <div className="lib-card-inline-actions" role="toolbar" aria-label="Card quick actions" onClick={(e) => e.stopPropagation()}>
                {isDraggable && (
                  <span
                    className="lib-card-action-btn lib-card-drag-handle"
                    title="Drag to rearrange"
                    aria-label="Drag to rearrange"
                  >
                    <Icon name="dots-six" size={13} />
                  </span>
                )}

                <HouseButton
                  type="button"
                  className={`lib-card-action-btn ${item.is_pinned ? 'lib-card-action-btn--pinned' : ''}`}
                  title={item.is_pinned ? 'Unpin from top' : 'Pin to top'}
                  aria-label={item.is_pinned ? 'Unpin from top' : 'Pin to top'}
                  onClick={() => onTogglePin ? onTogglePin(item) : api.updateLibraryItem(item.id, { is_pinned: !item.is_pinned })}
                >
                  <Icon name="pin" size={12} className={item.is_pinned ? 'text-amber-500 fill-amber-500' : ''} />
                </HouseButton>

                <div className="lib-overflow-wrap" ref={moreMenuRef}>
                  <HouseButton
                    type="button"
                    className={`lib-card-action-btn ${showMoreMenu ? 'lib-card-action-btn--active' : ''}`}
                    title="More actions"
                    aria-label="More actions"
                    aria-haspopup="true"
                    aria-expanded={showMoreMenu}
                    onClick={() => setShowMoreMenu((v) => !v)}
                  >
                    <Icon name="dots" size={13} />
                  </HouseButton>

                  {showMoreMenu && (
                    <div className="lib-overflow-menu" role="menu">
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="lib-overflow-row"
                          role="menuitem"
                          onClick={() => setShowMoreMenu(false)}
                        >
                          <Icon name="link" size={13} />
                          <span>Open original URL</span>
                        </a>
                      )}

                      {!item.summary && (
                        <button
                          type="button"
                          role="menuitem"
                          className="lib-overflow-row"
                          disabled={busy}
                          onClick={() => {
                            setShowMoreMenu(false)
                            onEnrich?.(item)
                          }}
                        >
                          <Icon name="spark" size={13} />
                          <span>Read & synthesize (AI)</span>
                        </button>
                      )}

                      {item.indexed && (
                        <button
                          type="button"
                          role="menuitem"
                          className="lib-overflow-row"
                          disabled={busy}
                          onClick={() => {
                            setShowMoreMenu(false)
                            onReindex?.(item)
                          }}
                        >
                          <Icon name="refresh" size={13} />
                          <span>Re-index embeddings</span>
                        </button>
                      )}

                      <div className="lib-overflow-hr" />

                      <button
                        type="button"
                        role="menuitem"
                        className="lib-overflow-row lib-overflow-row--danger"
                        disabled={busy}
                        onClick={() => {
                          setShowMoreMenu(false)
                          onDelete?.(item)
                        }}
                      >
                        <Icon name="trash" size={13} />
                        <span>Delete from library</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <h3 className="lib-card-title">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {item.title || 'Untitled Resource'}
            </a>
          ) : (
            item.title || 'Untitled Resource'
          )}
        </h3>

        {/* Kind-aware Interactive Progress Status Badge */}
        {showProgressBadge && progressLabel && (
          <div className="lib-card-status-row" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`lib-card-status-pill lib-card-status-pill--${currentProgress} lib-card-status-pill--clickable`}
              title={`Progress: ${progressLabel}. Click to mark as ${nextProgressLabel || 'next'}.`}
              aria-label={`Progress: ${progressLabel}. Click to mark as ${nextProgressLabel || 'next'}.`}
              onClick={() => {
                const next = getNextProgress(currentProgress)
                onProgressChange ? onProgressChange(item, next) : api.updateLibraryItem(item.id, { progress: next })
              }}
            >
              <Icon
                name={
                  currentProgress === 'completed'
                    ? 'check'
                    : currentProgress === 'in_progress'
                    ? (isVideo ? 'play' : 'book')
                    : 'bookmark'
                }
                size={11}
              />
              <span>{progressLabel}</span>
            </button>
          </div>
        )}

        {/* SaveToList Feature 2: Reminder Callout Banner */}
        {Boolean(item.remind_at) && (
          <div className="lib-card-reminder-row" onClick={(e) => e.stopPropagation()}>
            <LibraryReminderBanner
              item={item}
              variant="card"
              onSaveReminder={(patch) => onSaveReminder ? onSaveReminder(item, patch) : api.updateLibraryItem(item.id, patch)}
              onClearReminder={() => onClearReminder ? onClearReminder(item) : api.updateLibraryItem(item.id, { remind_at: null, reminded_at: null })}
            />
          </div>
        )}

        {/* Detected Music / Audio Track Pill */}
        {musicResource && (
          <div
            className="lib-card-music-chip"
            title={`Detected Audio: ${musicResource.name}${musicResource.detail ? ` by ${musicResource.detail}` : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="music" size={11} />
            <span className="lib-card-music-name">{musicResource.name}</span>
            {musicResource.detail && (
              <span className="lib-card-music-artist">· {musicResource.detail}</span>
            )}
          </div>
        )}

        {/* Processing State with Animated Skeleton */}
        {isLiveProcessing ? (
          <div className="lib-card-processing-status">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <AsciiSkeleton variant="dither" width={12} height={12} circle />
              <span style={{ fontWeight: 600 }}>
                {isOptimistic
                  ? 'Saving to library...'
                  : isReceived
                  ? 'Link queued for analysis...'
                  : isEnriching
                  ? 'AI analyzing and summarizing...'
                  : 'Processing media & transcript...'}
              </span>
            </div>
            <div className="lib-card-skel-lines">
              <AsciiSkeleton variant="scan" lines={2} widths={['90%', '65%']} />
            </div>
          </div>
        ) : deduplicatedSummary ? (
          <p className={`lib-card-summary ${!item.summary && item.notes ? 'lib-card-summary--notes' : ''}`}>
            {renderFormattedSummary(deduplicatedSummary)}
          </p>
        ) : null}

        {/* Tags Row with +N anti-clipping protection */}
        {visibleTags.length > 0 && (
          <div className="lib-card-tags-row">
            {visibleTags.map((tag) => (
              <HouseButton
                type="button"
                key={tag}
                className="lib-card-tag-badge"
                title={`Filter by #${tag}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick?.(tag)
                }}
              >
                <span className="lib-tag-hash">#</span>
                <span>{tag}</span>
              </HouseButton>
            ))}
            {extraTagsCount > 0 && (
              <span
                className="lib-card-extra-tags-badge"
                title={`${extraTagsCount} more tags`}
              >
                +{extraTagsCount}
              </span>
            )}
          </div>
        )}

        {/* Discovered Mentions & External Tool Chips */}
        {linkResources.length > 0 && (
          <div className="lib-card-resources-row" onClick={(e) => e.stopPropagation()}>
            <div className="lib-card-resources-pills">
              {linkResources.slice(0, 2).map((res, i) => {
                const fav = getFaviconUrl(res.url)
                const dName = res.name || getDomain(res.url)
                return (
                  <a
                    key={i}
                    href={res.url}
                    target="_blank"
                    rel="noreferrer"
                    className="lib-card-resource-chip"
                    title={`${dName} — ${res.detail || 'External resource'}`}
                  >
                    {fav ? (
                      <img
                        src={fav}
                        alt=""
                        className="lib-card-resource-fav"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                    ) : (
                      <Icon name="link" size={9} />
                    )}
                    <span>{dName}</span>
                    <Icon name="arrow-up-right" size={8} className="opacity-60" />
                  </a>
                )
              })}
              {linkResources.length > 2 && (
                <span className="lib-card-resource-more">+{linkResources.length - 2} tools</span>
              )}
            </div>
          </div>
        )}

        {/* Pinned Card Footer: Date, Duration / Reading time, and Rating Badge */}
        <div className="lib-card-footer">
          <div className="lib-card-footer-left">
            <Icon name="calendar" size={11} className="opacity-75" />
            <span className="lib-card-date">
              {dateFull || 'Undated'}
            </span>
            {(!hasThumbnail && !hasMediaFallback && durationMeta) ? (
              <>
                <span className="lib-card-dot">·</span>
                <span className="lib-card-duration">{durationMeta}</span>
              </>
            ) : readTimeMeta ? (
              <>
                <span className="lib-card-dot">·</span>
                <span className="lib-card-readtime">{readTimeMeta}</span>
              </>
            ) : null}
          </div>

          {/* Meaningful Semantic Rating Indicator */}
          {ratingTier && (
            <div
              className={`lib-card-rating-badge ${ratingTier.badgeClass}`}
              title={`Curator Tier: ${ratingTier.label} (${ratingTier.stars}/5) — ${ratingTier.description}`}
            >
              <Icon name="star" size={11} filled />
              <span>{ratingTier.shortLabel}</span>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

export const LibraryCard = memo(LibraryCardComponent)
export default LibraryCard
