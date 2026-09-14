import { useRef } from 'react'
import { motion } from 'framer-motion'
import Icon from './Icon.jsx'
import { useDismiss } from '../hooks/useDismiss.js'

const PRIMARY_MODES = [
  { id: 'read-only', icon: 'book', label: 'Read only', desc: 'Reads and plans. Makes no changes.' },
  { id: 'guard', icon: 'shield', label: 'Guard', desc: 'Asks before risky actions.' },
  { id: 'full-access', icon: 'check-circle', label: 'Full access', desc: 'Runs commands and edits without asking.' },
]

export default function GuardMenu({ guard, onChange, onClose, placement = 'down' }) {
  const ref = useRef(null)
  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })

  const isAutoEdit = guard === 'guard-auto-edit'
  const currentBase = isAutoEdit ? 'guard' : guard

  const handleBaseSelect = (id) => {
    if (id === 'guard' && isAutoEdit) {
      onChange('guard-auto-edit')
    } else {
      onChange(id)
    }
    onClose()
  }

  const toggleAutoEdit = (e) => {
    e.stopPropagation()
    if (isAutoEdit) {
      onChange('guard')
    } else {
      onChange('guard-auto-edit')
    }
  }

  return (
    <motion.div
      ref={ref}
      className={`guard-menu guard-menu--${placement}`}
      initial={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.98 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="guard-menu-head">Permission</div>

      <div className="guard-menu-list">
        {PRIMARY_MODES.map((g) => {
          const active = currentBase === g.id
          return (
            <button
              key={g.id}
              type="button"
              className={`guard-item${active ? ' is-active' : ''}${g.id === 'full-access' ? ' guard-item--full' : ''}`}
              onClick={() => handleBaseSelect(g.id)}
            >
              <span className="guard-item-icon">
                <Icon name={g.icon} size={14} />
              </span>
              <span className="guard-item-text">
                <span className="guard-item-label">{g.label}</span>
                <span className="guard-item-desc">{g.desc}</span>
              </span>
              {active && <Icon name="check" size={13} className="guard-check" />}
            </button>
          )
        })}
      </div>

      <div className="guard-menu-divider" />

      <div className="guard-menu-toggle-row" onClick={toggleAutoEdit} role="button" tabIndex={0}>
        <span className="guard-item-icon">
          <Icon name="zap" size={14} />
        </span>
        <span className="guard-toggle-label">Auto-apply edits</span>
        <span className={`guard-switch${isAutoEdit ? ' on' : ''}`}>
          <span className="guard-switch-thumb" />
        </span>
      </div>
    </motion.div>
  )
}
