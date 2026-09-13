import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, onServerState, serverState, wakeBackend } from './api.js'
import { byId, pathFor } from './nav.js'
import { useCompact } from './hooks/useMediaQuery.js'

function pathToId(pathname) {
  if (pathname === '/' || pathname === '/chat') return 'chat'
  const hit = pathname.split('/').filter(Boolean)[0]
  return byId(hit) ? hit : 'chat'
}

/* One store for everything that is not the transcript.

   The transcript stays inside Chat because it changes on every streamed token
   and nothing else needs to watch it. What lives here is what more than one
   surface has to agree on: which view is open, what the machine currently is,
   which conversations exist, and what the agent may reach. The command palette
   and the keyboard layer are built entirely from this, which is why toggling a
   connector from a hotkey and toggling it from the + menu are the same code. */

const AppCtx = createContext(null)

const KEY = 'amethyst.ui.v1'

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {}
  } catch {
    return {}
  }
}

function savePrefs(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* private mode, or a full quota: preferences are a convenience, not state */
  }
}

// How often the header re-asks whether connectors and providers are alive. Was
// 20s, which meant a connector could be dead for most of a minute with the
// screen still saying it was fine. The call is 17ms and answers from state the
// process already holds.
const HEALTH_INTERVAL = 8000

/* Which palette to paint. The palette this interface was drawn for is the light
   one -- warm parchment, ink text, hairlines instead of shadows -- so light is
   what an unconfigured install gets, rather than whatever the laptop happens to
   be set to. 'system' is still selectable and still follows the machine; it is
   just no longer the answer nobody chose. The chosen value is written to the
   document element so the stylesheet -- not JavaScript -- owns every colour. */
const THEMES = ['system', 'dark', 'light']

/* The panel has to stay wide enough to hold a line of code and narrow enough to
   leave a conversation beside it. A stored value from a wider monitor is
   clamped on load rather than trusted. */
export const PANEL_MIN = 300
export const PANEL_MAX = 900
const PANEL_DEFAULT = 372

function clampPanel(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return PANEL_DEFAULT
  return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(n)))
}

function applyTheme(theme) {
  const root = document.documentElement
  /* `system` used to *remove* `data-theme`, and leaving it off is what made
     the two themes unstable.

     The token blocks cope with a missing attribute -- there is a
     `prefers-color-scheme` copy of the whole dark block for exactly that. But
     roughly fifteen component rules elsewhere in the stylesheet are written as
     `[data-theme="light"] .thing { ... }` or `[data-theme="dark"] .thing`, and
     with no attribute present *none* of them match. A person who has never
     opened Settings -- which is the default -- got a page whose tokens were
     dark and whose connector cards, capability tabs and MCP modal were still
     wearing their light treatment, or the reverse.

     Resolving `system` to whatever the machine currently says, and stamping
     that, means the attribute is always one of two known values. The media
     query above re-fires this on the machine's own switch, so it stays true
     at sunset. The `prefers-color-scheme` copy in the stylesheet stays as the
     answer for the first paint, before any of this runs. */
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme
  root.setAttribute('data-theme', resolved)
  // The browser's own surfaces -- form controls, scrollbars, the address bar --
  // read this, and a light page inside dark chrome is the tell that a theme was
  // bolted on rather than designed.
  root.style.colorScheme = resolved
  /* `theme-color` was a fixed `#0b0b0c` in the markup, which paints the address
     bar of a phone in light mode black above a paper-coloured page. Read from
     the stylesheet after the switch, so it is whatever `--canvas` actually
     resolved to rather than a second copy of the palette kept in sync by hand. */
  const tag = document.querySelector('meta[name="theme-color"]')
  if (tag) {
    const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim()
    if (canvas) tag.setAttribute('content', canvas)
  }
}

// Applied before React mounts, so the first paint is already the right colour.
applyTheme(THEMES.includes(loadPrefs().theme) ? loadPrefs().theme : 'light')

export function AppProvider({ children }) {
  const prefs = useRef(loadPrefs()).current
  const location = useLocation()
  const navigate = useNavigate()
  /* Below this width the rail is a drawer over the page rather than a column
     beside it, so "is the rail showing" stops being one persisted preference
     and becomes two different questions. See `railOpen` below. */
  const compact = useCompact()

  // The URL is the source of truth now. `view` is derived from it every
  // render rather than tracked as its own state, so a browser back/forward
  // or a typed-in address bar is never out of step with what's on screen.
  const view = pathToId(location.pathname)
  // Whether the backend is answering at all. Distinct from `health`, which is
  // what a *reachable* backend says about itself: on a deployment where the
  // API is a container that stops when idle, "still booting" and "up but
  // degraded" want different frames, and conflating them showed a page full of
  // failed-to-load errors during an ordinary cold start.
  const [server, setServer] = useState(serverState)
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState(null)
  const [toasts, setToasts] = useState([])
  const [overlay, setOverlay] = useState(null) // 'palette' | 'shortcuts' | null

  const [conversations, setConversations] = useState([])
  const [activeId, setActiveIdRaw] = useState(prefs.activeId || null)
  const [caps, setCaps] = useState({ skills: [], connectors: [] })
  const [busyCap, setBusyCap] = useState('')
  const [workspace, setWorkspaceRaw] = useState(prefs.workspace || '')
  // Which conversation is being retitled. It lives here because the rail draws
  // the row and the keyboard layer starts the edit.
  const [renaming, setRenaming] = useState(null)
  const [sidebar, setSidebarRaw] = useState(prefs.sidebar !== false)
  /* The drawer's own state, separate from the desktop preference and never
     persisted. A phone that reopened with the rail across the whole screen --
     which is what sharing one boolean did -- looks like an application that
     failed to load its page. */
  const [drawer, setDrawer] = useState(false)
  /* The context panel on the right of the workbench: where a turn's machinery
     goes so the transcript can be prose. Persisted, because whether you want
     to watch the steps is a standing preference rather than a per-page one. */
  const [panel, setPanelRaw] = useState(prefs.panel !== false)
  /* How wide the side panel is, and whether it has taken over the window.

     Width is a preference because it is a decision about this screen and this
     pair of eyes -- it should survive a reload the way the rail's own state
     does. Expanded is deliberately *not* persisted: filling the window is
     something you do to read one document, and coming back tomorrow to an app
     with no conversation in it would be a puzzle rather than a memory. */
  const [panelWidth, setPanelWidthRaw] = useState(() => clampPanel(prefs.panelWidth))
  const [panelExpanded, setPanelExpanded] = useState(false)
  const [theme, setThemeRaw] = useState(
    () => (THEMES.includes(prefs.theme) ? prefs.theme : 'light'),
  )
  // Which half of Skills & connectors is open. In the store because the + menu
  // and the palette both send you to one side or the other.
  const [capabilitiesTab, setCapabilitiesTabRaw] = useState(prefs.capabilitiesTab || 'skills')

  // Chat owns the turn, so the palette and the keyboard layer reach it through
  // callbacks it registers rather than through a copy of its state.
  const chatRef = useRef({})

  const setView = useCallback((next) => {
    navigate(pathFor(next))
    savePrefs({ view: next })
  }, [navigate])

  const [pendingPrompt, setPendingPrompt] = useState(null)

  const openChatWithPrompt = useCallback((prompt) => {
    setActiveIdRaw(null)
    savePrefs({ activeId: null })
    setPendingPrompt(prompt)
    navigate(pathFor('chat'))
    savePrefs({ view: 'chat' })
  }, [navigate])

  // Reopen where you left off, but only from the bare root: a direct visit or
  // bookmark to e.g. /mail is a real URL and must never be overridden by
  // whatever the last session happened to have open.
  useEffect(() => {
    if (location.pathname === '/' && prefs.view && prefs.view !== 'chat') {
      navigate(pathFor(prefs.view), { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setActiveId = useCallback((next) => {
    setActiveIdRaw(next)
    savePrefs({ activeId: next })
  }, [])

  const setWorkspace = useCallback((next) => {
    setWorkspaceRaw(next)
    savePrefs({ workspace: next })
  }, [])

  const setCapabilitiesTab = useCallback((next) => {
    setCapabilitiesTabRaw(next)
    savePrefs({ capabilitiesTab: next })
  }, [])

  const setSidebar = useCallback((next) => {
    setSidebarRaw((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      savePrefs({ sidebar: value })
      return value
    })
  }, [])

  const setTheme = useCallback((next) => {
    const value = THEMES.includes(next) ? next : 'system'
    setThemeRaw(value)
    applyTheme(value)
    savePrefs({ theme: value })
  }, [])

  /* Beta pages -- Mail and Automations -- are hidden until this is on.

     Off by default, and per-browser like the rest of `prefs`: it decides what
     this interface shows, not what the server will do, so it has no business
     in the backend settings. `nav.js` is where "hidden" is spelled out; every
     surface that lists pages reads it from there rather than keeping its own
     idea of which ones exist. */
  const [betaPages, setBetaPagesRaw] = useState(prefs.betaPages === true)
  const setBetaPages = useCallback((next) => {
    const value = Boolean(next)
    setBetaPagesRaw(value)
    savePrefs({ betaPages: value })
  }, [])

  /* Desktop notification when a turn finishes, so a long turn does not need
     watching. Off by default and per-browser: the OS permission is per-browser
     and cannot be granted from the server, so it lives in prefs, not the
     backend settings. Turning it on asks for permission there and then, while
     the click is fresh -- browsers reject a permission prompt that is not tied
     to a user gesture. */
  const [notifyOnDone, setNotifyOnDoneRaw] = useState(prefs.notifyOnDone === true)
  const setNotifyOnDone = useCallback(async (next) => {
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* denied or unsupported */ }
    }
    const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted'
    // Only stays "on" if permission actually landed -- a toggle that says on
    // while the browser will show nothing is the kind of lie this codebase
    // keeps chasing out of its status rows.
    const value = Boolean(next) && granted
    setNotifyOnDoneRaw(value)
    savePrefs({ notifyOnDone: value })
    return { value, blocked: Boolean(next) && !granted }
  }, [])

  /* Fire one, if the user asked for them and is not already looking. The
     visibility gate is the whole point: notifying someone about the answer
     filling the screen in front of them is noise, so it fires only when the
     tab is backgrounded. */
  const notify = useCallback((title, body, onClick) => {
    if (!notifyOnDone) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') return
    try {
      const n = new Notification(title, { body: (body || '').slice(0, 180), tag: 'amethyst-turn' })
      n.onclick = () => { try { window.focus() } catch { /* no-op */ } ; onClick?.() ; n.close() }
    } catch { /* some contexts throw on construction */ }
  }, [notifyOnDone])

  /* One question -- "is the rail showing" -- with two answers depending on the
     width, so every caller (the ⌘B binding, the rail's own hide button, the
     header's menu button) can stay one line. */
  const railOpen = compact ? drawer : sidebar
  const toggleRail = useCallback(() => {
    if (compact) setDrawer((o) => !o)
    else setSidebar((s) => !s)
  }, [compact, setSidebar])
  const closeRail = useCallback(() => setDrawer(false), [])

  const setPanel = useCallback((value) => {
    setPanelRaw(value)
    savePrefs({ panel: value })
  }, [])
  const togglePanel = useCallback(() => setPanelRaw((open) => {
    savePrefs({ panel: !open })
    return !open
  }), [])

  /* Written on every pointer move during a drag, so the value is clamped here
     rather than at the call site and the preference is only persisted at the
     end of a drag -- `savePrefs` reads and rewrites the whole blob, and doing
     that sixty times a second for the length of a drag is a lot of JSON for a
     number that is about to change again. */
  const setPanelWidth = useCallback((value, { persist = true } = {}) => {
    const next = clampPanel(value)
    setPanelWidthRaw(next)
    if (persist) savePrefs({ panelWidth: next })
  }, [])

  const togglePanelExpanded = useCallback(() => setPanelExpanded((on) => !on), [])

  // Picking a place is the end of the drawer's job. Leaving it open over the
  // page someone just asked for is the classic mobile-nav bug.
  useEffect(() => { setDrawer(false) }, [location.pathname])
  useEffect(() => { if (!compact) setDrawer(false) }, [compact])

  /* On `system`, the stylesheet follows the machine on its own — but the
     address-bar colour is read out of the stylesheet once, so it has to be
     read again when the machine changes its mind at sunset. */
  useEffect(() => {
    if (theme !== 'system') return undefined
    const watch = window.matchMedia('(prefers-color-scheme: dark)')
    const relay = () => applyTheme('system')
    watch.addEventListener('change', relay)
    return () => watch.removeEventListener('change', relay)
  }, [theme])

  const toast = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.filter((x) => x.message !== message), { id, message, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4600)
  }, [])

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api.health()
      setHealth(h)
      setHealthError(null)
      return h
    } catch (err) {
      setHealthError(err.message)
      return null
    }
  }, [])

  const refreshConvs = useCallback(async () => {
    try {
      const rows = await api.conversations()
      setConversations(rows)
      return rows
    } catch (err) {
      setHealthError(err.message)
      return []
    }
  }, [])

  const renameConversation = useCallback(async (id, title) => {
    setRenaming(null)
    const clean = (title || '').trim()
    if (!clean) return
    try {
      await api.updateConversation(id, { title: clean })
      await refreshConvs()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }, [refreshConvs, toast])

  /** Delete a conversation, and leave the interface somewhere valid.
   *
   *  The open conversation is the one most likely to be deleted, so this has to
   *  answer "what is on screen now" itself rather than leaving Chat pointed at
   *  a row the API will 404 on. */
  const deleteConversation = useCallback(async (id) => {
    try {
      await api.deleteConversation(id)
    } catch (err) {
      toast(err.message, 'bad')
      return false
    }
    const rows = await refreshConvs()
    if (id === activeId) setActiveId(rows.find((c) => c.id !== id)?.id ?? null)
    toast('Conversation deleted', 'info')
    return true
  }, [activeId, refreshConvs, setActiveId, toast])

  /** Delete every conversation.
   *
   *  Unlike the single delete there is never a next row to fall back to, so
   *  Chat has to be told to start fresh: re-pointing `activeId` at null leaves
   *  the transcript it already rendered on screen, under an empty rail. */
  const deleteAllConversations = useCallback(async () => {
    try {
      const { deleted } = await api.deleteAllConversations()
      await refreshConvs()
      setActiveId(null)
      chatRef.current.startFresh?.()
      toast(`Deleted ${deleted} conversation${deleted === 1 ? '' : 's'}`, 'ok')
      return deleted
    } catch (err) {
      toast(err.message, 'bad')
      return null
    }
  }, [refreshConvs, setActiveId, toast])

  const refreshCaps = useCallback(async (scope = activeId) => {
    try {
      const next = await api.capabilities(scope || null)
      setCaps(next)
      return next
    } catch {
      return null
    }
  }, [activeId])

  /** Flip a skill or connector and report what actually happened.
   *
   *  A connector starts a real process, so the answer is not "on" but "running
   *  with N tools" or "failed, here is why". Both callers -- the + menu and the
   *  palette -- need that distinction, so it is resolved once, here. */
  const setCapEnabled = useCallback(async (cap, enabled) => {
    const token = `${cap.kind}:${cap.name}`
    setBusyCap(token)
    try {
      const result = await api.toggleCapability(cap.kind, cap.name, enabled, activeId || null)
      const live = result?.live || {}
      if (cap.kind === 'connector') {
        if (live.error) toast(`${cap.name} could not start — ${live.error}`, 'bad')
        else if (live.connected) toast(`${cap.name} ready · ${live.tools} tools`, 'ok')
        else toast(`${cap.name} ${enabled ? 'on' : 'off'}`, 'info')
        refreshHealth()
      } else {
        toast(`${cap.name} ${enabled ? 'engaged' : 'stood down'}`, enabled ? 'ok' : 'info')
      }
      await refreshCaps()
      return result
    } catch (err) {
      toast(err.message, 'bad')
      return null
    } finally {
      setBusyCap('')
    }
  }, [activeId, refreshCaps, refreshHealth, toast])

  useEffect(() => onServerState(setServer), [])

  // Nothing is fetched until the backend answers. Firing the first load against
  // a container that is still booting spends the whole cold start on requests
  // that time out, and then the interface has to be told to try again -- so the
  // three opening calls wait on the wake instead, and every one of them lands.
  const ready = server.phase === 'ready'
  useEffect(() => { if (ready) refreshHealth() }, [ready, refreshHealth])
  useEffect(() => { if (ready) refreshConvs() }, [ready, refreshConvs])
  useEffect(() => { if (ready) refreshCaps() }, [ready, refreshCaps])

  // A connector can die between messages and the API only notices at the start
  // of a turn, so the header has to keep asking.
  useEffect(() => {
    if (!ready) return undefined
    // Caps ride the health tick rather than a timer of their own. `caps` used
    // to be fetched once on boot and after a toggle, so the + menu's "N of M"
    // and the palette could read a state minutes old; a second interval would
    // just be a second clock to keep in step with this one.
    const tick = () => { refreshHealth(); refreshCaps() }
    const timer = setInterval(tick, HEALTH_INTERVAL)
    const onFocus = () => tick()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [ready, refreshHealth, refreshCaps])

  const value = useMemo(() => ({
    view, setView,
    server, retryServer: wakeBackend,
    health, healthError, refreshHealth,
    toasts, toast,
    overlay, setOverlay,
    conversations, refreshConvs,
    activeId, setActiveId,
    renaming, setRenaming, renameConversation, deleteConversation, deleteAllConversations,
    caps, refreshCaps, setCapEnabled, busyCap,
    workspace, setWorkspace,
    sidebar, setSidebar,
    compact, railOpen, toggleRail, closeRail,
    panel, setPanel, togglePanel,
    panelWidth, setPanelWidth,
    panelExpanded, setPanelExpanded, togglePanelExpanded,
    theme, setTheme,
    betaPages, setBetaPages,
    notifyOnDone, setNotifyOnDone, notify,
    capabilitiesTab, setCapabilitiesTab,
    pendingPrompt, setPendingPrompt, openChatWithPrompt,
    chat: chatRef.current,
    registerChat: (actions) => Object.assign(chatRef.current, actions),
  }), [
    view, setView, server, health, healthError, refreshHealth, toasts, toast, overlay,
    conversations, refreshConvs, activeId, setActiveId, caps, refreshCaps,
    setCapEnabled, busyCap, workspace, setWorkspace, sidebar, setSidebar,
    compact, railOpen, toggleRail, closeRail, panel, setPanel, togglePanel,
    panelWidth, setPanelWidth, panelExpanded, setPanelExpanded, togglePanelExpanded,
    theme, setTheme,
    betaPages, setBetaPages,
    notifyOnDone, setNotifyOnDone, notify,
    capabilitiesTab, setCapabilitiesTab,
    pendingPrompt, openChatWithPrompt,
    renaming, renameConversation, deleteConversation, deleteAllConversations,
  ])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
