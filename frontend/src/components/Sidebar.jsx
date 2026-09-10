import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useApp } from '../store.jsx'
import { MOD_LABEL } from '../keys.js'
import { forRail } from '../nav.js'
import { prefetchView } from '../views/registry.js'
import { fmtDate } from '../api.js'
import { useConfirm } from './ui/ConfirmDialog.jsx'
import { useDismiss } from '../hooks/useDismiss.js'
import {
  SkiperNavItem,
  ThemeToggleButton,
  SmoothInput,
  FadeScrollArea,
} from './ui/skiper/index.js'
import { AnimatePresence, motion } from 'framer-motion'



function bucketOf(iso) {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Earlier'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.floor((startOfToday - new Date(then.getFullYear(), then.getMonth(), then.getDate())) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Earlier this week'
  if (days < 30) return 'This month'
  return 'Earlier'
}

function ConvItem({ conv, active, onOpen, onRename, onDelete, onTogglePin }) {
  const [menu, setMenu] = useState(false)
  const ref = useRef(null)
  const confirm = useConfirm()

  useDismiss(ref, menu, { onAway: () => setMenu(false) })

  return (
    <div className={`sb-conv-item${active ? ' is-active' : ''}${menu ? ' menu-open' : ''}`} ref={ref}>
      <button
        type="button"
        className="sb-conv-btn"
        onClick={onOpen}
        onDoubleClick={onRename}
        title={`${conv.title || 'untitled'} (${fmtDate(conv.updated_at)})`}
      >
        <span className="sb-conv-icon">
          <Icon name={conv.pinned ? 'pin' : 'chat'} size={13} />
        </span>
        <span className="sb-conv-title">{conv.title || 'untitled'}</span>
      </button>

      <div className="sb-conv-actions">
        <button
          type="button"
          className="sb-conv-more-btn"
          onClick={(e) => {
            e.stopPropagation()
            setMenu((m) => !m)
          }}
          title="Conversation options"
          aria-label="Conversation options"
          aria-expanded={menu}
        >
          <Icon name="dots" size={13} />
        </button>
      </div>

      {menu && (
        <div className="sb-conv-menu" role="menu">
          {onTogglePin && (
            <button
              type="button"
              onClick={() => {
                setMenu(false)
                onTogglePin(conv)
              }}
            >
              <Icon name="pin" size={12} /> {conv.pinned ? 'Unpin' : 'Pin to Starred'}
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
            <kbd className="kbd">F2</kbd>
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
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const {
    view, setView, setOverlay, health, healthError,
    compact, railOpen, toggleRail, closeRail,
    conversations, activeId, chat,
    renaming, setRenaming, renameConversation, deleteConversation,
    theme, setTheme, betaPages,
  } = useApp()

  // Beta pages appear here only once they are switched on in Settings, and
  // Activity has moved there entirely.
  const places = useMemo(() => forRail(betaPages), [betaPages])

  const [filter, setFilter] = useState('')
  const [showSearchInput, setShowSearchInput] = useState(false)
  const [starredOpen, setStarredOpen] = useState(true)
  const [recentsOpen, setRecentsOpen] = useState(true)

  const firstRef = useRef(null)

  useEffect(() => {
    if (compact && railOpen) firstRef.current?.focus()
  }, [compact, railOpen])

  const leave = useCallback((act) => () => {
    act?.()
    if (compact) closeRail()
  }, [compact, closeRail])

  const status = healthError
    ? 'API offline'
    : health ? `${health.tools} tools · ${health.skills} skills` : 'connecting…'

  // Starred vs Recents conversations
  const { starred, recents } = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matches = q
      ? conversations.filter((c) => (c.title || 'untitled').toLowerCase().includes(q))
      : conversations

    const starList = matches.filter((c) => c.pinned)
    const recentList = matches.filter((c) => !c.pinned)

    return { starred: starList, recents: recentList }
  }, [conversations, filter])

  const togglePin = useCallback((conv) => {
    // Toggle pinned state
    chat?.togglePin?.()
  }, [chat])

  return (
    <aside
      id="rail"
      className={`wb-sidebar${compact && !railOpen ? ' is-hidden' : ''}`}
      aria-label="Main Navigation"
      aria-hidden={compact && !railOpen ? 'true' : undefined}
    >
      {/* 1. Header (Screenshot 1 & 2): Logo/App Mark + Search + Sidebar Toggle + Compose */}
      <div className="sb-header">
        <div className="sb-header-brand">
          <span className="sb-brand-mark" aria-hidden="true">
            <Icon name="spark" size={15} />
          </span>
          <span className="sb-brand-name">AMETHYST</span>
        </div>

        <div className="sb-header-controls">
          <button
            type="button"
            className={`sb-icon-btn${showSearchInput ? ' is-active' : ''}`}
            onClick={() => setShowSearchInput((s) => !s)}
            title="Search conversations"
            aria-label="Search conversations"
          >
            <Icon name="search" size={15} />
          </button>

          <button
            type="button"
            className="sb-icon-btn"
            onClick={toggleRail}
            title={`Close sidebar — ${MOD_LABEL}+B`}
            aria-label="Close sidebar"
          >
            <Icon name="sidebar" size={16} />
          </button>

          <button
            type="button"
            className="sb-icon-btn sb-compose-btn"
            onClick={leave(() => {
              setView('chat')
              chat.startFresh?.()
            })}
            title={`New chat — ${MOD_LABEL}+Shift+O`}
            aria-label="New chat"
          >
            <Icon name="edit" size={15} />
          </button>
        </div>
      </div>

      {/* Optional Search Field with Skiper106 Smooth Caret Input */}
      <AnimatePresence>
        {showSearchInput && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="sb-search-wrapper"
          >
            <div className="sb-search-bar">
              <Icon name="search" size={13} className="sb-search-icon" />
              <SmoothInput
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search..."
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

      {/* Scrollable Body: Places + Starred + Recents */}
      <FadeScrollArea className="sb-scroll-body" fadeHeight={20}>
        {/* 2. Primary Navigation Places (Screenshot 1 items with Skiper40 hover animations) */}
        <nav className="sb-places-nav" aria-label="Sections">
          {places.map((place) => {
            const isActive = view === place.id
            return (
              <SkiperNavItem
                key={place.id}
                active={isActive}
                onClick={leave(() => setView(place.id))}
                onPointerEnter={() => prefetchView(place.id)}
                onFocus={() => prefetchView(place.id)}
                className="sb-place-item"
                title={`${place.label} — ${MOD_LABEL}+${place.digit || ''}`}
              >
                <span className="sb-place-icon">
                  <Icon name={place.icon} size={16} />
                </span>
                <span className="sb-place-label">{place.label}</span>
                {place.beta && <span className="sb-beta-pill">BETA</span>}
                {place.digit && (
                  <span className="sb-shortcut-badge">{MOD_LABEL}{place.digit}</span>
                )}
              </SkiperNavItem>
            )
          })}
        </nav>

        {/* 3. Collapsible Section: STARRED (Screenshot 1) */}
        <div className="sb-section">
          <div className="sb-section-head">
            <button
              type="button"
              className="sb-section-toggle"
              onClick={() => setStarredOpen((o) => !o)}
              aria-expanded={starredOpen}
            >
              <Icon name={starredOpen ? 'caret-up' : 'caret-down'} size={11} className="sb-caret-icon" />
              <span className="sb-section-title">STARRED</span>
            </button>
            <button
              type="button"
              className="sb-section-more"
              title="Starred options"
              aria-label="Starred options"
            >
              <Icon name="dots" size={13} />
            </button>
          </div>

          <AnimatePresence initial={false}>
            {starredOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="sb-section-body"
              >
                {starred.length === 0 ? (
                  <div className="sb-empty-starred">
                    <span>Pin chats with {MOD_LABEL}+P</span>
                  </div>
                ) : (
                  starred.map((c) => (
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
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 4. Collapsible Section: RECENTS (Screenshot 1) */}
        <div className="sb-section">
          <div className="sb-section-head">
            <button
              type="button"
              className="sb-section-toggle"
              onClick={() => setRecentsOpen((o) => !o)}
              aria-expanded={recentsOpen}
            >
              <Icon name={recentsOpen ? 'caret-up' : 'caret-down'} size={11} className="sb-caret-icon" />
              <span className="sb-section-title">RECENTS</span>
            </button>
            <button
              type="button"
              className="sb-section-more"
              title="Recents options"
              aria-label="Recents options"
            >
              <Icon name="dots" size={13} />
            </button>
          </div>

          <AnimatePresence initial={false}>
            {recentsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="sb-section-body"
              >
                {recents.length === 0 ? (
                  <div className="sb-empty-recents">
                    <span>{filter ? 'No matching chats' : 'No recent chats'}</span>
                  </div>
                ) : (
                  recents.map((c) => (
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
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </FadeScrollArea>

      {/* 5. Footer: Skiper26 Theme Toggle + Settings */}
      <div className="sb-footer">
        <ThemeToggleButton
          theme={theme}
          setTheme={setTheme}
          className="sb-theme-toggle"
        />

        <button
          type="button"
          className="sb-settings-btn"
          onClick={leave(() => setOverlay('settings'))}
          title={`Settings — ${MOD_LABEL}+,`}
          aria-label="Settings"
        >
          <Icon name="sliders" size={15} />
          <span className="sb-settings-label">Settings</span>
          <span className="sb-settings-sub">{status}</span>
        </button>
      </div>
    </aside>
  )
}
