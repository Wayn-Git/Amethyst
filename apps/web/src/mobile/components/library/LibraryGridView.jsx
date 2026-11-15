import { motion } from 'framer-motion'
import { KIND_META, canonicalKind, INK, MUTED, BLUE } from './tokens.js'
import { EmptyLibraryState } from './LibraryListView.jsx'
import { Skeleton } from '../libraryUi.jsx'

export default function LibraryGridView({
  items = [],
  loading = false,
  activeFilter = 'all',
  onFilterChange,
  selectMode = false,
  selectedIds = new Set(),
  onToggleSelect,
  onSelectItem,
  onOpenItem,
  onStartSelect,
  onCreateClick,
}) {
  const handleItemClick = onSelectItem || onOpenItem
  if (loading && items.length === 0) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px 10px', padding: '14px 0 20px' }}>
        {[...Array(9)].map((_, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton height={106} radius={18} />
            <Skeleton height={14} radius={4} width="80%" />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0 && !loading) {
    return <EmptyLibraryState onSaveFirst={onCreateClick} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '12px 10px',
          padding: '4px 0 20px',
          boxSizing: 'border-box',
          width: '100%',
        }}
      >
      {items.map((item) => {
        const isSelected = selectedIds.has(item.id)
        const kind = canonicalKind(item.kind)
        const meta = KIND_META[kind] || KIND_META.article

        return (
          <motion.div
            key={item.id}
            whileTap={{ scale: 0.96 }}
            onClick={selectMode ? () => onToggleSelect?.(item.id) : () => handleItemClick?.(item)}
            onContextMenu={(e) => {
              e.preventDefault()
              onStartSelect?.(item.id)
            }}
            style={{
              position: 'relative',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 18,
              minWidth: 0,
              width: '100%',
              overflow: 'hidden',
              boxShadow: isSelected ? `0 0 0 2px ${BLUE}` : 'none',
              padding: isSelected ? 2 : 0,
            }}
          >
            {/* Square thumbnail with radius 18 */}
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '1 / 1',
                borderRadius: 18,
                overflow: 'hidden',
                background: meta.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 28, opacity: 0.6, color: meta.darkText ? INK : '#FFFFFF' }}>
                {kind === 'video' ? '▶' : kind === 'recipe' ? '🍳' : kind === 'book' ? '📖' : kind === 'movie' ? '🎬' : '📄'}
              </span>
              {item.thumbnail_url && (
                <img
                  src={item.thumbnail_url}
                  alt=""
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}

              {selectMode && (
                <span
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 6,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: isSelected ? BLUE : 'rgba(0,0,0,.5)',
                    border: '1.5px solid #FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#FFFFFF',
                  }}
                >
                  {isSelected && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </span>
              )}

              {/* Duration badge */}
              {item.duration_seconds > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    right: 6,
                    bottom: 6,
                    padding: '2px 5px',
                    borderRadius: 5,
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#FFFFFF',
                    background: 'rgba(0,0,0,.6)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.floor(item.duration_seconds / 60)}:{String(item.duration_seconds % 60).padStart(2, '0')}
                </span>
              )}
            </div>

            {/* One-line title under it (13/600) */}
            <div
              style={{
                margin: '6px 2px 0',
                fontSize: 13,
                fontWeight: 600,
                lineHeight: '17px',
                color: INK,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.title || item.url || 'Untitled save'}
            </div>
          </motion.div>
        )
      })}
      </div>
    </div>
  )
}
