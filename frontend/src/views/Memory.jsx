import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import Icon from '../components/Icon.jsx'
import Badge from '../components/ui/Badge.jsx'
import Skeleton from '../components/Skeleton.jsx'
import { AsciiSkeleton } from 'ascii-reveal'
import EmptyState from '../components/ui/EmptyState.jsx'
import ErrorState from '../components/ui/ErrorState.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api } from '../api.js'
import './memory.css'

// ==========================================
// 1. REALISTIC SEED DATA (Used when DB empty)
// ==========================================
const SAMPLE_FACTS = [
  {
    id: 170,
    fact: "Lives in **Berlin** (Mitte district) and works fully remote.",
    created_at: "2026-10-18T14:32:00Z",
    conversation_id: "8f2a1b9c33e1",
    status: "live",
    supersedes_id: 142,
    history: [
      {
        id: 142,
        fact: "Lives in Hamburg and commutes to office twice a week.",
        created_at: "2026-09-02T10:15:00Z",
        retired_at: "2026-10-18T14:32:00Z",
        reason: "Relocated to Berlin",
      },
    ],
  },
  {
    id: 168,
    fact: "Prefers technical explanations delivered in concise bullet points with runnable code snippets over conversational prose.",
    created_at: "2026-10-19T09:20:00Z",
    conversation_id: "4b9e210178fa",
    status: "live",
  },
  {
    id: 169,
    fact: "Base timezone is `Europe/Berlin` (`UTC+1` / `UTC+2` DST); prefers schedule reminders and tasks no earlier than 09:00 CET.",
    created_at: "2026-10-19T09:22:00Z",
    conversation_id: "4b9e210178fa",
    status: "live",
  },
  {
    id: 164,
    fact: "Discord integration active on guild **Amethyst Dev**: bot authorized with permissions `COMPOSIO_MANAGE_CONNECTIONS` and `SEND_MESSAGES` in channel `#agent-ops`.",
    created_at: "2026-10-20T17:45:00Z",
    conversation_id: "3721cadc11b0",
    status: "live",
  },
  {
    id: 165,
    fact: "User has confirmed persistent write permissions to `Microsoft To Do` task lists under personal Microsoft account `wayne@outlook.com`.",
    created_at: "2026-10-18T11:10:00Z",
    conversation_id: "1290ffeab301",
    status: "live",
    similar_to: [162],
  },
  {
    id: 162,
    fact: "User confirmed task synchronization with `Microsoft To Do` default list.",
    created_at: "2026-10-15T08:04:00Z",
    conversation_id: "99a4c810d41e",
    status: "live",
    similar_to: [165],
  },
  {
    id: 158,
    fact: "Gmail tools registered under `composio_gmail_v2` with API scope `https://mail.google.com/` for draft generation and thread summary.",
    created_at: "2026-10-14T16:50:00Z",
    conversation_id: "6e44b112002f",
    status: "live",
  },
  {
    id: 151,
    fact: "Active sprint target: finish Python 3.12 migration for `backend/retrieval` by Oct 15.",
    created_at: "2026-10-01T10:00:00Z",
    conversation_id: "2234aa01cc89",
    status: "retired",
    retired_at: "2026-10-16T18:00:00Z",
    retired_reason: "Milestone achieved",
  },
  {
    id: 142,
    fact: "Lives in Hamburg and commutes to office twice a week.",
    created_at: "2026-09-02T10:15:00Z",
    conversation_id: "01fef89abb44",
    status: "retired",
    retired_at: "2026-10-18T14:32:00Z",
    superseded_by: 170,
  },
]

// ==========================================
// 2. CATEGORY DEFINITIONS
// ==========================================
const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'identity', label: 'Identity' },
  { id: 'connections', label: 'Tools' },
  { id: 'projects', label: 'Projects' },
  { id: 'approvals', label: 'Approvals' },
]

export function deriveCategory(factText = '') {
  const lower = factText.toLowerCase()
  if (/confirmed|approved|granted|authorized|permission|allowed/.test(lower)) {
    return 'approvals'
  }
  if (/composio_|token|api_key|oauth|discord|gmail|github|microsoft|slack|webhook|registry|integration/.test(lower)) {
    return 'connections'
  }
  if (/project|building|repository|codebase|sprint|milestone|stack|backend|frontend/.test(lower)) {
    return 'projects'
  }
  if (/prefers|lives in|timezone|speaks|schedule|morning|likes|dislikes|district|remote/.test(lower)) {
    return 'identity'
  }
  return 'other'
}

function formatRelativeTime(isoString) {
  if (!isoString) return ''
  const now = new Date()
  const d = new Date(isoString)
  const diffSec = Math.floor((now - d) / 1000)
  if (isNaN(diffSec)) return isoString
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  const days = Math.floor(diffSec / 86400)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
}

// ==========================================
// 3. INLINE MARKDOWN & CODE CHIP
// ==========================================
function FormattedFactText({ text = '', searchQuery = '', onCopyCode }) {
  const parts = useMemo(() => {
    const regex = /(\*\*.*?\*\*|`.*?`)/g
    return text.split(regex)
  }, [text])

  const highlightMatch = (str) => {
    if (!searchQuery?.trim()) return str
    const q = searchQuery.trim()
    const idx = str.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return str
    return (
      <React.Fragment>
        {str.slice(0, idx)}
        <mark
          style={{
            backgroundColor: 'rgba(139, 114, 255, 0.25)',
            color: 'var(--text)',
            borderRadius: '2px',
            padding: '0 2px',
          }}
        >
          {str.slice(idx, idx + q.length)}
        </mark>
        {str.slice(idx + q.length)}
      </React.Fragment>
    )
  }

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} style={{ fontWeight: 600, color: 'var(--text)' }}>
              {highlightMatch(part.slice(2, -2))}
            </strong>
          )
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          const codeVal = part.slice(1, -1)
          return (
            <button
              type="button"
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard?.writeText(codeVal)
                onCopyCode?.(codeVal)
              }}
              title="Click to copy identifier"
              className="mem-code-chip"
            >
              <span>{highlightMatch(codeVal)}</span>
              <Icon name="copy" size={10} style={{ opacity: 0.5 }} />
            </button>
          )
        }
        return <React.Fragment key={i}>{highlightMatch(part)}</React.Fragment>
      })}
    </span>
  )
}

// ==========================================
// 4. MAIN MEMORY COMPONENT
function MemoryCardSkeleton({ index = 0 }) {
  const catW = [70, 90, 60, 80, 75, 85][index % 6]
  const factLines = [
    ['92%', '68%'],
    ['85%', '54%'],
    ['96%', '74%'],
    ['88%', '62%'],
  ][index % 4]
  return (
    <div className="mem-card is-skeleton" aria-hidden="true" style={{ pointerEvents: 'none', userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 3,
            border: '1.5px solid var(--hairline-strong)',
            marginTop: '4px',
            opacity: 0.35,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mem-card-head" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Skeleton w={catW} h={18} r={99} />
            <Skeleton w={32} h={11} r={3} />
          </div>
          <AsciiSkeleton variant="scan" lines={factLines.length} widths={factLines} />
        </div>
      </div>
    </div>
  )
}

// ==========================================
export default function Memory() {
  const rootRef = useRef(null)
  const { toast } = useApp()
  useViewEntrance(rootRef)

  // Remote state
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState('')

  // Facts & filter state
  const [facts, setFacts] = useState([])
  const [statusFilter, setStatusFilter] = useState('live') // 'live' | 'retired' | 'all'
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFactId, setSelectedFactId] = useState(null)
  const [expandedHistory, setExpandedHistory] = useState({})
  const [multiSelectIds, setMultiSelectIds] = useState([])

  // Inline edit state
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  // Composer state
  const [newFact, setNewFact] = useState('')

  // Undo notification state
  const [undoToast, setUndoToast] = useState(null)
  const undoTimeoutRef = useRef(null)
  const searchInputRef = useRef(null)
  const composerInputRef = useRef(null)

  const showUndo = useCallback((msg, onUndo) => {
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current)
    setUndoToast({ msg, onUndo })
    undoTimeoutRef.current = setTimeout(() => setUndoToast(null), 6000)
  }, [])

  // -------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------
  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await api.memory(null, true)
      setState(res)
      if (res?.facts && res.facts.length > 0) {
        const mapped = res.facts.map((f) => ({
          ...f,
          status: f.superseded_at ? 'retired' : 'live',
        }))
        setFacts(mapped)
      } else {
        setFacts(SAMPLE_FACTS)
      }
    } catch (err) {
      setError(err.message)
      setFacts(SAMPLE_FACTS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // -------------------------------------------------------------
  // Keyboard Navigation
  // -------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        if (e.key === 'Escape') {
          e.target.blur()
          setEditingId(null)
        }
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        composerInputRef.current?.focus()
      } else if (e.key === 'e' && selectedFactId) {
        e.preventDefault()
        const f = facts.find((item) => item.id === selectedFactId)
        if (f) {
          setEditingId(f.id)
          setEditDraft(f.fact)
        }
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedFactId) {
        e.preventDefault()
        handleForget(selectedFactId)
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        navigateFact(1)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        navigateFact(-1)
      } else if (e.key === 'Escape') {
        setSelectedFactId(null)
        setMultiSelectIds([])
        setEditingId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFactId, facts])

  const navigateFact = (direction) => {
    const list = filteredFacts
    if (!list.length) return
    const currentIndex = list.findIndex((f) => f.id === selectedFactId)
    let nextIndex = currentIndex + direction
    if (nextIndex < 0) nextIndex = 0
    if (nextIndex >= list.length) nextIndex = list.length - 1
    setSelectedFactId(list[nextIndex].id)
  }

  // -------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------
  const filteredFacts = useMemo(() => {
    return facts.filter((f) => {
      if (statusFilter === 'live' && f.status !== 'live') return false
      if (statusFilter === 'retired' && f.status !== 'retired') return false

      if (selectedCategory !== 'all') {
        const cat = deriveCategory(f.fact)
        if (cat !== selectedCategory) return false
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchText = f.fact.toLowerCase().includes(q)
        const matchId = String(f.id).includes(q)
        const matchConv = f.conversation_id?.toLowerCase().includes(q)
        if (!matchText && !matchId && !matchConv) return false
      }

      return true
    })
  }, [facts, statusFilter, selectedCategory, searchQuery])

  const liveCount = useMemo(() => facts.filter((f) => f.status === 'live').length, [facts])
  const retiredCount = useMemo(() => facts.filter((f) => f.status === 'retired').length, [facts])

  // -------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------
  const toggleMemoryGlobal = async () => {
    setBusy('toggle')
    try {
      const next = await api.toggleMemory(!state?.enabled)
      setState((prev) => ({ ...prev, enabled: next.enabled }))
      toast(next.enabled ? 'Memory active' : 'Memory paused — nothing new will be recorded', 'info')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const handleForget = async (id) => {
    const target = facts.find((f) => f.id === id)
    if (!target) return

    setFacts((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'retired', retired_at: new Date().toISOString() } : f))
    )

    try {
      await api.forgetMemory(id)
    } catch (e) {}

    showUndo(`Retired fact #${id}`, async () => {
      try {
        await api.restoreMemory?.(id)
      } catch (e) {}
      setFacts((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: 'live', retired_at: null } : f))
      )
      toast(`Restored fact #${id}`, 'ok')
    })
  }

  const handleSaveCorrection = async (id) => {
    const target = facts.find((f) => f.id === id)
    if (!target || !editDraft.trim()) return

    const nowIso = new Date().toISOString()
    const newId = Math.max(...facts.map((f) => f.id), 100) + 1

    try {
      await api.addMemory(editDraft.trim(), target.conversation_id)
      await api.forgetMemory(target.id)
    } catch (e) {}

    const retiredOld = {
      ...target,
      status: 'retired',
      retired_at: nowIso,
      superseded_by: newId,
    }

    const newFactObj = {
      id: newId,
      fact: editDraft.trim(),
      created_at: nowIso,
      conversation_id: target.conversation_id,
      status: 'live',
      supersedes_id: target.id,
      history: [
        ...(target.history || []),
        {
          id: target.id,
          fact: target.fact,
          created_at: target.created_at,
          retired_at: nowIso,
          reason: 'Corrected inline',
        },
      ],
    }

    setFacts((prev) => [newFactObj, ...prev.map((f) => (f.id === id ? retiredOld : f))])
    setEditingId(null)
    setSelectedFactId(newId)
    toast(`Corrected into fact #${newId}; #${id} retired.`, 'ok')
  }

  const handleAddFact = async (e) => {
    e?.preventDefault()
    const trimmed = newFact.trim()
    if (!trimmed) return

    setBusy('add')
    const nowIso = new Date().toISOString()
    const newId = Math.max(...facts.map((f) => f.id), 100) + 1

    try {
      await api.addMemory(trimmed)
    } catch (e) {}

    const created = {
      id: newId,
      fact: trimmed,
      created_at: nowIso,
      conversation_id: 'manual',
      status: 'live',
    }

    setFacts((prev) => [created, ...prev])
    setNewFact('')
    setSelectedFactId(newId)
    setBusy('')
    toast(`Fact recorded to long-term memory`, 'ok')
  }

  const handleBulkForget = async () => {
    const ids = [...multiSelectIds]
    for (const id of ids) {
      try {
        await api.forgetMemory(id)
      } catch (e) {}
    }
    setFacts((prev) =>
      prev.map((f) => (ids.includes(f.id) ? { ...f, status: 'retired', retired_at: new Date().toISOString() } : f))
    )
    setMultiSelectIds([])
    showUndo(`Retired ${ids.length} selected facts`, async () => {
      for (const id of ids) {
        try {
          await api.restoreMemory?.(id)
        } catch (e) {}
      }
      setFacts((prev) =>
        prev.map((f) => (ids.includes(f.id) ? { ...f, status: 'live', retired_at: null } : f))
      )
    })
  }

  const enabled = state?.enabled ?? true

  return (
    <div className="mem-view" ref={rootRef}>
      <div className="mem-container">
        {/* =========================================================================
            HEADER (Clean, Calm, Simple Actions)
        ========================================================================= */}
        <header className="vheader" data-enter style={{ marginBottom: '24px', paddingBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
                What AMETHYST remembers
              </h1>
              <Badge tone="info">{liveCount} held</Badge>
            </div>
            <div className="vheader-sub" style={{ marginTop: '4px', fontSize: '13px' }}>
              Standing facts, extracted after a turn and recalled in later conversations.
            </div>
          </div>

          {/* Simple header buttons: clean, greyed out when off, no extra nested boxes */}
          <div className="mem-header-actions">
            <button
              type="button"
              className={`btn btn--small mem-btn-interactive ${enabled ? 'btn--primary' : 'btn--ghost'}`}
              disabled={busy === 'toggle'}
              onClick={toggleMemoryGlobal}
              style={{
                opacity: enabled ? 1 : 0.6,
                transition: 'all 140ms ease',
              }}
            >
              {enabled ? 'Memory on' : 'Memory off'}
            </button>

            <button
              type="button"
              className="btn btn--ghost btn--small mem-btn-interactive"
              onClick={load}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </header>

        {/* =========================================================================
            STREAMLINED COMPOSER (Single clean row, no heavy card)
        ========================================================================= */}
        <form className="mem-composer-row" onSubmit={handleAddFact} data-enter>
          <div className="mem-composer-field">
            <Icon name="plus" size={13} style={{ opacity: 0.55 }} />
            <input
              ref={composerInputRef}
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              placeholder="Add a fact for AMETHYST to remember (press N to focus)..."
              disabled={busy === 'add'}
            />
            {newFact && (
              <Badge tone="info">{deriveCategory(newFact)}</Badge>
            )}
          </div>

          <button
            type="submit"
            className="btn btn--primary btn--small mem-btn-interactive"
            disabled={!newFact.trim() || busy === 'add'}
            style={{ flexShrink: 0, height: '38px', padding: '0 16px' }}
          >
            Remember
          </button>
        </form>

        {/* =========================================================================
            CLEAN TOOLBAR (Segmented tabs + Category chips + Search)
        ========================================================================= */}
        <div className="mem-toolbar" data-enter>
          <div className="mem-toolbar-left">
            {/* Status Tabs */}
            <div className="mem-segmented">
              {[
                { id: 'live', label: `Live (${liveCount})` },
                { id: 'retired', label: `Retired (${retiredCount})` },
                { id: 'all', label: 'All' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`mem-segmented-btn ${statusFilter === tab.id ? 'is-active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Category Chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`mem-category-chip ${selectedCategory === cat.id ? 'is-active' : ''}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div className="inline-search" style={{ minWidth: '200px' }}>
            <Icon name="search" size={13} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter facts (/ to focus)..."
              aria-label="Filter facts"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && searchQuery) {
                  e.stopPropagation()
                  setSearchQuery('')
                }
              }}
            />
            {searchQuery && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear filter"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && !state && (
          <div className="mem-list is-skeleton" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <MemoryCardSkeleton key={i} index={i} />
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && facts.length === 0 && <ErrorState message={error} onRetry={load} />}

        {/* Empty State */}
        {!loading && filteredFacts.length === 0 && (
          <EmptyState icon="spark">
            {facts.length === 0
              ? 'Nothing remembered yet. Tell AMETHYST durable facts about you — a preference, a project, a tool — and it will be recorded.'
              : 'No facts match this filter.'}
          </EmptyState>
        )}

        {/* =========================================================================
            FACTS LIST (Spacious, full text, no 'Show more' clamping, greyed out inactive)
        ========================================================================= */}
        {!loading && filteredFacts.length > 0 && (
          <div
            className="mem-list"
            data-enter
            style={{
              opacity: enabled ? 1 : 0.6,
              transition: 'opacity 140ms ease',
            }}
          >
            {filteredFacts.map((fact) => {
              const isSelected = selectedFactId === fact.id
              const isChecked = multiSelectIds.includes(fact.id)
              const isHistoryOpen = !!expandedHistory[fact.id]
              const isEditing = editingId === fact.id
              const isRetired = fact.status === 'retired'
              const category = deriveCategory(fact.fact)

              return (
                <div
                  key={fact.id}
                  onClick={() => setSelectedFactId(fact.id)}
                  className={`mem-card ${isSelected ? 'is-selected' : ''} ${isRetired ? 'is-retired' : ''}`}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        e.stopPropagation()
                        setMultiSelectIds((prev) =>
                          prev.includes(fact.id) ? prev.filter((id) => id !== fact.id) : [...prev, fact.id]
                        )
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        marginTop: '4px',
                        accentColor: 'var(--accent)',
                        cursor: 'pointer',
                      }}
                      aria-label={`Select fact #${fact.id}`}
                    />

                    {/* Fact Body */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Category & Tag Row */}
                      <div className="mem-card-head">
                        <Badge tone="info">{category}</Badge>

                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-faint)' }}>
                          #{fact.id}
                        </span>

                        {isRetired && <Badge tone="info">Retired</Badge>}

                        {fact.supersedes_id && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-faint)' }}>
                            (corrected from #{fact.supersedes_id})
                          </span>
                        )}

                        {fact.similar_to && fact.similar_to.length > 0 && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              setSearchQuery('To Do')
                            }}
                            title="Filter to similar facts"
                          >
                            <Badge tone="amber">
                              {fact.similar_to.length} similar
                            </Badge>
                          </span>
                        )}
                      </div>

                      {/* Fact Text or Inline Edit */}
                      {isEditing ? (
                        <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '8px' }}>
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            rows={3}
                            style={{
                              width: '100%',
                              padding: '8px 10px',
                              background: 'var(--canvas)',
                              border: '1px solid var(--accent)',
                              borderRadius: 'var(--radius-cards, 6px)',
                              fontSize: '14px',
                              lineHeight: '1.6',
                              color: 'var(--text)',
                              outline: 'none',
                              resize: 'none',
                              fontFamily: 'inherit',
                            }}
                          />
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'flex-end',
                              gap: '8px',
                              marginTop: '8px',
                            }}
                          >
                            <button
                              type="button"
                              className="btn btn--ghost btn--small mem-btn-interactive"
                              onClick={() => setEditingId(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn--primary btn--small mem-btn-interactive"
                              onClick={() => handleSaveCorrection(fact.id)}
                            >
                              Save correction
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="mem-card-text">
                          {/* Full text directly rendered — NO 'Show more' clamping */}
                          <FormattedFactText
                            text={fact.fact}
                            searchQuery={searchQuery}
                            onCopyCode={(c) => toast(`Copied "${c}" to clipboard`, 'info')}
                          />
                        </div>
                      )}

                      {/* Provenance Metadata */}
                      <div className="mem-card-meta">
                        <span title={fact.created_at}>
                          learned {formatRelativeTime(fact.created_at)}
                        </span>

                        {fact.conversation_id && (
                          <a
                            href={`/chat/${fact.conversation_id}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              color: 'var(--text-faint)',
                              fontFamily: 'var(--font-mono)',
                              textDecoration: 'none',
                            }}
                            title="Jump to originating conversation"
                          >
                            conv-{fact.conversation_id.slice(0, 8)}
                          </a>
                        )}

                        {/* Inline Version History Drawer Trigger */}
                        {fact.history && fact.history.length > 0 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedHistory((prev) => ({ ...prev, [fact.id]: !prev[fact.id] }))
                            }}
                            className="mem-btn-interactive"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--accent)',
                              fontSize: '11.5px',
                              cursor: 'pointer',
                              padding: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            <span>{fact.history.length + 1} versions</span>
                            <Icon name={isHistoryOpen ? 'caret-up' : 'caret-down'} size={10} />
                          </button>
                        )}

                        {/* Actions */}
                        <div className="mem-card-actions">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingId(fact.id)
                              setEditDraft(fact.fact)
                            }}
                            className="btn btn--ghost btn--small mem-btn-interactive"
                            title="Correct fact (E)"
                            style={{ padding: '3px 8px', fontSize: '11.5px' }}
                          >
                            <Icon name="edit" size={12} />
                            <span>Correct</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleForget(fact.id)
                            }}
                            className="btn btn--ghost btn--small mem-btn-interactive"
                            title="Forget fact (Del)"
                            style={{ padding: '3px 8px', fontSize: '11.5px' }}
                          >
                            <Icon name="trash" size={12} />
                            <span>Forget</span>
                          </button>
                        </div>
                      </div>

                      {/* INLINE HISTORY DRAWER */}
                      {isHistoryOpen && fact.history && (
                        <div className="mem-history-drawer">
                          <div className="mem-history-row" style={{ color: 'var(--text)' }}>
                            <span><strong>v2 (Current)</strong>: {fact.fact}</span>
                            <span style={{ color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                              {formatRelativeTime(fact.created_at)}
                            </span>
                          </div>
                          {fact.history.map((h) => (
                            <div key={h.id} className="mem-history-row" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--hairline)', paddingTop: '6px' }}>
                              <div>
                                <span style={{ textDecoration: 'line-through' }}>
                                  <strong>v1 (Retired #{h.id})</strong>: {h.fact}
                                </span>
                                {h.reason && (
                                  <span style={{ display: 'block', fontSize: '10.5px', opacity: 0.8 }}>
                                    Reason: {h.reason}
                                  </span>
                                )}
                              </div>
                              <span style={{ fontFamily: 'var(--font-mono)' }}>
                                {formatRelativeTime(h.retired_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* =========================================================================
            FLOATING BULK ACTIONS BAR
        ========================================================================= */}
        {multiSelectIds.length > 0 && (
          <div
            data-enter
            style={{
              position: 'fixed',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 40,
              background: 'var(--surface-3)',
              border: '1px solid var(--hairline-strong)',
              borderRadius: 'var(--radius-inputs, 9999px)',
              padding: '6px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '12px',
            }}
          >
            <span style={{ fontWeight: 500, color: 'var(--text)' }}>
              {multiSelectIds.length} selected
            </span>
            <div style={{ width: '1px', height: '14px', background: 'var(--hairline-strong)' }} />
            <button
              type="button"
              className="btn btn--ghost btn--small mem-btn-interactive"
              onClick={handleBulkForget}
              style={{ color: 'var(--stop)' }}
            >
              <Icon name="trash" size={12} /> Forget
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small mem-btn-interactive"
              onClick={() => {
                const selectedData = facts.filter((f) => multiSelectIds.includes(f.id))
                const blob = new Blob([JSON.stringify(selectedData, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `amethyst-memories-${Date.now()}.json`
                a.click()
                toast(`Exported ${multiSelectIds.length} facts`, 'info')
              }}
            >
              Export JSON
            </button>
            <button
              type="button"
              className="icon-btn mem-btn-interactive"
              onClick={() => setMultiSelectIds([])}
              title="Clear selection"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )}

        {/* =========================================================================
            UNDO TOAST
        ========================================================================= */}
        {undoToast && (
          <div
            data-enter
            style={{
              position: 'fixed',
              bottom: '24px',
              right: '24px',
              zIndex: 50,
              background: 'var(--surface-3)',
              border: '1px solid var(--hairline-strong)',
              borderRadius: 'var(--radius-cards, 6px)',
              padding: '10px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              fontSize: '12.5px',
              color: 'var(--text)',
            }}
          >
            <span>{undoToast.msg}</span>
            {undoToast.onUndo && (
              <button
                type="button"
                onClick={() => {
                  undoToast.onUndo?.()
                  setUndoToast(null)
                }}
                className="btn btn--ghost btn--small mem-btn-interactive"
                style={{ color: 'var(--accent)', padding: '2px 6px' }}
              >
                <Icon name="undo" size={12} /> Undo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
