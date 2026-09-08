import { memo } from 'react'
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

function LibraryCardComponent({
  item,
  busy,
  onSelect,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
}) {
  const isOptimistic = Boolean(item.isOptimistic)
  const isProcessing = Boolean(item.isProcessing)
  const hasThumbnail = Boolean(item.thumbnail_path)
  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)
  const favicon = getFaviconUrl(item.url)

  const handleCardClick = (e) => {
    // If the click was on a link, tag, or button, don't trigger the modal
    if (e.target.closest('a, button, .lib-tag-pill')) return
    onSelect?.(item)
  }

  const kindLabel = (item.kind || 'article').toUpperCase()

  return (
    <article
      className={`lib-card ${isOptimistic ? 'lib-card--optimistic' : ''} ${
        isProcessing ? 'lib-card--processing' : ''
      }`}
      onClick={handleCardClick}
      data-enter
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
        {/* Media / Thumbnail preview */}
        <div className="lib-card-media">
          {hasThumbnail ? (
            <img
              className="lib-card-img"
              src={api.thumbnailUrl(item.id)}
              alt=""
              loading="lazy"
            />
          ) : (
            <div className={`lib-card-placeholder lib-card-placeholder--${item.kind || 'link'}`}>
              <div className="lib-card-placeholder-art">
                <Icon name={KIND_ICON[item.kind] || 'link'} size={28} />
              </div>
              {domain ? <span className="lib-card-placeholder-domain mono">{domain}</span> : null}
            </div>
          )}

          {/* Kind badge on top left */}
          <div className="lib-card-badge-row">
            <span className="lib-kind-badge mono">{kindLabel}</span>
            {duration ? <span className="lib-duration-badge mono">{duration}</span> : null}
          </div>

          {/* Processing overlay / indicator */}
          {(isOptimistic || isProcessing) && (
            <div className="lib-card-processing-pill mono">
              <span className="lib-card-spinner" />
              <span>{isOptimistic ? 'Saving...' : 'Analyzing...'}</span>
            </div>
          )}

          {/* Hover quick action tray */}
          {!isOptimistic && (
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
          )}
        </div>

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
            {item.title || 'Untitled Resource'}
          </h3>

          {/* Summary / Excerpt preview or Skeleton when processing */}
          {isProcessing && !item.summary ? (
            <div className="lib-card-skel-lines">
              <span className="skel lib-card-skel" style={{ width: '92%', height: 10 }} />
              <span className="skel lib-card-skel" style={{ width: '74%', height: 10 }} />
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

          {/* Tags list (minimized to 2 tags per card) */}
          {item.tags?.length ? (
            <div className="lib-card-tags">
              {item.tags.slice(0, 2).map((tag) => (
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
              {item.tags.length > 2 ? (
                <span className="lib-tag-more mono">+{item.tags.length - 2}</span>
              ) : null}
            </div>
          ) : isProcessing ? (
            <div className="lib-card-tags">
              <span className="skel lib-tag-skel" style={{ width: 44, height: 18, borderRadius: 999 }} />
              <span className="skel lib-tag-skel" style={{ width: 56, height: 18, borderRadius: 999 }} />
            </div>
          ) : null}
        </div>

        {/* Card Footer */}
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
