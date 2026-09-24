import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'

/**
 * Interactive, animated popup showing task details with % completion controller.
 * Background uses a gradient built from the current accent color, matching active theme.
 * When a task hits 100%, it's automatically removed from the card.
 */
export default function TaskDetailPopup({
  task,
  initialProgress = 0,
  onClose,
  onUpdateProgress,
  onComplete,
}) {
  const [progress, setProgress] = useState(initialProgress)
  const [isFinishing, setIsFinishing] = useState(false)

  useEffect(() => {
    setProgress(initialProgress)
  }, [initialProgress])

  const handleProgressChange = (val) => {
    const num = Math.min(100, Math.max(0, Number(val)))
    setProgress(num)
    onUpdateProgress(task.id, num)

    if (num >= 100) {
      setIsFinishing(true)
      setTimeout(() => {
        onComplete(task.id)
      }, 500)
    }
  }

  const handleStep = (delta) => {
    handleProgressChange(progress + delta)
  }

  return (
    <AnimatePresence>
      <div className="task-popup-backdrop" onClick={onClose}>
        <motion.div
          className="task-popup-card"
          initial={{ opacity: 0, scale: 0.92, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 10 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="task-popup-head">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span className="today-card-badge">Task Details</span>
                {task.priority && (
                  <span className="today-card-badge" style={{ textTransform: 'capitalize' }}>
                    {task.priority} priority
                  </span>
                )}
              </div>
              <h2 className="task-popup-title">{task.title}</h2>
            </div>
            <button
              type="button"
              className="task-popup-close"
              onClick={onClose}
              aria-label="Close details"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Notes / Description if present */}
          {task.notes && (
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.45 }}>
              {task.notes}
            </div>
          )}

          {/* Due date if present */}
          {task.due_at && (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Icon name="clock" size={13} />
              <span>Due: {new Date(task.due_at.replace(' ', 'T')).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )}

          {/* Progress / Completion Controller */}
          <div className="task-popup-progress-box">
            <div className="task-popup-progress-header">
              <span className="task-popup-progress-label">Task Progress</span>
              <span className="task-popup-progress-val">
                {isFinishing ? '100% (Completed!)' : `${progress}%`}
              </span>
            </div>

            {/* Visual Fill Bar */}
            <div className="today-task-bar-track" style={{ height: 6, margin: '8px 0 12px 0' }}>
              <div
                className="today-task-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Slider */}
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={progress}
              disabled={isFinishing}
              className="task-popup-slider"
              onChange={(e) => handleProgressChange(e.target.value)}
            />

            {/* Steppers & Presets */}
            <div className="task-popup-steppers">
              <button
                type="button"
                className="task-popup-step-btn"
                disabled={isFinishing}
                onClick={() => handleStep(-10)}
              >
                -10%
              </button>
              <button
                type="button"
                className="task-popup-step-btn"
                disabled={isFinishing}
                onClick={() => handleProgressChange(25)}
              >
                25%
              </button>
              <button
                type="button"
                className="task-popup-step-btn"
                disabled={isFinishing}
                onClick={() => handleProgressChange(50)}
              >
                50%
              </button>
              <button
                type="button"
                className="task-popup-step-btn"
                disabled={isFinishing}
                onClick={() => handleProgressChange(75)}
              >
                75%
              </button>
              <button
                type="button"
                className="task-popup-step-btn"
                disabled={isFinishing}
                onClick={() => handleStep(10)}
              >
                +10%
              </button>
              <button
                type="button"
                className="task-popup-step-btn is-100"
                disabled={isFinishing}
                onClick={() => handleProgressChange(100)}
              >
                Complete (100%)
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
