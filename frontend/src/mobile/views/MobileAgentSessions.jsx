import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
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
  const [jobs, setJobs] = useState([])
  const [confirmations, setConfirmations] = useState([])
  const [filter, setFilter] = useState('all') // 'all' | 'running' | 'pinned'
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const [cRes, jRes, confRes] = await Promise.allSettled([
        api.conversations({ limit: 40 }),
        api.jobs(),
        api.confirmations(),
      ])

      if (cRes.status === 'fulfilled' && cRes.value?.conversations) {
        setConversations(cRes.value.conversations)
      }
      if (jRes.status === 'fulfilled' && jRes.value?.jobs) {
        setJobs(jRes.value.jobs)
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

  const activeJobs = jobs.filter((j) => j.state === 'running' || j.state === 'queued')
  const runningSessions = conversations.filter((c) => c.status === 'running' || c.is_running)
  const pinnedSessions = conversations.filter((c) => c.pinned)

  const filteredConversations = conversations.filter((c) => {
    if (filter === 'running' && !c.is_running && c.status !== 'running') return false
    if (filter === 'pinned' && !c.pinned) return false
    if (query && !c.title?.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  return (
    <motion.div
      className="m-body"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="m-r m-sp">
        <div>
          <div className="m-gl">Your</div>
          <h1 className="m-h">Sessions</h1>
        </div>
        <button
          type="button"
          className="m-ib k"
          aria-label="New session"
          onClick={onCreateSession}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>

      {/* Search Input */}
      <div
        className="m-r"
        style={{
          background: '#F6F4F1',
          borderRadius: 999,
          padding: '0 8px 0 18px',
          boxShadow: '0 1px 2px rgba(30,25,20,0.05)',
        }}
      >
        <span style={{ color: '#6E6A64', display: 'flex' }}>
          <Icon name="search" size={18} />
        </span>
        <input
          className="m-in"
          placeholder="Search sessions"
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

      {/* Filter Chips */}
      <div className="m-r" style={{ gap: 8 }}>
        <button
          type="button"
          className={`m-ch ${filter === 'all' ? 'on' : ''}`}
          onClick={() => setFilter('all')}
        >
          All {conversations.length}
        </button>
        <button
          type="button"
          className={`m-ch ${filter === 'running' ? 'on' : ''}`}
          onClick={() => setFilter('running')}
        >
          Running {activeJobs.length + runningSessions.length}
        </button>
        <button
          type="button"
          className={`m-ch ${filter === 'pinned' ? 'on' : ''}`}
          onClick={() => setFilter('pinned')}
        >
          Pinned {pinnedSessions.length}
        </button>
      </div>

      {/* Active Section */}
      <div className="m-m" style={{ marginBottom: -6 }}>
        Active
      </div>
      <div className="m-c" style={{ padding: '4px 16px' }}>
        {/* Real Pending Confirmations */}
        {confirmations.map((conf, idx) => (
          <div key={conf.id || idx}>
            <div
              className="m-r"
              style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
              onClick={() =>
                onSelectSession({
                  id: conf.conversation_id || 'approval-session',
                  title: conf.description || conf.operation_key || 'Approval Required',
                  confirmation: conf,
                })
              }
            >
              <span className="m-it" style={{ background: '#F6D5C6', color: '#B8430F' }}>
                <Icon name="clock" size={20} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {conf.description || conf.operation_key || 'Pending PC Action'}
                </div>
                <div className="m-m" style={{ color: '#B8430F' }}>
                  Waiting for your approval
                </div>
              </div>
              <div className="m-col" style={{ alignItems: 'flex-end', gap: 4 }}>
                <span className="m-m">Now</span>
                <Icon name="desktop" size={14} style={{ color: '#6E6A64' }} />
              </div>
            </div>
            {(idx < confirmations.length - 1 || activeJobs.length > 0) && (
              <div className="m-hr" />
            )}
          </div>
        ))}

        {/* Real Active Jobs */}
        {activeJobs.map((job, idx) => (
          <div key={job.id || idx}>
            <div className="m-r" style={{ padding: '12px 0', gap: 12 }}>
              <span className="m-it">
                <span className="m-spn" />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {job.kind || job.name || 'Running job'}
                </div>
                <div className="m-m">{job.state || 'running'}</div>
              </div>
              <div className="m-col" style={{ alignItems: 'flex-end', gap: 4 }}>
                <span className="m-m">Now</span>
                <Icon name="desktop" size={14} style={{ color: '#6E6A64' }} />
              </div>
            </div>
            {idx < activeJobs.length - 1 && <div className="m-hr" />}
          </div>
        ))}

        {confirmations.length === 0 && activeJobs.length === 0 && (
          <div style={{ padding: '16px 0', textAlign: 'center', color: '#6E6A64' }}>
            No active jobs or pending approvals
          </div>
        )}
      </div>

      {/* Sessions Section */}
      <div className="m-m" style={{ marginBottom: -6 }}>
        Sessions
      </div>
      <div className="m-c" style={{ padding: '4px 16px' }}>
        {filteredConversations.map((c, idx) => (
          <div key={c.id || idx}>
            <div
              className="m-r"
              style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
              onClick={() => onSelectSession(c)}
            >
              <span
                className="m-it"
                style={{
                  background: c.is_running || c.status === 'running' ? '#D6F23E' : '#ECEAE6',
                  color: '#111113',
                }}
              >
                <Icon
                  name={c.is_running || c.status === 'running' ? 'sparkle' : 'check'}
                  size={20}
                />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.title || 'Untitled session'}
                </div>
                <div
                  className="m-m"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.last_message_excerpt || c.model || 'Agent conversation'}
                </div>
              </div>
              <div className="m-col" style={{ alignItems: 'flex-end', gap: 4 }}>
                <span className="m-m">{formatTimeAgo(c.updated_at || c.created_at)}</span>
                <Icon name="device-mobile" size={14} style={{ color: '#6E6A64' }} />
              </div>
            </div>
            {idx < filteredConversations.length - 1 && <div className="m-hr" />}
          </div>
        ))}

        {!filteredConversations.length && !loading && (
          <div style={{ textAlign: 'center', padding: '32px 16px' }} className="m-col">
            <Icon name="chat" size={32} style={{ color: '#9A958E', margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 600 }}>No sessions found</div>
            <div className="m-m" style={{ marginTop: 4 }}>
              {query
                ? 'No sessions match your search.'
                : 'Tap + above to start your first agent session.'}
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: '#6E6A64' }}>
            Loading sessions…
          </div>
        )}
      </div>
    </motion.div>
  )
}
