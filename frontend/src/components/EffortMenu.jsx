import { useRef } from 'react'
import { motion } from 'framer-motion'
import Icon from './Icon.jsx'
import { useDismiss } from '../hooks/useDismiss.js'

const EFFORT_LEVELS = [
  { id: 'off', icon: 'brain', label: 'Off', desc: 'Answer directly, no reasoning' },
  { id: 'low', icon: 'brain', label: 'Low', desc: 'Fastest and cheapest' },
  { id: 'medium', icon: 'brain', label: 'Medium', desc: 'Balanced for routine work' },
  { id: 'high', icon: 'brain', label: 'High', desc: 'Default. Good for most tasks' },
]

export default function EffortMenu({ effort, onChange, onClose, placement = 'down' }) {
  const ref = useRef(null)
  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })

  return (
    <motion.div
      ref={ref}
      className={`effort-menu effort-menu--${placement}`}
      initial={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: placement === 'up' ? 6 : -6, scale: 0.98 }}
      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="effort-menu-head">Reasoning effort</div>
      <div className="effort-menu-list">
        {EFFORT_LEVELS.map((e) => {
          const active = effort === e.id
          return (
            <button
              key={e.id}
              type="button"
              className={`effort-item${active ? ' is-active' : ''}`}
              onClick={() => { onChange(e.id); onClose() }}
            >
              <span className="effort-item-icon">
                <Icon name={e.icon} size={14} />
              </span>
              <span className="effort-item-text">
                <span className="effort-item-label">{e.label}</span>
                <span className="effort-item-desc">{e.desc}</span>
              </span>
              {active && <Icon name="check" size={13} className="effort-check" />}
            </button>
          )
        })}
      </div>
    </motion.div>
  )
}
