import { useMemo, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ListRowCard, SectionLabel, Skeleton, getCardDescription } from '../libraryUi.jsx'
import { LibraryThumbnail } from '../../thumbnailLoader.jsx'
import {
  INK,
  MUTED,
  LINE,
  BLUE,
  DEEP_BLUE,
  BLUE_SOFT,
  KIND_META,
  canonicalKind,
  statusLabelFor,
  CARD_SHADOW,
} from './tokens.js'

/* Jump back in colored cards palette (Page 2) */
const JUMP_COLORS = {
  recipe: '#C2561A',
  movie: '#1E2A4F',
  note: '#3157C8',
  video: '#2B3040',
  game: '#0C4A54',
  book: '#6D4C41',
  podcast: '#5C2D91',
  product: '#1A237E',
  article: '#4C5A8A',
  default: '#2B3040',
}

/* Page 16: Empty Library state matching empty_library.html */
export function EmptyLibraryState({ onSaveFirst }) {
  return (
    <div style={{ padding: '0 16px 40px', boxSizing: 'border-box' }}>
      {/* Visual illustration stack */}
      <div style={{ position: 'relative', width: 200, height: 150, margin: '34px auto 0' }}>
        <div
          style={{
            position: 'absolute',
            left: 14,
            top: 18,
            width: 120,
            height: 104,
            borderRadius: 22,
            background: '#D6E4FB',
            transform: 'rotate(-8deg)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 14,
            top: 18,
            width: 120,
            height: 104,
            borderRadius: 22,
            background: '#E5E5EA',
            transform: 'rotate(7deg)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 40,
            top: 0,
            width: 120,
            height: 120,
            borderRadius: 26,
            background: '#FFFFFF',
            boxShadow: '0 8px 24px rgba(0,0,0,.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              background: '#0B5FD9',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </div>
        </div>
      </div>

      {/* Headline & description */}
      <div style={{ textAlign: 'center', padding: '0 24px' }}>
        <h2 style={{ margin: '20px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em', color: INK }}>
          Nothing saved yet
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: 16, lineHeight: '25px', color: MUTED }}>
          Save links, videos, recipes, movies and notes. Everything lands here, sorted and searchable.
        </p>
      </div>

      {/* Primary button */}
      <div style={{ margin: '24px 0 0' }}>
        <button
          type="button"
          onClick={onSaveFirst}
          style={{
            width: '100%',
            height: 52,
            borderRadius: 14,
            border: 0,
            background: BLUE,
            color: '#FFFFFF',
            fontSize: 17,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Save your first link
        </button>
      </div>

      {/* Ways to save section */}
      <h3
        style={{
          margin: '28px 4px 10px',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        Ways to save
      </h3>

      <div
        style={{
          padding: '0 14px',
          borderRadius: 22,
          background: '#FFFFFF',
          boxShadow: CARD_SHADOW,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, borderBottom: `1px solid ${LINE}` }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              background: BLUE_SOFT,
              color: DEEP_BLUE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
          </span>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: INK }}>Share from any app</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              background: BLUE_SOFT,
              color: DEEP_BLUE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: INK }}>Paste a link</span>
        </div>
      </div>
    </div>
  )
}

/* Jump back in colored card matching Main.dc.html */
export function JumpBackInCard({ item, onClick }) {
  const kind = canonicalKind(item.kind)
  const meta = KIND_META[kind] || KIND_META.recipe
  const bg = JUMP_COLORS[kind] || JUMP_COLORS.default
  const progressText = item.progress_text || statusLabelFor(kind, item.progress)
  const description = getCardDescription(item)

  // Progress detail subtext (e.g. "2 of 6 ingredients", "Rated 3 of 5", "1 of 4 done", "Stopped at 04:12")
  const detailText = useMemo(() => {
    if (item.subtitle) return item.subtitle
    if (kind === 'recipe') {
      const ing = item.ingredient_count || (Array.isArray(item.ingredients) ? item.ingredients.length : 6)
      return `2 of ${ing} ingredients`
    }
    if (kind === 'movie') {
      return item.rating ? `Rated ${item.rating} of 5` : 'Watchlist'
    }
    if (kind === 'note' && Array.isArray(item.checklist) && item.checklist.length > 0) {
      const done = item.checklist.filter((c) => c.checked).length
      return `${done} of ${item.checklist.length} done`
    }
    if (kind === 'video') {
      return item.resume_time ? `Stopped at ${item.resume_time}` : progressText
    }
    return progressText
  }, [item, kind, progressText])

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={() => onClick(item)}
      style={{
        flex: 'none',
        width: 300,
        height: 146,
        boxSizing: 'border-box',
        padding: '16px 18px',
        borderRadius: 24,
        background: bg,
        color: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'none',
        scrollSnapAlign: 'start',
      }}
    >
      {/* Background Media Thumbnail with screen blend + top mask so bottom stays clean */}
      <LibraryThumbnail
        item={item}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 0,
          opacity: 0.28,
          mixBlendMode: 'screen',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.5) 45%, rgba(0,0,0,0) 75%)',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.5) 45%, rgba(0,0,0,0) 75%)',
          pointerEvents: 'none',
        }}
      />

      {/* Top Metadata & Titles */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', opacity: 0.95, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{meta.label}</span>
          <span>·</span>
          <span>{progressText}</span>
        </div>
        <div style={{ fontSize: 18, lineHeight: '23px', fontWeight: 700, letterSpacing: '-0.01em', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.title || 'Untitled save'}
        </div>
        {description && (
          <div style={{ fontSize: 13, lineHeight: '18px', color: 'rgba(255,255,255,.90)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }}>
            {description}
          </div>
        )}
      </div>

      {/* Bottom Progress & Resume Button */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, opacity: 0.95, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {detailText}
        </span>
        <span
          style={{
            height: 30,
            padding: '0 14px',
            borderRadius: 15,
            background: 'rgba(255,255,255,.24)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.3)',
            fontSize: 13.5,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            flex: 'none',
          }}
        >
          Resume
        </span>
      </div>
    </motion.div>
  )
}

export default function LibraryListView({
  items = [],
  resumeItems = [],
  jumpItems = [],
  loading = false,
  activeFilter = 'all',
  onFilterChange,
  onRefresh,
  selectMode = false,
  selectedIds = new Set(),
  onToggleSelect,
  onSelectItem,
  onOpenItem,
  onStartSelect,
  onCreateClick,
  onOpenCreate,
  onOpenActions,
}) {
  const realResume = resumeItems.length ? resumeItems : jumpItems
  const handleItemClick = onSelectItem || onOpenItem
  const handleCreate = onCreateClick || onOpenCreate

  // Pull-To-Refresh State with Direction Lock & Horizontal Scroll Protection
  const [pullY, setPullY] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [activeJumpIndex, setActiveJumpIndex] = useState(0)
  const touchTrackRef = useRef(null)

  const handleTouchStart = (e) => {
    // If inside horizontal scroller, never pull
    if (e.target.closest('[data-horizontal-scroll], .jump-carousel, [style*="overflow-x"], [style*="overflowX"]')) {
      touchTrackRef.current = null
      return
    }

    const atTop = (window.scrollY || document.documentElement.scrollTop || 0) <= 4
    if (!atTop) {
      touchTrackRef.current = null
      return
    }

    touchTrackRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      locked: null, // 'horizontal' | 'vertical' | 'ignored'
    }
  }

  const handleTouchMove = (e) => {
    if (!touchTrackRef.current || refreshing) return
    const currentX = e.touches[0].clientX
    const currentY = e.touches[0].clientY
    const diffX = currentX - touchTrackRef.current.startX
    const diffY = currentY - touchTrackRef.current.startY

    // Direction lock once moved > 6px
    if (touchTrackRef.current.locked === null) {
      const absX = Math.abs(diffX)
      const absY = Math.abs(diffY)
      if (absX > 6 || absY > 6) {
        if (absX >= absY) {
          // Horizontal swipe detected - lock out pull to refresh!
          touchTrackRef.current.locked = 'horizontal'
          setPullY(0)
          return
        }
        if (diffY > 0) {
          touchTrackRef.current.locked = 'vertical'
        } else {
          touchTrackRef.current.locked = 'ignored'
          setPullY(0)
          return
        }
      } else {
        return
      }
    }

    if (touchTrackRef.current.locked === 'vertical' && diffY > 0) {
      setPullY(Math.min(diffY * 0.45, 75))
    }
  }

  const handleTouchEnd = async () => {
    const track = touchTrackRef.current
    touchTrackRef.current = null
    if (track && track.locked === 'vertical' && pullY > 48 && onRefresh && !refreshing) {
      setRefreshing(true)
      setPullY(48)
      try {
        await onRefresh()
      } finally {
        setTimeout(() => {
          setRefreshing(false)
          setPullY(0)
        }, 350)
      }
    } else {
      setPullY(0)
    }
  }

  /* Date grouping by consumed_on / created_at */
  const groupedSections = useMemo(() => {
    if (!items.length) return []

    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const yestStr = yesterday.toISOString().slice(0, 10)

    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(now.getDate() - 7)

    const groups = {
      today: { title: 'Today', items: [] },
      yesterday: { title: 'Yesterday', items: [] },
      thisWeek: { title: 'This week', items: [] },
      earlier: { title: 'Earlier', items: [] },
    }

    for (const item of items) {
      const dateStr = (item.consumed_on || item.created_at || '').slice(0, 10)
      if (dateStr === todayStr) {
        groups.today.items.push(item)
      } else if (dateStr === yestStr) {
        groups.yesterday.items.push(item)
      } else if (dateStr >= sevenDaysAgo.toISOString().slice(0, 10)) {
        groups.thisWeek.items.push(item)
      } else {
        groups.earlier.items.push(item)
      }
    }

    return [
      groups.today,
      groups.yesterday,
      groups.thisWeek,
      groups.earlier,
    ].filter((g) => g.items.length > 0)
  }, [items])

  if (loading && items.length === 0) {
    return (
      <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Skeleton height={40} radius={20} />
        <Skeleton height={88} radius={22} />
        <Skeleton height={88} radius={22} />
        <Skeleton height={88} radius={22} />
        <Skeleton height={88} radius={22} />
      </div>
    )
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ padding: '0 0 24px', boxSizing: 'border-box' }}
    >
      {/* Pull-To-Refresh Indicator */}
      {(pullY > 0 || refreshing) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: pullY,
            overflow: 'hidden',
            transition: touchTrackRef.current ? 'none' : 'height 0.25s ease',
            color: BLUE,
            fontSize: 13,
            fontWeight: 600,
            gap: 8,
          }}
        >
          <svg
            style={{
              transform: `rotate(${refreshing ? 0 : Math.min(pullY * 6, 360)}deg)`,
              animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
            }}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>{refreshing ? 'Updating saves…' : pullY > 48 ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      )}

      {/* Empty State when no items exist */}
      {items.length === 0 && !loading && (
        activeFilter !== 'all' ? (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: INK }}>No {activeFilter}s found</h3>
            <p style={{ margin: '8px 0 16px', fontSize: 14, color: MUTED }}>You haven't saved any {activeFilter}s yet.</p>
            <button
              type="button"
              onClick={() => onFilterChange?.('all')}
              style={{
                padding: '8px 18px',
                borderRadius: 14,
                border: 0,
                background: BLUE,
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Show all saves
            </button>
          </div>
        ) : (
          <EmptyLibraryState onSaveFirst={handleCreate} />
        )
      )}

      {/* Section: Jump back in matching Main.dc.html - full bleed across phone screen */}
      {items.length > 0 && realResume && realResume.length > 0 && (
        <div style={{ margin: '0 -16px 14px' }}>
          <div
            style={{
              padding: '0 16px',
              margin: '6px 0 10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                color: MUTED,
              }}
            >
              Jump back in
            </h2>
            <button
              type="button"
              onClick={() => onFilterChange?.('in_progress')}
              style={{
                height: 36,
                padding: 0,
                border: 0,
                background: 'transparent',
                color: DEEP_BLUE,
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              See all {realResume.length}
            </button>
          </div>

          <div
            data-horizontal-scroll="true"
            onScroll={(e) => {
              const idx = Math.round(e.currentTarget.scrollLeft / 312)
              setActiveJumpIndex(Math.max(0, Math.min(idx, realResume.length - 1)))
            }}
            style={{
              display: 'flex',
              gap: 12,
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollSnapType: 'x mandatory',
              scrollPadding: '0 16px',
              padding: '0 16px 8px',
              scrollbarWidth: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {realResume.map((item) => (
              <JumpBackInCard key={item.id} item={item} onClick={() => handleItemClick?.(item)} />
            ))}
            {/* Trailing spacer so right padding matches left padding on scroll */}
            <div style={{ width: 16, minWidth: 16, height: 1, flex: '0 0 16px', pointerEvents: 'none' }} />
          </div>

          {/* Dots Indicator */}
          {realResume.length > 1 && (
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', gap: 6 }}>
              {realResume.slice(0, 6).map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === activeJumpIndex ? 18 : 7,
                    height: 7,
                    borderRadius: 4,
                    background: i === activeJumpIndex ? INK : '#C7C7CC',
                    transition: 'all 0.2s ease',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Date timeline sections matching Main.dc.html */}
      {groupedSections.map((sec) => (
        <div key={sec.title} style={{ marginBottom: 24 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              margin: '26px 4px 10px',
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '.07em',
                textTransform: 'uppercase',
                color: MUTED,
              }}
            >
              {sec.title}
            </h2>
            <span style={{ fontSize: 14, color: MUTED }}>
              {sec.items.length} saved
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sec.items.map((item) => {
              const isSelected = selectedIds.has(item.id)
              return (
                <ListRowCard
                  key={item.id}
                  item={item}
                  selected={isSelected}
                  multiSelect={selectMode}
                  onSelectToggle={() => onToggleSelect?.(item.id)}
                  onClick={() => handleItemClick?.(item)}
                  onLongPress={() => onStartSelect?.(item.id)}
                />
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
