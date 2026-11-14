import { motion, AnimatePresence } from 'framer-motion'

export default function ConfirmDeleteModal({
  isOpen,
  title = 'Delete this save?',
  description,
  count = 1,
  itemName = '',
  onConfirm,
  onCancel,
}) {
  const displayTitle = count > 1 ? `Delete ${count} saves?` : title
  const displayDesc =
    description ||
    (count > 1
      ? `${count} items will be permanently removed from your Library. This can't be undone.`
      : itemName
      ? `“${itemName}” will be removed from your Library. This can't be undone.`
      : 'This item will be removed from your Library. This can’t be undone.')

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="lb-sheet-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 32px' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onCancel?.()
          }}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-desc"
            className="alert"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{
              width: '100%',
              maxWidth: 326,
              borderRadius: 28,
              padding: '22px 16px 16px',
              boxSizing: 'border-box',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                background: '#FDECEA',
                color: '#B3261E',
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
              </svg>
            </div>
            <h1
              id="confirm-delete-title"
              style={{ margin: '14px 0 0', fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: '#151517' }}
            >
              {displayTitle}
            </h1>
            <p
              id="confirm-delete-desc"
              style={{ margin: '8px 0 0', fontSize: 15, lineHeight: '21px', color: '#48484A' }}
            >
              {displayDesc}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 18 }}>
              <button
                type="button"
                style={{
                  height: 50,
                  borderRadius: 14,
                  border: 0,
                  background: '#B3261E',
                  color: '#fff',
                  fontSize: 17,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                onClick={onConfirm}
              >
                Delete
              </button>
              <button
                type="button"
                style={{
                  height: 50,
                  borderRadius: 14,
                  border: 0,
                  background: 'rgba(118,118,128,.16)',
                  color: '#151517',
                  fontSize: 17,
                  fontWeight: 650,
                  cursor: 'pointer',
                }}
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
