import { useApp } from '../store.jsx'
import Icon from './Icon.jsx'
import { motion } from 'framer-motion'
import { useMediaQuery } from '../hooks/useMediaQuery.js'

const MOBILE_ITEMS = [
  { id: 'chat', label: 'Chat', icon: 'chat' },
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'tasks', label: 'Tasks', icon: 'check' },
  { id: 'library', label: 'Library', icon: 'book' },
  { id: 'more', label: 'Menu', icon: 'menu' },
]

export default function MobileNav() {
  const isMobile = useMediaQuery('(max-width: 768px)')
  const { view, setView, toggleRail, railOpen } = useApp()

  if (!isMobile) return null

  return (
    <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
      <div className="mobile-nav-inner">
        {MOBILE_ITEMS.map((item) => {
          const isMenu = item.id === 'more'
          const isActive = isMenu ? railOpen : view === item.id

          return (
            <button
              key={item.id}
              type="button"
              className={`mobile-nav-btn${isActive ? ' is-active' : ''}`}
              onClick={() => {
                if (isMenu) {
                  toggleRail()
                } else {
                  setView(item.id)
                }
              }}
              aria-label={item.label}
              aria-current={isActive && !isMenu ? 'page' : undefined}
            >
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-active-pill"
                  className="mobile-nav-active-indicator"
                  transition={{ type: 'spring', stiffness: 480, damping: 32 }}
                />
              )}
              <span className="mobile-nav-icon-wrap">
                <Icon name={item.icon} size={20} filled={isActive} />
              </span>
              <span className="mobile-nav-label">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
