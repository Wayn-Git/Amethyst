import { useRef } from 'react'
import { motion } from 'framer-motion'
import Icon from './Icon.jsx'
import { useDismiss } from '../hooks/useDismiss.js'

const ALL_LEVELS = {
  'none':   { id: 'none',   icon: 'brain', label: 'None',   desc: 'No reasoning, answer directly' },
  'low':    { id: 'low',    icon: 'brain', label: 'Low',    desc: 'Fastest and cheapest' },
  'medium': { id: 'medium', icon: 'brain', label: 'Medium', desc: 'Balanced for routine work' },
  'high':   { id: 'high',   icon: 'brain', label: 'High',   desc: 'Default. Good for most tasks' },
  'xhigh':  { id: 'xhigh',  icon: 'brain', label: 'Extra high', desc: 'Deeper reasoning' },
  'max':    { id: 'max',    icon: 'brain', label: 'Max',    desc: 'Maximum reasoning effort' },
}

const DEFAULT_LEVELS = [ALL_LEVELS['none'], ALL_LEVELS['low'], ALL_LEVELS['medium'], ALL_LEVELS['high']]

export default function EffortMenu({ effort, levels, onChange, onClose, placement = 'down' }) {
  const ref = useRef(null)
  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })

  const currentLevels = (levels && levels.length > 0)
    ? levels.map(level => {
        const predefined = ALL_LEVELS[level];
        if (predefined) return predefined;
        return {
          id: level,
          icon: 'brain',
          label: level.charAt(0).toUpperCase() + level.slice(1),
          desc: `Use ${level} reasoning effort`
        };
      })
    : DEFAULT_LEVELS;

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
        {currentLevels.map((e) => {
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
