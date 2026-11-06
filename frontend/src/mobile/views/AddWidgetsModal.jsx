import { useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'

const WIDGET_CATALOG = [
  { id: 'weather', name: 'Weather', desc: 'Small, medium, large', icon: 'sun', cat: 'glance' },
  { id: 'inbox', name: 'Inbox', desc: 'Unread and drafts', icon: 'mail', cat: 'comms' },
  { id: 'pull_requests', name: 'Pull requests', desc: 'Open PRs and CI', icon: 'git-pull-request', cat: 'dev' },
  { id: 'library_daily', name: 'Library daily', desc: 'One saved item a day', icon: 'book', cat: 'glance' },
  { id: 'agent_jobs', name: 'Agent jobs', desc: 'Live progress', icon: 'sparkle', cat: 'dev' },
  { id: 'music', name: 'Music', desc: 'Now playing on PC', icon: 'music', cat: 'glance' },
]

export default function AddWidgetsModal({ onClose, onAddWidget }) {
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [added, setAdded] = useState({})

  const filtered = WIDGET_CATALOG.filter((w) => {
    const matchesCat = filter === 'all' || w.cat === filter
    const matchesQuery = !query || w.name.toLowerCase().includes(query.toLowerCase()) || w.desc.toLowerCase().includes(query.toLowerCase())
    return matchesCat && matchesQuery
  })

  const handleAdd = (id) => {
    setAdded((prev) => ({ ...prev, [id]: true }))
    if (onAddWidget) onAddWidget(id)
  }

  return (
    <motion.div
      className="m-shell"
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#ECEAE6' }}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 30 }}
      transition={{ duration: 0.2 }}
    >
      <div className="m-body" style={{ paddingBottom: 20 }}>
        {/* Top Header */}
        <div className="m-r m-sp">
          <button
            type="button"
            className="m-ib"
            aria-label="Back"
            onClick={onClose}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <div className="m-ttl" style={{ fontSize: 17 }}>
            Add widgets
          </div>
          <button
            type="button"
            className="m-bt"
            style={{ minHeight: 40, padding: '0 18px', fontSize: 13 }}
            onClick={onClose}
          >
            Done
          </button>
        </div>

        {/* Search input */}
        <div
          className="m-r"
          style={{
            background: '#F6F4F1',
            borderRadius: 999,
            padding: '0 16px',
            boxShadow: '0 1px 2px rgba(30,25,20,0.05)',
          }}
        >
          <span style={{ color: '#6E6A64', display: 'flex' }}>
            <Icon name="search" size={18} />
          </span>
          <input
            className="m-in"
            placeholder="Search widgets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="m-ib"
              style={{ width: 28, height: 28, background: 'none', boxShadow: 'none' }}
              onClick={() => setQuery('')}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="m-r" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            ['all', 'All'],
            ['glance', 'Glance'],
            ['comms', 'Comms'],
            ['dev', 'Dev'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`m-ch ${filter === id ? 'on' : ''}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Widget items list */}
        <div className="m-c" style={{ padding: '4px 16px' }}>
          {filtered.map((w, idx) => (
            <div key={w.id}>
              <div className="m-r" style={{ padding: '14px 0', gap: 14 }}>
                <span className="m-it">
                  <Icon name={w.icon} size={20} />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{w.name}</div>
                  <div className="m-m">{w.desc}</div>
                </div>
                <button
                  type="button"
                  className="m-bt l"
                  style={{
                    minHeight: 36,
                    padding: '0 16px',
                    fontSize: 13,
                    background: added[w.id] ? '#111113' : '#D6F23E',
                    color: added[w.id] ? '#fff' : '#111113',
                  }}
                  onClick={() => handleAdd(w.id)}
                >
                  {added[w.id] ? 'Added' : 'Add'}
                </button>
              </div>
              {idx < filtered.length - 1 && <div className="m-hr" />}
            </div>
          ))}

          {!filtered.length && (
            <div style={{ padding: 24, textAlign: 'center', color: '#6E6A64' }}>
              No widgets match your search.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
