import { memo } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import LibraryCard, { getDomain } from './LibraryCard.jsx'

function ShelfHeader({ icon, title, count, onNavigate, actionLabel = 'View all →' }) {
  return (
    <div className="lib-shelf-header">
      <div className="lib-shelf-title-group">
        <span className="lib-shelf-icon" aria-hidden="true">
          <Icon name={icon} size={15} />
        </span>
        <h2 className="lib-shelf-title">{title}</h2>
        {typeof count === 'number' && (
          <span className="lib-shelf-count">{count}</span>
        )}
      </div>

      {onNavigate && (
        <button
          type="button"
          className="lib-shelf-action"
          onClick={onNavigate}
        >
          <span>{actionLabel}</span>
        </button>
      )}
    </div>
  )
}

function JumpBackInShelf({ items = [], onSelect, onNavigate }) {
  if (!items || items.length === 0) return null

  return (
    <section className="lib-shelf lib-shelf--recent" aria-labelledby="shelf-jump-back-in">
      <ShelfHeader
        icon="spark"
        title="Jump Back In"
        count={items.length}
        onNavigate={() => onNavigate?.('jumpBackIn')}
      />
      <div className="lib-shelf-scroll-track">
        {items.map((item, index) => {
          const isProcessing = Boolean(
            item.isProcessing ||
            item.status === 'processing' ||
            item.status === 'enriching' ||
            item.status === 'received' ||
            item.isOptimistic
          )
          const domain = getDomain(item.url, item.site)

          return (
            <motion.div
              key={item.id || index}
              className="lib-recent-capsule"
              initial={{ opacity: 0, x: 12 }}
              animate={{
                opacity: 1,
                x: 0,
                transition: {
                  duration: 0.22,
                  delay: Math.min(index * 0.04, 0.2),
                  ease: [0.23, 1, 0.32, 1],
                },
              }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onSelect?.(item)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect?.(item)
                }
              }}
            >
              <div className="lib-recent-capsule-thumb">
                {item.thumbnail_path ? (
                  <img src={item.thumbnail_path} alt="" loading="lazy" />
                ) : (
                  <div className="lib-recent-capsule-placeholder">
                    <Icon name={item.kind === 'video' ? 'play' : item.kind === 'note' ? 'edit' : 'book'} size={14} />
                  </div>
                )}
                {isProcessing && (
                  <span className="lib-recent-live-dot" title="Syncing / enriching with AI" />
                )}
              </div>

              <div className="lib-recent-capsule-info">
                <span className="lib-recent-capsule-domain">{domain || item.kind}</span>
                <h3 className="lib-recent-capsule-title">{item.title}</h3>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}

function EssentialShelf({ items = [], busyId, onSelect, onReindex, onEnrich, onDelete, onTagClick, onNavigate }) {
  if (!items || items.length === 0) return null

  return (
    <section className="lib-shelf lib-shelf--essential" aria-labelledby="shelf-essential">
      <ShelfHeader
        icon="star"
        title="Essential Knowledge"
        count={items.length}
        onNavigate={() => onNavigate?.('essential')}
      />
      <div className="lib-shelf-grid lib-shelf-grid--essential">
        {items.map((item, index) => (
          <motion.div
            key={item.id || index}
            className="lib-shelf-card-col"
            initial={{ opacity: 0, y: 12 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.26,
                delay: Math.min(index * 0.04, 0.2),
                ease: [0.23, 1, 0.32, 1],
              },
            }}
            whileHover={{ y: -2 }}
          >
            <LibraryCard
              item={item}
              variant="wide"
              isFeatured={true}
              busy={busyId === item.id}
              onSelect={onSelect}
              onReindex={onReindex}
              onEnrich={onEnrich}
              onDelete={onDelete}
              onTagClick={onTagClick}
            />
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function MediaShelf({ items = [], busyId, onSelect, onReindex, onEnrich, onDelete, onTagClick, onNavigate }) {
  if (!items || items.length === 0) return null

  return (
    <section className="lib-shelf lib-shelf--media" aria-labelledby="shelf-media">
      <ShelfHeader
        icon="play"
        title="Media & Watchlist"
        count={items.length}
        onNavigate={() => onNavigate?.('media')}
      />
      <div className="lib-shelf-grid lib-shelf-grid--media">
        {items.map((item, index) => {
          const url = (item.url || '').toLowerCase()
          const isReel = url.includes('/reel/') || url.includes('/shorts/') || item.app === 'tiktok'
          const variant = isReel ? 'portrait' : 'landscape'

          return (
            <motion.div
              key={item.id || index}
              className={`lib-shelf-card-col ${isReel ? 'col-span-1' : 'col-span-1 sm:col-span-1'}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{
                opacity: 1,
                y: 0,
                transition: {
                  duration: 0.26,
                  delay: Math.min(index * 0.035, 0.2),
                  ease: [0.23, 1, 0.32, 1],
                },
              }}
              whileHover={{ y: -2 }}
            >
              <LibraryCard
                item={item}
                variant={variant}
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
}

function ReadingShelf({ items = [], busyId, onSelect, onReindex, onEnrich, onDelete, onTagClick, onNavigate }) {
  if (!items || items.length === 0) return null

  return (
    <section className="lib-shelf lib-shelf--reading" aria-labelledby="shelf-reading">
      <ShelfHeader
        icon="book"
        title="Reading & Insights"
        count={items.length}
        onNavigate={() => onNavigate?.('reading')}
      />
      <div className="lib-shelf-grid lib-shelf-grid--reading">
        {items.map((item, index) => (
          <motion.div
            key={item.id || index}
            className="lib-shelf-card-col"
            initial={{ opacity: 0, y: 12 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: {
                duration: 0.26,
                delay: Math.min(index * 0.035, 0.2),
                ease: [0.23, 1, 0.32, 1],
              },
            }}
            whileHover={{ y: -2 }}
          >
            <LibraryCard
              item={item}
              variant={item.kind === 'note' ? 'note' : 'standard'}
              busy={busyId === item.id}
              onSelect={onSelect}
              onReindex={onReindex}
              onEnrich={onEnrich}
              onDelete={onDelete}
              onTagClick={onTagClick}
            />
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function LibraryEditorialShelves({
  shelves = {},
  busyId,
  onSelect,
  onNavigateShelf,
  onReindex,
  onEnrich,
  onDelete,
  onTagClick,
}) {
  const { jumpBackIn = [], essential = [], media = [], reading = [] } = shelves

  const hasAnyItems =
    jumpBackIn.length > 0 ||
    essential.length > 0 ||
    media.length > 0 ||
    reading.length > 0

  if (!hasAnyItems) return null

  return (
    <div className="lib-editorial-shelves w-full flex flex-col gap-10">
      <JumpBackInShelf
        items={jumpBackIn}
        onSelect={onSelect}
        onNavigate={onNavigateShelf}
      />

      <EssentialShelf
        items={essential}
        busyId={busyId}
        onSelect={onSelect}
        onReindex={onReindex}
        onEnrich={onEnrich}
        onDelete={onDelete}
        onTagClick={onTagClick}
        onNavigate={onNavigateShelf}
      />

      <MediaShelf
        items={media}
        busyId={busyId}
        onSelect={onSelect}
        onReindex={onReindex}
        onEnrich={onEnrich}
        onDelete={onDelete}
        onTagClick={onTagClick}
        onNavigate={onNavigateShelf}
      />

      <ReadingShelf
        items={reading}
        busyId={busyId}
        onSelect={onSelect}
        onReindex={onReindex}
        onEnrich={onEnrich}
        onDelete={onDelete}
        onTagClick={onTagClick}
        onNavigate={onNavigateShelf}
      />
    </div>
  )
}

export default memo(LibraryEditorialShelves)
