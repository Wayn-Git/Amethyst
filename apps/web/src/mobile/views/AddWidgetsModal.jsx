import { useState } from 'react'
import { motion } from 'framer-motion'

const AVAILABLE_WIDGETS = [
  {
    id: 'weather',
    category: 'glance',
    title: 'Weather',
    description: 'Small, medium, large',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    ),
  },
  {
    id: 'inbox',
    category: 'comms',
    title: 'Inbox',
    description: 'Unread and drafts',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="16" x="2" y="4" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    ),
  },
  {
    id: 'prs',
    category: 'dev',
    title: 'Pull requests',
    description: 'CI and reviewers',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M13 6h3a2 2 0 0 1 2 2v7" />
        <line x1="6" x2="6" y1="9" y2="21" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    category: 'glance',
    title: 'Agenda',
    description: 'Upcoming meetings & events',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <line x1="16" x2="16" y1="2" y2="6" />
        <line x1="8" x2="8" y1="2" y2="6" />
        <line x1="3" x2="21" y1="10" y2="10" />
      </svg>
    ),
  },
  {
    id: 'pc_status',
    category: 'dev',
    title: 'PC Telemetry',
    description: 'CPU, Memory, Disk',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="20" height="14" x="2" y="3" rx="2" />
        <line x1="8" x2="16" y1="21" y2="21" />
        <line x1="12" x2="12" y1="17" y2="21" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    category: 'glance',
    title: 'Tasks',
    description: "Today's checklist and progress",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
]

export default function AddWidgetsModal({ onClose, onAddWidget }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all') // 'all' | 'glance' | 'comms' | 'dev'
  const [addedIds, setAddedIds] = useState(new Set(['weather', 'tasks', 'pc_status']))

  const handleToggleAdd = (widgetId) => {
    setAddedIds((prev) => {
      const next = new Set(prev)
      if (next.has(widgetId)) next.delete(widgetId)
      else next.add(widgetId)
      return next
    })
    if (onAddWidget) onAddWidget(widgetId)
  }

  const filtered = AVAILABLE_WIDGETS.filter((w) => {
    if (category !== 'all' && w.category !== category) return false
    if (query.trim()) {
      const q = query.toLowerCase()
      return w.title.toLowerCase().includes(q) || w.description.toLowerCase().includes(q)
    }
    return true
  })

  return (
    <motion.div
      className="s"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 140,
        background: '#F2F2F7',
        maxWidth: 480,
        margin: '0 auto',
      }}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="b" style={{ paddingBottom: 20, gap: 14 }}>
        {/* Header */}
        <div className="r sp">
          <button
            type="button"
            className="ib"
            aria-label="Back"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <div className="ttl" style={{ fontSize: 17 }}>
            Add widgets
          </div>
          <button
            type="button"
            className="bt"
            style={{ minHeight: 40, fontSize: 13, padding: '0 16px' }}
            onClick={onClose}
          >
            Done
          </button>
        </div>

        {/* Search Widgets Bar */}
        <div
          className="r"
          style={{
            background: '#FFFFFF',
            borderRadius: 999,
            padding: '0 8px 0 18px',
            boxShadow: '0 1px 2px rgba(0,0,0,.05)',
          }}
        >
          <span style={{ color: '#6E6E73', display: 'flex' }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            className="in"
            aria-label="Search widgets"
            placeholder="Search widgets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Category Filter Chips */}
        <div className="r" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          <button
            type="button"
            className={`ch ${category === 'all' ? 'on' : ''}`}
            onClick={() => setCategory('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`ch ${category === 'glance' ? 'on' : ''}`}
            onClick={() => setCategory('glance')}
          >
            Glance
          </button>
          <button
            type="button"
            className={`ch ${category === 'comms' ? 'on' : ''}`}
            onClick={() => setCategory('comms')}
          >
            Comms
          </button>
          <button
            type="button"
            className={`ch ${category === 'dev' ? 'on' : ''}`}
            onClick={() => setCategory('dev')}
          >
            Dev
          </button>
        </div>

        {/* Widgets List in Card */}
        <div className="c" style={{ padding: '4px 16px' }}>
          {filtered.map((w, idx) => {
            const isAdded = addedIds.has(w.id)
            return (
              <div key={w.id}>
                <div className="r" style={{ padding: '12px 0', gap: 12 }}>
                  <span className="it">{w.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{w.title}</div>
                    <div className="m">{w.description}</div>
                  </div>
                  <button
                    type="button"
                    className={`bt ${isAdded ? '' : 'l'}`}
                    style={{
                      minHeight: 36,
                      padding: '0 14px',
                      fontSize: 13,
                      background: isAdded ? '#E5E5EA' : '#0071E3',
                      color: isAdded ? '#1D1D1F' : '#FFFFFF',
                    }}
                    onClick={() => handleToggleAdd(w.id)}
                  >
                    {isAdded ? 'Added' : 'Add'}
                  </button>
                </div>
                {idx < filtered.length - 1 && <div className="hr" />}
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
