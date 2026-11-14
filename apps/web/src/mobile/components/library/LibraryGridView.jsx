import { motion } from 'framer-motion'
import { LibraryThumbnail } from '../../thumbnailLoader.jsx'
import { INK, MUTED, KIND_META, canonicalKind } from './tokens.js'

function itemScreenKind(item) {
  const kind = canonicalKind(item.kind)
  if (item.category === 'movie' || item.category === 'film') return 'movie'
  if (item.category === 'food' || item.category === 'recipe') return 'recipe'
  return kind
}

export default function LibraryGridView({
  items = [],
  onOpenItem,
  onOpenActions,
  selectMode = false,
  selectedIds = new Set(),
  onToggleSelect,
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 12,
        padding: '16px 16px 110px',
      }}
    >
      {items.map((item) => {
        const kind = itemScreenKind(item)
        const meta = KIND_META[kind] || KIND_META.other
        const isSelected = selectedIds.has(item.id)

        return (
          <motion.div
            key={item.id}
            layout
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              if (selectMode) {
                onToggleSelect?.(item.id)
              } else {
                onOpenItem?.(item)
              }
            }}
            style={{
              position: 'relative',
              borderRadius: 20,
              background: '#fff',
              overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)',
              display: 'flex',
              flexDirection: 'column',
              cursor: 'pointer',
            }}
          >
            {/* Thumbnail banner */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                paddingTop: '68%',
                background: meta.color,
                overflow: 'hidden',
              }}
            >
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LibraryThumbnail item={item} />
              </div>

              {/* Kind badge */}
              <span
                className="glass-dark"
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  padding: '3px 8px',
                  borderRadius: 8,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: '#fff',
                }}
              >
                {meta.label}
              </span>

              {/* Video duration */}
              {item.duration && (
                <span
                  className="glass-dark"
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
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

              {/* Multi-select check */}
              {selectMode && (
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    border: isSelected ? 0 : '2px solid rgba(255,255,255,0.85)',
                    background: isSelected ? '#0B5FD9' : 'rgba(0,0,0,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </div>
              )}
            </div>

            {/* Title & metadata caption */}
            <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
                {item.title || item.url || 'Untitled save'}
              </div>
              <div style={{ fontSize: 12, color: MUTED }}>
                {item.author || meta.label}
              </div>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
