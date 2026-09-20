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
import {
  SkiperNavItem,
  ThemeToggleButton,
  SmoothInput,
  FadeScrollArea,
} from './ui/skiper/index.js'
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
  /* Which way the menu opens. Downwards unless the row is close enough to the
     bottom of the rail that the menu would be cut off by it -- which is what
     happened to every conversation near the end of the list, usually taking
     Delete with it. Measured when it opens rather than guessed from the row's
     index, because the rail scrolls. */
  const [up, setUp] = useState(false)
  const ref = useRef(null)
  const confirm = useConfirm()

  useDismiss(ref, menu, { onAway: () => setMenu(false) })

  const openMenu = useCallback(() => {
    const row = ref.current?.getBoundingClientRect()
    const rail = ref.current?.closest('.wb-sidebar')?.getBoundingClientRect()
    // 132px is the menu at its tallest: three items and its padding.
    if (row && rail) setUp(rail.bottom - row.bottom < 132)
    setMenu((m) => !m)
  }, [])

  return (
    <div className={`sb-conv-item${active ? ' is-active' : ''}${menu ? ' menu-open' : ''}`} ref={ref}>
      {active && (
        <motion.span
          layoutId="sb-active-conv"
          className="sb-conv-active-bg"
          initial={false}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
      )}
      <button
        type="button"
        className={`sb-conv-btn${conv.pinned ? ' has-pinned-icon' : ''}`}
        onClick={onOpen}
        onDoubleClick={onRename}
        title={`${conv.title || 'untitled'} (${fmtDate(conv.updated_at || conv.created_at)})`}
      >
        {Boolean(conv.pinned) && (
          <span className="sb-conv-icon sb-conv-icon--pinned">
            <Icon name="star" size={13} filled={true} />
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
                <Icon name="star" size={13} filled={Boolean(conv.pinned)} /> {conv.pinned ? 'Unpin' : 'Pin to Starred'}
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
    conversations, activeId, chat,
    renaming, setRenaming, renameConversation, deleteConversation,
    theme, setTheme, betaPages, refreshConvs, toast,
    userProfile, updateUserProfile,
  } = useApp()

  // Beta pages appear here only once they are switched on in Settings, and
  // Activity has moved there entirely.
  const places = useMemo(() => forRail(betaPages), [betaPages])

  const [filter, setFilter] = useState('')
  const [showSearchInput, setShowSearchInput] = useState(false)
  const [starredOpen, setStarredOpen] = useState(true)
  const [recentsOpen, setRecentsOpen] = useState(true)
  /* A section clips its contents only while its height is moving.
  
     It clipped them always, which is fine for the collapse animation and wrong
     for everything else: the row menu is positioned just below its row, so on
     any row near the bottom of a section the menu was cut off -- Delete was
     usually the half that disappeared. */
  const [collapsing, setCollapsing] = useState({ starred: false, recents: false })

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

  /* Pin the conversation this row is for.
     
     It used to accept `conv`, ignore it, and call the chat view's own pin --
     which pins the last *message* of whatever conversation happened to be open.
     So starring a row in the sidebar wrote a bit on a different object
     entirely, and Starred, which filters on `c.pinned`, stayed empty forever. */
  const togglePin = useCallback(async (conv) => {
    try {
      await api.pinConversation(conv.id, !conv.pinned)
      await refreshConvs()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }, [refreshConvs, toast])

  return (
    <aside
      id="rail"
      className={`wb-sidebar${compact && !railOpen ? ' is-hidden' : ''}`}
      aria-label="Main Navigation"
      aria-hidden={compact && !railOpen ? 'true' : undefined}
    >
      {/* 1. Header (Screenshot 1): User Card + Sidebar Close Toggle */}
      <div className="sb-header">
        <div className="sb-header-top-row">
          <button
            type="button"
            className="sb-icon-btn"
            onClick={toggleRail}
            title={`Close sidebar — ${MOD_LABEL}+B`}
            aria-label="Close sidebar"
          >
            <Icon name="sidebar" size={16} />
          </button>

          <UserMenu align="start" side="bottom" sideOffset={8}>
            <button
              type="button"
              className="sb-user-card-top"
              title={`User menu for ${userProfile?.name || 'User'} — Click to edit name or open settings`}
            >
              <BrandMark size={22} glow />
              <span className="sb-user-name-top">{userProfile?.name ? `${userProfile.name}'s Amethyst` : 'Amethyst OS'}</span>
              <Icon name="chevron" size={10} className="sb-user-chevron" />
            </button>
          </UserMenu>
        </div>

        {/* Row 2: New chat button + Search button (Matching Screenshot 1 & Apple design) */}
        <div className="sb-header-actions-row">
          <button
            type="button"
            className="sb-new-chat-btn"
            onClick={leave(() => {
              setView('chat')
              chat.startFresh?.()
            })}
            title={`New chat — ${MOD_LABEL}+Shift+O`}
            aria-label="New chat"
          >
            <Icon name="edit" size={15} />
            <span>New chat</span>
          </button>

          <button
            type="button"
            className={`sb-search-btn-square${showSearchInput ? ' is-active' : ''}`}
            onClick={() => setShowSearchInput((s) => !s)}
            title="Search conversations"
            aria-label="Search conversations"
          >
            <Icon name="search" size={15} />
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
                  <Icon name={place.icon} size={18} filled={isActive} />
                </span>
                <span className="sb-place-label">{place.label}</span>
                {place.beta && <span className="sb-beta-pill">BETA</span>}
                {/* Two elements, not one string. `{MOD_LABEL}{digit}` renders
                    "Ctrl8" on anything that is not a Mac, and in a mono face
                    at 11px the lowercase L and the 1 are the same glyph -- the
                    hint for Ctrl+8 read as "Ctr18". The separator is the fix;
                    on a Mac it is still just "⌘8" with a hair of air. */}
                {place.digit && (
                  <span className="sb-shortcut-badge">
                    <kbd>{MOD_LABEL}</kbd><kbd>{place.digit}</kbd>
                  </span>
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
              <span className={`sb-caret-wrap${starredOpen ? ' is-open' : ''}`}>
                <Icon name="chevron-right" size={11} className="sb-caret-icon" />
              </span>
              <span className="sb-section-title">Starred</span>
            </button>
            <button
              type="button"
              className="sb-section-more"
              title="Starred options"
              aria-label="Starred options"
            >
              <Icon name="dots" size={14} />
            </button>
          </div>

          <AnimatePresence initial={false}>
            {starredOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={`sb-section-body${collapsing.starred ? ' is-collapsing' : ''}`}
                onAnimationStart={() => setCollapsing((c) => ({ ...c, starred: true }))}
                onAnimationComplete={() => setCollapsing((c) => ({ ...c, starred: false }))}
              >
                {starred.length === 0 ? (
                  <div className="sb-empty-starred">
                    <Icon name="star" size={12} className="sb-empty-starred-icon" />
                    <span>Starred chats will appear here</span>
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
              <span className={`sb-caret-wrap${recentsOpen ? ' is-open' : ''}`}>
                <Icon name="chevron-right" size={11} className="sb-caret-icon" />
              </span>
              <span className="sb-section-title">Recents</span>
            </button>
            <button
              type="button"
              className="sb-section-more"
              title="Recents options"
              aria-label="Recents options"
            >
              <Icon name="dots" size={14} />
            </button>
          </div>

          <AnimatePresence initial={false}>
            {recentsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className={`sb-section-body${collapsing.recents ? ' is-collapsing' : ''}`}
                onAnimationStart={() => setCollapsing((c) => ({ ...c, recents: true }))}
                onAnimationComplete={() => setCollapsing((c) => ({ ...c, recents: false }))}
              >
                {recents.length === 0 ? (
                  <div className="sb-empty-recents">
                    <span>{filter ? 'No matching chats' : 'No recent chats'}</span>
                  </div>
                ) : (
                  recentBuckets.map((bucket) => (
                    <div key={bucket.label || 'all'} className="sb-bucket-group">
                      {bucket.label && <div className="sb-bucket-header">{bucket.label}</div>}
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </FadeScrollArea>
    </aside>
  )
}
