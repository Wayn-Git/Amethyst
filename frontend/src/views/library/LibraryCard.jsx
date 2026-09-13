import { memo, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api, fmtDate } from '../../api.js'

export const KIND_ICON = {
  article: 'book',
  book: 'book',
  video: 'image',
  podcast: 'spark',
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
  const [thumbAspect, setThumbAspect] = useState(null)
  const [isTinyThumb, setIsTinyThumb] = useState(false)
  const hasThumbnail = Boolean(item.thumbnail_path) && !thumbFailed
  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)
  const favicon = getFaviconUrl(item.url)
  const app = getAppFromItem(item)

  const defaultAspect = useMemo(() => {
    if (app === 'instagram' || app === 'tiktok') return 9 / 16
    if (app === 'pinterest') return 2 / 3
    if (app === 'youtube' || item.kind === 'video') return 16 / 9
    return 16 / 9
  }, [app, item.kind])

  const handleThumbLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.currentTarget
    if (naturalWidth > 0 && naturalHeight > 0) {
      if (naturalWidth < 120 && naturalHeight < 120) {
        setIsTinyThumb(true)
      } else {
        setThumbAspect(naturalWidth / naturalHeight)
      }
    }
  }

  const linkResources = useMemo(() => {
    if (!item.resources || !Array.isArray(item.resources)) return []
    return item.resources
      .filter((r) => r && typeof r === 'object' && Boolean(r.url))
      .slice(0, 2)
  }, [item.resources])

  const hasRealMedia = hasThumbnail && !isTinyThumb
  const hasMedia = hasRealMedia || (!hasThumbnail && (app === 'instagram' || app === 'pinterest' || app === 'tiktok' || item.kind === 'video'))

  // Deduplicate tags against app and category, limit to top 2 high-signal tags
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
      if (deduped.length >= 2) break
    }
    return deduped
  }, [item.tags, app, item.category])

  const handleCardClick = (e) => {
    if (e.target.closest('a, button, .lib-tag-pill, .lib-card-link-chip')) return
    onSelect?.(item)
  }

  const kindLabel = app ? app.toUpperCase() : (item.kind || 'article').toUpperCase()

  const renderHoverActions = () => (
    !isOptimistic && (
      <div className="lib-card-hover-actions">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="lib-action-btn"
            title="Open original source"
            aria-label="Open source link"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="link" size={13} />
          </a>
        )}
        {item.indexed && !item.summary && (
          <button
            type="button"
            className="lib-action-btn"
            disabled={busy}
            title="Summarise with AI"
            aria-label="Summarise item"
            onClick={(e) => {
              e.stopPropagation()
              onEnrich?.(item)
            }}
          >
            <Icon name="spark" size={13} />
          </button>
        )}
        {item.indexed && (
          <button
            type="button"
            className="lib-action-btn"
            disabled={busy}
            title="Re-index search embeddings"
            aria-label="Re-index item"
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
          className="lib-action-btn lib-action-btn--delete"
          disabled={busy}
          title="Delete item"
          aria-label="Delete item"
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.(item)
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    )
  )

  return (
    <article
      data-item-id={item.id}
      className={`lib-card ${
        isOptimistic ? 'lib-card--optimistic' : ''
      } ${isLiveProcessing ? 'lib-card--processing' : ''}`}
      onClick={handleCardClick}
      tabIndex={0}
      role="button"
      aria-label={`View ${item.title || 'resource'}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (!e.target.closest('a, button, .lib-tag-pill')) {
            e.preventDefault()
            onSelect?.(item)
          }
        }
      }}
    >
      <div className="lib-card-core">
        {/* Media or Sleek Editorial Top Bar */}
        {hasMedia ? (
          <div className="lib-card-media">
            {hasRealMedia ? (
              <img
                className="lib-card-img"
                src={api.thumbnailUrl(item.id)}
                alt=""
                style={{ aspectRatio: `${thumbAspect || defaultAspect}` }}
                loading="lazy"
                onLoad={handleThumbLoad}
                onError={() => setThumbFailed(true)}
              />
            ) : (
              <div className={`lib-card-placeholder ${app === 'instagram' || app === 'tiktok' ? 'lib-card-placeholder--tall' : app === 'pinterest' ? 'lib-card-placeholder--pin' : ''} lib-card-placeholder--${app || item.kind || 'link'}`}>
                <div className="lib-card-placeholder-badge">
                  <Icon name={app === 'pinterest' ? 'pin' : app === 'youtube' ? 'play' : KIND_ICON[item.kind] || 'link'} size={24} />
                </div>
                <span className="lib-card-placeholder-domain mono">{domain || item.site || (app ? app.toUpperCase() : 'RESOURCE')}</span>
              </div>
            )}

            {/* App / Kind badge on top left */}
            <div className="lib-card-badge-row">
              <span className={`lib-kind-badge ${app ? `lib-kind-badge--${app}` : ''} mono`}>
                {kindLabel}
              </span>
              {duration ? <span className="lib-duration-badge mono">{duration}</span> : null}
            </div>

            {/* Processing overlay pill */}
            {isLiveProcessing && (
              <div className="lib-card-processing-pill mono">
                <span className="lib-card-spinner" />
                <span>
                  {isOptimistic ? 'Saving...' : isReceived ? 'Received...' : isEnriching ? 'Summarizing...' : 'Processing...'}
                </span>
              </div>
            )}

            {renderHoverActions()}
          </div>
        ) : (
          <div className="lib-card-editorial-bar">
            <div className="lib-card-editorial-meta">
              {(favicon || isTinyThumb) && (
                <img
                  src={isTinyThumb ? api.thumbnailUrl(item.id) : favicon}
                  alt=""
                  className="lib-card-favicon"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}
              <span className={`lib-kind-badge ${app ? `lib-kind-badge--${app}` : ''} mono`}>
                {kindLabel}
              </span>
              {domain && <span className="lib-card-domain mono">{domain}</span>}
              {duration ? <span className="lib-duration-badge mono">{duration}</span> : null}
            </div>

            {isLiveProcessing && (
              <div className="lib-card-processing-pill lib-card-processing-pill--inline mono">
                <span className="lib-card-spinner" />
                <span>
                  {isOptimistic ? 'Saving...' : isReceived ? 'Received...' : isEnriching ? 'Summarizing...' : 'Processing...'}
                </span>
              </div>
            )}

            {renderHoverActions()}
          </div>
        )}

        {/* Card Body */}
        <div className="lib-card-body">
          {/* Domain & Author meta */}
          <div className="lib-card-source">
            {favicon ? (
              <img
                className="lib-card-favicon"
                src={favicon}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            ) : (
              <Icon name={KIND_ICON[item.kind] || 'link'} size={12} />
            )}
            <span className="lib-card-domain mono">{domain || item.site || item.kind}</span>
            {item.author ? (
              <>
                <span className="lib-card-dot">·</span>
                <span className="lib-card-author">{item.author}</span>
              </>
            ) : null}
          </div>

          {/* Title */}
          <h3 className="lib-card-title" title={item.title}>
            {item.title || (isReceived ? 'Receiving link...' : 'Untitled Resource')}
          </h3>

          {/* Summary / Processing State / Excerpt */}
          {isEnriching && !item.summary ? (
            <div className="lib-card-summarizing-state">
              <div className="lib-card-summarizing-pill">
                <span className="lib-card-spinner" />
                <span>{item.kind === 'video' ? 'Summarizing video…' : 'Generating AI summary…'}</span>
              </div>
              <div className="lib-card-skel-lines">
                <span className="skel lib-card-skel" style={{ width: '92%', height: 10 }} />
                <span className="skel lib-card-skel" style={{ width: '68%', height: 10 }} />
              </div>
            </div>
          ) : isProcessing || isReceived ? (
            <div className="lib-card-summarizing-state">
              <div className="lib-card-summarizing-pill">
                <span className="lib-card-spinner" />
                <span>{isReceived ? 'Link received, queuing…' : 'Extracting content…'}</span>
              </div>
              <div className="lib-card-skel-lines">
                <span className="skel lib-card-skel" style={{ width: '85%', height: 10 }} />
                <span className="skel lib-card-skel" style={{ width: '60%', height: 10 }} />
              </div>
            </div>
          ) : item.summary ? (
            <p className="lib-card-desc">{item.summary}</p>
          ) : item.notes ? (
            <p className="lib-card-desc lib-card-desc--notes">{item.notes}</p>
          ) : item.excerpt ? (
            <p className="lib-card-desc">{item.excerpt}</p>
          ) : item.capture_note ? (
            <p className="lib-card-desc lib-card-desc--note">
              <Icon name="info" size={11} /> {item.capture_note}
            </p>
          ) : null}

          {/* Extracted Clickable Links or Link Discovery State */}
          {linkResources.length > 0 ? (
            <div className="lib-card-links" onClick={(e) => e.stopPropagation()}>
              <span className="lib-card-links-label mono">
                <Icon name="link" size={10} />
                <span>Links</span>
              </span>
              <div className="lib-card-links-list">
                {linkResources.map((r, i) => {
                  const rDomain = getDomain(r.url)
                  return (
                    <a
                      key={i}
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="lib-card-link-chip"
                      title={`${r.name}: ${r.url}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="lib-card-link-name">{r.name}</span>
                      {rDomain ? (
                        <span className="lib-card-link-domain mono">{rDomain}</span>
                      ) : null}
                      <span className="lib-card-link-arrow">↗</span>
                    </a>
                  )
                })}
              </div>
            </div>
          ) : isLiveProcessing ? (
            <div className="lib-card-links lib-card-links--loading">
              <span className="lib-card-links-label mono">
                <span className="lib-card-spinner" style={{ width: 9, height: 9 }} />
                <span>Discovering links…</span>
              </span>
              <div className="lib-card-links-list">
                <span className="skel" style={{ width: 88, height: 22, borderRadius: 6 }} />
                <span className="skel" style={{ width: 72, height: 22, borderRadius: 6 }} />
              </div>
            </div>
          ) : null}

          {/* Tags list (capped to 2 high-signal tags, deduplicated against app & category) */}
          {visibleTags.length > 0 ? (
            <div className="lib-card-tags">
              {visibleTags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  className="lib-tag-pill"
                  title={`Filter by #${tag}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onTagClick?.(tag)
                  }}
                >
                  #{tag}
                </button>
              ))}
            </div>
          ) : isLiveProcessing && !item.summary ? (
            <div className="lib-card-tags">
              <span className="skel lib-tag-skel" style={{ width: 44, height: 18, borderRadius: 999 }} />
              <span className="skel lib-tag-skel" style={{ width: 56, height: 18, borderRadius: 999 }} />
            </div>
          ) : null}
        </div>

        {/* Card Footer — always pinned to bottom */}
        <div className="lib-card-footer mono">
          <span className="lib-card-date">{fmtDate(item.consumed_on || item.created_at)}</span>
          {item.rating ? (
            <span className="lib-card-rating">
              {'★'.repeat(item.rating)}
            </span>
          ) : null}
          {item.resources?.length ? (
            <span className="lib-card-entities-count" title={`${item.resources.length} named entities extracted`}>
              {item.resources.length} entities
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export const LibraryCard = memo(LibraryCardComponent)
export default LibraryCard
