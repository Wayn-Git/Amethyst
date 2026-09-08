import { memo } from 'react'
import Icon from '../../components/Icon.jsx'
import { api, fmtDate } from '../../api.js'
import { KIND_ICON, getDomain, getFaviconUrl } from './LibraryCard.jsx'

function LibraryRowComponent({
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
  const favicon = getFaviconUrl(item.url)

  const handleRowClick = (e) => {
    if (e.target.closest('a, button, .lib-tag-pill')) return
    onSelect?.(item)
  }

  return (
    <article
      className={`card lib-row ${isOptimistic ? 'lib-row--optimistic' : ''} ${
        isProcessing ? 'lib-row--processing' : ''
      }`}
      onClick={handleRowClick}
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
      <div className="lib-row-icon">
        {hasThumbnail ? (
          <img
            className="lib-thumb"
            src={api.thumbnailUrl(item.id)}
            alt=""
            loading="lazy"
          />
        ) : (
          <div className="lib-row-icon-fallback">
            <Icon name={KIND_ICON[item.kind] || 'link'} size={18} />
          </div>
        )}
      </div>

      <div className="lib-row-body">
        <div className="lib-row-head">
          <div className="lib-row-title-wrap">
            <span className="lib-kind-badge mono">{item.kind || 'article'}</span>
            <h3 className="lib-row-title">
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
          </div>

          {(isOptimistic || isProcessing) && (
            <span className="lib-row-processing-pill mono">
              <span className="lib-card-spinner" />
              {isOptimistic ? 'Saving...' : 'Analyzing...'}
            </span>
          )}
        </div>

        <div className="lib-row-meta mono">
          {favicon ? (
            <img
              className="lib-row-favicon"
              src={favicon}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : null}
          {[domain || item.site, item.author, fmtDate(item.consumed_on || item.created_at)]
            .filter(Boolean)
            .join(' · ')}
          {item.rating ? (
            <span className="lib-row-rating"> · {'★'.repeat(item.rating)}</span>
          ) : null}
        </div>

        {/* What it is about */}
        {isProcessing && !item.summary ? (
          <div className="lib-row-skel-lines">
            <span className="skel" style={{ width: '90%', height: 11 }} />
            <span className="skel" style={{ width: '65%', height: 11 }} />
          </div>
        ) : item.summary ? (
          <p className="lib-row-excerpt">{item.summary}</p>
        ) : item.excerpt ? (
          <p className="lib-row-excerpt">{item.excerpt}</p>
        ) : item.notes ? (
          <p className="lib-row-excerpt lib-row-excerpt--notes">{item.notes}</p>
        ) : null}

        {/* Tags (minimized to max 3 tags per row) */}
        {item.tags?.length ? (
          <div className="lib-tags">
            {item.tags.slice(0, 3).map((tag) => (
              <button
                type="button"
                key={tag}
                className="lib-tag lib-tag-pill"
                title={`Filter by #${tag}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onTagClick?.(tag)
                }}
              >
                #{tag}
              </button>
            ))}
            {item.tags.length > 3 ? (
              <span className="lib-tag-more mono">+{item.tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}

        {/* Extracted named entities/resources */}
        {item.resources?.length ? (
          <ul className="lib-resources">
            {item.resources.map((r, i) => (
              <li key={i}>
                <span className="lib-resource-kind mono">{r.type}</span>
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.name}
                  </a>
                ) : (
                  r.name
                )}
                {r.detail ? <span className="lib-resource-detail"> — {r.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Capture note explanation */}
        {item.capture_note ? (
          <p className="lib-row-note">
            <Icon name="info" size={13} /> {item.capture_note}
          </p>
        ) : null}
      </div>

      {/* Row action buttons */}
      <div className="lib-row-actions">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="btn btn--ghost btn--small"
            title="Open original URL"
            aria-label="Open source link"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="link" size={13} />
          </a>
        )}
        {item.indexed && !item.summary && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={busy}
            title="Summarise with AI"
            aria-label={`Summarise ${item.title}`}
            onClick={(e) => {
              e.stopPropagation()
              onEnrich?.()
            }}
          >
            <Icon name="spark" size={13} />
          </button>
        )}
        {item.indexed && (
          <button
            type="button"
            className="btn btn--ghost btn--small"
            disabled={busy}
            title="Index text again"
            aria-label={`Re-index ${item.title}`}
            onClick={(e) => {
              e.stopPropagation()
              onReindex?.()
            }}
          >
            <Icon name="refresh" size={13} />
          </button>
        )}
        <button
          type="button"
          className="btn btn--ghost btn--small lib-btn-danger"
          disabled={busy}
          title="Remove item"
          aria-label={`Remove ${item.title}`}
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.()
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </article>
  )
}

export const LibraryRow = memo(LibraryRowComponent)
export default LibraryRow
