import React, { memo, useMemo, useState } from 'react'
import LibraryCard from './LibraryCard.jsx'
import { groupItemsByDate } from './dateUtils.js'
import LoadMoreSentinel from '../../components/damon/LoadMoreSentinel.jsx'

export function getBentoItemConfig(item, index, totalInGroup) {
  const url = (item.url || '').toLowerCase()
  const app = item.app || (
    url.includes('instagram.') || url.includes('instagr.am') ? 'instagram' :
    url.includes('pinterest.') || url.includes('pin.it') ? 'pinterest' :
    url.includes('youtube.') || url.includes('youtu.be') ? 'youtube' :
    url.includes('tiktok.') ? 'tiktok' : null
  )
  const hasLocalVideo = Boolean(item.media_path && /\.(mp4|mov|webm)(\?|$)/i.test(item.media_path))
  const hasRealMedia = Boolean(
    item.thumbnail_path ||
    hasLocalVideo ||
    (Array.isArray(item.resources) && item.resources.some((r) => r && (r.type === 'slide' || r.type === 'video' || r.type === 'image')))
  )
  const isReelOrShort = url.includes('/reel/') || url.includes('/reels/') || url.includes('/shorts/')
  const isVideo = (
    item.kind === 'video' ||
    app === 'youtube' ||
    app === 'tiktok' ||
    isReelOrShort ||
    hasLocalVideo ||
    Boolean(item.duration_seconds)
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
    (Array.isArray(item.resources) && item.resources.some((r) => r?.type === 'slide'))
  )
  const isNote = item.kind === 'note' || (!hasRealMedia && !item.url)

  if (isNote || (!hasRealMedia && !isVideo)) {
    return {
      spanClass: 'col-span-1',
      variant: isNote ? 'note' : 'standard',
    }
  }

  // Vertical Reels & Shorts with real media
  if (isVertical && hasRealMedia) {
    return {
      spanClass: 'col-span-1',
      variant: 'portrait',
    }
  }

  // Square Posts & Carousels: 1:1 square card
  if (isSlidePost) {
    return {
      spanClass: 'col-span-1',
      variant: 'square',
    }
  }

  // Landscape Videos (YouTube etc.) & Articles
  return {
    spanClass: 'col-span-1',
    variant: isVideo ? 'landscape' : 'standard',
  }
}

function LibraryGridComponent({
  items = [],
  total = 0,
  showing = 0,
  totalShowing = 0,
  hasMore = false,
  onLoadMore,
  busyId,
  onSelect,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
  onTogglePin,
  onProgressChange,
  onSaveReminder,
  onClearReminder,
  onReorder,
  columns,
  className,
}) {
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  const handleDragStart = (e, item) => {
    if (!onReorder) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(item.id))
    setDraggedId(item.id)
  }

  const handleDragOver = (e, item) => {
    if (!onReorder) return
    e.preventDefault()
    if (draggedId && draggedId !== item.id) {
      setDragOverId(item.id)
    }
  }

  const handleDragLeave = () => {
    setDragOverId(null)
  }

  const handleDrop = (e, targetItem) => {
    if (!onReorder) return
    e.preventDefault()
    setDragOverId(null)
    if (!draggedId || draggedId === targetItem.id) {
      setDraggedId(null)
      return
    }
    const fromIndex = items.findIndex((it) => it.id === draggedId)
    const toIndex = items.findIndex((it) => it.id === targetItem.id)
    if (fromIndex !== -1 && toIndex !== -1) {
      const next = [...items]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      onReorder(next)
    }
    setDraggedId(null)
  }

  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
  }

  const groups = useMemo(() => groupItemsByDate(items), [items])

  if (!items || items.length === 0) {
    return null
  }

  return (
    <div className={`lib-grid-view w-full flex flex-col gap-10 ${className || ''}`}>
      {groups.map((group, groupIndex) => {
        return (
          <section key={group.dateKey} className="lib-date-group">
            <header className="lib-date-header">
              <div className="flex items-center gap-2">
                <h2 className="lib-date-title">{group.heading}</h2>
                <span className="lib-date-count">
                  {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              {groupIndex === 0 && (showing || total) ? (
                <span className="lib-date-showing">
                  Showing {showing || items.length} of {totalShowing || total || items.length}
                </span>
              ) : null}
            </header>

            <div
              style={columns ? { columnCount: columns } : undefined}
              className="lib-bento-grid w-full"
            >
              {group.items.map((item, index) => {
                const { spanClass, variant } = getBentoItemConfig(item, index, group.items.length)
                return (
                  <div
                    key={item.id || index}
                    className={`lib-bento-grid-item ${spanClass}`}
                  >
                    <LibraryCard
                      item={item}
                      variant={variant}
                      isFeatured={variant === 'wide'}
                      busy={busyId === item.id}
                      onSelect={onSelect}
                      onReindex={onReindex}
                      onEnrich={onEnrich}
                      onDelete={onDelete}
                      onTagClick={onTagClick}
                      onTogglePin={onTogglePin}
                      onProgressChange={onProgressChange}
                      onSaveReminder={onSaveReminder}
                      onClearReminder={onClearReminder}
                      isDraggable={Boolean(onReorder)}
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDragOver={(e) => handleDragOver(e, item)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, item)}
                      onDragEnd={handleDragEnd}
                      isDragOver={dragOverId === item.id}
                      isDragged={draggedId === item.id}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {hasMore && (
        <div className="lib-load-more-container flex flex-col items-center justify-center py-6 gap-3">
          <LoadMoreSentinel
            hasMore={hasMore}
            loading={false}
            onLoadMore={onLoadMore}
            label="Loading more items…"
          />
          <button
            type="button"
            className="lib-btn lib-btn--secondary"
            onClick={onLoadMore}
            style={{
              padding: '7px 18px',
              fontSize: '12px',
              borderRadius: 'var(--radius-buttons, 6px)',
              cursor: 'pointer',
            }}
          >
            Show more ({totalShowing ? Math.max(0, totalShowing - items.length) : 'more'} remaining)
          </button>
        </div>
      )}
    </div>
  )
}

export const LibraryGrid = memo(LibraryGridComponent)
export default LibraryGrid
