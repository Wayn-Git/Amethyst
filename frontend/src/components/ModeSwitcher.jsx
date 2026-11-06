import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button as HouseButton } from './ui/bento/index.jsx'
import Icon from './Icon.jsx'
import BrandMark from './BrandMark.jsx'
import { useApp } from '../store.jsx'
import { useDismiss } from '../hooks/useDismiss.js'
import './mode-switcher.css'

export default function ModeSwitcher() {
  const { appMode, setAppMode, workspace } = useApp()
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useDismiss(menuRef, open, { onAway: () => setOpen(false) })

  const handleSelect = useCallback((mode) => {
    setAppMode(mode)
    setOpen(false)
  }, [setAppMode])

  const appTitle = workspace || 'Amethyst'
  const isAgent = appMode === 'agent'

  return (
    <div className="mode-switcher-root" ref={menuRef}>
      <HouseButton
        type="button"
        className={`mode-switcher-btn wb-brand${open ? ' is-open' : ''}${isAgent ? ' is-agent' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch between Workspace and Agent Mode"
      >
        <span className="mode-switcher-icon-wrap">
          {isAgent ? (
            <Icon name="spark" size={17} className="mode-switcher-agent-icon" />
          ) : (
            <BrandMark size={20} glow={false} />
          )}
        </span>
        <span className="mode-switcher-label">
          {isAgent ? 'Agent' : appTitle}
        </span>
        <span className={`mode-switcher-chevron${open ? ' is-open' : ''}`}>
          <Icon name="chevron-down" size={12} />
        </span>
      </HouseButton>

      <AnimatePresence>
        {open && (
          <motion.div
            className="mode-switcher-menu"
            role="menu"
            initial={{ opacity: 0, scale: 0.95, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <HouseButton
              type="button"
              role="menuitem"
              className={`mode-switcher-item${!isAgent ? ' is-active' : ''}`}
              onClick={() => handleSelect('app')}
            >
              <div className="mode-switcher-item-left">
                <div className="mode-switcher-item-title-row">
                  <BrandMark size={16} glow={false} />
                  <span className="mode-switcher-item-title">{appTitle}</span>
                </div>
                <span className="mode-switcher-item-desc">
                  Manage, plan, and overview
                </span>
              </div>
              {!isAgent && (
                <span className="mode-switcher-check">
                  <Icon name="check" size={15} />
                </span>
              )}
            </HouseButton>

            <HouseButton
              type="button"
              role="menuitem"
              className={`mode-switcher-item${isAgent ? ' is-active' : ''}`}
              onClick={() => handleSelect('agent')}
            >
              <div className="mode-switcher-item-left">
                <div className="mode-switcher-item-title-row">
                  <Icon name="spark" size={15} className="mode-switcher-agent-icon" />
                  <span className="mode-switcher-item-title">Agent</span>
                </div>
                <span className="mode-switcher-item-desc">
                  Chat, build, and execute
                </span>
              </div>
              {isAgent && (
                <span className="mode-switcher-check">
                  <Icon name="check" size={15} />
                </span>
              )}
            </HouseButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
