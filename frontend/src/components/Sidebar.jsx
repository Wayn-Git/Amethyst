import { Button as HouseButton } from './ui/bento/index.jsx'
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
import ModeSwitcher from './ModeSwitcher.jsx'
import { safeStorage } from '../lib/storage.js'

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
      <HouseButton
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
      </HouseButton>

      <div className="sb-conv-actions">
        <HouseButton
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
        </HouseButton>
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
              <HouseButton
                type="button"
                onClick={() => {
                  setMenu(false)
                  onTogglePin(conv)
                }}
              >
                <Icon name="star" size={12} filled={Boolean(conv.pinned)} /> {conv.pinned ? 'Unpin' : 'Pin to Starred'}
              </HouseButton>
            )}
            <HouseButton
              type="button"
              onClick={() => {
                setMenu(false)
                onRename()
              }}
            >
              <Icon name="edit" size={12} /> Rename
            </HouseButton>
            <HouseButton
              type="button"
              className="danger"
              onClick={async () => {
                setMenu(false)
                const ok = await confirm({
                  title: 'Delete conversation?',
                  subject: conv.title || 'untitled',
                  description: 'This conversation and its messages will be permanently removed.',
                  confirmLabel: 'Delete',
                  tone: 'danger',
                })
                if (ok) onDelete()
              }}
            >
              <Icon name="trash" size={12} /> Delete
            </HouseButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Sidebar() {
  const {
    appMode, setAppMode,
    view, setView, setOverlay, health, healthError,
    compact, railOpen, toggleRail, closeRail,
    sidebar, setSidebar,
    conversations, activeId, chat,
    renaming, setRenaming, renameConversation, deleteConversation,
    theme, setTheme, betaPages, refreshConvs, toast,
    userProfile, updateUserProfile,
    workspace, setWorkspace,
  } = useApp()

  const [filter, setFilter] = useState('')
  const [showSearchInput, setShowSearchInput] = useState(false)
  const [taskCount, setTaskCount] = useState(0)
  const [recentFiles, setRecentFiles] = useState([])
  const [connectors, setConnectors] = useState([])

  useEffect(() => {
    api.tasks({ bucket: 'pending', limit: 20 })
      .then((res) => {
        if (res?.tasks) setTaskCount(res.tasks.length)
      })
      .catch(() => {})

    api.library({ limit: 4 })
      .then((res) => {
        if (res?.items) setRecentFiles(res.items)
      })
      .catch(() => {})

    api.capabilities()
      .then((res) => {
        if (res?.connectors) setConnectors(res.connectors)
      })
      .catch(() => {})
  }, [])

  const toggleSidebar = toggleRail

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
    const list = Array.isArray(conversations) ? conversations : []
    const q = filter.trim().toLowerCase()
    const matches = q
      ? list.filter((c) => (c.title || 'untitled').toLowerCase().includes(q))
      : list

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
            <HouseButton
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
            </HouseButton>

            <HouseButton
              type="button"
              className="sb-mini-plus-btn"
              onClick={leave(() => {
                setView('chat')
                chat.startFresh?.()
              })}
              title={`New chat — ${MOD_LABEL}+Shift+O`}
              aria-label="New chat"
            >
              <Icon name="plus" size={18} weight="bold" />
            </HouseButton>

            <HouseButton
              type="button"
              className="sb-mini-btn"
              onClick={(e) => {
                e.stopPropagation()
                setSidebar(true)
                setShowSearchInput(true)
              }}
              title={`Search conversations — ${MOD_LABEL}+K`}
              aria-label="Search"
            >
              <Icon name="search" size={20} />
            </HouseButton>
          </div>

          {/* Middle Nav Items: Real Places */}
          <div className="sb-mini-nav" aria-label="Main Navigation">
            {topPlaces.map((place) => {
              const isActive = view === place.id
              return (
                <HouseButton
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
                </HouseButton>
              )
            })}

            {/* Collapsed Utilities Icon with Flyout */}
            <div ref={miniUtilsRef} style={{ position: 'relative' }}>
              <HouseButton
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
              </HouseButton>

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
                      <HouseButton
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
                      </HouseButton>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {bottomPlaces.map((place) => {
              const isActive = view === place.id
              return (
                <HouseButton
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
                </HouseButton>
              )
            })}
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
              <HouseButton
                type="button"
                className="sb-mini-avatar-square"
                title={`User menu for ${displayName}`}
                aria-label={`User menu for ${displayName}`}
              >
                {userInitials}
              </HouseButton>
            </UserMenu>
          </div>
        </div>
      ) : (
        /* ===================================================================
           2. EXPANDED MODERN SIDEBAR (260px) — Vibecoded
           =================================================================== */
        <div className="sb-expanded-container">
          <AnimatePresence mode="wait" initial={false}>
            {appMode === 'app' ? (
              /* ===============================================================
                 WORKSPACE APP SIDEBAR (Screenshot 1)
                 =============================================================== */
              <motion.div
                key="sb-app-mode"
                className="sb-mode-content-wrapper"
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 6 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="sb-header">
                  <div className="sb-header-top-row">
                    <ModeSwitcher />
                    <HouseButton
                      type="button"
                      className="sb-header-icon-btn"
                      onClick={handleToggle}
                      title={`Collapse sidebar — ${MOD_LABEL}+B`}
                      aria-label="Collapse sidebar"
                    >
                      <Icon name="sidebar" size={17} />
                    </HouseButton>
                  </div>
                </div>

                {/* Action row: + New button and Search */}
                <div className="sb-fennel-action-row">
                  <motion.button
                    type="button"
                    className="sb-fennel-new-btn"
                    onClick={() => setOverlay('palette')}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.97 }}
                    title="Create new task, note, or prompt"
                  >
                    <Icon name="plus" size={14} />
                    <span>New</span>
                  </motion.button>
                  <motion.button
                    type="button"
                    className="sb-fennel-search-icon-btn"
                    onClick={() => setOverlay('palette')}
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.95 }}
                    title={`Search in project — ${MOD_LABEL}+K`}
                    aria-label="Search"
                  >
                    <Icon name="search" size={14} />
                  </motion.button>
                </div>

                {/* Main Nav Section */}
                <nav className="sb-fennel-nav wb-list" aria-label="App Navigation">
                  <HouseButton
                    type="button"
                    className={`sb-fennel-nav-item${view === 'today' ? ' is-active' : ''}`}
                    onClick={leave(() => setView('today'))}
                  >
                    <div className="sb-fennel-nav-item-left">
                      <Icon name="home" size={16} />
                      <span>Home</span>
                    </div>
                  </HouseButton>

                  <HouseButton
                    type="button"
                    className="sb-fennel-nav-item"
                    onClick={() => toast('Projects workspace coming soon', 'info')}
                  >
                    <div className="sb-fennel-nav-item-left">
                      <Icon name="folder" size={16} />
                      <span>Projects</span>
                    </div>
                    <span className="sb-fennel-soon-badge">Soon</span>
                  </HouseButton>

                  <HouseButton
                    type="button"
                    className="sb-fennel-nav-item"
                    onClick={() => toast('Templates coming soon', 'info')}
                  >
                    <div className="sb-fennel-nav-item-left">
                      <Icon name="grid" size={16} />
                      <span>Templates</span>
                    </div>
                    <span className="sb-fennel-soon-badge">Soon</span>
                  </HouseButton>

                  <HouseButton
                    type="button"
                    className={`sb-fennel-nav-item${view === 'library' ? ' is-active' : ''}`}
                    onClick={leave(() => setView('library'))}
                  >
                    <div className="sb-fennel-nav-item-left">
                      <Icon name="files" size={16} />
                      <span>Artifacts</span>
                    </div>
                  </HouseButton>

                  <HouseButton
                    type="button"
                    className={`sb-fennel-nav-item${view === 'tasks' ? ' is-active' : ''}`}
                    onClick={leave(() => setView('tasks'))}
                  >
                    <div className="sb-fennel-nav-item-left">
                      <Icon name="check-square" size={16} />
                      <span>Tasks</span>
                    </div>
                    {taskCount > 0 && <span className="sb-fennel-count-badge">{taskCount}</span>}
                  </HouseButton>
                </nav>

                {/* Real Recent Files section */}
                <div className="sb-fennel-section">
                  <div className="sb-fennel-section-label">Recent</div>
                  <div className="sb-fennel-recent-list">
                    {recentFiles.length > 0 ? (
                      recentFiles.map((file) => (
                        <HouseButton
                          key={file.id}
                          type="button"
                          className="sb-fennel-recent-item"
                          onClick={leave(() => setView('library'))}
                          title={file.title}
                        >
                          <Icon name="file" size={13} className="sb-fennel-recent-icon" />
                          <span className="sb-fennel-recent-title">{file.title || 'Untitled'}</span>
                        </HouseButton>
                      ))
                    ) : (
                      <div className="sb-fennel-empty-hint">No recent documents</div>
                    )}
                  </div>
                </div>

                {/* Real Connectors section (Zero fake teams) */}
                <div className="sb-fennel-section">
                  <div className="sb-fennel-section-label">Connectors</div>
                  <div className="sb-fennel-recent-list">
                    {connectors.length > 0 ? (
                      connectors.map((c) => (
                        <HouseButton
                          key={c.id || c.name}
                          type="button"
                          className="sb-fennel-recent-item"
                          onClick={leave(() => setView('capabilities'))}
                          title={`${c.name || c.id} — Active`}
                        >
                          <span className="sb-fennel-status-dot sb-fennel-status-dot--live" />
                          <span className="sb-fennel-recent-title">{c.name || c.id}</span>
                        </HouseButton>
                      ))
                    ) : (
                      <HouseButton
                        type="button"
                        className="sb-fennel-recent-item"
                        onClick={leave(() => setView('capabilities'))}
                      >
                        <Icon name="plug" size={13} className="sb-fennel-recent-icon" />
                        <span className="sb-fennel-recent-title">Manage connectors</span>
                      </HouseButton>
                    )}
                  </div>
                </div>

                {/* Real System Status Footer (Zero fake credits) */}
                <div className="sb-fennel-footer">
                  <span className="wb-foot-sub" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}>{status}</span>
                  <div className="sb-fennel-status-card">
                    <div className="sb-fennel-status-top">
                      <span className="sb-fennel-status-label">
                        <span className="sb-fennel-status-live-dot" />
                        <span>System Ready</span>
                      </span>
                      <span className="sb-fennel-status-badge">
                        {health?.tools ? `${health.tools} tools` : 'Director'}
                      </span>
                    </div>
                    <div className="sb-fennel-status-sub">
                      {health?.skills ? `${health.skills} active skills · local runtime` : 'Local runtime active'}
                    </div>
                  </div>

                  <UserMenu align="start" side="top" sideOffset={10}>
                    <HouseButton
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
                    </HouseButton>
                  </UserMenu>
                </div>
              </motion.div>
            ) : (
            /* ===============================================================
               AGENT MODE SIDEBAR (Screenshot 2)
               =============================================================== */
              <motion.div
                key="sb-agent-mode"
                className="sb-mode-content-wrapper"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
              <div className="sb-header">
                <div className="sb-header-top-row">
                  <ModeSwitcher />

                  <div className="sb-header-actions">
                    <HouseButton
                      type="button"
                      className="sb-header-icon-btn"
                      onClick={() => toast('No new notifications', 'info')}
                      title="Notifications"
                      aria-label="Notifications"
                    >
                      <Icon name="bell" size={16} />
                    </HouseButton>

                    <HouseButton
                      type="button"
                      className={`sb-header-icon-btn${showSearchInput ? ' is-active' : ''}`}
                      onClick={() => setShowSearchInput((s) => !s)}
                      title={`Search conversations — ${MOD_LABEL}+K`}
                      aria-label="Search conversations"
                    >
                      <Icon name="search" size={16} />
                    </HouseButton>

                    <HouseButton
                      type="button"
                      className="sb-header-icon-btn"
                      onClick={handleToggle}
                      title={`Collapse sidebar — ${MOD_LABEL}+B`}
                      aria-label="Collapse sidebar"
                    >
                      <Icon name="sidebar" size={16} />
                    </HouseButton>
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
                          placeholder="Search chats…"
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
                          <HouseButton
                            type="button"
                            className="sb-clear-btn"
                            onClick={() => setFilter('')}
                            aria-label="Clear search"
                          >
                            <Icon name="x" size={12} />
                          </HouseButton>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Prominent + New Chat Pill Button */}
              <HouseButton
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
              </HouseButton>

              {/* Scroll Area: Starred & Time-Grouped Recent Chats */}
              <div className="sb-scroll-body wb-list">
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

              {/* Bottom Actions: Functional User & Workspace Card */}
              <div className="sb-bottom-container">
                <span className="wb-foot-sub" style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}>{status}</span>

                <UserMenu align="start" side="top" sideOffset={10}>
                  <HouseButton
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
                  </HouseButton>
                </UserMenu>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      )}
    </aside>
  )
}
