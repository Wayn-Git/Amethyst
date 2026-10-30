import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'
import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'
import { api, copyText } from '../../api.js'
import { useApp } from '../../store.jsx'

export default function Storage() {
  const { toast } = useApp()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Modals state
  const [showReviewChats, setShowReviewChats] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [showArchivedChats, setShowArchivedChats] = useState(false)

  const loadStats = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.storageStats()
      if (data && data.ok) {
        setStats(data)
      }
    } catch (err) {
      toast(`Failed to load storage stats: ${err.message}`, 'bad')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  const handleCopyPath = () => {
    if (!stats?.path) return
    copyText(stats.path)
    setCopied(true)
    toast('Storage path copied to clipboard', 'ok')
    setTimeout(() => setCopied(false), 2000)
  }

  const chartData = useMemo(() => {
    if (!stats) return []
    return [
      {
        name: 'Storage',
        chats: stats.chats_bytes || 0,
        subagents: stats.subagents_bytes || 0,
        archived: stats.archived_bytes || 0,
        worktrees: stats.worktrees_bytes || 0,
        other: stats.other_bytes || 0,
      },
    ]
  }, [stats])

  const total = stats?.total_bytes || 1

  return (
    <div className="codex-settings-container">
      {/* Header */}
      <div>
        <h2 style={{ fontSize: 26, fontWeight: 600, color: 'var(--text)', margin: '0 0 16px', letterSpacing: '-0.02em' }}>
          Storage
        </h2>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
          This device
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', margin: 0 }}>
          Manage chats and worktrees stored on this computer
        </p>
      </div>

      {/* Storage Breakdown Section (Unboxed, matching Codex design) */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
            {stats?.total_formatted || '0 bytes'} used by Amethyst
          </span>
          <HouseButton
            type="button"
            className="set-btn-sm"
            onClick={loadStats}
            disabled={loading}
            style={{ fontSize: '11.5px', padding: '2px 10px', height: 24, borderRadius: 6 }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </HouseButton>
        </div>

        {/* Prebuilt Recharts Horizontal Stacked Bar Chart */}
        <div style={{ width: '100%', height: 14, margin: '12px 0 10px', background: 'var(--surface-3, #3f3f46)', borderRadius: 7, overflow: 'hidden' }}>
          <ResponsiveContainer width="100%" height={14}>
            <BarChart
              layout="vertical"
              data={chartData}
              margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
            >
              <XAxis type="number" hide domain={[0, total]} />
              <YAxis type="category" dataKey="name" hide />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div
                      style={{
                        background: 'var(--raised)',
                        border: '1px solid var(--hairline-strong)',
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontSize: '11px',
                        boxShadow: 'var(--shadow-popup)',
                      }}
                    >
                      {payload.map((p) => (
                        <div key={p.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: p.fill }} />
                          <span style={{ textTransform: 'capitalize', color: 'var(--text-dim)' }}>{p.dataKey}:</span>
                          <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                            {stats?.[`${p.dataKey}_formatted`] || '0 bytes'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              <Bar dataKey="chats" stackId="storage" fill="#eab308" radius={[7, 0, 0, 7]} />
              <Bar dataKey="subagents" stackId="storage" fill="#a855f7" />
              <Bar dataKey="archived" stackId="storage" fill="#f97316" />
              <Bar dataKey="worktrees" stackId="storage" fill="#22c55e" />
              <Bar dataKey="other" stackId="storage" fill="#71717a" radius={[0, 7, 7, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="codex-storage-legend" style={{ marginBottom: 10 }}>
          <div className="codex-legend-item">
            <span className="codex-legend-dot" style={{ backgroundColor: '#eab308' }} />
            <span>Chats <span style={{ color: 'var(--text)', fontWeight: 500 }}>{stats?.chats_formatted || '0 bytes'}</span></span>
          </div>
          <div className="codex-legend-item">
            <span className="codex-legend-dot" style={{ backgroundColor: '#a855f7' }} />
            <span>Subagents <span style={{ color: 'var(--text)', fontWeight: 500 }}>{stats?.subagents_formatted || '0 bytes'}</span></span>
          </div>
          <div className="codex-legend-item">
            <span className="codex-legend-dot" style={{ backgroundColor: '#f97316' }} />
            <span>Archived chats <span style={{ color: 'var(--text)', fontWeight: 500 }}>{stats?.archived_formatted || '0 bytes'}</span></span>
          </div>
          <div className="codex-legend-item">
            <span className="codex-legend-dot" style={{ backgroundColor: '#22c55e' }} />
            <span>Worktrees <span style={{ color: 'var(--text)', fontWeight: 500 }}>{stats?.worktrees_formatted || '0 bytes'}</span></span>
          </div>
          <div className="codex-legend-item">
            <span className="codex-legend-dot" style={{ backgroundColor: '#71717a' }} />
            <span>Other <span style={{ color: 'var(--text)', fontWeight: 500 }}>{stats?.other_formatted || '0 bytes'}</span></span>
          </div>
        </div>

        {/* Directory Path (Clean and subtle, exactly matching Codex screenshot) */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            onClick={handleCopyPath}
            style={{
              fontSize: '11px',
              color: 'var(--text-dim)',
              fontFamily: 'monospace',
              cursor: 'pointer',
              userSelect: 'all',
              opacity: 0.85,
            }}
            title="Click to copy path"
          >
            {stats?.path || '~/.amethyst'}
          </span>
          {copied && (
            <span style={{ fontSize: '11px', color: 'var(--ok, #22c55e)' }}>
              Copied!
            </span>
          )}
        </div>
      </div>

      {/* Action Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Card 1: Clean up old chats */}
        <div className="codex-card">
          <div className="codex-row" style={{ padding: '16px 20px' }}>
            <div className="codex-row-info">
              <span className="codex-row-title">Clean up old chats</span>
              <span className="codex-row-desc">Review chats and their subagents before permanently deleting them</span>
            </div>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={() => setShowReviewChats(true)}
              style={{ padding: '5px 16px', fontSize: '13px' }}
            >
              Review
            </HouseButton>
          </div>
        </div>

        {/* Card 2: Manage worktrees & Archived chats */}
        <div className="codex-card">
          <div className="codex-row" style={{ padding: '16px 20px' }}>
            <div className="codex-row-info">
              <span className="codex-row-title">Manage worktrees</span>
              <span className="codex-row-desc">Review working copies and choose how many old worktrees to keep</span>
            </div>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={() => setShowWorktrees(true)}
              style={{ padding: '5px 16px', fontSize: '13px' }}
            >
              Manage
            </HouseButton>
          </div>

          <div className="codex-row" style={{ padding: '16px 20px' }}>
            <div className="codex-row-info">
              <span className="codex-row-title">Archived chats</span>
              <span className="codex-row-desc">Restore or delete individual archived chats</span>
            </div>
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={() => setShowArchivedChats(true)}
              style={{ padding: '5px 16px', fontSize: '13px' }}
            >
              Manage
            </HouseButton>
          </div>
        </div>
      </div>

      {/* Modal: Review old chats */}
      <AnimatePresence>
        {showReviewChats && (
          <ReviewChatsModal
            onClose={() => {
              setShowReviewChats(false)
              loadStats()
            }}
          />
        )}
      </AnimatePresence>

      {/* Modal: Manage worktrees */}
      <AnimatePresence>
        {showWorktrees && (
          <ManageWorktreesModal
            onClose={() => {
              setShowWorktrees(false)
              loadStats()
            }}
          />
        )}
      </AnimatePresence>

      {/* Modal: Archived chats */}
      <AnimatePresence>
        {showArchivedChats && (
          <ArchivedChatsModal
            onClose={() => {
              setShowArchivedChats(false)
              loadStats()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ReviewChatsModal({ onClose }) {
  const { toast } = useApp()
  const [chats, setChats] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [deleting, setDeleting] = useState(false)

  const loadChats = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.conversations()
      setChats(Array.isArray(list) ? list : [])
    } catch (err) {
      toast(`Failed to load chats: ${err.message}`, 'bad')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadChats()
  }, [loadChats])

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === chats.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(chats.map((c) => c.id)))
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return
    setDeleting(true)
    try {
      for (const id of selectedIds) {
        await api.deleteConversation(id)
      }
      toast(`Deleted ${selectedIds.size} chat${selectedIds.size === 1 ? '' : 's'}`, 'ok')
      setSelectedIds(new Set())
      loadChats()
    } catch (err) {
      toast(`Error deleting chats: ${err.message}`, 'bad')
    } finally {
      setDeleting(false)
    }
  }

  const handleDeleteSingle = async (id, title) => {
    try {
      await api.deleteConversation(id)
      toast(`Deleted "${title || 'Chat'}"`, 'ok')
      loadChats()
    } catch (err) {
      toast(`Error: ${err.message}`, 'bad')
    }
  }

  return (
    <div className="set-modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(8px)' }}>
      <motion.div
        className="set-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        style={{ maxWidth: 580, maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
            Clean up old chats ({chats.length})
          </h3>
          <HouseButton type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </HouseButton>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, fontSize: '13px' }}>
          <HouseButton
            type="button"
            className="set-btn-sm"
            onClick={toggleSelectAll}
            disabled={chats.length === 0}
          >
            {selectedIds.size === chats.length && chats.length > 0 ? 'Deselect All' : 'Select All'}
          </HouseButton>

          {selectedIds.size > 0 && (
            <HouseButton
              type="button"
              className="set-btn-sm"
              onClick={handleDeleteSelected}
              disabled={deleting}
              style={{ background: 'var(--bad, #ef4444)', color: '#fff', borderColor: 'transparent' }}
            >
              {deleting ? 'Deleting…' : `Delete (${selectedIds.size})`}
            </HouseButton>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--hairline)', borderRadius: 8, padding: 8 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
              Loading chats…
            </div>
          ) : chats.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
              No chats found.
            </div>
          ) : (
            chats.map((c) => {
              const isSelected = selectedIds.has(c.id)
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: isSelected ? 'var(--surface-3)' : 'transparent',
                    borderBottom: '1px solid var(--hairline)',
                    gap: 12,
                  }}
                >
                  <div
                    onClick={() => toggleSelect(c.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 0 }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: isSelected ? '1px solid var(--accent, #6366f1)' : '1px solid var(--hairline-strong)',
                        background: isSelected ? 'var(--accent, #6366f1)' : 'var(--surface-2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: '#fff',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isSelected && <Icon name="check" size={11} />}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title || 'Untitled chat'}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                        {c.created_at ? new Date(c.created_at).toLocaleDateString() : 'Active session'}
                      </span>
                    </div>
                  </div>
                  <HouseButton
                    type="button"
                    className="icon-btn"
                    onClick={() => handleDeleteSingle(c.id, c.title)}
                    title="Delete permanently"
                    style={{ color: 'var(--text-dim)', padding: 4 }}
                  >
                    <Icon name="trash" size={13} />
                  </HouseButton>
                </div>
              )
            })
          )}
        </div>
      </motion.div>
    </div>
  )
}

function ManageWorktreesModal({ onClose }) {
  const { toast } = useApp()
  const [worktrees, setWorktrees] = useState([])
  const [loading, setLoading] = useState(true)
  const [pruning, setPruning] = useState(false)

  const loadTrees = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.worktrees()
      if (res && res.ok) {
        setWorktrees(res.worktrees || [])
      }
    } catch (err) {
      toast(`Failed to load worktrees: ${err.message}`, 'bad')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadTrees()
  }, [loadTrees])

  const handlePrune = async () => {
    setPruning(true)
    try {
      const res = await api.pruneWorktrees()
      if (res && res.ok) {
        toast('Worktrees pruned successfully', 'ok')
        loadTrees()
      } else {
        toast(res?.error || 'Failed to prune', 'bad')
      }
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setPruning(false)
    }
  }

  return (
    <div className="set-modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(8px)' }}>
      <motion.div
        className="set-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        style={{ maxWidth: 580, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
            Manage Git Worktrees ({worktrees.length})
          </h3>
          <HouseButton type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </HouseButton>
        </div>

        <p style={{ fontSize: '13px', color: 'var(--text-dim)', margin: '0 0 14px 0' }}>
          Git worktrees allow isolated subagents to edit multiple branches safely. Pruning removes records of deleted or unreachable worktree folders.
        </p>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--hairline)', borderRadius: 8, padding: 8, marginBottom: 16 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
              Loading worktrees…
            </div>
          ) : worktrees.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
              No extra worktrees active. Main repository working tree only.
            </div>
          ) : (
            worktrees.map((wt, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  borderBottom: '1px solid var(--hairline)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', fontFamily: 'monospace' }}>
                    {wt.branch || '(detached HEAD)'}
                  </span>
                  {wt.bare && <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>bare</span>}
                </div>
                <span style={{ fontSize: '11.5px', color: 'var(--text-dim)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {wt.path}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <HouseButton
            type="button"
            className="set-btn-sm"
            onClick={handlePrune}
            disabled={pruning}
            style={{ padding: '6px 16px' }}
          >
            {pruning ? 'Pruning…' : 'Prune Inactive Worktrees'}
          </HouseButton>
        </div>
      </motion.div>
    </div>
  )
}

function ArchivedChatsModal({ onClose }) {
  const { toast } = useApp()
  const [archived, setArchived] = useState([])
  const [loading, setLoading] = useState(true)

  const loadArchived = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.conversations({ archived: true })
      setArchived(Array.isArray(list) ? list : [])
    } catch (err) {
      toast(`Failed to load archived chats: ${err.message}`, 'bad')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadArchived()
  }, [loadArchived])

  const handleRestore = async (id, title) => {
    try {
      await api.updateConversation(id, { archived: 0 })
      toast(`Restored "${title || 'Chat'}"`, 'ok')
      loadArchived()
    } catch (err) {
      toast(`Failed to restore: ${err.message}`, 'bad')
    }
  }

  const handleDelete = async (id, title) => {
    try {
      await api.deleteConversation(id)
      toast(`Deleted "${title || 'Chat'}" permanently`, 'ok')
      loadArchived()
    } catch (err) {
      toast(`Failed to delete: ${err.message}`, 'bad')
    }
  }

  return (
    <div className="set-modal-backdrop" onClick={onClose} style={{ backdropFilter: 'blur(8px)' }}>
      <motion.div
        className="set-modal-card"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        style={{ maxWidth: 580, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}>
            Archived Chats ({archived.length})
          </h3>
          <HouseButton type="button" className="icon-btn" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={14} />
          </HouseButton>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--hairline)', borderRadius: 8, padding: 8 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
              Loading archived chats…
            </div>
          ) : archived.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: '13px' }}>
              No archived chats.
            </div>
          ) : (
            archived.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  borderRadius: 6,
                  borderBottom: '1px solid var(--hairline)',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.title || 'Untitled chat'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>
                    {c.created_at ? new Date(c.created_at).toLocaleDateString() : 'Archived'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <HouseButton
                    type="button"
                    className="set-btn-sm"
                    onClick={() => handleRestore(c.id, c.title)}
                    style={{ fontSize: '12px', padding: '3px 10px' }}
                  >
                    Restore
                  </HouseButton>
                  <HouseButton
                    type="button"
                    className="icon-btn"
                    onClick={() => handleDelete(c.id, c.title)}
                    title="Delete permanently"
                    style={{ color: 'var(--bad, #ef4444)', padding: 4 }}
                  >
                    <Icon name="trash" size={13} />
                  </HouseButton>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  )
}
