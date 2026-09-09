import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import SkillsTab from './capabilities/SkillsTab.jsx'
import ConnectorsTab from './capabilities/ConnectorsTab.jsx'

/* Skills and connectors, one page, two tabs.

   They were two rail entries and a third overlay that browsed both, which meant
   a connector had a page for managing it and a different card for adding it,
   and a skill could be listed twice with different controls in each place. They
   are the same kind of thing — something the agent is given — so they are one
   page, and adding is done where managing is done. */

const TABS = [
  { id: 'skills', label: 'Skills' },
  { id: 'connectors', label: 'Connectors' },
]

export default function Capabilities() {
  const rootRef = useRef(null)
  const { capabilitiesTab, setCapabilitiesTab } = useApp()
  const [query, setQuery] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  useViewEntrance(rootRef)

  // Neither the search nor a half-open form means anything on the other side.
  useEffect(() => { setQuery(''); setNewOpen(false) }, [capabilitiesTab])

  const skills = capabilitiesTab === 'skills'

  return (
    <div className="view" ref={rootRef}>
      <div className="view-inner view-inner--wide">
        {/* Clean borderless tab switcher (Skills vs Plugins) */}
        <div className="clean-cap-topbar" data-enter>
          <div className="clean-cap-switch" role="tablist" aria-label="Skills or connectors">
            {TABS.map((t) => {
              const isActive = capabilitiesTab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`cap-tab-${t.id}`}
                  aria-selected={isActive}
                  aria-controls={`cap-panel-${t.id}`}
                  tabIndex={isActive ? 0 : -1}
                  className={`clean-cap-tab-btn${isActive ? ' is-active' : ''}`}
                  onClick={() => setCapabilitiesTab(t.id)}
                >
                  <span style={{ position: 'relative', zIndex: 1 }}>
                    {t.id === 'connectors' ? 'Plugins' : t.label}
                  </span>
                  {isActive && (
                    <motion.div
                      layoutId="activeCapSwitch"
                      className="clean-cap-tab-indicator"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {skills && (
            <div className="clean-cap-actions">
              <div className="plugin-search-pill">
                <Icon name="search" size={14} />
                <input
                  value={query}
                  placeholder="Search skills…"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && query) {
                      e.stopPropagation()
                      setQuery('')
                    }
                  }}
                />
                {query && (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setQuery('')}
                    aria-label="Clear"
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>
              <motion.button
                type="button"
                className="plugin-add-custom-btn"
                title="New skill"
                onClick={() => setNewOpen((o) => !o)}
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.94 }}
              >
                <Icon name={newOpen ? 'x' : 'plus'} size={15} />
              </motion.button>
            </div>
          )}
        </div>

        <div
          role="tabpanel"
          id={`cap-panel-${capabilitiesTab}`}
          aria-labelledby={`cap-tab-${capabilitiesTab}`}
        >
          <AnimatePresence mode="wait">
            {skills ? (
              <motion.div
                key="skills-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <SkillsTab query={query} newOpen={newOpen} setNewOpen={setNewOpen} />
              </motion.div>
            ) : (
              <motion.div
                key="connectors-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <ConnectorsTab query={query} newOpen={newOpen} setNewOpen={setNewOpen} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
