import { memo, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api, fmtDate } from '../../api.js'

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
  if (url.includes('x.com') || url.includes('twitter.')) return 'x'
  if (url.includes('github.')) return 'github'
  if (url.includes('reddit.')) return 'reddit'
  if (url.includes('spotify.')) return 'spotify'
  return null
}

function LibraryCardComponent({
  item,
  busy,
  onSelect,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
}) {
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

  const mediaAspect = useMemo(() => {
    if (app === 'instagram' || app === 'tiktok') return '9 / 13'
    if (app === 'pinterest') return '2 / 3'
    if (app === 'youtube' || item.kind === 'video') return '16 / 9'
    return '16 / 9'
  }, [app, item.kind])

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
      .slice(0, 3)
  }, [item.resources])

  // Deduplicate and filter tags
  const visibleTags = useMemo(() => {
    if (!item.tags || !Array.isArray(item.tags)) return []
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
    return deduped.slice(0, 4)
  }, [item.tags, app, item.category])

  const handleCardClick = (e) => {
    if (e.target.closest('a, button, .lib-tag-pill, .lib-dock-btn, .lib-card-link-chip')) return
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

  return (
    <article
      data-item-id={item.id}
      className={`lib-card ${isLiveProcessing ? 'lib-card--processing' : ''}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={`Inspect ${item.title || 'knowledge resource'}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (!e.target.closest('a, button, .lib-tag-pill, .lib-dock-btn')) {
            e.preventDefault()
            onSelect?.(item)
          }
        }
      }}
    >
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

      {/* Media Box or Ambient Header */}
      {hasThumbnail ? (
        <div className="lib-card-media" style={{ aspectRatio: mediaAspect }}>
          <img
            className="lib-card-media-img"
            src={api.thumbnailUrl(item.id)}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
          <div className="lib-card-media-overlay">
            {duration && <span className="lib-card-duration-badge">{duration}</span>}
          </div>
        </div>
      ) : (app || item.kind === 'video' || item.kind === 'podcast' || item.kind === 'music') ? (
        <div className="lib-card-ambient-banner">
          <div className="lib-card-ambient-icon">
            <Icon name={app === 'pinterest' ? 'pin' : app === 'youtube' ? 'play' : KIND_ICON[item.kind] || 'link'} size={22} />
          </div>
          <span className="lib-card-ambient-brand">{app ? app.toUpperCase() : item.kind.toUpperCase()}</span>
          {duration && <span className="lib-card-duration-badge" style={{ marginLeft: 'auto' }}>{duration}</span>}
        </div>
      ) : null}

      {/* Card Content Core */}
      <div className="lib-card-body">
        {/* Source metadata strip */}
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
              <>
                <span className="lib-card-dot">·</span>
                <span className="lib-card-author">{item.author}</span>
              </>
            )}
          </div>
          <span className="lib-card-kind-badge">
            <Icon name={KIND_ICON[item.kind] || 'link'} size={11} />
            <span>{app || item.kind || 'article'}</span>
          </span>
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

        {/* Detected Music / Audio Track Pill */}
        {musicResource && (
          <div
            className="lib-card-music-chip"
            title={`Detected Audio: ${musicResource.name}${musicResource.detail ? ` by ${musicResource.detail}` : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="music" size={12} />
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
              <span className="lib-skel" style={{ width: '90%', height: 9 }} />
              <span className="lib-skel" style={{ width: '65%', height: 9 }} />
            </div>
          </div>
        ) : item.summary ? (
          <p className="lib-card-summary">{item.summary}</p>
        ) : item.excerpt ? (
          <p className="lib-card-summary">{item.excerpt}</p>
        ) : item.notes ? (
          <p className="lib-card-summary lib-card-summary--notes">{item.notes}</p>
        ) : item.capture_note ? (
          <p className="lib-card-summary" style={{ color: 'var(--text-faint)' }}>
            <Icon name="info" size={11} /> {item.capture_note}
          </p>
        ) : null}

        {/* Discovered External Links */}
        {linkResources.length > 0 && (
          <div className="lib-card-link-resources" onClick={(e) => e.stopPropagation()}>
            {linkResources.map((res, i) => {
              const resDomain = getDomain(res.url)
              return (
                <a
                  key={i}
                  href={res.url}
                  target="_blank"
                  rel="noreferrer"
                  className="lib-card-link-chip"
                  title={`${res.name}: ${res.url}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icon name="link" size={11} />
                  <span className="lib-card-link-name">{res.name}</span>
                  {resDomain && <span className="lib-card-link-domain">{resDomain}</span>}
                  <span className="lib-card-link-arrow">↗</span>
                </a>
              )
            })}
          </div>
        )}

        {/* Beautiful Modern Tags Pill Row Under Cards */}
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
          </div>
        )}

        {/* Card Footer: Date, Reading time, Rating */}
        <div className="lib-card-footer">
          <div className="lib-card-footer-left">
            <span className="lib-card-date">
              {fmtDate(item.consumed_on || item.created_at)}
            </span>
            {readTimeMeta && (
              <>
                <span className="lib-card-dot">·</span>
                <span className="lib-card-readtime">{readTimeMeta}</span>
              </>
            )}
          </div>

          {item.rating ? (
            <div className="lib-card-rating-stars" title={`Rated ${item.rating} star${item.rating !== 1 ? 's' : ''}`}>
              {Array.from({ length: item.rating }).map((_, i) => (
                <Icon key={i} name="star" size={11} filled />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export const LibraryCard = memo(LibraryCardComponent)
export default LibraryCard
