import { motion, AnimatePresence } from 'framer-motion'
import { INK, MUTED, DANGER_RED, DANGER_BG, DEEP_BLUE, ALERT_SHADOW } from './tokens.js'

export default function ConfirmDeleteModal({
  open,
  isOpen,
  title = 'Delete this save?',
  itemName,
  count = 1,
  onConfirm,
  onCancel,
  onArchive,
}) {
  const visible = open ?? isOpen
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            zIndex: 130,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            boxSizing: 'border-box',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel?.()
          }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 450, damping: 32 }}
            style={{
              width: '100%',
              maxWidth: 320,
              borderRadius: 28,
              padding: '22px 18px 16px',
              background: 'rgba(250,250,252,.85)',
              WebkitBackdropFilter: 'blur(32px) saturate(200%)',
              backdropFilter: 'blur(32px) saturate(200%)',
              boxShadow: ALERT_SHADOW,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}
          >
            {/* 52px red circle with trash icon */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                background: DANGER_BG,
                color: DANGER_RED,
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
              </svg>
            </div>

            <h2
              style={{
                margin: '14px 0 0',
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: INK,
              }}
            >
              {count > 1 ? `Delete ${count} saves?` : title}
            </h2>

            <p
              style={{
                margin: '8px 0 0',
                fontSize: 15,
                lineHeight: '21px',
                color: '#48484A',
              }}
            >
              {count > 1
                ? `${count} items will be removed from your Library.`
                : `“${itemName || 'This item'}” will be removed from your Library. You can undo this for 10 seconds.`}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={onConfirm}
                style={{
                  height: 50,
                  borderRadius: 14,
                  border: 0,
                  background: DANGER_RED,
                  color: '#FFFFFF',
                  fontSize: 17,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Delete
              </button>

              <button
                type="button"
                onClick={onCancel}
                style={{
                  height: 50,
                  borderRadius: 14,
                  border: 0,
                  background: 'rgba(118,118,128,.16)',
                  color: INK,
                  fontSize: 17,
                  fontWeight: 650,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>

            {onArchive && (
              <button
                type="button"
                onClick={onArchive}
                style={{
                  marginTop: 4,
                  height: 44,
                  border: 0,
                  background: 'transparent',
                  color: DEEP_BLUE,
                  fontSize: 15,
                  fontWeight: 650,
                  cursor: 'pointer',
                }}
              >
                Archive instead
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
