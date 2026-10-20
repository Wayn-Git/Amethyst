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
  const hasThumb = Boolean(item.thumbnail_path || item.url)
  const isReelOrShort = url.includes('/reel/') || url.includes('/reels/') || url.includes('/shorts/')
  const hasLocalVideo = Boolean(item.media_path && /\.(mp4|mov|webm)(\?|$)/i.test(item.media_path))
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
  const isNote = item.kind === 'note' || (!hasThumb && !item.url)
  const isEssential = item.rating === 5

  // Small groups (1 or 2 items): clean single or pair cards
  if (totalInGroup <= 2) {
    return {
      spanClass: isVertical && hasThumb ? 'col-span-1 sm:row-span-2' : 'col-span-1',
      variant: isNote ? 'note' : isVertical ? 'portrait' : isSlidePost ? 'square' : isVideo ? 'landscape' : 'standard',
    }
  }

  // If item has no thumbnail, never give it a video/landscape media variant
  if (!hasThumb) {
    return {
      spanClass: 'col-span-1 sm:row-span-1',
      variant: isNote ? 'note' : 'standard',
    }
  }

  // 1) Vertical media (Instagram Reels, TikTok, Pinterest) with valid thumbnail: Tall Bento Card
  if (isVertical) {
    return {
      spanClass: 'col-span-1 sm:row-span-2',
      variant: 'portrait',
    }
  }

  // 2) Hero / Featured first item (if horizontal or 5-star essential): Spans 2 columns
  if ((index === 0 && totalInGroup >= 4 && !isVertical) || (isEssential && totalInGroup >= 4 && !isVertical && index < 3)) {
    return {
      spanClass: 'col-span-1 sm:col-span-2 sm:row-span-1',
      variant: 'wide',
    }
  }

  // 3) Rhythmic Wide Card for horizontal items
  if (index > 0 && index % 6 === 0 && !isVertical) {
    return {
      spanClass: 'col-span-1 sm:col-span-2 sm:row-span-1',
      variant: 'wide',
    }
  }

  // 4) Square Post cards (Instagram photo carousels, artwork)
  if (isSlidePost) {
    return {
      spanClass: 'col-span-1 sm:row-span-1',
      variant: 'square',
    }
  }

  // 5) Note cards: Editorial typography bento block
  if (isNote) {
    return {
      spanClass: 'col-span-1 sm:row-span-1',
      variant: 'note',
    }
  }

  // 6) Default standard/landscape bento cell
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
