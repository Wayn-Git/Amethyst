import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import { memo, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'
import { KIND_ICON, getDomain, getFaviconUrl } from './LibraryCard.jsx'
import { getRatingTier } from './ratingUtils.js'
import { formatDisplayDate, formatRelativeDate } from './dateUtils.js'
import ProgressSegmentedControl from './ProgressSegmentedControl.jsx'
import LibraryReminderBanner from './LibraryReminderBanner.jsx'

function LibraryRowComponent({
  item,
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
  const isOptimistic = Boolean(item.isOptimistic)
  const isProcessing = Boolean(item.isProcessing) || item.status === 'processing' || item.status === 'enriching'
  const [thumbFailed, setThumbFailed] = useState(false)
  const hasThumbnail = (Boolean(item.thumbnail_path) || Boolean(item.url)) && !thumbFailed
  const domain = getDomain(item.url, item.site)
  const favicon = getFaviconUrl(item.url)

  const rawDate = item.consumed_on || item.created_at
  const dateFull = useMemo(() => formatDisplayDate(rawDate, true), [rawDate])
  const ratingTier = useMemo(() => getRatingTier(item.rating), [item.rating])

  const handleRowClick = (e) => {
    if (e.target.closest('a, button, .lib-tag-pill, .lib-dock-btn')) return
    onSelect?.(item)
  }

  return (
    <article
      data-item-id={item.id}
      draggable={isDraggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`lib-row ${isProcessing ? 'lib-card--processing' : ''} ${isDragOver ? 'lib-row--drag-over' : ''} ${isDragged ? 'lib-row--dragged' : ''}`}
      onClick={handleRowClick}
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
          {Boolean(item.is_pinned) && (
            <span className="lib-row-pinned-badge" title="Pinned to top">
              <Icon name="pin" size={11} className="text-amber-500" />
            </span>
          )}
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
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {item.app && (domain || '').toLowerCase().includes(item.app.toLowerCase())
              ? (item.author ? `@${item.author.replace(/^@/, '')}` : (item.site || (item.kind || 'LOCAL').toUpperCase()))
              : (domain || item.author || 'LOCAL')}
          </span>
          {item.summary && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.8 }}>
              — {item.summary}
            </span>
          )}
        </div>
      </div>

      {/* SaveToList Progress State */}
      <div className="lib-row-progress-col" onClick={(e) => e.stopPropagation()}>
        <ProgressSegmentedControl
          progress={item.progress}
          kind={item.kind}
          variant="compact"
          onChange={(next) => onProgressChange ? onProgressChange(item, next) : api.updateLibraryItem(item.id, { progress: next })}
        />
      </div>

      {/* SaveToList Reminder Indicator */}
      {Boolean(item.remind_at) && (
        <div className="lib-row-reminder-col" onClick={(e) => e.stopPropagation()}>
          <LibraryReminderBanner
            item={item}
            variant="compact"
            onSaveReminder={(patch) => onSaveReminder ? onSaveReminder(item, patch) : api.updateLibraryItem(item.id, patch)}
            onClearReminder={() => onClearReminder ? onClearReminder(item) : api.updateLibraryItem(item.id, { remind_at: null, reminded_at: null })}
          />
        </div>
      )}

      {/* Dedicated Date Badge — Never Hidden */}
      <div className="lib-row-date-col" title={`Captured on ${dateFull}`}>
        <Icon name="calendar" size={11} className="opacity-60" />
        <span>{dateFull || 'Undated'}</span>
      </div>

      {/* Curator Significance Tier (if rated) */}
      {ratingTier && (
        <span
          className={`lib-card-rating-badge ${ratingTier.badgeClass}`}
          title={`Curator Tier: ${ratingTier.label}`}
        >
          <Icon name="star" size={10} filled />
          <span>{ratingTier.shortLabel}</span>
        </span>
      )}

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
        {isDraggable && (
          <span
            className="lib-dock-btn lib-row-drag-handle"
            title="Drag to rearrange"
            aria-label="Drag to rearrange"
          >
            <Icon name="dots-six" size={13} />
          </span>
        )}

        <HouseButton
          type="button"
          className={`lib-dock-btn ${item.is_pinned ? 'lib-dock-btn--pinned' : ''}`}
          title={item.is_pinned ? 'Unpin from top' : 'Pin to top'}
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin ? onTogglePin(item) : api.updateLibraryItem(item.id, { is_pinned: !item.is_pinned })
          }}
        >
          <Icon name="pin" size={13} className={item.is_pinned ? 'text-amber-500 fill-amber-500' : ''} />
        </HouseButton>

        {!item.remind_at && (
          <LibraryReminderBanner
            item={item}
            variant="compact"
            onSaveReminder={(patch) => onSaveReminder ? onSaveReminder(item, patch) : api.updateLibraryItem(item.id, patch)}
            onClearReminder={() => onClearReminder ? onClearReminder(item) : api.updateLibraryItem(item.id, { remind_at: null, reminded_at: null })}
          />
        )}
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
          <HouseButton
            type="button"
            className="lib-dock-btn"
            disabled={busy}
            title="Summarise with AI"
            onClick={(e) => {
              e.stopPropagation()
              onEnrich?.(item)
            }}
          >
            <Icon name="brain" size={13} />
          </HouseButton>
        )}
        {item.indexed && (
          <HouseButton
            type="button"
            className="lib-dock-btn"
            disabled={busy}
            title="Re-index resource"
            onClick={(e) => {
              e.stopPropagation()
              onReindex?.(item)
            }}
          >
            <Icon name="refresh" size={13} />
          </HouseButton>
        )}
        <HouseButton
          type="button"
          className="lib-dock-btn lib-dock-btn--danger"
          disabled={busy}
          title="Delete resource"
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.(item)
          }}
        >
          <Icon name="trash" size={13} />
        </HouseButton>
      </div>
    </article>
  )
}

export const LibraryRow = memo(LibraryRowComponent)
export default LibraryRow
