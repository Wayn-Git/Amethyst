import React, { useMemo } from 'react'
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
  const hasThumb = Boolean(item.thumbnail_path)
  const isVideo = item.kind === 'video' || app === 'youtube' || app === 'instagram' || app === 'tiktok'
  const isVertical = app === 'instagram' || app === 'tiktok' || app === 'pinterest' || (item.kind === 'video' && app !== 'youtube')
  const isNote = item.kind === 'note' || (!hasThumb && !item.url)
  const isEssential = item.rating === 5

  // Small groups (1, 2, 3 items): Clean, proportionate standard cards. Never stretched wide.
  if (totalInGroup <= 3) {
    return {
      spanClass: 'col-span-1',
      variant: isNote ? 'note' : isVertical ? 'portrait' : isVideo ? 'landscape' : 'standard',
    }
  }

  // 4+ items: Full Dynamic Bento Grid Architecture
  // 1) Editorial notes always occupy a clean 1x1 bento tile
  if (isNote) {
    return {
      spanClass: 'col-span-1 sm:row-span-1',
      variant: 'note',
    }
  }

  // 2) Hero Brick for the first item in the date group:
  // - If vertical video: prominent 1x2 tall portrait brick
  // - If horizontal video, article, or 5-star essential: prominent 2x1 wide brick
  if (index === 0) {
    if (isVertical && hasThumb) {
      return {
        spanClass: 'col-span-1 sm:row-span-2',
        variant: 'portrait',
      }
    }
    if (hasThumb || isEssential) {
      return {
        spanClass: 'col-span-1 sm:col-span-2 sm:row-span-1',
        variant: 'wide',
      }
    }
  }

  // 3) Rhythmic Bento Variation for vertical media (e.g. consecutive Instagram Reels):
  // Alternates between 2-row tall cards and 1-row standard cards so it forms an interlocking mosaic instead of a flat wall
  if (isVertical && hasThumb) {
    const isTall = index % 3 === 1 || index % 5 === 0
    if (isTall) {
      return {
        spanClass: 'col-span-1 sm:row-span-2',
        variant: 'portrait',
      }
    }
    return {
      spanClass: 'col-span-1 sm:row-span-1',
      variant: 'standard',
    }
  }

  // 4) Horizontal media / articles / high-impact cards:
  // Periodically introduce a 2-col wide brick for visual rhythm, provided there is room
  const isWide = (index % 6 === 1 || index % 6 === 4) && (index < totalInGroup - 1)
  if (isWide && hasThumb) {
    return {
      spanClass: 'col-span-1 sm:col-span-2 sm:row-span-1',
      variant: 'wide',
    }
  }

  // 5) Default standard 1x1 bento cell
  return {
    spanClass: 'col-span-1 sm:row-span-1',
    variant: isVideo ? 'landscape' : 'standard',
  }
}

export default function LibraryGrid({
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
              style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
              className={`lib-bento-grid ${
                group.items.length === 1
                  ? 'lib-bento-grid--single'
                  : group.items.length === 2
                  ? 'lib-bento-grid--pair'
                  : group.items.length === 3
                  ? 'lib-bento-grid--trio'
                  : ''
              } w-full`}
            >
              {group.items.map((item, index) => {
                const { spanClass, variant } = getBentoItemConfig(item, index, group.items.length)
                return (
                  <motion.div
                    key={item.id || index}
                    className={`h-full ${spanClass}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: {
                        duration: 0.32,
                        delay: Math.min((index % 8) * 0.035, 0.22),
                        ease: [0.16, 1, 0.3, 1],
                      },
                    }}
                    whileHover={{ y: -3 }}
                  >
                    <LibraryCard
                      item={item}
                      variant={variant}
                      isFeatured={variant === 'wide'}
                      busy={busyId === item.id}
                      onSelect={onSelect}
                      onReindex={() => onReindex?.(item)}
                      onEnrich={() => onEnrich?.(item)}
                      onDelete={() => onDelete?.(item)}
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
