import { motion, AnimatePresence } from 'framer-motion'

export default function MultiSelectBar({
  visible,
  selectedCount = 0,
  isAllSelected = false,
  onSelectAll,
  onCancel,
  onCollect,
  onTag,
  onShare,
  onDelete,
}) {
  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Top selection header bar */}
          <motion.div
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              height: 'calc(env(safe-area-inset-top, 0px) + 54px)',
              paddingTop: 'env(safe-area-inset-top, 0px)',
              background: 'rgba(242,242,247,0.92)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 16,
              paddingRight: 16,
              zIndex: 110,
              borderBottom: '1px solid #ECECF0',
            }}
          >
            <button
              type="button"
              style={{
                border: 0,
                background: 'transparent',
                color: '#0A55C4',
                fontSize: 17,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={onCancel}
            >
              Cancel
            </button>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#151517' }}>
              {selectedCount} selected
            </span>
            <button
              type="button"
              style={{
                border: 0,
                background: 'transparent',
                color: '#0A55C4',
                fontSize: 17,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              onClick={onSelectAll}
            >
              {isAllSelected ? 'Deselect all' : 'Select all'}
            </button>
          </motion.div>

          {/* Bottom actions dock */}
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              height: 'calc(env(safe-area-inset-bottom, 0px) + 64px)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(28px) saturate(200%)',
              WebkitBackdropFilter: 'blur(28px) saturate(200%)',
              borderTop: '1px solid #ECECF0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-around',
              paddingLeft: 12,
              paddingRight: 12,
              zIndex: 110,
            }}
          >
            {onCollect && (
              <button
                type="button"
                disabled={selectedCount === 0}
                style={{
                  border: 0,
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  color: selectedCount > 0 ? '#151517' : '#8E8E93',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedCount > 0 ? 'pointer' : 'default',
                  opacity: selectedCount > 0 ? 1 : 0.4,
                }}
                onClick={onCollect}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <path d="M12 11v5M9.5 13.5h5" />
                </svg>
                Collect
              </button>
            )}

            {onTag && (
              <button
                type="button"
                disabled={selectedCount === 0}
                style={{
                  border: 0,
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  color: selectedCount > 0 ? '#151517' : '#8E8E93',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedCount > 0 ? 'pointer' : 'default',
                  opacity: selectedCount > 0 ? 1 : 0.4,
                }}
                onClick={onTag}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 9h14M5 15h14M9 4L7.5 20M16.5 4L15 20" />
                </svg>
                Tag
              </button>
            )}

            {onShare && (
              <button
                type="button"
                disabled={selectedCount === 0}
                style={{
                  border: 0,
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  color: selectedCount > 0 ? '#151517' : '#8E8E93',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedCount > 0 ? 'pointer' : 'default',
                  opacity: selectedCount > 0 ? 1 : 0.4,
                }}
                onClick={onShare}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
                </svg>
                Share
              </button>
            )}

            {onDelete && (
              <button
                type="button"
                disabled={selectedCount === 0}
                style={{
                  border: 0,
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  color: selectedCount > 0 ? '#B3261E' : '#8E8E93',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: selectedCount > 0 ? 'pointer' : 'default',
                  opacity: selectedCount > 0 ? 1 : 0.4,
                }}
                onClick={onDelete}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
                </svg>
                Delete
              </button>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
