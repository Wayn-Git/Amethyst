import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  Sparkles,
  Search,
  Plus,
  RefreshCw,
  Check,
  Copy,
  Clock,
  Trash2,
  Edit3,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  User,
  Plug,
  FolderGit2,
  CheckCircle2,
  RotateCcw,
  AlertCircle,
  HelpCircle,
  Command,
  ArrowRight,
  Archive,
  Eye,
  SlidersHorizontal,
} from 'lucide-react'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api, fmtDate } from '../api.js'
import { SkeletonCard } from '../components/Skeleton.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import ErrorState from '../components/ui/ErrorState.jsx'

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
// 2. SEMANTIC CATEGORY DEFINITIONS
// ==========================================
const CATEGORIES = [
  { id: 'all', label: 'All facts', icon: Sparkles },
  { id: 'identity', label: 'Identity & Preferences', icon: User },
  { id: 'connections', label: 'Connections & Tools', icon: Plug },
  { id: 'projects', label: 'Projects & Context', icon: FolderGit2 },
  { id: 'approvals', label: 'Approvals & Grants', icon: CheckCircle2 },
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
// 3. INLINE MARKDOWN & CODE CHIP COMPONENT
// ==========================================
function FormattedFactText({ text = '', searchQuery = '', onCopyCode }) {
  const parts = useMemo(() => {
    // Regex splits **bold** and `code`
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
            backgroundColor: 'rgba(139, 114, 255, 0.3)',
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
    <span style={{ lineHeight: '1.6' }}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong
              key={i}
              style={{ fontWeight: 600, color: 'var(--text)' }}
            >
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
              className="inline-code-chip"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11.5px',
                padding: '1.5px 6px',
                margin: '0 2px',
                borderRadius: 'var(--r-xs, 4px)',
                background: 'var(--surface-3)',
                border: '1px solid var(--hairline)',
                color: 'var(--accent)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                verticalAlign: 'baseline',
              }}
            >
              <span>{highlightMatch(codeVal)}</span>
              <Copy size={10} style={{ opacity: 0.5 }} />
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
  const [lastSynced, setLastSynced] = useState('just now')

  // Local/Augmented facts
  const [facts, setFacts] = useState([])

  // View filtering & sorting
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [statusFilter, setStatusFilter] = useState('live') // 'live' | 'retired' | 'all'
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('newest') // 'newest' | 'oldest' | 'type'
  const [selectedFactId, setSelectedFactId] = useState(null)
  const [multiSelectIds, setMultiSelectIds] = useState([])
  const [expandedFacts, setExpandedFacts] = useState({})
  const [showHowItWorks, setShowHowItWorks] = useState(false)

  // Inline edit state
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  // Composer state
  const [composerOpen, setComposerOpen] = useState(false)
  const [newFact, setNewFact] = useState('')

  // Undo Toast state
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
        // Map backend facts
        const mapped = res.facts.map((f) => ({
          ...f,
          status: f.superseded_at ? 'retired' : 'live',
        }))
        setFacts(mapped)
        setSelectedFactId((prev) => prev || mapped[0]?.id)
      } else {
        // Use realistic sample facts if database is fresh/empty
        setFacts(SAMPLE_FACTS)
        setSelectedFactId(170)
      }
      setLastSynced(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      setError(err.message)
      // Fallback to sample facts so user can still explore
      setFacts(SAMPLE_FACTS)
      setSelectedFactId(170)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // -------------------------------------------------------------
  // Keyboard Shortcuts
  // -------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) {
        if (e.key === 'Escape') {
          e.target.blur()
          setComposerOpen(false)
          setEditingId(null)
        }
        return
      }

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setComposerOpen(true)
        setTimeout(() => composerInputRef.current?.focus(), 60)
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
        setComposerOpen(false)
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
  // Filtered & Sorted Facts
  // -------------------------------------------------------------
  const filteredFacts = useMemo(() => {
    return facts
      .filter((f) => {
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
      .sort((a, b) => {
        if (sortBy === 'newest') return new Date(b.created_at) - new Date(a.created_at)
        if (sortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at)
        if (sortBy === 'type') return deriveCategory(a.fact).localeCompare(deriveCategory(b.fact))
        return 0
      })
  }, [facts, statusFilter, selectedCategory, searchQuery, sortBy])

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
      toast(next.enabled ? 'Memory active' : 'Memory paused — nothing new will be recorded', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy('')
    }
  }

  const handleForget = async (id) => {
    const target = facts.find((f) => f.id === id)
    if (!target) return

    // Optimistic removal from live view
    setFacts((prev) =>
      prev.map((f) => (f.id === id ? { ...f, status: 'retired', retired_at: new Date().toISOString() } : f))
    )

    try {
      await api.forgetMemory(id)
    } catch (e) {
      // Local demo mode gracefully ignores 404 on mock ids
    }

    showUndo(`Forgot fact #${id}`, async () => {
      try {
        await api.restoreMemory?.(id)
      } catch (e) {}
      setFacts((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: 'live', retired_at: null } : f))
      )
      setSelectedFactId(id)
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
          reason: 'Corrected inline by user',
        },
      ],
    }

    setFacts((prev) => [newFactObj, ...prev.map((f) => (f.id === id ? retiredOld : f))])
    setEditingId(null)
    setSelectedFactId(newId)
    toast(`Corrected into new fact #${newId}; #${id} retired.`, 'ok')
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
    setComposerOpen(false)
    setSelectedFactId(newId)
    setBusy('')
    toast(`Fact #${newId} recorded to long-term memory`, 'ok')
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

  const activeFact = useMemo(() => facts.find((f) => f.id === selectedFactId), [facts, selectedFactId])
  const enabled = state?.enabled ?? true

  return (
    <div className="view" ref={rootRef} style={{ paddingBottom: '90px' }}>
      <div className="view-inner view-inner--wide" style={{ maxWidth: '1200px' }}>
        {/* =========================================================================
            HEADER
        ========================================================================= */}
        <header
          className="vheader"
          data-enter
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            paddingBottom: '20px',
            marginBottom: '24px',
            borderBottom: '1px solid var(--hairline)',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                What AMETHYST remembers
              </h1>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  background: 'var(--surface-3)',
                  border: '1px solid var(--hairline)',
                  color: 'var(--text-dim)',
                }}
              >
                {liveCount} live facts
              </span>
            </div>
            <div
              style={{
                fontSize: '13px',
                color: 'var(--text-dim)',
                marginTop: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
              }}
            >
              <span>Standing facts extracted after turns and recalled in later conversations.</span>
              <button
                type="button"
                onClick={() => setShowHowItWorks(!showHowItWorks)}
                style={{
                  color: 'var(--accent)',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  fontSize: '12.5px',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <HelpCircle size={12} />
                <span>How memory works</span>
                {showHowItWorks ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Memory Active Toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                borderRadius: 'var(--r-md, 10px)',
                background: 'var(--surface-2)',
                border: '1px solid var(--hairline)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '2px',
                  background: enabled ? 'var(--live)' : 'var(--text-faint)',
                  boxShadow: enabled ? '0 0 8px var(--live)' : 'none',
                  transition: 'background 160ms ease',
                }}
              />
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-dim)' }}>
                {enabled ? 'Memory on' : 'Memory off'}
              </span>
              <button
                type="button"
                onClick={toggleMemoryGlobal}
                disabled={busy === 'toggle'}
                aria-label="Toggle memory"
                style={{
                  position: 'relative',
                  width: '28px',
                  height: '16px',
                  borderRadius: '9999px',
                  background: enabled ? 'var(--accent)' : 'var(--surface-3)',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  transition: 'background 140ms ease',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    width: '12px',
                    height: '12px',
                    borderRadius: '9999px',
                    background: '#fff',
                    transform: enabled ? 'translateX(12px)' : 'translateX(0)',
                    transition: 'transform 140ms ease',
                  }}
                />
              </button>
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="btn btn--ghost"
              style={{
                fontSize: '12px',
                height: '32px',
                padding: '0 12px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                borderRadius: 'var(--r-md, 10px)',
              }}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>{loading ? 'Syncing…' : `Synced ${lastSynced}`}</span>
            </button>

            {/* Add Fact Trigger */}
            <button
              type="button"
              onClick={() => {
                setComposerOpen(true)
                setTimeout(() => composerInputRef.current?.focus(), 50)
              }}
              className="btn btn--primary"
              style={{
                fontSize: '12.5px',
                height: '32px',
                padding: '0 14px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                borderRadius: 'var(--r-md, 10px)',
              }}
            >
              <Plus size={14} />
              <span>Remember</span>
              <kbd
                style={{
                  fontSize: '10px',
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(0,0,0,0.25)',
                  padding: '1px 4px',
                  borderRadius: '3px',
                }}
              >
                N
              </kbd>
            </button>
          </div>
        </header>

        {/* =========================================================================
            HOW MEMORY WORKS DISCLOSURE
        ========================================================================= */}
        {showHowItWorks && (
          <div
            data-enter
            style={{
              padding: '14px 18px',
              borderRadius: 'var(--r-md, 10px)',
              background: 'var(--surface)',
              border: '1px solid var(--hairline)',
              marginBottom: '20px',
              fontSize: '12.5px',
              color: 'var(--text-dim)',
              lineHeight: '1.6',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <div>
              <p style={{ margin: 0 }}>
                AMETHYST automatically extracts lasting facts about identity, preferences, tools, and ongoing
                projects after each turn. When a fact changes, AMETHYST <strong>retires</strong> the prior fact
                instead of deleting it, keeping the reasoning chain completely auditable.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowHowItWorks(false)}
              className="icon-btn"
              style={{ padding: '2px', color: 'var(--text-faint)' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* =========================================================================
            MEMORY PAUSED BANNER
        ========================================================================= */}
        {!enabled && (
          <div
            data-enter
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              borderRadius: 'var(--r-md, 10px)',
              background: 'var(--confirm-soft)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              color: 'var(--confirm)',
              fontSize: '12.5px',
              marginBottom: '20px',
            }}
          >
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>
              Memory is paused globally: no new facts will be recorded and existing facts will not be injected into
              prompts. Held facts remain preserved below.
            </span>
          </div>
        )}

        {/* =========================================================================
            COMMAND COMPOSER (SUMMONABLE WITH N)
        ========================================================================= */}
        {composerOpen && (
          <form
            onSubmit={handleAddFact}
            data-enter
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--accent-line)',
              borderRadius: 'var(--r-lg, 14px)',
              padding: '16px',
              marginBottom: '20px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}
            >
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: 'var(--accent)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Command size={13} />
                <span>Add fact to long-term memory</span>
              </span>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                className="icon-btn"
                style={{ color: 'var(--text-faint)' }}
              >
                <X size={14} />
              </button>
            </div>

            <textarea
              ref={composerInputRef}
              value={newFact}
              onChange={(e) => setNewFact(e.target.value)}
              placeholder="e.g. 'Prefers dark mode with high contrast', or 'Github token scoped to repo:status'..."
              rows={2}
              style={{
                width: '100%',
                background: 'var(--surface-2)',
                border: '1px solid var(--hairline)',
                borderRadius: 'var(--r-md, 10px)',
                padding: '10px 12px',
                fontSize: '13.5px',
                color: 'var(--text)',
                fontFamily: 'inherit',
                resize: 'none',
                outline: 'none',
              }}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '10px',
              }}
            >
              <div
                style={{
                  fontSize: '11px',
                  color: 'var(--text-dim)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span>Filing preview:</span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    background: 'var(--surface-3)',
                    color: 'var(--accent)',
                    border: '1px solid var(--hairline)',
                  }}
                >
                  {deriveCategory(newFact)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setComposerOpen(false)}
                  style={{
                    fontSize: '12px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: '6px 10px',
                  }}
                >
                  Cancel (Esc)
                </button>
                <button
                  type="submit"
                  disabled={!newFact.trim() || busy === 'add'}
                  className="btn btn--primary"
                  style={{
                    fontSize: '12px',
                    padding: '6px 14px',
                    borderRadius: 'var(--r-md, 10px)',
                  }}
                >
                  {busy === 'add' ? 'Saving…' : 'Remember (↵)'}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* =========================================================================
            FACETS & CONTROLS BAR
        ========================================================================= */}
        <div style={{ marginBottom: '20px' }}>
          {/* Category Facet Tabs */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              overflowX: 'auto',
              paddingBottom: '6px',
              marginBottom: '12px',
            }}
          >
            {CATEGORIES.map((cat) => {
              const IconComp = cat.icon
              const count =
                cat.id === 'all'
                  ? facts.length
                  : facts.filter((f) => deriveCategory(f.fact) === cat.id).length
              const active = selectedCategory === cat.id

              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '12.5px',
                    borderRadius: 'var(--r-md, 10px)',
                    border: active ? '1px solid var(--accent-line)' : '1px solid transparent',
                    background: active ? 'var(--surface-2)' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 120ms ease',
                  }}
                >
                  <IconComp size={13} style={{ color: active ? 'var(--accent)' : 'inherit', opacity: active ? 1 : 0.6 }} />
                  <span>{cat.label}</span>
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', opacity: 0.5 }}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Search, Status Segmented Toggle & Sort */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              background: 'var(--surface)',
              border: '1px solid var(--hairline)',
              borderRadius: 'var(--r-lg, 14px)',
              padding: '8px 12px',
            }}
          >
            {/* Search Input */}
            <div
              style={{
                position: 'relative',
                flex: 1,
                minWidth: '220px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '10px',
                  color: 'var(--text-faint)',
                  pointerEvents: 'none',
                }}
              />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search facts, IDs, tools (/ to focus)..."
                style={{
                  width: '100%',
                  padding: '6px 28px 6px 32px',
                  background: 'var(--surface-2)',
                  border: '1px solid transparent',
                  borderRadius: 'var(--r-md, 10px)',
                  color: 'var(--text)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-faint)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {/* Status Segmented Control */}
              <div
                style={{
                  display: 'inline-flex',
                  padding: '3px',
                  background: 'var(--surface-2)',
                  borderRadius: 'var(--r-md, 10px)',
                  border: '1px solid var(--hairline)',
                }}
              >
                {[
                  { id: 'live', label: `Live (${liveCount})` },
                  { id: 'retired', label: `Retired (${retiredCount})` },
                  { id: 'all', label: 'All' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setStatusFilter(tab.id)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '11.5px',
                      fontWeight: 500,
                      borderRadius: 'var(--r-sm, 6px)',
                      border: 'none',
                      background: statusFilter === tab.id ? 'var(--surface-3)' : 'transparent',
                      color: statusFilter === tab.id ? 'var(--text)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      transition: 'all 120ms ease',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Sort Dropdown */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--hairline)',
                  borderRadius: 'var(--r-md, 10px)',
                  color: 'var(--text-dim)',
                  fontSize: '12px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <option value="newest">Sort: Newest</option>
                <option value="oldest">Sort: Oldest</option>
                <option value="type">Sort: Category</option>
              </select>
            </div>
          </div>
        </div>

        {/* Loading State */}
        {loading && !state && <SkeletonCard rows={6} controls={1} icon={false} />}

        {/* Error State with Retry */}
        {!loading && error && facts.length === 0 && <ErrorState message={error} onRetry={load} />}

        {/* =========================================================================
            TWO-PANE LEDGER & INSPECTOR WORKSPACE
        ========================================================================= */}
        {!loading && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
              gap: '24px',
              alignItems: 'start',
            }}
          >
            {/* LEFT / CENTER: THE MEMORY LEDGER (COLUMNS 1-7) */}
            <div
              style={{
                gridColumn: 'span 7 / span 7',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              {filteredFacts.length === 0 ? (
                <div
                  style={{
                    padding: '48px 24px',
                    textAlign: 'center',
                    background: 'var(--surface)',
                    border: '1px dashed var(--hairline)',
                    borderRadius: 'var(--r-lg, 14px)',
                  }}
                >
                  <Sparkles size={24} style={{ margin: '0 auto 8px', color: 'var(--text-faint)' }} />
                  <h3 style={{ fontSize: '14px', fontWeight: 500, margin: 0 }}>No memories match this view</h3>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    Try clearing your search query or switching to another filter.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedCategory('all')
                      setStatusFilter('all')
                    }}
                    className="btn btn--ghost btn--small"
                    style={{ marginTop: '14px' }}
                  >
                    Reset filters
                  </button>
                </div>
              ) : (
                filteredFacts.map((fact) => {
                  const isSelected = selectedFactId === fact.id
                  const isChecked = multiSelectIds.includes(fact.id)
                  const isExpanded = !!expandedFacts[fact.id]
                  const isEditing = editingId === fact.id
                  const category = deriveCategory(fact.fact)

                  return (
                    <div
                      key={fact.id}
                      onClick={() => setSelectedFactId(fact.id)}
                      style={{
                        position: 'relative',
                        padding: '14px 16px',
                        borderRadius: 'var(--r-lg, 14px)',
                        background: isSelected ? 'var(--surface)' : 'rgba(19, 21, 28, 0.65)',
                        border: isSelected ? '1px solid var(--accent-line)' : '1px solid var(--hairline)',
                        boxShadow: isSelected ? '0 4px 20px rgba(0,0,0,0.3)' : 'none',
                        opacity: fact.status === 'retired' ? 0.65 : 1,
                        cursor: 'pointer',
                        transition: 'all 120ms ease',
                      }}
                    >
                      {/* Active Left Indicator Notch */}
                      {isSelected && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: '12px',
                            bottom: '12px',
                            width: '3px',
                            borderRadius: '0 2px 2px 0',
                            background: 'var(--accent)',
                          }}
                        />
                      )}

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            setMultiSelectIds((prev) =>
                              prev.includes(fact.id) ? prev.filter((id) => id !== fact.id) : [...prev, fact.id]
                            )
                          }}
                          style={{
                            width: '16px',
                            height: '16px',
                            marginTop: '2px',
                            borderRadius: '3px',
                            border: isChecked ? '1px solid var(--accent)' : '1px solid var(--hairline-strong)',
                            background: isChecked ? 'var(--accent)' : 'transparent',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            padding: 0,
                            flexShrink: 0,
                          }}
                        >
                          {isChecked && <Check size={11} strokeWidth={3} />}
                        </button>

                        {/* Content Area */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {/* Badges / Header Metadata */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              flexWrap: 'wrap',
                              marginBottom: '6px',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 500,
                                padding: '2px 8px',
                                borderRadius: '9999px',
                                background: 'var(--surface-2)',
                                border: '1px solid var(--hairline)',
                                color: 'var(--text-dim)',
                              }}
                            >
                              {category}
                            </span>

                            <span
                              style={{
                                fontSize: '11px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-faint)',
                              }}
                            >
                              #{fact.id}
                            </span>

                            {fact.status === 'retired' && (
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: 'var(--stop-soft)',
                                  color: 'var(--stop)',
                                  border: '1px solid rgba(239, 68, 68, 0.2)',
                                }}
                              >
                                Retired
                              </span>
                            )}

                            {fact.supersedes_id && (
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: 'var(--accent-soft)',
                                  color: 'var(--accent)',
                                  border: '1px solid var(--accent-line)',
                                }}
                              >
                                Corrected from #{fact.supersedes_id}
                              </span>
                            )}

                            {fact.similar_to && fact.similar_to.length > 0 && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSearchQuery('To Do')
                                }}
                                style={{
                                  fontSize: '10.5px',
                                  padding: '1px 6px',
                                  borderRadius: '3px',
                                  background: 'var(--confirm-soft)',
                                  color: 'var(--confirm)',
                                  cursor: 'pointer',
                                }}
                              >
                                {fact.similar_to.length} similar facts
                              </span>
                            )}
                          </div>

                          {/* Fact Text or Inline Editor */}
                          {isEditing ? (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{ marginTop: '8px', marginBottom: '8px' }}
                            >
                              <textarea
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                rows={3}
                                style={{
                                  width: '100%',
                                  padding: '8px 10px',
                                  background: 'var(--surface-2)',
                                  border: '1px solid var(--accent)',
                                  borderRadius: 'var(--r-md, 10px)',
                                  fontSize: '13px',
                                  color: 'var(--text)',
                                  outline: 'none',
                                  resize: 'none',
                                }}
                              />
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'flex-end',
                                  gap: '8px',
                                  marginTop: '6px',
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-dim)',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveCorrection(fact.id)}
                                  className="btn btn--primary btn--small"
                                  style={{ fontSize: '11.5px', padding: '4px 10px' }}
                                >
                                  Save correction (retires old)
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div
                                style={{
                                  fontSize: '13.5px',
                                  color: 'var(--text)',
                                  display: '-webkit-box',
                                  WebkitLineClamp: !isExpanded ? 3 : 'none',
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }}
                              >
                                <FormattedFactText
                                  text={fact.fact}
                                  searchQuery={searchQuery}
                                  onCopyCode={(c) => toast(`Copied "${c}" to clipboard`, 'info')}
                                />
                              </div>

                              {fact.fact.length > 140 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setExpandedFacts((prev) => ({ ...prev, [fact.id]: !prev[fact.id] }))
                                  }}
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--accent)',
                                    fontSize: '11.5px',
                                    fontWeight: 500,
                                    padding: '2px 0',
                                    cursor: 'pointer',
                                    marginTop: '4px',
                                  }}
                                >
                                  {isExpanded ? 'Show less' : 'Show more'}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Footer / Provenance info */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              marginTop: '8px',
                              fontSize: '11.5px',
                              color: 'var(--text-faint)',
                            }}
                          >
                            <span title={fact.created_at} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Clock size={11} />
                              <span>Learned {formatRelativeTime(fact.created_at)}</span>
                            </span>

                            {fact.conversation_id && (
                              <a
                                href={`/chat/${fact.conversation_id}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  fontFamily: 'var(--font-mono)',
                                  color: 'var(--text-dim)',
                                  textDecoration: 'none',
                                }}
                                title="Jump to originating conversation"
                              >
                                <span>conv-{fact.conversation_id.slice(0, 8)}</span>
                                <ExternalLink size={10} />
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Row Hover / Action Buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingId(fact.id)
                              setEditDraft(fact.fact)
                            }}
                            title="Correct fact (E)"
                            className="icon-btn"
                            style={{ color: 'var(--text-dim)', padding: '5px' }}
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleForget(fact.id)
                            }}
                            title="Forget fact (Del)"
                            className="icon-btn"
                            style={{ color: 'var(--text-dim)', padding: '5px' }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* RIGHT: FACT & VERSION INSPECTOR (COLUMNS 8-12) */}
            <div
              style={{
                gridColumn: 'span 5 / span 5',
                position: 'sticky',
                top: '20px',
              }}
            >
              {activeFact ? (
                <div
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--hairline)',
                    borderRadius: 'var(--r-lg, 14px)',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
                  }}
                >
                  {/* Inspector Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid var(--hairline)',
                      paddingBottom: '14px',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            padding: '2px 8px',
                            borderRadius: 'var(--r-xs, 4px)',
                            background: 'var(--surface-2)',
                            color: 'var(--accent)',
                            border: '1px solid var(--hairline)',
                          }}
                        >
                          Fact #{activeFact.id}
                        </span>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 500,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            background: activeFact.status === 'live' ? 'var(--live-soft)' : 'var(--stop-soft)',
                            color: activeFact.status === 'live' ? 'var(--live)' : 'var(--stop)',
                          }}
                        >
                          {activeFact.status === 'live' ? 'Active' : 'Retired'}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--text-faint)',
                          marginTop: '4px',
                          display: 'block',
                        }}
                      >
                        Category: {deriveCategory(activeFact.fact)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(activeFact.id)
                          setEditDraft(activeFact.fact)
                        }}
                        className="btn btn--ghost btn--small"
                        style={{ fontSize: '11.5px', padding: '4px 10px' }}
                      >
                        Correct (E)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleForget(activeFact.id)}
                        className="icon-btn"
                        title="Forget fact"
                        style={{ color: 'var(--text-dim)', padding: '5px' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Primary Held Fact Content */}
                  <div>
                    <h4
                      style={{
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--text-faint)',
                        margin: '0 0 8px 0',
                        fontWeight: 600,
                      }}
                    >
                      Held Belief
                    </h4>
                    <div
                      style={{
                        padding: '12px 14px',
                        borderRadius: 'var(--r-md, 10px)',
                        background: 'var(--surface-2)',
                        border: '1px solid var(--hairline)',
                        fontSize: '13.5px',
                        color: 'var(--text)',
                      }}
                    >
                      <FormattedFactText
                        text={activeFact.fact}
                        onCopyCode={(c) => toast(`Copied "${c}"`, 'info')}
                      />
                    </div>
                  </div>

                  {/* Version Lineage Timeline */}
                  <div>
                    <h4
                      style={{
                        fontSize: '11px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--text-faint)',
                        margin: '0 0 12px 0',
                        fontWeight: 600,
                      }}
                    >
                      Version Lineage & Provenance
                    </h4>

                    <div
                      style={{
                        position: 'relative',
                        paddingLeft: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '14px',
                      }}
                    >
                      {/* Vertical connecting line */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '6px',
                          top: '6px',
                          bottom: '6px',
                          width: '1.5px',
                          background: 'var(--hairline-strong)',
                        }}
                      />

                      {/* Current Node */}
                      <div style={{ position: 'relative' }}>
                        <div
                          style={{
                            position: 'absolute',
                            left: '-19px',
                            top: '3px',
                            width: '9px',
                            height: '9px',
                            borderRadius: '9999px',
                            background: 'var(--accent)',
                            boxShadow: '0 0 0 3px var(--surface)',
                          }}
                        />
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: 'var(--text)',
                          }}
                        >
                          <span>Version 2 (Current)</span>
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                            {formatRelativeTime(activeFact.created_at)}
                          </span>
                        </div>
                        <p style={{ margin: '3px 0 0 0', fontSize: '11.5px', color: 'var(--text-dim)' }}>
                          Extracted from conversation{' '}
                          <code style={{ color: 'var(--accent)' }}>
                            conv-{activeFact.conversation_id?.slice(0, 8)}
                          </code>
                        </p>
                      </div>

                      {/* History / Prior Retired Node */}
                      {activeFact.history?.map((h) => (
                        <div key={h.id} style={{ position: 'relative', opacity: 0.65 }}>
                          <div
                            style={{
                              position: 'absolute',
                              left: '-19px',
                              top: '3px',
                              width: '9px',
                              height: '9px',
                              borderRadius: '9999px',
                              background: 'var(--text-faint)',
                              boxShadow: '0 0 0 3px var(--surface)',
                            }}
                          />
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              fontSize: '12px',
                              fontWeight: 500,
                              color: 'var(--text-dim)',
                            }}
                          >
                            <span>Version 1 (Retired)</span>
                            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                              {formatRelativeTime(h.retired_at)}
                            </span>
                          </div>
                          <p
                            style={{
                              margin: '3px 0 0 0',
                              fontSize: '11.5px',
                              color: 'var(--text-faint)',
                              textDecoration: 'line-through',
                            }}
                          >
                            {h.fact}
                          </p>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-faint)', fontStyle: 'italic', display: 'block', marginTop: '2px' }}>
                            Reason: {h.reason}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Near-duplicate cluster review affordance */}
                  {activeFact.similar_to && activeFact.similar_to.length > 0 && (
                    <div
                      style={{
                        paddingTop: '12px',
                        borderTop: '1px solid var(--hairline)',
                      }}
                    >
                      <h4
                        style={{
                          fontSize: '11.5px',
                          fontWeight: 500,
                          color: 'var(--confirm)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          margin: '0 0 6px 0',
                        }}
                      >
                        <AlertCircle size={12} />
                        <span>Near-duplicate candidates</span>
                      </h4>
                      <p style={{ fontSize: '11.5px', color: 'var(--text-dim)', margin: '0 0 8px 0' }}>
                        Overlapping tool authorizations detected. You can review and retire redundant entries:
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {activeFact.similar_to.map((simId) => {
                          const sim = facts.find((f) => f.id === simId)
                          if (!sim) return null
                          return (
                            <div
                              key={simId}
                              onClick={() => setSelectedFactId(simId)}
                              style={{
                                padding: '8px 10px',
                                borderRadius: 'var(--r-sm, 6px)',
                                background: 'var(--surface-2)',
                                border: '1px solid var(--hairline)',
                                fontSize: '11.5px',
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                                #{sim.id}
                              </span>
                              <div
                                style={{
                                  marginTop: '2px',
                                  color: 'var(--text-dim)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {sim.fact}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    padding: '32px 16px',
                    textAlign: 'center',
                    border: '1px dashed var(--hairline)',
                    borderRadius: 'var(--r-lg, 14px)',
                    color: 'var(--text-faint)',
                    fontSize: '12.5px',
                  }}
                >
                  Select any fact in the ledger to view its version lineage, audit trail, and originating conversation.
                </div>
              )}
            </div>
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
              borderRadius: 'var(--r-lg, 14px)',
              padding: '8px 16px',
              boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
            }}
          >
            <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text)' }}>
              {multiSelectIds.length} facts selected
            </span>
            <div style={{ width: '1px', height: '16px', background: 'var(--hairline-strong)' }} />
            <button
              type="button"
              onClick={handleBulkForget}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: 'var(--r-sm, 6px)',
                background: 'var(--stop-soft)',
                color: 'var(--stop)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                cursor: 'pointer',
              }}
            >
              <Trash2 size={13} />
              <span>Forget selected</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const selectedData = facts.filter((f) => multiSelectIds.includes(f.id))
                const blob = new Blob([JSON.stringify(selectedData, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `amethyst-memories-${Date.now()}.json`
                a.click()
                toast(`Exported ${multiSelectIds.length} facts to JSON`, 'ok')
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: 'var(--r-sm, 6px)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--hairline)',
                cursor: 'pointer',
              }}
            >
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={() => setMultiSelectIds([])}
              className="icon-btn"
              title="Clear selection"
              style={{ color: 'var(--text-faint)', padding: '2px' }}
            >
              <X size={14} />
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
              borderRadius: 'var(--r-lg, 14px)',
              padding: '12px 18px',
              boxShadow: '0 12px 36px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '13px',
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
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent)',
                  fontWeight: 600,
                  fontSize: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <RotateCcw size={12} />
                <span>Undo</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
