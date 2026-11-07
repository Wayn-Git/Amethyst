import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { listConversations, deleteConversation, createConversation } from '../agent/conversationStore.js'
import { getBundle } from '../bundle.js'

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
  const [loading, setLoading] = useState(true)
  const [hasPairedBundle, setHasPairedBundle] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const bundle = await getBundle()
      setHasPairedBundle(Boolean(bundle?.device_id && bundle?.llm))

      const convs = await listConversations()
      setConversations(convs || [])
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

  const handleCreate = async () => {
    if (onCreateSession) {
      try {
        const newConv = await createConversation('New conversation')
        onCreateSession(newConv)
      } catch {
        onCreateSession({ id: `temp-${Date.now()}`, title: 'New session' })
      }
    }
  }

  const filteredConversations = conversations.filter((c) => {
    if (query && !c.title?.toLowerCase().includes(query.toLowerCase()) && !c.preview?.toLowerCase().includes(query.toLowerCase())) {
      return false
    }
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
          onClick={handleCreate}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>

      {/* Missing Bundle Pairing Prompt */}
      {!hasPairedBundle && !loading && (
        <div
          className="m-c"
          style={{
            padding: '16px 18px',
            background: '#FFFBEB',
            borderColor: '#FDE68A',
            borderRadius: 16,
          }}
        >
          <div className="m-r" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span style={{ color: '#D97706', marginTop: 2 }}>
              <Icon name="shield-alert" size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: '#92400E', fontSize: 14 }}>
                Pairing Required
              </div>
              <div style={{ fontSize: 13, color: '#B45309', marginTop: 2, lineHeight: 1.4 }}>
                Please pair with your PC via QR code to enable the Amethyst AI agent and tools.
              </div>
            </div>
          </div>
        </div>
      )}

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
          placeholder="Search local sessions"
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

      {/* Sessions Section */}
      <div className="m-m" style={{ marginBottom: -6 }}>
        Local Conversations ({conversations.length})
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
                  background: '#ECEAE6',
                  color: '#111113',
                }}
              >
                <Icon name="chat" size={18} />
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
                  {c.title || 'Untitled conversation'}
                </div>
                <div
                  className="m-m"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.preview || 'No messages yet'}
                </div>
              </div>
              <div className="m-col" style={{ alignItems: 'flex-end', gap: 6 }}>
                <span className="m-m">{formatTimeAgo(c.updated_at || c.created_at)}</span>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 4,
                    color: '#9A958E',
                    cursor: 'pointer',
                  }}
                  title="Delete conversation"
                  onClick={(e) => handleDelete(e, c.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
            {idx < filteredConversations.length - 1 && <div className="m-hr" />}
          </div>
        ))}

        {!filteredConversations.length && !loading && (
          <div style={{ textAlign: 'center', padding: '32px 16px' }} className="m-col">
            <Icon name="chat" size={32} style={{ color: '#9A958E', margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 600 }}>No conversations yet</div>
            <div className="m-m" style={{ marginTop: 4 }}>
              {query
                ? 'No conversations match your search.'
                : 'Tap + above to start chatting on your phone.'}
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: '#6E6A64' }}>
            Loading conversations…
          </div>
        )}
      </div>
    </motion.div>
  )
}
