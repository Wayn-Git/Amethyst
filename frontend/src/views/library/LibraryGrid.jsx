import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import LibraryCard from './LibraryCard.jsx'
import { groupItemsByDate } from './dateUtils.js'

export function getBentoItemConfig(item, index, totalInGroup) {
  const isNote = item.kind === 'note' || (!item.thumbnail_path && !item.url)
  return {
    spanClass: 'col-span-1',
    variant: isNote ? 'note' : 'standard',
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
