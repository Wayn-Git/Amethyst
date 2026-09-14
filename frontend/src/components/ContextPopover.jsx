import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from './Icon.jsx'
import { useDismiss } from '../hooks/useDismiss.js'

function fmtTokens(n) {
  if (!n || Number.isNaN(n)) return '0K'
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return `${n}`
}

export default function ContextPopover({
  pct = 5,
  usedTokens = 13000,
  maxTokens = 262000,
  compactionTokens = 245000,
  onClose,
  onCompact,
  placement = 'up',
}) {
  const ref = useRef(null)
  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })

  const [compacting, setCompacting] = useState(false)
  const [compactDone, setCompactDone] = useState(false)

  const handleCompact = async () => {
    if (compacting) return
    setCompacting(true)
    try {
      if (onCompact) {
        await onCompact()
      } else {
        await new Promise((r) => setTimeout(r, 600))
      }
      setCompactDone(true)
      setTimeout(() => {
        onClose?.()
      }, 800)
    } catch {
      setCompacting(false)
    }
  }

  // Calculate compaction point percentage relative to maxTokens
  const compactPointPct = Math.min(
    95,
    Math.max(50, Math.round((compactionTokens / maxTokens) * 100))
  )

  return (
    <motion.div
      ref={ref}
      className={`context-popover context-popover--${placement}`}
      initial={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.96 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="context-popover-head">
        <span className="context-popover-title">Conversation context</span>
        <button
          type="button"
          className="context-popover-close"
          onClick={onClose}
          aria-label="Close"
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      {/* Main Stat Row */}
      <div className="context-popover-stat-row">
        <span className="context-popover-pct">{pct}%</span>
        <span className="context-popover-ratio">
          <strong>{fmtTokens(usedTokens)}</strong> / {fmtTokens(maxTokens)} tokens
        </span>
      </div>

      {/* Progress Bar with Amber Marker */}
      <div className="context-popover-progress-wrap">
        <div className="context-popover-track">
          <div
            className="context-popover-fill"
            style={{ width: `${Math.min(100, Math.max(3, pct))}%` }}
          />
          <div
            className="context-popover-marker"
            style={{ left: `${compactPointPct}%` }}
            title={`Compaction point: ${fmtTokens(compactionTokens)} tokens`}
          />
        </div>
        <div className="context-popover-marker-label">
          <span>Approx. compaction point</span>
          <span className="context-popover-marker-val">{fmtTokens(compactionTokens)}</span>
        </div>
      </div>

      {/* Explanatory notes */}
      <div className="context-popover-notes">
        <p className="context-popover-desc">
          Older messages are summarised to make room.
        </p>

        <div className="context-popover-detail-row">
          <span>Sent fresh</span>
          <span className="context-popover-detail-val">{fmtTokens(usedTokens)}</span>
        </div>
        <div className="context-popover-detail-hint">
          Measured at the last reply.
        </div>
      </div>

      {/* Action Button */}
      <div className="context-popover-actions">
        <button
          type="button"
          className={`context-popover-btn${compactDone ? ' is-done' : ''}`}
          onClick={handleCompact}
          disabled={compacting}
        >
          {compacting
            ? 'Compacting context…'
            : compactDone
              ? 'Compacted!'
              : 'Compact now'}
        </button>
      </div>
    </motion.div>
  )
}
