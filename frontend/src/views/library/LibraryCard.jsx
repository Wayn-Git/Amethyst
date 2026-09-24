import { memo, useMemo, useRef, useState, useCallback } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { getRatingTier } from './ratingUtils.js'
import { formatDisplayDate } from './dateUtils.js'

export const KIND_ICON = {
  article: 'book',
  book: 'book',
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

export function getDomain(url, site) {
  if (site) return site.replace(/^www\./i, '').toUpperCase()
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return (parsed.hostname || '').replace(/^www\./i, '').toUpperCase()
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
}) {
  const cardRef = useRef(null)
  const status = item.status || 'ready'
  const isOptimistic = Boolean(item.isOptimistic)
  const isReceived = status === 'received'
  const isProcessing = Boolean(item.isProcessing) || status === 'processing'
  const isEnriching = status === 'enriching' || busy
  const isLiveProcessing = isOptimistic || isReceived || isProcessing || isEnriching

  const [thumbFailed, setThumbFailed] = useState(false)
  const hasThumbnail = Boolean(item.thumbnail_path) && !thumbFailed
  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)
  const favicon = getFaviconUrl(item.url)
  const app = getAppFromItem(item)

  const isVideo = item.kind === 'video' || app === 'youtube' || app === 'instagram' || app === 'tiktok'
  const isVertical = app === 'instagram' || app === 'tiktok' || app === 'pinterest' || (item.kind === 'video' && app !== 'youtube')
  const isNote = item.kind === 'note' || (!hasThumbnail && !item.url)

  const cardVariant = variant || (
    isFeatured ? 'wide' :
    isNote ? 'note' :
    isVertical ? 'portrait' :
    isVideo ? 'landscape' : 'standard'
  )

  // Explicit, reliable dates that are NEVER hidden
  const rawDate = item.consumed_on || item.created_at
  const dateShort = useMemo(() => formatDisplayDate(rawDate, false), [rawDate])
  const dateFull = useMemo(() => formatDisplayDate(rawDate, true), [rawDate])

  // Spotlight mouse tracking (MagicUI / Apple spotlight effect)
  const handleMouseMove = useCallback((e) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    cardRef.current.style.setProperty('--mouse-x', `${x}px`)
    cardRef.current.style.setProperty('--mouse-y', `${y}px`)
  }, [])

  // Extract detected song / music track
  const musicResource = useMemo(() => {
    if (!item.resources || !Array.isArray(item.resources)) return null
    return item.resources.find(
      (r) => r && typeof r === 'object' && (r.type === 'music' || r.type === 'song') && r.name
    )
  }, [item.resources])

  // Extract external discovered links
  const linkResources = useMemo(() => {
    if (!item.resources || !Array.isArray(item.resources)) return []
    return item.resources
      .filter((r) => r && typeof r === 'object' && Boolean(r.url) && r.type !== 'music')
  }, [item.resources])

  // Deduplicate and filter tags (max 3 displayed to prevent cutoff, with +N counter)
  const { visibleTags, extraTagsCount } = useMemo(() => {
    if (!item.tags || !Array.isArray(item.tags)) return { visibleTags: [], extraTagsCount: 0 }
    const appLower = (app || '').toLowerCase()
    const catLower = (item.category || '').toLowerCase()
    const deduped = []
    for (const t of item.tags) {
      if (!t || typeof t !== 'string') continue
      const clean = t.trim().toLowerCase()
      if (clean === appLower || clean === catLower) continue
      if (clean === 'general' || clean === 'post' || clean === 'other') continue
      if (!deduped.includes(clean)) {
        deduped.push(clean)
      }
    }
    const maxVisible = cardVariant === 'wide' ? 4 : 3
    return {
      visibleTags: deduped.slice(0, maxVisible),
      extraTagsCount: Math.max(0, deduped.length - maxVisible),
    }
  }, [item.tags, app, item.category, cardVariant])

  const handleCardClick = (e) => {
    if (e.target.closest('a, button, .lib-tag-pill, .lib-dock-btn, .lib-card-link-chip, .lib-card-tag-badge')) return
    onSelect?.(item)
  }

  // Reading time or word count
  const readTimeMeta = useMemo(() => {
    if (item.word_count) {
      const mins = Math.max(1, Math.round(item.word_count / 200))
      return `${mins} min read`
    }
    return null
  }, [item.word_count])

  // Semantic rating tier
  const ratingTier = useMemo(() => getRatingTier(item.rating), [item.rating])

  return (
    <article
      ref={cardRef}
      data-item-id={item.id}
      className={`lib-card lib-card--${cardVariant} ${isLiveProcessing ? 'lib-card--processing' : ''} ${item.rating === 5 ? 'lib-card--essential' : ''}`}
      onClick={handleCardClick}
      onMouseMove={handleMouseMove}
      tabIndex={0}
      role="button"
      aria-label={`Inspect ${item.title || 'knowledge resource'}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (!e.target.closest('a, button, .lib-tag-pill, .lib-dock-btn, .lib-card-link-chip, .lib-card-tag-badge')) {
            e.preventDefault()
            onSelect?.(item)
          }
        }
      }}
    >
      {/* Spotlight glow layer */}
      <div className="lib-card-spotlight" aria-hidden="true" />

      {/* Floating Action Dock */}
      {!isOptimistic && (
        <div className="lib-card-action-dock" role="toolbar" aria-label="Card quick actions">
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="lib-dock-btn"
              title="Open original website"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="link" size={13} />
            </a>
          )}
          {item.indexed && !item.summary && (
            <button
              type="button"
              className="lib-dock-btn"
              disabled={busy}
              title="Read & synthesize with AI"
              onClick={(e) => {
                e.stopPropagation()
                onEnrich?.(item)
              }}
            >
              <Icon name="brain" size={13} />
            </button>
          )}
          {item.indexed && (
            <button
              type="button"
              className="lib-dock-btn"
              disabled={busy}
              title="Re-index embeddings"
              onClick={(e) => {
                e.stopPropagation()
                onReindex?.(item)
              }}
            >
              <Icon name="refresh" size={13} />
            </button>
          )}
          <button
            type="button"
            className="lib-dock-btn lib-dock-btn--danger"
            disabled={busy}
            title="Delete from library"
            onClick={(e) => {
              e.stopPropagation()
              onDelete?.(item)
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      )}

      {/* Modern Edge-To-Edge Bento Media or Header */}
      {hasThumbnail ? (
        <div className="lib-card-media-wrap lib-card-media-framed">
          <div className="lib-card-media">
            <img
              className="lib-card-media-img"
              src={api.thumbnailUrl(item.id)}
              alt=""
              loading="lazy"
              onError={() => setThumbFailed(true)}
            />
            {/* Ambient Dark Gradient Scrim */}
            <div className="lib-card-media-scrim" aria-hidden="true" />

            {/* Top-Left Platform Glass Badge */}
            {(app || item.kind) && (
              <div className="lib-card-platform-pill">
                <Icon
                  name={
                    app === 'pinterest' ? 'pin' :
                    app === 'youtube' ? 'play' :
                    app === 'instagram' ? 'spark' :
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
            {(isVideo || duration) && (
              <div className="lib-card-play-btn" aria-hidden="true">
                <Icon name="play" size={14} />
              </div>
            )}

            {/* Bottom-Right Duration Badge */}
            {duration && (
              <div className="lib-card-media-overlay">
                <span className="lib-card-duration-badge">{duration}</span>
              </div>
            )}
          </div>
        </div>
      ) : isNote ? (
        <div className="lib-card-note-header">
          <div className="lib-card-note-badge">
            <Icon name="file-text" size={11} />
            <span>NOTE</span>
          </div>
          {dateShort && (
            <span className="lib-card-note-date" title={`Captured on ${dateFull}`}>
              <Icon name="calendar" size={10} />
              <span>{dateShort}</span>
            </span>
          )}
        </div>
      ) : (app || isVideo || item.kind === 'podcast' || item.kind === 'music') ? (
        <div className="lib-card-ambient-banner">
          <div className="lib-card-ambient-icon">
            <Icon name={app === 'pinterest' ? 'pin' : app === 'youtube' ? 'play' : KIND_ICON[item.kind] || 'link'} size={18} />
          </div>
          <span className="lib-card-ambient-brand">{app ? app.toUpperCase() : item.kind.toUpperCase()}</span>
          {dateShort && (
            <span className="lib-card-top-date" style={{ marginLeft: 6 }}>
              · {dateShort}
            </span>
          )}
          {duration && <span className="lib-card-duration-badge" style={{ marginLeft: 'auto' }}>{duration}</span>}
        </div>
      ) : null}

      {/* Card Content Core */}
      <div className="lib-card-body">
        {/* Source & Date metadata strip (hidden on notes since note header has it) */}
        {!isNote && (
          <div className="lib-card-source-row">
          <div className="lib-card-source-left">
            {favicon ? (
              <img
                className="lib-card-favicon"
                src={favicon}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : null}
            <span className="lib-card-domain">
              {domain || item.site || (item.kind === 'note' ? 'NOTE' : 'LOCAL')}
            </span>

            {item.author && (
              <span className="lib-card-author" title={item.author}>
                · {item.author}
              </span>
            )}
          </div>

          <div className="lib-card-source-right">
            {dateShort && (
              <span className="lib-card-top-date" title={`Captured on ${dateFull}`}>
                <Icon name="calendar" size={10} />
                <span>{dateShort}</span>
              </span>
            )}
            <span className="lib-card-kind-badge">
              <Icon name={KIND_ICON[item.kind] || 'link'} size={11} />
              <span>{app || item.kind || 'article'}</span>
            </span>
          </div>
        </div>
        )}

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
              <span className="lib-card-spinner" />
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
              <span className="lib-skel" style={{ width: '90%', height: 8 }} />
              <span className="lib-skel" style={{ width: '65%', height: 8 }} />
            </div>
          </div>
        ) : item.summary ? (
          <p className="lib-card-summary">{item.summary}</p>
        ) : item.excerpt ? (
          <p className="lib-card-summary">{item.excerpt}</p>
        ) : item.notes ? (
          <p className="lib-card-summary lib-card-summary--notes">{item.notes}</p>
        ) : (item.capture_note || item.enrichment_note) ? (
          <p className="lib-card-summary" style={{ color: 'var(--text-faint)' }}>
            <Icon name="info" size={11} /> {item.capture_note || item.enrichment_note}
          </p>
        ) : null}

        {/* Discovered External Links (compact) */}
        {linkResources.length > 0 && (
          <div className="lib-card-link-resources" onClick={(e) => e.stopPropagation()}>
            <a
              href={linkResources[0].url}
              target="_blank"
              rel="noreferrer"
              className="lib-card-link-chip"
              title={`${linkResources[0].name}: ${linkResources[0].url}`}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="link" size={10} />
              <span className="lib-card-link-name">{linkResources[0].name}</span>
              <span className="lib-card-link-arrow">↗</span>
            </a>
            {linkResources.length > 1 && (
              <span
                className="lib-card-extra-links-chip"
                title={linkResources.slice(1).map((r) => r.name || r.url).join(', ')}
              >
                +{linkResources.length - 1}
              </span>
            )}
          </div>
        )}

        {/* Tags Row with +N anti-clipping protection */}
        {visibleTags.length > 0 && (
          <div className="lib-card-tags-row">
            {visibleTags.map((tag) => (
              <button
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
              </button>
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

        {/* Pinned Card Footer: Date, Reading time, and Meaningful Rating Badge */}
        <div className="lib-card-footer">
          <div className="lib-card-footer-left">
            <Icon name="calendar" size={11} className="opacity-75" />
            <span className="lib-card-date">
              {dateFull || 'Undated'}
            </span>
            {readTimeMeta && (
              <>
                <span className="lib-card-dot">·</span>
                <span className="lib-card-readtime">{readTimeMeta}</span>
              </>
            )}
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
