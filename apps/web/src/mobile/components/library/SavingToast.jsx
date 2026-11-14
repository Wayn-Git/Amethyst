import { motion, AnimatePresence } from 'framer-motion'

export default function SavingToast({
  visible,
  status = 'success', // 'saving' | 'success' | 'error'
  message = 'Saved to Library',
  actionLabel,
  onAction,
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="glass-dark"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 24, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          style={{
            position: 'fixed',
            left: 16,
            right: 16,
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)',
            height: 52,
            borderRadius: 26,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 8px 0 16px',
            color: '#fff',
            zIndex: 150,
          }}
        >
          {status === 'saving' && (
            <svg
              className="animate-spin"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0B5FD9"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ animation: 'spin 1s linear infinite' }}
            >
              <circle cx="12" cy="12" r="9" stroke="rgba(255,255,255,0.2)" />
              <path d="M12 3a9 9 0 0 1 9 9" stroke="#fff" />
            </svg>
          )}

          {status === 'success' && (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#5FD38D"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l3 3 5-6" />
            </svg>
          )}

          {status === 'error' && (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FF453A"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          )}

          <span style={{ flex: 1, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {message}
          </span>

          {actionLabel && (
            <button
              type="button"
              style={{
                height: 40,
                padding: '0 14px',
                borderRadius: 20,
                border: 0,
                background: 'rgba(255,255,255,.16)',
                color: '#fff',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
