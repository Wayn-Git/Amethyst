import { BottomSheet } from '../libraryUi.jsx'
import { INK, MUTED, DANGER_RED, LINE } from './tokens.js'

export default function ItemActionSheet({
  open,
  isOpen,
  onClose,
  item,
  isFavorite = false,
  onShare,
  onAddToCollection,
  onToggleFavorite,
  onEditTags,
  onReEnrich,
  onOpenOriginal,
  onArchive,
  onDelete,
}) {
  const visible = open ?? isOpen
  const actions = [
    {
      id: 'share',
      label: 'Share',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onShare?.(item)
      },
    },
    {
      id: 'collect',
      label: 'Add to collection',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          <path d="M12 11v5M9.5 13.5h5" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onAddToCollection?.(item)
      },
    },
    {
      id: 'favorite',
      label: isFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill={isFavorite ? '#F5A524' : 'none'} stroke={isFavorite ? '#F5A524' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onToggleFavorite?.(item)
      },
    },
    {
      id: 'tags',
      label: 'Edit tags',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 9h14M5 15h14M9 4L7.5 20M16.5 4L15 20" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onEditTags?.(item)
      },
    },
    {
      id: 'enrich',
      label: 'Re-enrich',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onReEnrich?.(item)
      },
    },
    {
      id: 'original',
      label: 'Open original',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onOpenOriginal?.(item)
      },
    },
    {
      id: 'archive',
      label: 'Archive',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onArchive?.(item)
      },
    },
    {
      id: 'delete',
      label: 'Delete',
      danger: true,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
        </svg>
      ),
      action: () => {
        onClose?.()
        onDelete?.(item)
      },
    },
  ]

  return (
    <BottomSheet open={visible} onClose={onClose} grabber={true} showClose={false}>
      <div style={{ padding: '0 4px 10px' }}>
        {actions.map((act) => (
          <button
            key={act.id}
            type="button"
            onClick={act.action}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              width: '100%',
              height: 52,
              padding: '0 8px',
              border: 0,
              borderBottom: act.id === 'delete' ? 'none' : '1px solid rgba(60,60,67,.12)',
              background: 'transparent',
              color: act.danger ? DANGER_RED : INK,
              fontSize: 17,
              fontWeight: 500,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span style={{ flex: 'none', display: 'flex', color: act.danger ? DANGER_RED : '#636366' }}>
              {act.icon}
            </span>
            <span style={{ flex: 1 }}>{act.label}</span>
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
