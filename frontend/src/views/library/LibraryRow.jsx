import { memo, useState } from 'react'
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
  const isProcessing = Boolean(item.isProcessing) || item.status === 'processing' || item.status === 'enriching'
  const [thumbFailed, setThumbFailed] = useState(false)
  const hasThumbnail = Boolean(item.thumbnail_path) && !thumbFailed
  const domain = getDomain(item.url, item.site)
  const favicon = getFaviconUrl(item.url)

  const handleRowClick = (e) => {
    if (e.target.closest('a, button, .lib-tag-pill')) return
    onSelect?.(item)
  }

  return (
    <article
      data-item-id={item.id}
      className={`lib-row ${isProcessing ? 'lib-card--processing' : ''}`}
      onClick={handleRowClick}
      tabIndex={0}
      role="button"
      aria-label={`Inspect ${item.title || 'knowledge resource'}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (!e.target.closest('a, button, .lib-tag-pill')) {
            e.preventDefault()
            onSelect?.(item)
          }
        }
      }}
    >
      {/* Thumbnail or Format Icon */}
      <div className="lib-row-leading">
        {hasThumbnail ? (
          <img
            className="lib-row-thumb"
            src={api.thumbnailUrl(item.id)}
            alt=""
            loading="lazy"
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <Icon name={KIND_ICON[item.kind] || 'link'} size={18} />
        )}
      </div>

      {/* Main Content Info */}
      <div className="lib-row-main">
        <div className="lib-row-title-line">
          <span className="lib-card-kind-badge">
            {item.app || item.kind || 'link'}
          </span>
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
          {isProcessing && (
            <span className="lib-card-spinner" style={{ flexShrink: 0 }} />
          )}
        </div>

        <div className="lib-row-meta-line">
          {favicon && (
            <img
              src={favicon}
              alt=""
              style={{ width: 12, height: 12, borderRadius: 2 }}
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            {[domain || item.author, fmtDate(item.consumed_on || item.created_at)].filter(Boolean).join(' · ')}
          </span>
          {item.summary && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
              — {item.summary}
            </span>
          )}
        </div>
      </div>

      {/* Tags */}
      {item.tags?.length > 0 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
          {item.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="lib-tag-pill"
              onClick={(e) => {
                e.stopPropagation()
                onTagClick?.(tag)
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Row Action Buttons */}
      <div className="lib-row-actions">
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="lib-dock-btn"
            title="Open original URL"
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
            title="Summarise with AI"
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
            className="lib-dock-btn"
            disabled={busy}
            title="Re-index resource"
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
          className="lib-dock-btn lib-dock-btn--danger"
          disabled={busy}
          title="Delete resource"
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
