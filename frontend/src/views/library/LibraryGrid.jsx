import React, { memo, useMemo } from 'react'
import { motion } from 'framer-motion'
import LibraryCard from './LibraryCard.jsx'
import { groupItemsByDate } from './dateUtils.js'

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
  busyId,
  onSelect,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
  columns,
  className,
}) {
  const groups = useMemo(() => groupItemsByDate(items), [items])

  if (!items || items.length === 0) {
    return null
  }

  return (
    <div className={`lib-grid-view w-full flex flex-col gap-10 ${className || ''}`}>
      {groups.map((group) => {
        return (
          <section key={group.dateKey} className="lib-date-group">
            <header className="lib-date-header">
              <h2 className="lib-date-title">{group.heading}</h2>
              <span className="lib-date-count">
                {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
              </span>
            </header>

            <div
              style={columns ? { columnCount: columns } : undefined}
              className="lib-bento-grid w-full"
            >
              {group.items.map((item, index) => {
                const { spanClass, variant } = getBentoItemConfig(item, index, group.items.length)
                return (
                  <motion.div
                    key={item.id || index}
                    className={`lib-bento-grid-item ${spanClass}`}
                    initial={{ opacity: 0 }}
                    animate={{
                      opacity: 1,
                      transition: {
                        duration: 0.24,
                        delay: Math.min((index % 8) * 0.025, 0.16),
                        ease: [0.16, 1, 0.3, 1],
                      },
                    }}
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
                    />
                  </motion.div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export const LibraryGrid = memo(LibraryGridComponent)
export default LibraryGrid
