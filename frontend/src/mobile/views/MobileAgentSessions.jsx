import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { listConversations, deleteConversation, createConversation } from '../agent/conversationStore.js'
import { getBundle } from '../bundle.js'
import { api } from '../../api.js'

function formatTimeAgo(dateStr) {
  if (!dateStr) return 'Recently'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Recently'
  const diffHours = (Date.now() - date.getTime()) / (1000 * 60 * 60)
  if (diffHours < 1) return `${Math.max(1, Math.round(diffHours * 60))}m`
  if (diffHours < 24) return `${Math.round(diffHours)}h`
  return `${Math.round(diffHours / 24)}d`
}

export default function MobileAgentSessions({ onSelectSession, onCreateSession }) {
  const [conversations, setConversations] = useState([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // 'all' | 'running' | 'pinned'
  const [loading, setLoading] = useState(true)
  const [activeJobs, setActiveJobs] = useState([])
  const [confirmations, setConfirmations] = useState([])

  const loadData = useCallback(async () => {
    try {
      const [convs, jobsRes, confRes] = await Promise.allSettled([
        listConversations(),
        api.jobs(),
        api.confirmations(),
      ])

      if (convs.status === 'fulfilled') {
        setConversations(convs.value || [])
      }
      if (jobsRes.status === 'fulfilled' && jobsRes.value?.jobs) {
        setActiveJobs(jobsRes.value.jobs.filter((j) => j.state === 'running' || j.state === 'queued'))
      }
      if (confRes.status === 'fulfilled' && Array.isArray(confRes.value)) {
        setConfirmations(confRes.value)
      }
    } catch (err) {
      console.warn('[MobileAgentSessions] Load failed:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    try {
      await deleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      console.warn('[MobileAgentSessions] Delete failed:', err.message)
    }
  }

  const handleNewSession = async () => {
    if (onCreateSession) {
      onCreateSession()
      return
    }
    try {
      const newConv = await createConversation({
        title: 'New Session',
        model: 'auto',
      })
      onSelectSession(newConv)
    } catch (err) {
      console.warn('[MobileAgentSessions] Create failed:', err.message)
    }
  }

  const filtered = conversations.filter((c) => {
    if (query.trim()) {
      return (c.title || '').toLowerCase().includes(query.toLowerCase())
    }
    return true
  })

  const todayStr = new Date().toDateString()
  const todaySessions = filtered.filter((c) => new Date(c.updated_at || c.created_at || Date.now()).toDateString() === todayStr)
  const earlierSessions = filtered.filter((c) => new Date(c.updated_at || c.created_at || Date.now()).toDateString() !== todayStr)

  const displayToday = todaySessions.length > 0 ? todaySessions : filtered.slice(0, 3)
  const displayEarlier = todaySessions.length > 0 ? earlierSessions : filtered.slice(3)

  return (
    <motion.div
      className="b"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Header */}
      <div className="r sp">
        <div>
          <div className="gl">Agent</div>
          <h1 className="h">Sessions</h1>
        </div>
        <button
          type="button"
          className="ib k"
          aria-label="New session"
          onClick={handleNewSession}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
      </div>

      {/* Search Input Bar */}
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
          aria-label="Search sessions"
          placeholder="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            style={{ border: 0, background: 'none', color: '#6E6E73', cursor: 'pointer', paddingRight: 8 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter Chips */}
      <div className="r" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
        <button
          type="button"
          className={`ch ${filter === 'all' ? 'on' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        <button
          type="button"
          className={`ch ${filter === 'running' ? 'on' : ''}`}
          onClick={() => setFilter('running')}
        >
          Running {activeJobs.length || 1}
        </button>
        <button
          type="button"
          className={`ch ${filter === 'pinned' ? 'on' : ''}`}
          onClick={() => setFilter('pinned')}
        >
          Pinned 2
        </button>
      </div>

      {/* Active Section */}
      {(activeJobs.length > 0 || confirmations.length > 0) && (
        <>
          <div className="m" style={{ marginBottom: -6 }}>
            Active
          </div>
          <div className="c" style={{ padding: '4px 16px' }}>
            {activeJobs.map((job, idx) => (
              <div key={job.id || idx}>
                <div
                  className="r"
                  style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
                  onClick={() => onSelectSession({ id: job.conversation_id || `job-${job.id}`, title: job.title || 'Running Job' })}
                >
                  <span className="it">
                    <span className="spn" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.title || 'Index new saves'}
                    </div>
                    <div className="m">
                      {job.progress ? `Step ${Math.round(job.progress * 5)} of 5` : 'Step 3 of 5, Library'}
                    </div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <span className="m">Now</span>
                    <span className="m" style={{ display: 'flex' }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="20" height="14" x="2" y="3" rx="2" />
                        <line x1="8" x2="16" y1="21" y2="21" />
                        <line x1="12" x2="12" y1="17" y2="21" />
                      </svg>
                    </span>
                  </div>
                </div>
                {idx < activeJobs.length - 1 && <div className="hr" />}
              </div>
            ))}

            {confirmations.map((conf, idx) => (
              <div key={conf.id || idx}>
                {activeJobs.length > 0 && <div className="hr" />}
                <div
                  className="r"
                  style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
                  onClick={() => onSelectSession({ id: conf.conversation_id || 'approval-session', title: conf.description || 'Approval Required', confirmation: conf })}
                >
                  <span className="it" style={{ background: '#F6D5C6', color: '#B8430F' }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conf.description || conf.operation_key || 'Clean up old branches'}
                    </div>
                    <div className="m">Waiting for your approval</div>
                  </div>
                  <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                    <span className="m">2m</span>
                    <span className="m" style={{ display: 'flex' }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect width="20" height="14" x="2" y="3" rx="2" />
                        <line x1="8" x2="16" y1="21" y2="21" />
                        <line x1="12" x2="12" y1="17" y2="21" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Today Section */}
      <div className="m" style={{ marginBottom: -6 }}>
        Today
      </div>
      <div className="c" style={{ padding: '4px 16px' }}>
        {displayToday.map((conv, idx) => (
          <div key={conv.id || idx}>
            <div
              className="r"
              style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
              onClick={() => onSelectSession(conv)}
            >
              <span className="it" style={{ background: '#E3F5E8', color: '#1E7A3D' }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conv.title || 'Hybrid retrieval note'}
                </div>
                <div className="m" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {conv.last_message || 'Drafted a note from 4 saves'}
                </div>
              </div>
              <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                <span className="m">{formatTimeAgo(conv.updated_at || conv.created_at)}</span>
                <span className="m" style={{ display: 'flex' }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                    <path d="M12 18h.01" />
                  </svg>
                </span>
              </div>
            </div>
            {idx < displayToday.length - 1 && <div className="hr" />}
          </div>
        ))}

        {!displayToday.length && !loading && (
          <div style={{ padding: '24px 0', textAlign: 'center' }} className="m">
            No agent sessions today. Tap + to start one.
          </div>
        )}
      </div>

      {/* Earlier Section */}
      {displayEarlier.length > 0 && (
        <>
          <div className="m" style={{ marginBottom: -6 }}>
            Earlier
          </div>
          <div className="c" style={{ padding: '4px 16px' }}>
            {displayEarlier.map((conv, idx) => (
              <div key={conv.id || idx}>
                <div
                  className="r"
                  style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
                  onClick={() => onSelectSession(conv)}
                >
                  <span className="it" style={{ background: '#F2F2F7', color: '#1D1D1F' }}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {conv.title}
                    </div>
                    <div className="m">{formatTimeAgo(conv.updated_at || conv.created_at)}</div>
                  </div>
                  <button
                    type="button"
                    aria-label="Delete"
                    style={{ border: 0, background: 'none', color: '#8E8E93', cursor: 'pointer', padding: 4 }}
                    onClick={(e) => handleDelete(e, conv.id)}
                  >
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
                {idx < displayEarlier.length - 1 && <div className="hr" />}
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  )
}
