import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { LibraryThumbnail } from '../../thumbnailLoader.jsx'
import { GlassIconButton, ChipRow, CARD_EASE } from '../libraryUi.jsx'
import { INK, MUTED, KIND_META, statusLabelFor, canonicalKind } from './tokens.js'

const FILTER_CHIPS = [
  ['all', 'All'],
  ['video', 'Videos'],
  ['article', 'Articles'],
  ['post', 'Posts'],
  ['movie', 'Movies'],
  ['recipe', 'Recipes'],
  ['game', 'Games'],
  ['note', 'Notes'],
  ['book', 'Books'],
  ['place', 'Places'],
]

function parseItemTags(item) {
  if (Array.isArray(item.tags)) return item.tags
  if (typeof item.tags === 'string') {
    return item.tags.split(',').map((t) => t.trim()).filter(Boolean)
  }
  return []
}

function itemScreenKind(item) {
  const kind = canonicalKind(item.kind)
  if (item.category === 'movie' || item.category === 'film') return 'movie'
  if (item.category === 'food' || item.category === 'recipe') return 'recipe'
  return kind
}

export function TimelineCard({
  item,
  onSelect,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onOpenActions,
}) {
  const kind = itemScreenKind(item)
  const meta = KIND_META[kind] || KIND_META.other
  const tags = parseItemTags(item).slice(0, 3)
  const isFailed = item.status === 'failed'
  const isProcessing = item.status === 'received' || item.status === 'processing' || item.status === 'enriching'

  return (
    <motion.article
      layout
      transition={{ duration: 0.2, ease: CARD_EASE }}
      className="lb-card"
      onClick={() => {
        if (selectMode) {
          onToggleSelect?.(item.id)
        } else {
          onSelect?.(item)
        }
      }}
      style={{
        position: 'relative',
        display: 'flex',
        gap: 12,
        padding: 10,
        borderRadius: 22,
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 6px 18px rgba(0,0,0,.06)',
        cursor: 'pointer',
        alignItems: 'center',
        marginBottom: 8,
      }}
    >
      {/* Selection checkbox */}
      {selectMode && (
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            border: selected ? '0' : '2px solid #C7C7CC',
            background: selected ? '#0B5FD9' : '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginLeft: 4,
          }}
        >
          {selected && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
        </div>
      )}

      {/* Thumbnail */}
      <div
        style={{
          position: 'relative',
          width: 84,
          height: 84,
          borderRadius: 16,
          overflow: 'hidden',
          background: meta.color,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <LibraryThumbnail item={item} />

        {/* Kind badge */}
        <span
          className="glass-dark"
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            padding: '2px 7px',
            borderRadius: 7,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#fff',
          }}
        >
          {meta.label}
        </span>

        {/* Duration badge if video */}
        {item.duration && (
          <span
            className="glass-dark"
            style={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              padding: '2px 6px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 600,
              color: '#fff',
            }}
          >
            {item.duration}
          </span>
        )}
      </div>

      {/* Item info */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 16,
            lineHeight: '21px',
            fontWeight: 650,
            letterSpacing: '-0.01em',
            color: INK,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {item.title || item.url || 'Untitled save'}
        </h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: MUTED }}>
          <span>{meta.label}</span>
          {item.author && <span>· {item.author}</span>}
          {item.time_ago && <span>· {item.time_ago}</span>}
        </div>

        {/* Tags or Status pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
          {isProcessing && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#E4EDFC', color: '#0A55C4' }}>
              Enriching…
            </span>
          )}
          {isFailed && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#FDECEA', color: '#B3261E' }}>
              Capture failed
            </span>
          )}
          {item.progress && item.progress !== 'unstarted' && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, background: meta.tint, color: meta.tintText }}>
              {statusLabelFor(kind, item.progress)}
            </span>
          )}
          {tags.map((t) => (
            <span key={t} style={{ fontSize: 11, fontWeight: 500, color: '#636366' }}>
              #{t}
            </span>
          ))}
        </div>
      </div>

      {/* Kebab action button */}
      {!selectMode && onOpenActions && (
        <button
          type="button"
          aria-label="Item actions"
          style={{
            border: 0,
            background: 'transparent',
            padding: 8,
            color: '#8E8E93',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={(e) => {
            e.stopPropagation()
            onOpenActions(item)
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
      )}
    </motion.article>
  )
}

export function JumpCard({ item, onSelect }) {
  const kind = itemScreenKind(item)
  const meta = KIND_META[kind] || KIND_META.other

  return (
    <motion.div
      whileTap={{ scale: 0.96 }}
      onClick={() => onSelect?.(item)}
      style={{
        width: 172,
        height: 118,
        borderRadius: 20,
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 6px 18px rgba(0,0,0,.06)',
        padding: '12px 14px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        flexShrink: 0,
        cursor: 'pointer',
      }}
    >
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: meta.tintText, marginBottom: 4 }}>
          {meta.label} · {statusLabelFor(kind, item.progress || 'in_progress')}
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 650,
            lineHeight: '18px',
            color: INK,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {item.title || item.url}
        </div>
      </div>
      <div style={{ fontSize: 12, color: MUTED }}>
        {item.progress_detail || item.author || 'In progress'}
      </div>
    </motion.div>
  )
}

export default function LibraryListView({
  items = [],
  jumpItems = [],
  activeFilter = 'all',
  onFilterChange,
  onOpenItem,
  onOpenActions,
  onOpenCreate,
  selectMode = false,
  selectedIds = new Set(),
  onToggleSelect,
}) {
  // Timeline grouping
  const { today, yesterday, thisWeek, earlier } = useMemo(() => {
    const t = []
    const y = []
    const w = []
    const e = []
    const now = Date.now()
    const oneDay = 86400000

    for (const item of items) {
      if (activeFilter !== 'all' && itemScreenKind(item) !== activeFilter) continue
      const ts = item.created_at ? new Date(item.created_at).getTime() : now
      const diff = now - ts
      if (diff < oneDay) {
        t.push(item)
      } else if (diff < oneDay * 2) {
        y.push(item)
      } else if (diff < oneDay * 7) {
        w.push(item)
      } else {
        e.push(item)
      }
    }
    return { today: t, yesterday: y, thisWeek: w, earlier: e }
  }, [items, activeFilter])

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* Filter chips rail */}
      <div style={{ position: 'relative', marginTop: 16, padding: '0 16px', display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        <ChipRow options={FILTER_CHIPS} value={activeFilter} onChange={onFilterChange} />
      </div>

      {/* Jump back in carousel */}
      {jumpItems.length > 0 && (
        <section style={{ marginTop: 22 }}>
          <div style={{ padding: '0 16px', marginBottom: 10, fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
            Jump back in
          </div>
          <div style={{ display: 'flex', gap: 12, padding: '0 16px 6px', overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            {jumpItems.map((item) => (
              <JumpCard key={item.id} item={item} onSelect={onOpenItem} />
            ))}
          </div>
        </section>
      )}

      {/* Timeline groups */}
      <div style={{ padding: '0 16px', marginTop: 20 }}>
        {today.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              Today · {today.length} {today.length === 1 ? 'save' : 'saves'}
            </div>
            {today.map((item) => (
              <TimelineCard
                key={item.id}
                item={item}
                onSelect={onOpenItem}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={onToggleSelect}
                onOpenActions={onOpenActions}
              />
            ))}
          </section>
        )}

        {yesterday.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              Yesterday · {yesterday.length} {yesterday.length === 1 ? 'save' : 'saves'}
            </div>
            {yesterday.map((item) => (
              <TimelineCard
                key={item.id}
                item={item}
                onSelect={onOpenItem}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={onToggleSelect}
                onOpenActions={onOpenActions}
              />
            ))}
          </section>
        )}

        {thisWeek.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              This Week · {thisWeek.length} {thisWeek.length === 1 ? 'save' : 'saves'}
            </div>
            {thisWeek.map((item) => (
              <TimelineCard
                key={item.id}
                item={item}
                onSelect={onOpenItem}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={onToggleSelect}
                onOpenActions={onOpenActions}
              />
            ))}
          </section>
        )}

        {earlier.length > 0 && (
          <section style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              Earlier · {earlier.length} {earlier.length === 1 ? 'save' : 'saves'}
            </div>
            {earlier.map((item) => (
              <TimelineCard
                key={item.id}
                item={item}
                onSelect={onOpenItem}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={onToggleSelect}
                onOpenActions={onOpenActions}
              />
            ))}
          </section>
        )}

        {items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: MUTED }}>
            <p style={{ fontSize: 16, margin: 0 }}>No items in this view</p>
          </div>
        )}
      </div>

      {/* Floating Action Button (FAB) */}
      {!selectMode && onOpenCreate && (
        <motion.button
          type="button"
          aria-label="Save new item"
          whileTap={{ scale: 0.92 }}
          style={{
            position: 'fixed',
            right: 20,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 82px)',
            width: 56,
            height: 56,
            borderRadius: 28,
            border: 0,
            background: '#0B5FD9',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(11,95,217,0.38)',
            cursor: 'pointer',
            zIndex: 90,
          }}
          onClick={onOpenCreate}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </motion.button>
      )}
    </div>
  )
}
