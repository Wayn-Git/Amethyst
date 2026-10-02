import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import BrandMark from './BrandMark.jsx'
import { useApp } from '../store.jsx'
import { MOD_LABEL } from '../keys.js'
import { forRail } from '../nav.js'
import { prefetchView } from '../views/registry.js'
import { api, fmtDate, serverTime } from '../api.js'
import { useConfirm } from './ui/ConfirmDialog.jsx'
import { useDismiss } from '../hooks/useDismiss.js'
import { SmoothInput } from './ui/skiper/index.js'
import { AnimatePresence, motion } from 'framer-motion'
import UserMenu from './UserMenu.jsx'
import { safeStorage } from '../lib/storage.js'
import opencode from '../lib/opencode.js'

function parseSessionTime(val) {
  if (!val) return null
  if (typeof val === 'number' || (!Number.isNaN(Number(val)) && !String(val).includes('-'))) {
    const n = Number(val)
    return new Date(n > 1e11 ? n : n * 1000)
  }
  return serverTime(val) || new Date(val)
}

function bucketOf(iso) {
  if (!iso) return 'Earlier'
  const then = parseSessionTime(iso)
  if (!then || Number.isNaN(then.getTime())) return 'Earlier'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const thenDay = new Date(then.getFullYear(), then.getMonth(), then.getDate())
  const days = Math.floor((startOfToday - thenDay) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Previous 7 days'
  if (days < 30) return 'Previous 30 days'
  return 'Earlier'
}

function formatSessionDate(val) {
  const d = parseSessionTime(val)
  if (!d || Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}


function ConvItem({ conv, active, onOpen, onRename, onDelete, onTogglePin }) {
  const [menu, setMenu] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef(null)
  const confirm = useConfirm()

  useDismiss(ref, menu, { onAway: () => setMenu(false) })

  const openMenu = useCallback(() => {
    const row = ref.current?.getBoundingClientRect()
    const rail = ref.current?.closest('.wb-sidebar')?.getBoundingClientRect()
    if (row && rail) setUp(rail.bottom - row.bottom < 132)
    setMenu((m) => !m)
  }, [])

  return (
    <div className={`sb-conv-item${active ? ' is-active' : ''}${menu ? ' menu-open' : ''}`} ref={ref}>
      <button
        type="button"
        className={`sb-conv-btn${conv.pinned ? ' has-pinned-icon' : ''}`}
        onClick={onOpen}
        onDoubleClick={onRename}
        title={`${conv.title || 'untitled'} (${fmtDate(conv.updated_at || conv.created_at)})`}
      >
        {Boolean(conv.pinned) && (
          <span className="sb-conv-icon--pinned">
            <Icon name="star" size={12} filled={true} />
          </span>
        )}
        <span className="sb-conv-title">{conv.title || 'untitled'}</span>
      </button>

      <div className="sb-conv-actions">
        <button
          type="button"
          className="sb-conv-more-btn"
          onClick={(e) => {
            e.stopPropagation()
            openMenu()
          }}
          title="Conversation options"
          aria-label="Conversation options"
          aria-expanded={menu}
        >
          <Icon name="dots" size={14} />
        </button>
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: up ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: up ? 4 : -4 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={`sb-conv-menu${up ? ' is-up' : ''}`}
            role="menu"
          >
            {onTogglePin && (
              <button
                type="button"
                onClick={() => {
                  setMenu(false)
                  onTogglePin(conv)
                }}
              >
                <Icon name="star" size={12} filled={Boolean(conv.pinned)} /> {conv.pinned ? 'Unpin' : 'Pin to Starred'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenu(false)
                onRename()
              }}
            >
              <Icon name="edit" size={12} /> Rename
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                setMenu(false)
                const ok = await confirm({
                  title: `Delete "${conv.title || 'untitled'}"?`,
                  description: 'This conversation and its messages will be permanently removed.',
                  confirmLabel: 'Delete',
                  tone: 'danger',
                })
                if (ok) onDelete()
              }}
            >
              <Icon name="trash" size={12} /> Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CodeSessionItem({ session, active, onOpen, onRename, onDelete }) {
  const [menu, setMenu] = useState(false)
  const [up, setUp] = useState(false)
  const ref = useRef(null)
  const confirm = useConfirm()

  useDismiss(ref, menu, { onAway: () => setMenu(false) })

  const openMenu = useCallback(() => {
    const row = ref.current?.getBoundingClientRect()
    const rail = ref.current?.closest('.wb-sidebar')?.getBoundingClientRect()
    if (row && rail) setUp(rail.bottom - row.bottom < 132)
    setMenu((m) => !m)
  }, [])

  const agentLabel = session.agent || 'build'
  const timeFormatted = formatSessionDate(session.time?.updated || session.time?.created)
  const title = session.title || session.slug || 'Untitled session'

  return (
    <div className={`sb-conv-item sb-code-session-item${active ? ' is-active' : ''}${menu ? ' menu-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="sb-conv-btn"
        onClick={onOpen}
        onDoubleClick={onRename}
        title={`${title} (${timeFormatted})`}
      >
        <span className="sb-code-session-icon">
          <Icon name="code" size={13} />
        </span>
        <span className="sb-conv-title">{title}</span>
        {agentLabel && agentLabel !== 'build' && (
          <span className="sb-code-agent-badge">{agentLabel}</span>
        )}
      </button>

      <div className="sb-conv-actions">
        <button
          type="button"
          className="sb-conv-more-btn"
          onClick={(e) => {
            e.stopPropagation()
            openMenu()
          }}
          title="Session options"
          aria-label="Session options"
          aria-expanded={menu}
        >
          <Icon name="dots" size={14} />
        </button>
      </div>

      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: up ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: up ? 4 : -4 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className={`sb-conv-menu${up ? ' is-up' : ''}`}
            role="menu"
          >
            <button
              type="button"
              onClick={() => {
                setMenu(false)
                onRename()
              }}
            >
              <Icon name="edit" size={12} /> Rename
            </button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                setMenu(false)
                const ok = await confirm({
                  title: `Delete "${title}"?`,
                  description: 'This code session will be permanently deleted from OpenCode.',
                  confirmLabel: 'Delete',
                  tone: 'danger',
                })
                if (ok) onDelete()
              }}
            >
              <Icon name="trash" size={12} /> Delete
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Sidebar() {
  const {
    view, setView, setOverlay, health, healthError,
    compact, railOpen, toggleRail, closeRail,
    sidebar, setSidebar,
    conversations, activeId, chat,
    renaming, setRenaming, renameConversation, deleteConversation,
    theme, setTheme, betaPages, refreshConvs, toast,
    userProfile, updateUserProfile,
    workspace, setWorkspace,
    sidebarMode, setSidebarMode,
    codeActiveSessionId, setCodeActiveSessionId,
    codeActiveProjectId, setCodeActiveProjectId,
    openCodeSession,
    opencode: opencodeCtx,
  } = useApp()

  const [filter, setFilter] = useState('')
  const [showSearchInput, setShowSearchInput] = useState(false)

  // Live OpenCode State
  const [codeProjects, setCodeProjects] = useState([])
  const [codeSessions, setCodeSessions] = useState([])
  const [codeSkills, setCodeSkills] = useState([])
  const [codeSkillsOpen, setCodeSkillsOpen] = useState(false)
  const [codeContextOpen, setCodeContextOpen] = useState(true)
  const [codeRenamingId, setCodeRenamingId] = useState(null)
  const [codeLoading, setCodeLoading] = useState(false)

  const loadCodeData = useCallback(async () => {
    try {
      setCodeLoading(true)
      const [projList, sesList, skillsList] = await Promise.all([
        opencode.listProjects().catch(() => []),
        opencode.listSessions().catch(() => []),
        opencode.listSkills().catch(() => []),
      ])
      setCodeProjects(Array.isArray(projList) ? projList : [])
      setCodeSessions(Array.isArray(sesList) ? sesList : [])
      setCodeSkills(Array.isArray(skillsList) ? skillsList : [])
    } catch (e) {
      console.warn('[Sidebar] Failed to load OpenCode data:', e)
    } finally {
      setCodeLoading(false)
    }
  }, [])

  useEffect(() => {
    if (sidebarMode !== 'code') return
    loadCodeData()
    const handleFocus = () => loadCodeData()
    window.addEventListener('focus', handleFocus)
    const interval = setInterval(loadCodeData, 3500)
    return () => {
      window.removeEventListener('focus', handleFocus)
      clearInterval(interval)
    }
  }, [sidebarMode, loadCodeData])

  // Filter root sessions scoped to active workspace, excluding child subagents
  const rootSessions = useMemo(() => {
    let list = codeSessions.filter((s) => !s.parentID)
    if (workspace) {
      const normWorkspace = workspace.replace(/\/+$/, '').toLowerCase()
      list = list.filter((s) => {
        if (!s.directory) return true
        return s.directory.replace(/\/+$/, '').toLowerCase() === normWorkspace
      })
    }
    if (!filter.trim()) return list
    const q = filter.trim().toLowerCase()
    return list.filter((s) => (s.title || s.slug || '').toLowerCase().includes(q))
  }, [codeSessions, workspace, filter])

  // Group root sessions into temporal buckets (Today, Yesterday, Previous 7 days, Earlier)
  const sessionBuckets = useMemo(() => {
    if (filter.trim()) {
      return [{ label: '', items: rootSessions }]
    }
    const order = ['Today', 'Yesterday', 'Previous 7 days', 'Earlier']
    const map = new Map(order.map((b) => [b, []]))

    for (const s of rootSessions) {
      const b = bucketOf(s.time?.updated || s.time?.created)
      if (map.has(b)) map.get(b).push(s)
      else map.get('Earlier').push(s)
    }

    return order
      .map((label) => ({ label, items: map.get(label) }))
      .filter((b) => b.items.length > 0)
  }, [rootSessions, filter])

  // Active project scoped to active workspace (no more foreign khoj project)
  const activeProject = useMemo(() => {
    if (workspace) {
      const norm = workspace.replace(/\/+$/, '').toLowerCase()
      const match = codeProjects.find((p) => (p.worktree || '').replace(/\/+$/, '').toLowerCase() === norm)
      if (match) return match
      return { id: 'workspace', worktree: workspace }
    }
    if (codeActiveProjectId) {
      return codeProjects.find((p) => p.id === codeActiveProjectId) || null
    }
    return codeProjects[0] || null
  }, [codeProjects, codeActiveProjectId, workspace])

  const handleNewCodeSession = useCallback(async () => {
    try {
      const dir = activeProject?.worktree || workspace || ''
      const res = await opencode.createSession({ directory: dir })
      if (res?.id) {
        openCodeSession(res.id, res.directory || dir)
        await loadCodeData()
        toast('New code session started', 'good')
      }
    } catch (e) {
      toast(e.message || 'Failed to create session', 'bad')
    }
  }, [activeProject, workspace, openCodeSession, loadCodeData, toast])

  const renameCodeSession = useCallback(async (sessionId, newTitle) => {
    setCodeRenamingId(null)
    const title = (newTitle || '').trim()
    if (!title) return
    try {
      await opencode.updateSession(sessionId, { title })
      setCodeSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title } : s))
      )
      toast('Session renamed', 'good')
    } catch (e) {
      toast(e.message || 'Failed to rename session', 'bad')
    }
  }, [toast])

  const deleteCodeSession = useCallback(async (sessionId) => {
    try {
      await opencode.deleteSession(sessionId)
      setCodeSessions((prev) => prev.filter((s) => s.id !== sessionId))
      if (codeActiveSessionId === sessionId) {
        setCodeActiveSessionId(null)
      }
      toast('Session deleted', 'good')
    } catch (e) {
      toast(e.message || 'Failed to delete session', 'bad')
    }
  }, [codeActiveSessionId, setCodeActiveSessionId, toast])

  const toggleSidebar = toggleRail

  const handleSwitchMode = useCallback((mode) => {
    setSidebarMode(mode)
    if (mode === 'code' && view !== 'code') {
      setView('code')
    } else if (mode === 'work' && view === 'code') {
      setView('chat')
    }
  }, [setSidebarMode, view, setView])

  // Keep sidebarMode and view in sync bidirectionally
  useEffect(() => {
    if (view === 'code' && sidebarMode !== 'code') {
      setSidebarMode('code')
    } else if (view !== 'code' && sidebarMode === 'code') {
      setSidebarMode('work')
    }
  }, [view, sidebarMode, setSidebarMode])

  // Real navigation places
  const places = useMemo(() => forRail(betaPages), [betaPages])

  const isCollapsed = compact ? !railOpen : !sidebar

  const handleToggle = useCallback(() => {
    toggleRail()
  }, [toggleRail])

  const leave = useCallback((act) => () => {
    act?.()
    if (compact) closeRail()
  }, [compact, closeRail])

  // Pinning conversations
  const togglePin = useCallback(async (conv) => {
    try {
      await api.pinConversation(conv.id, !conv.pinned)
      await refreshConvs()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }, [refreshConvs, toast])

  // Split into Starred and Recents
  const { starred, recents } = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matches = q
      ? conversations.filter((c) => (c.title || 'untitled').toLowerCase().includes(q))
      : conversations

    const starList = matches.filter((c) => c.pinned)
    const recentList = matches.filter((c) => !c.pinned)

    return { starred: starList, recents: recentList }
  }, [conversations, filter])

  // Group recents into temporal buckets (Today, Yesterday, Previous 7 days, etc.)
  const recentBuckets = useMemo(() => {
    if (filter.trim()) {
      return [{ label: '', items: recents }]
    }
    const order = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Earlier']
    const map = new Map(order.map((b) => [b, []]))

    for (const c of recents) {
      const b = bucketOf(c.updated_at || c.created_at)
      if (map.has(b)) map.get(b).push(c)
      else map.get('Earlier').push(c)
    }

    return order
      .map((label) => ({ label, items: map.get(label) }))
      .filter((b) => b.items.length > 0)
  }, [recents, filter])

  // Display user information
  const displayName = userProfile?.full_name || userProfile?.name || 'Wayne'
  const userInitials = useMemo(() => {
    const raw = (userProfile?.name || displayName || 'Wayne').trim()
    const parts = raw.split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    if (raw.length >= 2) {
      return raw.slice(0, 2).toUpperCase()
    }
    return 'WA'
  }, [userProfile, displayName])

  // Active workspace name for subtitle
  const workspaceName = useMemo(() => {
    if (!workspace) return 'Default Workspace'
    const parts = workspace.split('/').filter(Boolean)
    return parts[parts.length - 1] || 'Default Workspace'
  }, [workspace])

  // Separate primary navigation places and grouped utility places (Tasks, Email, File Converter)
  const { topPlaces, utilityPlaces, bottomPlaces } = useMemo(() => {
    const utils = places.filter((p) => p.group === 'utilities')
    const others = places.filter((p) => p.id !== 'chat' && p.id !== 'code' && p.group !== 'utilities')
    const top = others.filter((p) => p.id === 'today')
    const bottom = others.filter((p) => p.id !== 'today')
    return { topPlaces: top, utilityPlaces: utils, bottomPlaces: bottom }
  }, [places])

  const isUtilityActive = useMemo(() => {
    return utilityPlaces.some((p) => p.id === view)
  }, [utilityPlaces, view])

  const [utilitiesOpen, setUtilitiesOpen] = useState(() => {
    return isUtilityActive || safeStorage.getItem('sb_utilities_open') !== 'false'
  })

  useEffect(() => {
    if (isUtilityActive) {
      setUtilitiesOpen(true)
    }
  }, [isUtilityActive])

  const toggleUtilities = useCallback(() => {
    setUtilitiesOpen((open) => {
      const next = !open
      safeStorage.setItem('sb_utilities_open', String(next))
      return next
    })
  }, [])

  const [miniUtilsOpen, setMiniUtilsOpen] = useState(false)
  const miniUtilsRef = useRef(null)
  useDismiss(miniUtilsRef, miniUtilsOpen, { onAway: () => setMiniUtilsOpen(false) })

  const status = healthError
    ? 'API offline'
    : health ? `${health.tools} tools · ${health.skills} skills` : 'connecting…'

  const showExpandedView = !isCollapsed

  return (
    <aside
      id="rail"
      className={`wb-sidebar${compact && !railOpen ? ' is-hidden' : ''}${isCollapsed ? ' is-collapsed' : ' is-expanded'}`}
      aria-label="Main Navigation"
      aria-hidden={compact && !railOpen ? 'true' : undefined}
    >
      {!showExpandedView ? (
        /* ===================================================================
           1. COLLAPSED MINI RAIL (54px) — Icon Rail
           =================================================================== */
        <div
          className="sb-mini-rail"
          onClick={(e) => {
            // Expand sidebar if clicking anywhere on the mini-rail outside of interactive buttons
            if (!e.target.closest('button, a, input, [role="button"]')) {
              handleToggle()
            }
          }}
          title="Click to expand sidebar"
        >
          {/* Top Actions: App Icon (reveals Sidebar Expand on hover) + Mode Switch + New Chat/Session + Search */}
          <div className="sb-mini-top">
            <button
              type="button"
              className="sb-mini-brand-toggle-btn"
              onClick={(e) => {
                e.stopPropagation()
                handleToggle()
              }}
              title={`Expand sidebar — ${MOD_LABEL}+B`}
              aria-label="Expand sidebar"
            >
              <span className="sb-mini-brand-icon">
                <BrandMark size={26} glow />
              </span>
              <span className="sb-mini-toggle-icon">
                <Icon name="sidebar" size={19} />
              </span>
            </button>

            {/* Mini Mode Switcher (Work / Code) */}
            <div className="sb-mini-mode-switch">
              <button
                type="button"
                className={`sb-mini-mode-btn${sidebarMode === 'work' ? ' is-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSwitchMode('work')
                }}
                title="Work Mode (Amethyst Assistant & Tools)"
                aria-label="Work Mode"
              >
                <Icon name="chat" size={16} />
              </button>
              <button
                type="button"
                className={`sb-mini-mode-btn${sidebarMode === 'code' ? ' is-active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSwitchMode('code')
                }}
                title="Code Mode (OpenCode Engine)"
                aria-label="Code Mode"
              >
                <Icon name="code" size={16} />
              </button>
            </div>

            <button
              type="button"
              className="sb-mini-plus-btn"
              onClick={(e) => {
                e.stopPropagation()
                if (sidebarMode === 'code') {
                  handleNewCodeSession()
                } else {
                  leave(() => {
                    setView('chat')
                    chat.startFresh?.()
                  })()
                }
              }}
              title={sidebarMode === 'code' ? 'New OpenCode session' : `New chat — ${MOD_LABEL}+Shift+O`}
              aria-label={sidebarMode === 'code' ? 'New OpenCode session' : 'New chat'}
            >
              <Icon name="plus" size={18} weight="bold" />
            </button>

            <button
              type="button"
              className="sb-mini-btn"
              onClick={(e) => {
                e.stopPropagation()
                setSidebar(true)
                setShowSearchInput(true)
              }}
              title={sidebarMode === 'code' ? 'Search sessions' : `Search conversations — ${MOD_LABEL}+K`}
              aria-label="Search"
            >
              <Icon name="search" size={20} />
            </button>
          </div>

          {/* Middle Nav Items: Real Places (Work Mode) or Sessions (Code Mode) */}
          <div className="sb-mini-nav" aria-label="Main Navigation">
            {sidebarMode === 'code' ? (
              rootSessions.slice(0, 8).map((s) => {
                const isActive = codeActiveSessionId === s.id && view === 'code'
                const title = s.title || s.slug || 'Session'
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`sb-mini-btn${isActive ? ' is-active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      leave(() => {
                        if (view !== 'code') setView('code')
                        openCodeSession(s.id, s.directory || activeProject?.worktree)
                      })()
                    }}
                    title={title}
                    aria-label={title}
                  >
                    <Icon name="code" size={18} />
                  </button>
                )
              })
            ) : (
              <>
                {topPlaces.map((place) => {
                  const isActive = view === place.id
                  return (
                    <button
                      key={place.id}
                      type="button"
                      className={`sb-mini-btn${isActive ? ' is-active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        leave(() => setView(place.id))()
                      }}
                      onPointerEnter={() => prefetchView(place.id)}
                      title={`${place.label} — ${MOD_LABEL}+${place.digit || ''}`}
                      aria-label={place.label}
                    >
                      <Icon name={place.icon} size={20} />
                    </button>
                  )
                })}

                {/* Collapsed Utilities Icon with Flyout */}
                <div ref={miniUtilsRef} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    className={`sb-mini-btn${isUtilityActive ? ' is-active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setMiniUtilsOpen((o) => !o)
                    }}
                    title="Utilities (Tasks, Email, File Converter)"
                    aria-label="Utilities"
                    aria-expanded={miniUtilsOpen}
                  >
                    <Icon name="wrench" size={20} />
                  </button>

                  <AnimatePresence>
                    {miniUtilsOpen && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.94, x: 6 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.94, x: 6 }}
                        transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                        className="sb-mini-flyout"
                      >
                        <div className="sb-mini-flyout-title">Utilities</div>
                        {utilityPlaces.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            className={`sb-mini-flyout-item${view === u.id ? ' is-active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setMiniUtilsOpen(false)
                              leave(() => setView(u.id))()
                            }}
                          >
                            <span className="sb-mini-flyout-icon"><Icon name={u.icon} size={16} /></span>
                            <span className="sb-mini-flyout-label">{u.label}</span>
                            {u.digit && <span className="sb-mini-flyout-shortcut">{MOD_LABEL}+{u.digit}</span>}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {bottomPlaces.map((place) => {
                  const isActive = view === place.id
                  return (
                    <button
                      key={place.id}
                      type="button"
                      className={`sb-mini-btn${isActive ? ' is-active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        leave(() => setView(place.id))()
                      }}
                      onPointerEnter={() => prefetchView(place.id)}
                      title={`${place.label} — ${MOD_LABEL}+${place.digit || ''}`}
                      aria-label={place.label}
                    >
                      <Icon name={place.icon} size={20} />
                    </button>
                  )
                })}
              </>
            )}
          </div>

          {/* Spacious middle rail area — hover shows expand hint, click anywhere opens sidebar */}
          <div
            className="sb-mini-body"
            onClick={(e) => {
              e.stopPropagation()
              handleToggle()
            }}
            title={`Open sidebar — ${MOD_LABEL}+B`}
            aria-label="Open sidebar"
          >
            <div className="sb-mini-grab-line" aria-hidden="true" />
          </div>

          {/* Bottom Actions: User Profile Initials Square */}
          <div className="sb-mini-bottom">
            <span className="wb-foot-sub" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}>{status}</span>

            <UserMenu align="start" side="right" sideOffset={12}>
              <button
                type="button"
                className="sb-mini-avatar-square"
                title={`User menu for ${displayName}`}
                aria-label={`User menu for ${displayName}`}
              >
                {userInitials}
              </button>
            </UserMenu>
          </div>
        </div>
      ) : (
        /* ===================================================================
           2. EXPANDED MODERN SIDEBAR (260px) — Vibecoded
           =================================================================== */
        <div className="sb-expanded-container">
          {/* Top Header: Authentic Amethyst Logo + Workspace Selector + Search + Collapse */}
          <div className="sb-header">
            <div className="sb-header-top-row">
              <UserMenu align="start" side="bottom" sideOffset={8}>
                <button
                  type="button"
                  className="sb-workspace-selector wb-brand"
                  title="Workspace settings & user menu"
                >
                  <BrandMark size={24} glow />
                  <span className="sb-workspace-name">Amethyst</span>
                  <Icon name="chevron-down" size={11} className="sb-workspace-chevron" />
                </button>
              </UserMenu>

              <div className="sb-header-actions">
                <button
                  type="button"
                  className={`sb-header-icon-btn${showSearchInput ? ' is-active' : ''}`}
                  onClick={() => setShowSearchInput((s) => !s)}
                  title={`Search conversations — ${MOD_LABEL}+K`}
                  aria-label="Search conversations"
                >
                  <Icon name="search" size={18} />
                </button>

                <button
                  type="button"
                  className="sb-header-icon-btn"
                  onClick={handleToggle}
                  title={`Collapse sidebar — ${MOD_LABEL}+B`}
                  aria-label="Collapse sidebar"
                >
                  <Icon name="sidebar" size={18} />
                </button>
              </div>
            </div>

            {/* Inline Conversation Filter */}
            <AnimatePresence>
              {showSearchInput && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="sb-search-wrapper"
                >
                  <div className="sb-search-bar">
                    <Icon name="search" size={15} className="sb-search-icon" />
                    <SmoothInput
                      autoFocus
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder={sidebarMode === 'code' ? 'Search sessions…' : 'Search chats…'}
                      className="sb-search-input"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setFilter('')
                          setShowSearchInput(false)
                        }
                      }}
                    />
                    {filter && (
                      <button
                        type="button"
                        className="sb-clear-btn"
                        onClick={() => setFilter('')}
                        aria-label="Clear search"
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Work / Code Mode Switcher */}
          <div className="sb-mode-segmented-wrapper">
            <div className="sb-mode-segmented" role="tablist" aria-label="Sidebar Mode">
              <button
                type="button"
                role="tab"
                aria-selected={sidebarMode === 'work'}
                className={`sb-mode-tab${sidebarMode === 'work' ? ' is-active' : ''}`}
                onClick={() => handleSwitchMode('work')}
              >
                <Icon name="chat" size={13} />
                <span>Work</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sidebarMode === 'code'}
                className={`sb-mode-tab${sidebarMode === 'code' ? ' is-active' : ''}`}
                onClick={() => handleSwitchMode('code')}
              >
                <Icon name="code" size={13} />
                <span>Code</span>
              </button>
            </div>
          </div>

          {sidebarMode === 'code' ? (
            <>
              {/* Prominent + New Code Session Pill Button */}
              <button
                type="button"
                className="sb-new-chat-pill sb-code-new-session-pill"
                onClick={handleNewCodeSession}
                title="New OpenCode session"
                aria-label="New OpenCode session"
              >
                <div className="sb-new-chat-left">
                  <Icon name="plus" size={16} weight="bold" />
                  <span>New Session</span>
                </div>
                <span className="sb-code-counter-badge">
                  {rootSessions.length}
                </span>
              </button>

              {/* Active Workspace */}
              <div className="sb-code-projects-section">
                <div className="sb-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 14 }}>
                  <span>Active Workspace</span>
                  {codeLoading && <Icon name="refresh" size={12} className="sb-code-spinner spin" />}
                </div>

                <div className="sb-code-project-badge" title={activeProject?.worktree || workspace || 'Current workspace'}>
                  <Icon name="folder" size={14} />
                  <span className="sb-code-project-title">
                    {workspaceName}
                  </span>
                  <span className="sb-code-counter-badge">Active</span>
                </div>
              </div>

              {/* Scroll Area: Code Sessions */}
              <div className="sb-scroll-body wb-list sb-code-sessions-section">
                {rootSessions.length === 0 ? (
                  <div className="sb-empty-chats">
                    {codeLoading ? 'Loading sessions…' : filter ? 'No matching sessions' : 'No sessions yet'}
                  </div>
                ) : (
                  sessionBuckets.map((bucket) => (
                    <div key={bucket.label || 'all'} className="sb-bucket-group">
                      {bucket.label && (
                        <div className="sb-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 14 }}>
                          <span>{bucket.label}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{bucket.items.length}</span>
                        </div>
                      )}
                      {bucket.items.map((s) => (
                        codeRenamingId === s.id ? (
                          <div key={s.id} className="sb-rename-wrap">
                            <SmoothInput
                              autoFocus
                              defaultValue={s.title || s.slug || ''}
                              className="sb-rename-input"
                              onBlur={(e) => renameCodeSession(s.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  renameCodeSession(s.id, e.target.value)
                                }
                                if (e.key === 'Escape') {
                                  e.stopPropagation()
                                  setCodeRenamingId(null)
                                }
                              }}
                            />
                          </div>
                        ) : (
                          <CodeSessionItem
                            key={s.id}
                            session={s}
                            active={codeActiveSessionId === s.id}
                            onOpen={leave(() => {
                              if (view !== 'code') setView('code')
                              openCodeSession(s.id, s.directory || activeProject?.worktree || workspace)
                            })}
                            onRename={() => setCodeRenamingId(s.id)}
                            onDelete={() => deleteCodeSession(s.id)}
                          />
                        )
                      ))}
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <>

          {/* Prominent + New Chat Pill Button */}
          <button
            type="button"
            className={`sb-new-chat-pill${view === 'chat' && !activeId ? ' is-active' : ''}`}
            onClick={leave(() => {
              setView('chat')
              chat.startFresh?.()
            })}
            title={`New chat — ${MOD_LABEL}+Shift+O`}
            aria-label="New chat"
          >
            <div className="sb-new-chat-left">
              <Icon name="plus" size={16} weight="bold" />
              <span>New Chat</span>
            </div>
            <span className="sb-new-chat-shortcut">
              {MOD_LABEL}+Shift+O
            </span>
          </button>

          {/* Primary Navigation Section: Real Amethyst Views */}
          <div className="sb-nav-section" aria-label="Main Navigation">
            {/* Top item: Today */}
            {topPlaces.map((place) => {
              const isActive = view === place.id
              return (
                <button
                  key={place.id}
                  type="button"
                  className={`sb-nav-item${isActive ? ' is-active' : ''}`}
                  onClick={leave(() => setView(place.id))}
                  onPointerEnter={() => prefetchView(place.id)}
                  title={`${place.label} — ${MOD_LABEL}+${place.digit || ''}`}
                >
                  <div className="sb-nav-item-left">
                    <span className="sb-nav-item-icon">
                      <Icon name={place.icon} size={18} />
                    </span>
                    <span className="sb-nav-item-label">{place.label}</span>
                  </div>
                  {place.digit && (
                    <span className="sb-nav-item-shortcut">
                      {MOD_LABEL}+{place.digit}
                    </span>
                  )}
                </button>
              )
            })}

            {/* Expandable Utilities Group (Tasks, Email, File Converter) */}
            <div className="sb-nav-group">
              <button
                type="button"
                className={`sb-nav-item sb-nav-group-trigger${isUtilityActive ? ' has-active-child' : ''}`}
                onClick={toggleUtilities}
                aria-expanded={utilitiesOpen}
                title="Utilities (Tasks, Email, File Converter)"
              >
                <div className="sb-nav-item-left">
                  <span className="sb-nav-item-icon">
                    <Icon name="wrench" size={18} />
                  </span>
                  <span className="sb-nav-item-label">Utilities</span>
                </div>
                <div className="sb-nav-group-right">
                  {isUtilityActive && <span className="sb-nav-group-active-dot" />}
                  <span className={`sb-nav-group-chevron${utilitiesOpen ? ' is-open' : ''}`}>
                    <Icon name="chevron-down" size={13} />
                  </span>
                </div>
              </button>

              <AnimatePresence initial={false}>
                {utilitiesOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                    className="sb-nav-subitems-wrap"
                  >
                    <div className="sb-nav-subitems">
                      {utilityPlaces.map((place) => {
                        const isActive = view === place.id
                        return (
                          <button
                            key={place.id}
                            type="button"
                            className={`sb-nav-item sb-nav-subitem${isActive ? ' is-active' : ''}`}
                            onClick={leave(() => setView(place.id))}
                            onPointerEnter={() => prefetchView(place.id)}
                            title={`${place.label} — ${MOD_LABEL}+${place.digit || ''}`}
                          >
                            <div className="sb-nav-item-left">
                              <span className="sb-nav-item-icon">
                                <Icon name={place.icon} size={16} />
                              </span>
                              <span className="sb-nav-item-label">{place.label}</span>
                            </div>
                            {place.digit ? (
                              <span className="sb-nav-item-shortcut">
                                {MOD_LABEL}+{place.digit}
                              </span>
                            ) : place.beta ? (
                              <span className="sb-nav-item-beta">Beta</span>
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom items: Capabilities, Automations, Memory, Library */}
            {bottomPlaces.map((place) => {
              const isActive = view === place.id
              return (
                <button
                  key={place.id}
                  type="button"
                  className={`sb-nav-item${isActive ? ' is-active' : ''}`}
                  onClick={leave(() => setView(place.id))}
                  onPointerEnter={() => prefetchView(place.id)}
                  title={`${place.label} — ${MOD_LABEL}+${place.digit || ''}`}
                >
                  <div className="sb-nav-item-left">
                    <span className="sb-nav-item-icon">
                      <Icon name={place.icon} size={18} />
                    </span>
                    <span className="sb-nav-item-label">{place.label}</span>
                  </div>
                  {place.digit && (
                    <span className="sb-nav-item-shortcut">
                      {MOD_LABEL}+{place.digit}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Scroll Area: Starred & Time-Grouped Recent Chats */}
          <div className="sb-scroll-body wb-list">
            {/* Starred Conversations */}
            {starred.length > 0 && (
              <div className="sb-starred-group">
                <div className="sb-section-label">Starred</div>
                {starred.map((c) => (
                  renaming === c.id ? (
                    <div key={c.id} className="sb-rename-wrap">
                      <SmoothInput
                        autoFocus
                        defaultValue={c.title || ''}
                        className="sb-rename-input"
                        onBlur={(e) => renameConversation(c.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            renameConversation(c.id, e.target.value)
                          }
                          if (e.key === 'Escape') {
                            e.stopPropagation()
                            setRenaming(null)
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <ConvItem
                      key={c.id}
                      conv={c}
                      active={c.id === activeId && view === 'chat'}
                      onOpen={leave(() => {
                        setView('chat')
                        chat.selectConversation?.(c.id)
                      })}
                      onRename={() => setRenaming(c.id)}
                      onDelete={() => deleteConversation(c.id)}
                      onTogglePin={togglePin}
                    />
                  )
                ))}
              </div>
            )}

            {/* Time-Grouped Recents (Today, Yesterday, Previous 7 Days, etc.) */}
            {recentBuckets.length === 0 ? (
              <div className="sb-empty-chats">
                {filter ? 'No matching chats' : 'No chats yet'}
              </div>
            ) : (
              recentBuckets.map((bucket) => (
                <div key={bucket.label || 'all'} className="sb-bucket-group">
                  {bucket.label && <div className="sb-section-label">{bucket.label}</div>}
                  {bucket.items.map((c) => (
                    renaming === c.id ? (
                      <div key={c.id} className="sb-rename-wrap">
                        <SmoothInput
                          autoFocus
                          defaultValue={c.title || ''}
                          className="sb-rename-input"
                          onBlur={(e) => renameConversation(c.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              renameConversation(c.id, e.target.value)
                            }
                            if (e.key === 'Escape') {
                              e.stopPropagation()
                              setRenaming(null)
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <ConvItem
                        key={c.id}
                        conv={c}
                        active={c.id === activeId && view === 'chat'}
                        onOpen={leave(() => {
                          setView('chat')
                          chat.selectConversation?.(c.id)
                        })}
                        onRename={() => setRenaming(c.id)}
                        onDelete={() => deleteConversation(c.id)}
                        onTogglePin={togglePin}
                      />
                    )
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}

          {/* Bottom Actions: Functional User & Workspace Card */}
          <div className="sb-bottom-container">
            <span className="wb-foot-sub" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}>{status}</span>

            <UserMenu align="start" side="top" sideOffset={10}>
              <button
                type="button"
                className="sb-user-card-bottom"
                title={`Account settings for ${displayName}`}
              >
                <div className="sb-user-avatar-square">
                  {userInitials}
                </div>
                <div className="sb-user-info-bottom">
                  <span className="sb-user-name-bottom">{displayName}</span>
                  <span className="sb-user-subtext-bottom">{workspaceName}</span>
                </div>
              </button>
            </UserMenu>
          </div>
        </div>
      )}
    </aside>
  )
}
