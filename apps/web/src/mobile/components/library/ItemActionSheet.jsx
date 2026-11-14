import { motion, AnimatePresence } from 'framer-motion'
import { BottomSheet } from '../libraryUi.jsx'

export default function ItemActionSheet({
  isOpen,
  item,
  onClose,
  onShare,
  onAddToCollection,
  onToggleFavorite,
  onEditTags,
  onReEnrich,
  onOpenOriginal,
  onDelete,
}) {
  if (!item) return null

  const isFavorite = item.is_favorite || item.favorite

  return (
    <BottomSheet
      open={isOpen}
      onClose={onClose}
      label="Item actions"
      grabber
      showClose={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 4 }}>
        {onShare && (
          <button
            type="button"
            className="lb-act"
            onClick={() => {
              onClose()
              onShare(item)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
            Share
          </button>
        )}

        {onAddToCollection && (
          <button
            type="button"
            className="lb-act"
            onClick={() => {
              onClose()
              onAddToCollection(item)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <path d="M12 11v5M9.5 13.5h5" />
            </svg>
            Add to collection
          </button>
        )}

        {onToggleFavorite && (
          <button
            type="button"
            className="lb-act"
            onClick={() => {
              onClose()
              onToggleFavorite(item)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill={isFavorite ? '#F5A524' : 'none'} stroke={isFavorite ? '#F5A524' : 'currentColor'} strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z" />
            </svg>
            {isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          </button>
        )}

        {onEditTags && (
          <button
            type="button"
            className="lb-act"
            onClick={() => {
              onClose()
              onEditTags(item)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 9h14M5 15h14M9 4L7.5 20M16.5 4L15 20" />
            </svg>
            Edit tags
          </button>
        )}

        {onReEnrich && (
          <button
            type="button"
            className="lb-act"
            onClick={() => {
              onClose()
              onReEnrich(item)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            Re-enrich
          </button>
        )}

        {item.url && onOpenOriginal && (
          <button
            type="button"
            className="lb-act"
            onClick={() => {
              onClose()
              onOpenOriginal(item)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
            </svg>
            Open original
          </button>
        )}

        {onDelete && (
          <button
            type="button"
            className="lb-act"
            style={{ color: '#B3261E', borderBottom: 0 }}
            onClick={() => {
              onClose()
              onDelete(item)
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
            </svg>
            Delete
          </button>
        )}

        <button
          type="button"
          className="glass"
          style={{
            marginTop: 10,
            width: '100%',
            height: 52,
            borderRadius: 14,
            border: 0,
            fontSize: 17,
            fontWeight: 700,
            color: '#151517',
            cursor: 'pointer',
          }}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </BottomSheet>
  )
}
