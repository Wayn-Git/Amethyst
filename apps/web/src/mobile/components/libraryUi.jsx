import { useEffect, useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { LibraryThumbnail } from '../thumbnailLoader.jsx'
import {
  INK,
  MUTED,
  LINE,
  BLUE,
  DEEP_BLUE,
  BLUE_SOFT,
  CARD,
  CANVAS,
  KIND_META,
  canonicalKind,
  statusLabelFor,
  normalizeTags,
  GLASS_STYLE,
  GLASS_DARK_STYLE,
  GLASS_MAP_STYLE,
  CARD_SHADOW,
  SHEET_SHADOW,
  ALERT_SHADOW,
} from './library/tokens.js'

export const CARD_EASE = [0.16, 1, 0.3, 1]

/* Real frosted glass container primitive */
export function Glass({
  children,
  variant = 'light', // 'light' | 'dark' | 'map'
  radius = 23,
  style = {},
  className = '',
  onClick,
  ...props
}) {
  const baseStyle = useMemo(() => {
    if (variant === 'dark') return GLASS_DARK_STYLE
    if (variant === 'map') return GLASS_MAP_STYLE
    return GLASS_STYLE
  }, [variant])

  return (
    <div
      className={`lb-glass ${className}`}
      onClick={onClick}
      style={{
        ...baseStyle,
        borderRadius: radius,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
}

/* 44-46px circle glass button below status bar */
export function HeaderCircleButton({
  label,
  onClick,
  children,
  size = 46,
  style = {},
  testId,
  ariaExpanded,
}) {
  return (
    <motion.button
      type="button"
      className="lb-header-circle-btn"
      aria-label={label}
      aria-expanded={ariaExpanded}
      data-testid={testId}
      whileTap={{ scale: 0.92 }}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: size / 2,
        border: 0,
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: INK,
        cursor: 'pointer',
        ...GLASS_STYLE,
        ...style,
      }}
    >
      {children}
    </motion.button>
  )
}

export function GlassIconButton({ label, onClick, children, width = 46, style = {}, className = '', testId }) {
  return (
    <HeaderCircleButton label={label} onClick={onClick} size={width} style={style} testId={testId}>
      {children}
    </HeaderCircleButton>
  )
}

/* Item Action Bar pinned at bottom of item screens */
export function ItemActionBar({
  isFavorite = false,
  onToggleFavorite,
  onDiscussWithAgent,
}) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
        left: 16,
        right: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 40,
        pointerEvents: 'auto',
      }}
    >
      {/* 58pt Glass Circle with star */}
      <motion.button
        type="button"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        whileTap={{ scale: 0.92 }}
        onClick={onToggleFavorite}
        style={{
          width: 58,
          height: 58,
          minWidth: 58,
          borderRadius: 29,
          border: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: isFavorite ? '#F5A524' : INK,
          cursor: 'pointer',
          ...GLASS_STYLE,
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill={isFavorite ? '#F5A524' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </motion.button>

      {/* 58pt Dark Glass Pill "Discuss with Agent" */}
      <motion.button
        type="button"
        aria-label="Discuss with Agent"
        whileTap={{ scale: 0.96 }}
        onClick={onDiscussWithAgent}
        style={{
          flex: 1,
          height: 58,
          borderRadius: 29,
          border: 0,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          color: '#FFFFFF',
          fontSize: 17,
          fontWeight: 650,
          cursor: 'pointer',
          ...GLASS_DARK_STYLE,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <span>Discuss with Agent</span>
      </motion.button>
    </div>
  )
}

/* Segmented control with sliding pill */
export function Segmented({ segments, value, onChange, height = 44 }) {
  const index = Math.max(0, segments.findIndex((segment) => segment.value === value))
  return (
    <div
      role="tablist"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(118,118,128,.12)',
        borderRadius: height / 2,
        padding: 3,
        height,
        boxSizing: 'border-box',
      }}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        style={{
          position: 'absolute',
          top: 3,
          bottom: 3,
          width: `calc(${100 / segments.length}% - 6px)`,
          left: `calc(${(index * 100) / segments.length}% + 3px)`,
          background: '#FFFFFF',
          borderRadius: (height - 6) / 2,
          boxShadow: '0 1px 2px rgba(0,0,0,.08), 0 3px 8px rgba(0,0,0,.08)',
          pointerEvents: 'none',
        }}
      />
      {segments.map((segment) => {
        const isSelected = value === segment.value
        return (
          <button
            key={segment.value}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange(segment.value)}
            style={{
              position: 'relative',
              flex: 1,
              height: '100%',
              border: 0,
              background: 'transparent',
              color: INK,
              fontSize: 15,
              fontWeight: isSelected ? 700 : 500,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              zIndex: 2,
              padding: '0 8px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{segment.label}</span>
            {segment.count != null && (
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: isSelected ? INK : MUTED,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {segment.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* Wrapping chip row */
export function ChipRow({ options, value, onChange, testIdPrefix = 'chip' }) {
  return (
    <div
      role="radiogroup"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
      }}
    >
      {options.map(([optVal, optLabel]) => {
        const isSelected = value === optVal
        return (
          <motion.button
            key={optVal}
            type="button"
            data-testid={`${testIdPrefix}-${optVal}`}
            aria-pressed={isSelected}
            whileTap={{ scale: 0.94 }}
            onClick={() => onChange(optVal)}
            style={{
              height: 40,
              padding: '0 16px',
              borderRadius: 20,
              border: isSelected ? 'none' : '1px solid #D8D8DE',
              background: isSelected ? BLUE : '#FFFFFF',
              color: isSelected ? '#FFFFFF' : INK,
              fontSize: 15,
              fontWeight: isSelected ? 650 : 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: isSelected ? '0 2px 8px rgba(11,95,217,.3)' : 'none',
            }}
          >
            {optLabel}
          </motion.button>
        )
      })}
    </div>
  )
}

/* 48pt tall status pills */
export function StatusPills({ options, value, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        width: '100%',
      }}
    >
      {options.map(([pillVal, pillLabel]) => {
        const isSelected = value === pillVal
        return (
          <button
            key={pillVal}
            type="button"
            onClick={() => onChange(pillVal)}
            style={{
              flex: 1,
              minWidth: 0,
              height: 48,
              borderRadius: 24,
              border: isSelected ? 'none' : '1px solid #D8D8DE',
              background: isSelected ? INK : '#FFFFFF',
              color: isSelected ? '#FFFFFF' : INK,
              fontSize: 15,
              fontWeight: isSelected ? 650 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              padding: '0 4px',
            }}
          >
            {pillLabel}
          </button>
        )
      })}
    </div>
  )
}

/* Section label: 13pt, weight 700, uppercase, letter-spacing 0.07em */
export function SectionLabel({ text, style = {}, action }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '28px 4px 12px',
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        {text}
      </span>
      {action}
    </div>
  )
}

export function SectionHead({ title, note, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '14px 4px 8px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MUTED }}>
        {title}
      </div>
      {note != null && <span style={{ fontSize: 13, color: MUTED }}>{note}</span>}
      {action}
    </div>
  )
}

/* Subtitle and description helpers matching Main.dc.html */
export function formatCardSubtitle(item, kind, meta) {
  if (kind === 'recipe') {
    const time = item.cooking_time || item.total_time || item.duration || '35 min'
    const diff = item.difficulty || 'Easy'
    return `Recipe · ${time} · ${diff}`
  }
  if (kind === 'movie') {
    let extra = item.extra_data || item.entity
    if (typeof extra === 'string') {
      try {
        extra = JSON.parse(extra)
      } catch {}
    }
    const year = extra?.release_year || item.year || (item.published_on ? String(item.published_on).slice(0, 4) : (item.consumed_on ? String(item.consumed_on).slice(0, 4) : '2024'))
    const duration = extra?.duration || item.duration || ''
    const genre = extra?.genre || (item.category && item.category !== 'general' ? item.category : 'Drama')
    const parts = ['Movie', year]
    if (duration) parts.push(duration)
    else if (genre) parts.push(genre)
    return parts.join(' · ')
  }
  if (kind === 'note') {
    if (Array.isArray(item.checklist) && item.checklist.length > 0) {
      const done = item.checklist.filter((c) => c.checked).length
      return `Note · ${done} of ${item.checklist.length} done`
    }
    return `Note · ${item.author || 'Personal'}`
  }
  if (kind === 'video') {
    const source = (item.site || item.author || 'youtu.be').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')
    return `Video · ${source}`
  }
  if (kind === 'article') {
    const source = (item.site || item.author || 'tikvib.com').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '')
    return `Article · ${source}`
  }
  if (kind === 'game') {
    return `Game · ${item.publisher || item.author || 'Capcom'}`
  }
  if (kind === 'post') {
    return item.author || item.site ? `Post · ${item.author || item.site}` : 'Post'
  }
  return `${meta?.label || 'Saved'}${item.site || item.author ? ` · ${item.site || item.author}` : ''}`
}

export function getCardDescription(item) {
  const raw = item.description || item.summary || item.capture_note || item.notes || item.excerpt || ''
  if (!raw) return ''
  const clean = String(raw)
    .replace(/^[#*-\s]+/, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/^Executive Overview:\s*/i, '')
    .trim()
  if (!clean) return ''
  return clean.length > 70 ? `${clean.slice(0, 70)}...` : clean
}

/* List Row Card: radius 22, 12pt padding, 96pt rounded thumbnail matching Main.dc.html */
export function ListRowCard({
  item,
  selected = false,
  multiSelect = false,
  onSelectToggle,
  onClick,
  onLongPress,
}) {
  const kind = canonicalKind(item.kind)
  const meta = KIND_META[kind] || KIND_META.article
  const progressLabel = statusLabelFor(kind, item.progress)
  const subtitle = formatCardSubtitle(item, kind, meta)
  const description = getCardDescription(item)
  const tags = normalizeTags(item?.tags)

  const THUMB_BG = {
    post: '#1f3d2b',
    article: '#4C5A8A',
    video: '#2B3040',
    game: '#0c4a54',
    recipe: '#b5501a',
    movie: '#1E2A4F',
    note: '#E8E8ED',
    podcast: '#5C2D91',
    book: '#6D4C41',
    place: '#2E5A44',
    product: '#1A237E',
    other: '#2B3040',
  }
  const thumbBg = THUMB_BG[kind] || meta.color || '#2B3040'

  const durationText = useMemo(() => {
    if (item.duration_text) return item.duration_text
    if (item.duration_seconds > 0) {
      const mins = Math.floor(item.duration_seconds / 60)
      const secs = String(item.duration_seconds % 60).padStart(2, '0')
      return `${mins}:${secs}`
    }
    return null
  }, [item.duration_text, item.duration_seconds])

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={multiSelect ? onSelectToggle : onClick}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault()
          onLongPress()
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 22,
        background: '#FFFFFF',
        boxShadow: selected
          ? '0 0 0 2px #0B5FD9, 0 4px 14px rgba(0,0,0,.08)'
          : '0 2px 10px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.03)',
        cursor: 'pointer',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {multiSelect && (
        <span
          style={{
            flex: 'none',
            width: 28,
            height: 28,
            borderRadius: 14,
            border: selected ? 'none' : '2px solid #C7C7CC',
            background: selected ? BLUE : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
          }}
        >
          {selected && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
        </span>
      )}

      {/* 96pt Rounded Thumbnail */}
      <div
        style={{
          position: 'relative',
          width: 96,
          height: 96,
          minWidth: 96,
          minHeight: 96,
          borderRadius: 20,
          overflow: 'hidden',
          background: thumbBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        {/* Fallback Icon Centered in Thumbnail Box */}
        {kind === 'note' ? (
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#0A55C4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3" />
          </svg>
        ) : (
          <span style={{ fontSize: 28, opacity: 0.5, color: '#FFFFFF', pointerEvents: 'none' }}>
            {kind === 'video' ? '▶' : kind === 'recipe' ? '🍳' : kind === 'book' ? '📖' : kind === 'movie' ? '🎬' : kind === 'game' ? '🎮' : '📄'}
          </span>
        )}

        {/* Thumbnail Image */}
        <LibraryThumbnail item={item} />

        {/* Badges on Thumbnail */}
        {kind === 'video' ? (
          <>
            <span
              style={{
                position: 'absolute',
                left: 8,
                top: 8,
                padding: '4px 9px',
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '.08em',
                color: '#fff',
                zIndex: 2,
                ...GLASS_DARK_STYLE,
              }}
            >
              VIDEO
            </span>
            {durationText && (
              <span
                style={{
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  padding: '3px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#fff',
                  fontVariantNumeric: 'tabular-nums',
                  zIndex: 2,
                  ...GLASS_DARK_STYLE,
                }}
              >
                {durationText}
              </span>
            )}
          </>
        ) : kind === 'note' ? (
          <span
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
              padding: '4px 9px',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.08em',
              color: '#fff',
              background: '#0A55C4',
              zIndex: 2,
            }}
          >
            NOTE
          </span>
        ) : (
          <span
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
              padding: '4px 9px',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '.08em',
              color: '#fff',
              zIndex: 2,
              ...GLASS_DARK_STYLE,
            }}
          >
            {(meta.label || kind).toUpperCase()}
          </span>
        )}
      </div>

      {/* Right Column: Title + Subtitle + Description + Tags */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 17,
            lineHeight: '22px',
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

        <div style={{ fontSize: 13, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}
        </div>

        {description && (
          <div
            style={{
              fontSize: 13,
              lineHeight: '17px',
              color: '#636366',
              opacity: 0.88,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {description}
          </div>
        )}

        {/* Tags or Status chips */}
        {(tags.length > 0 || (item.progress && item.progress !== 'unstarted') || item.is_favorite || item.favorite) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                style={{
                  display: 'inline-block',
                  padding: '3px 10px',
                  borderRadius: 10,
                  background: '#E8F0FD',
                  color: '#0A55C4',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {tag.startsWith('#') ? tag : `#${tag}`}
              </span>
            ))}
            {item.progress && item.progress !== 'unstarted' && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '3px 10px',
                  borderRadius: 10,
                  background: '#E4EDFC',
                  color: '#0A55C4',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {progressLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

/* Bottom Sheet Modal: 28px top radius, grabber, full-width controls */
export function BottomSheet({
  open,
  onClose,
  label,
  children,
  headTitle,
  showClose = true,
  grabber = true,
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label || headTitle}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            style={{
              width: '100%',
              maxHeight: '92vh',
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              background: 'rgba(250,250,252,.85)',
              WebkitBackdropFilter: 'blur(32px) saturate(200%)',
              backdropFilter: 'blur(32px) saturate(200%)',
              boxShadow: SHEET_SHADOW,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
              overflow: 'hidden',
            }}
          >
            {grabber && (
              <div
                style={{
                  width: 36,
                  height: 5,
                  borderRadius: 3,
                  background: 'rgba(60,60,67,.3)',
                  margin: '10px auto 4px',
                }}
                aria-hidden="true"
              />
            )}

            {headTitle && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 20px 8px',
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: 22,
                    fontWeight: 800,
                    color: INK,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {headTitle}
                </h2>
                {showClose && (
                  <HeaderCircleButton label="Close" size={44} onClick={onClose}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </HeaderCircleButton>
                )}
              </div>
            )}

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                WebkitOverflowScrolling: 'touch',
                padding: '0 20px',
              }}
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* Skeleton loader: flat #E5E5EA blocks with slow opacity pulse */
export function Skeleton({ width = '100%', height = 20, radius = 6, style = {} }) {
  return (
    <motion.div
      animate={{ opacity: [0.5, 0.9, 0.5] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        width,
        height,
        borderRadius: radius,
        background: '#E5E5EA',
        ...style,
      }}
    />
  )
}

/* Add to Collection Sheet (Page 22) */
export function AddToCollectionSheet({ open, onClose, item, showToast }) {
  const [lists, setLists] = useState([])
  const [memberIds, setMemberIds] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    api
      .getLibraryLists()
      .then((res) => {
        if (cancelled) return
        const loaded = res || []
        setLists(loaded)
        const ids = new Set()
        for (const row of loaded) {
          if (Array.isArray(row.member_item_ids) && row.member_item_ids.includes(item?.id)) ids.add(row.id)
        }
        setMemberIds(ids)
      })
      .catch((err) => {
        if (!cancelled) showToast?.(`Could not load collections: ${err.message}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, item?.id])

  const toggle = async (listId) => {
    if (!item?.id) return
    const wasMember = memberIds.has(listId)
    setMemberIds((prev) => {
      const next = new Set(prev)
      if (wasMember) next.delete(listId)
      else next.add(listId)
      return next
    })
    try {
      if (wasMember) {
        await api.removeLibraryListMember(listId, { item_id: item.id })
      } else {
        await api.addLibraryListMember(listId, { item_id: item.id })
      }
    } catch (err) {
      setMemberIds((prev) => {
        const next = new Set(prev)
        if (wasMember) next.add(listId)
        else next.delete(listId)
        return next
      })
      showToast?.(`Could not update collection: ${err.message}`)
    }
  }

  const createAndAdd = async () => {
    const title = newTitle.trim()
    if (!title || creating) return
    setCreating(true)
    try {
      const created = await api.createLibraryList({ title, description: '', icon: 'bookmark', is_smart: false })
      if (item?.id && created?.id) {
        await api.addLibraryListMember(created.id, { item_id: item.id })
        setMemberIds((prev) => new Set(prev).add(created.id))
      }
      const nextLists = await api.getLibraryLists()
      setLists(nextLists || [])
      setNewTitle('')
      showToast?.(`Added to "${title}"`)
    } catch (err) {
      showToast?.(`Could not create collection: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} headTitle="Add to collection">
      {item && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 14,
            borderRadius: 18,
            background: '#FFFFFF',
            boxShadow: CARD_SHADOW,
            margin: '10px 0 16px',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 12,
              background: '#2B3040',
              overflow: 'hidden',
              flex: 'none',
            }}
          >
            {item.thumbnail_url && (
              <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 650, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.title || item.url || 'Save'}
            </div>
            <div style={{ fontSize: 13, color: MUTED }}>
              {item.kind ? item.kind.charAt(0).toUpperCase() + item.kind.slice(1) : 'Item'}
            </div>
          </div>
        </div>
      )}

      <SectionLabel text="Collections" style={{ margin: '14px 4px 8px' }} />

      <div
        style={{
          borderRadius: 20,
          background: '#FFFFFF',
          boxShadow: CARD_SHADOW,
          overflow: 'hidden',
          marginBottom: 16,
        }}
      >
        {loading && <div style={{ padding: 16, color: MUTED, textAlign: 'center' }}>Loading…</div>}
        {!loading && lists.length === 0 && (
          <div style={{ padding: 16, color: MUTED, textAlign: 'center' }}>No collections yet.</div>
        )}
        {lists.map((list) => {
          const on = memberIds.has(list.id)
          return (
            <button
              key={list.id}
              type="button"
              onClick={() => toggle(list.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 56,
                padding: '0 16px',
                border: 0,
                borderBottom: `1px solid ${LINE}`,
                background: 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  border: on ? 'none' : '2px solid #C7C7CC',
                  background: on ? BLUE : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#FFFFFF',
                  flex: 'none',
                }}
              >
                {on && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </span>
              <span style={{ flex: 1, fontSize: 16, fontWeight: 550, color: INK }}>{list.title}</span>
              <span style={{ fontSize: 13, color: MUTED }}>{list.item_count ?? 0} saves</span>
            </button>
          )
        })}

        {/* New collection input row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            minHeight: 56,
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              background: BLUE_SOFT,
              color: DEEP_BLUE,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="New collection"
            style={{
              flex: 1,
              border: 0,
              fontSize: 16,
              outline: 'none',
              background: 'transparent',
              color: INK,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                createAndAdd()
              }
            }}
          />
          {newTitle.trim() && (
            <button
              type="button"
              onClick={createAndAdd}
              disabled={creating}
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 18,
                background: BLUE,
                color: '#FFFFFF',
                border: 0,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        style={{
          width: '100%',
          height: 54,
          borderRadius: 16,
          background: BLUE,
          color: '#FFFFFF',
          border: 0,
          fontSize: 17,
          fontWeight: 650,
          cursor: 'pointer',
          marginTop: 8,
        }}
      >
        Done
      </button>
    </BottomSheet>
  )
}
