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

function bucketOf(iso) {
  if (!iso) return 'Earlier'
  const then = serverTime(iso) || new Date(iso)
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
  } = useApp()

  const toggleSidebar = toggleRail

  // Real navigation places
  const places = useMemo(() => forRail(betaPages), [betaPages])

  const [filter, setFilter] = useState('')
  const [showSearchInput, setShowSearchInput] = useState(false)

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

  // Navigation places excluding chat
  const navPlaces = useMemo(() => {
    return places.filter((p) => p.id !== 'chat')
  }, [places])

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
          {/* Top Actions: App Icon (reveals Sidebar Expand on hover) + Search + New Chat */}
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
                <BrandMark size={22} glow />
              </span>
              <span className="sb-mini-toggle-icon">
                <Icon name="sidebar" size={17} />
              </span>
            </button>

            <button
              type="button"
              className="sb-mini-btn"
              onClick={(e) => {
                e.stopPropagation()
                setSidebar(true)
                setShowSearchInput(true)
              }}
              title={`Search conversations — ${MOD_LABEL}+K`}
              aria-label="Search conversations"
            >
              <Icon name="search" size={17} />
            </button>

            <button
              type="button"
              className="sb-mini-plus-btn"
              onClick={(e) => {
                e.stopPropagation()
                leave(() => {
                  setView('chat')
                  chat.startFresh?.()
                })()
              }}
              title={`New chat — ${MOD_LABEL}+Shift+O`}
              aria-label="New chat"
            >
              <Icon name="edit" size={16} />
            </button>
          </div>

          {/* Middle Nav Items: Real Places (Today, Tasks, Mail, Skills, Automations, Memory, Library) */}
          <div className="sb-mini-nav" aria-label="Main Navigation">
            {navPlaces.map((place) => {
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
                  <Icon name={place.icon} size={17} />
                </button>
              )
            })}

            <button
              type="button"
              className={`sb-mini-btn${view === 'chat' ? ' is-active' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                leave(() => setView('chat'))()
              }}
              title={`Chat — ${MOD_LABEL}+1`}
              aria-label="Chat"
            >
              <Icon name="chat" size={17} />
            </button>
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
                  <BrandMark size={22} glow />
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
                  <Icon name="search" size={16} />
                </button>

                <button
                  type="button"
                  className="sb-header-icon-btn"
                  onClick={handleToggle}
                  title={`Collapse sidebar — ${MOD_LABEL}+B`}
                  aria-label="Collapse sidebar"
                >
                  <Icon name="sidebar" size={16} />
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
                    <Icon name="search" size={13} className="sb-search-icon" />
                    <SmoothInput
                      autoFocus
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Search chats..."
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
              <Icon name="plus" size={15} />
              <span>New Chat</span>
            </div>
            <span className="sb-new-chat-shortcut">
              {MOD_LABEL}+Shift+O
            </span>
          </button>

          {/* Primary Navigation Section: Real Amethyst Views */}
          <div className="sb-nav-section" aria-label="Main Navigation">
            {navPlaces.map((place) => {
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
                      <Icon name={place.icon} size={16} />
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
