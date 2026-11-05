import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, onServerState, serverState, wakeBackend } from './api.js'
import { byId, pathFor } from './nav.js'
import { useCompact, usePhone } from './hooks/useMediaQuery.js'

import { safeStorage } from './lib/storage.js'
import { useSync } from './lib/sync/useSync.js'
import { showBoardUINotification } from './lib/boardui-notifications.js'

function pathToId(pathname) {
  if (pathname === '/') return 'today'
  if (pathname === '/chat') return 'chat'
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
    const raw = safeStorage.getItem(KEY)
    const base = raw ? JSON.parse(raw) : {}
    // Graceful migration from legacy ad-hoc keys if not already present in base
    if (base.sendWith === undefined && safeStorage.getItem('amethyst_send_with')) {
      base.sendWith = safeStorage.getItem('amethyst_send_with')
    }
    if (base.defaultGuard === undefined && safeStorage.getItem('amethyst_default_guard')) {
      base.defaultGuard = safeStorage.getItem('amethyst_default_guard')
    }
    if (base.defaultEffort === undefined && safeStorage.getItem('amethyst_default_effort')) {
      base.defaultEffort = safeStorage.getItem('amethyst_default_effort')
    }
    if (base.archiveChats === undefined && safeStorage.getItem('amethyst_archive_instead')) {
      base.archiveChats = safeStorage.getItem('amethyst_archive_instead') !== 'false'
    }
    if (base.confirmDestructive === undefined && safeStorage.getItem('amethyst_confirm_destructive')) {
      base.confirmDestructive = safeStorage.getItem('amethyst_confirm_destructive') !== 'false'
    }
    if (base.restoreTabs === undefined && safeStorage.getItem('amethyst_restore_tabs')) {
      base.restoreTabs = safeStorage.getItem('amethyst_restore_tabs') !== 'false'
    }
    if (base.showUsage === undefined && safeStorage.getItem('amethyst_show_usage')) {
      base.showUsage = safeStorage.getItem('amethyst_show_usage') !== 'false'
    }
    if (base.glassMaterial === undefined && safeStorage.getItem('amethyst_glass')) {
      base.glassMaterial = safeStorage.getItem('amethyst_glass')
    }
    if (base.shellConfirm === undefined && safeStorage.getItem('amethyst_confirm_shell')) {
      base.shellConfirm = safeStorage.getItem('amethyst_confirm_shell') !== 'false'
    }
    if (base.fileConfirm === undefined && safeStorage.getItem('amethyst_confirm_files')) {
      base.fileConfirm = safeStorage.getItem('amethyst_confirm_files') !== 'false'
    }
    if (base.netConfirm === undefined && safeStorage.getItem('amethyst_confirm_network')) {
      base.netConfirm = safeStorage.getItem('amethyst_confirm_network') !== 'false'
    }
    return base
  } catch {
    return {}
  }
}

// The preferences that follow you between devices, as opposed to the ones that
// should not. Panel width, text size, which conversation is open and which
// workspace is loaded are per-device on purpose -- a phone and a laptop want
// different answers -- so they are absent here deliberately rather than by
// omission. The server holds the same list and refuses anything outside it;
// see backend/sync/registry.py and ADR-0024.
const SYNCED_PREFS = new Set([
  'theme', 'accentColor', 'defaultGuard', 'defaultEffort', 'sendWith',
  'archiveChats', 'confirmDestructive', 'shellConfirm', 'fileConfirm',
  'netConfirm', 'showUsage', 'notifyOnDone', 'draftProvider', 'draftModel',
  'thinkingStyle',
  'editorDestination', 'confirmClose', 'fullViewDefault', 'restoreTabs',
  'preventSleep', 'autoArchiveDays', 'compressHistory', 'speedProfile',
  'followUpBehavior', 'plainTextComposer', 'showContextUsage',
  'confettiEnabled', 'defaultStandaloneChat',
])

function savePrefs(patch) {
  try {
    safeStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* private mode, or a full quota: preferences are a convenience, not state */
  }
  // localStorage stays the source of truth for the browser, and the server is
  // told separately. Deliberately not awaited and deliberately unable to throw:
  // a backend that is asleep must not stop a theme from changing, and the write
  // above has already happened. The change reaches the other devices on the
  // next relay poll, or on the next preference change after the backend wakes.
  const crossing = {}
  for (const [name, value] of Object.entries(patch)) {
    if (SYNCED_PREFS.has(name)) crossing[name] = value
  }
  if (Object.keys(crossing).length) {
    api.savePreferences(crossing).catch(() => { /* offline; localStorage holds */ })
  }
}

// What the user's other devices have changed since this browser last looked.
//
// Applied to localStorage rather than to React state: every preference here is
// read through `loadPrefs` at mount, and the ones with a live visual effect
// (theme, accent) are applied to documentElement by the provider below. Writing
// the blob and letting the next read pick it up avoids threading fourteen
// setters through a network callback.
async function adoptRemotePrefs() {
  try {
    const { preferences } = await api.preferences()
    if (!preferences || !Object.keys(preferences).length) return null
    const current = loadPrefs()
    const merged = {}
    for (const [name, raw] of Object.entries(preferences)) {
      if (!SYNCED_PREFS.has(name)) continue
      // The server stores every value as text; restore the shape the interface
      // expects, so a boolean does not come back as the string "false" -- which
      // is truthy, and would silently invert every confirmation setting.
      const before = current[name]
      const value = typeof before === 'boolean' ? raw === 'true' || raw === '1' : raw
      if (value !== before) merged[name] = value
    }
    if (!Object.keys(merged).length) return null
    safeStorage.setItem(KEY, JSON.stringify({ ...current, ...merged }))
    return merged
  } catch {
    return null   // offline, or an older backend with no /preferences route
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
export const THEMES = ['system', 'graphite', 'ink', 'nocturne', 'nvidia', 'paper', 'sand', 'claude', 'cursor']
export const DARK_THEMES = ['graphite', 'ink', 'nocturne', 'nvidia']
export const LIGHT_THEMES = ['paper', 'sand', 'claude', 'cursor']

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
  const prefs = loadPrefs()
  const darkPref = prefs.preferredDarkTheme || 'graphite'
  const lightPref = prefs.preferredLightTheme || 'paper'
  /* Resolve `system` to the machine's preference, then stamp it. All
     themes map to either a dark or light colour scheme for the browser chrome. */
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? darkPref : lightPref)
    : theme
  root.setAttribute('data-theme', resolved)
  const isDark = DARK_THEMES.includes(resolved)
  root.setAttribute('data-theme-mode', isDark ? 'dark' : 'light')
  root.style.colorScheme = isDark ? 'dark' : 'light'
  root.classList.toggle('dark', isDark)
  root.classList.toggle('dark-mode', isDark)
  root.classList.toggle('light', !isDark)
  const tag = document.querySelector('meta[name="theme-color"]')
  if (tag) {
    const canvas = getComputedStyle(root).getPropertyValue('--canvas').trim()
    if (canvas) tag.setAttribute('content', canvas)
  }
}

// Applied before React mounts, so the first paint is already the right colour.
applyTheme(THEMES.includes(loadPrefs().theme) ? loadPrefs().theme : 'graphite')

function applyAccentColor(hex) {
  const root = document.documentElement
  const styleTag = document.getElementById('custom-accent-style')
  if (styleTag) styleTag.remove()

  const accentKeys = [
    '--accent', '--accent-hover', '--accent-line', '--accent-soft', '--accent-wash',
    '--ember', '--focus-ring', '--color-brand', '--primary',
    '--color-accent-50', '--color-accent-100', '--color-accent-200', '--color-accent-300',
    '--color-accent-400', '--color-accent-500', '--color-accent-600', '--color-accent-700',
    '--color-accent-800', '--color-accent-900', '--color-accent-950'
  ]

  if (!hex || typeof hex !== 'string') {
    accentKeys.forEach((key) => root.style.removeProperty(key))
    return
  }

  const validHex = hex.startsWith('#') ? hex : '#' + hex
  const hoverHex = `color-mix(in srgb, ${validHex} 82%, black)`
  const softHex = `color-mix(in srgb, ${validHex} 18%, transparent)`
  const washHex = `color-mix(in srgb, ${validHex} 9%, transparent)`
  const ringHex = `color-mix(in srgb, ${validHex} 35%, transparent)`

  root.style.setProperty('--accent', validHex)
  root.style.setProperty('--accent-hover', hoverHex)
  root.style.setProperty('--accent-line', validHex)
  root.style.setProperty('--accent-soft', softHex)
  root.style.setProperty('--accent-wash', washHex)
  root.style.setProperty('--ember', validHex)
  root.style.setProperty('--focus-ring', ringHex)

  // Tailwind / BoardUI 11-step ramp
  root.style.setProperty('--color-accent-50', `color-mix(in srgb, ${validHex} 6%, white)`)
  root.style.setProperty('--color-accent-100', `color-mix(in srgb, ${validHex} 12%, white)`)
  root.style.setProperty('--color-accent-200', `color-mix(in srgb, ${validHex} 24%, white)`)
  root.style.setProperty('--color-accent-300', `color-mix(in srgb, ${validHex} 45%, white)`)
  root.style.setProperty('--color-accent-400', `color-mix(in srgb, ${validHex} 70%, white)`)
  root.style.setProperty('--color-accent-500', validHex)
  root.style.setProperty('--color-accent-600', `color-mix(in srgb, ${validHex} 85%, black)`)
  root.style.setProperty('--color-accent-700', `color-mix(in srgb, ${validHex} 70%, black)`)
  root.style.setProperty('--color-accent-800', `color-mix(in srgb, ${validHex} 52%, black)`)
  root.style.setProperty('--color-accent-900', `color-mix(in srgb, ${validHex} 36%, black)`)
  root.style.setProperty('--color-accent-950', `color-mix(in srgb, ${validHex} 20%, black)`)
  root.style.setProperty('--color-brand', validHex)
  root.style.setProperty('--primary', validHex)
}
applyAccentColor(loadPrefs().accentColor)

function applyTextSize(pct) {
  const root = document.documentElement
  const scale = pct / 100
  if (typeof window !== 'undefined' && window.amethystDesktop?.setZoomFactor) {
    window.amethystDesktop.setZoomFactor(scale)
    root.style.setProperty('--ui-scale', 1)
    root.style.setProperty('--text-scale', 1)
  } else {
    root.style.setProperty('--ui-scale', scale)
    root.style.setProperty('--text-scale', scale)
  }
  root.style.fontSize = ''
}

function applyDensity(density) {
  const root = document.documentElement
  root.setAttribute('data-density', density)
}

// Apply persisted values before React mounts.
applyTextSize(loadPrefs().textSize || 100)
applyDensity(loadPrefs().density || 'comfortable')
if (typeof document !== 'undefined') document.documentElement.setAttribute('data-glass', loadPrefs().glassMaterial || 'full')
// Before mount, like the material above: the spotlight can be summoned within a
// frame of the page loading, and reading this from state would mean the first
// summon of a session played the default animation rather than the chosen one.
if (typeof document !== 'undefined') document.documentElement.setAttribute('data-spotlight-anim', loadPrefs().spotlightAnimation || 'spring')

export function applyAppearanceSettings(prefs = {}) {
  if (typeof document === 'undefined') return
  const root = document.documentElement

  if (prefs.uiFontSize) {
    root.style.setProperty('--ui-font-size', `${prefs.uiFontSize}px`)
    root.style.setProperty('--text-scale', prefs.uiFontSize / 14)
  }
  if (prefs.codeFontSize) {
    root.style.setProperty('--code-font-size', `${prefs.codeFontSize}px`)
  }
  if (prefs.reduceMotion) {
    root.setAttribute('data-reduce-motion', prefs.reduceMotion)
  }
  if (prefs.uiFontStyle) {
    root.style.setProperty('--font-weight-ui', prefs.uiFontStyle)
  }
  if (prefs.fontFamily && prefs.fontFamily !== 'system') {
    const familyMap = {
      inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      'plus-jakarta': "'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif",
      geist: "'Geist', 'Inter', -apple-system, sans-serif",
      serif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
    }
    if (familyMap[prefs.fontFamily]) {
      const fam = familyMap[prefs.fontFamily]
      root.style.setProperty('--font-sans', fam)
      root.style.setProperty('--font-body', fam)
      root.style.setProperty('--font-display', fam)
      root.style.setProperty('--font-openai-sans', fam)
    }
  } else if (prefs.fontFamily === 'system') {
    root.style.removeProperty('--font-sans')
    root.style.removeProperty('--font-body')
    root.style.removeProperty('--font-display')
    root.style.removeProperty('--font-openai-sans')
  }

  if (prefs.codeFont && prefs.codeFont !== 'system') {
    const codeMap = {
      geist: "'Geist Mono', ui-monospace, monospace",
      jetbrains: "'JetBrains Mono', ui-monospace, monospace",
      fira: "'Fira Code', ui-monospace, monospace",
      sfmono: "'SF Mono', Monaco, Menlo, monospace",
    }
    if (codeMap[prefs.codeFont]) {
      root.style.setProperty('--font-mono', codeMap[prefs.codeFont])
    }
  } else if (prefs.codeFont === 'system') {
    root.style.removeProperty('--font-mono')
  }

  if (prefs.contentFont && prefs.contentFont !== 'same') {
    const contentMap = {
      inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      system: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif",
      serif: "Charter, 'Bitstream Charter', 'Sitka Text', Cambria, serif",
    }
    if (contentMap[prefs.contentFont]) {
      root.style.setProperty('--font-chat-prose', contentMap[prefs.contentFont])
      root.style.setProperty('--font-body', contentMap[prefs.contentFont])
    }
  } else if (prefs.contentFont === 'same') {
    root.style.removeProperty('--font-chat-prose')
    root.style.removeProperty('--font-body')
  }

  if (prefs.contentFontWeight) {
    root.style.setProperty('--font-weight-content', prefs.contentFontWeight)
  }
  if (prefs.codeFontWeight) {
    root.style.setProperty('--font-weight-code', prefs.codeFontWeight)
  }

  if (prefs.contrast !== undefined) {
    const factor = Number(prefs.contrast) / 60
    root.style.setProperty('--contrast-factor', factor)
  }

  if (prefs.diffMarkers) {
    root.setAttribute('data-diff-style', prefs.diffMarkers)
  }

  root.setAttribute('data-pointer-cursors', prefs.pointerCursors ? 'true' : 'false')

  if (prefs.customBg) {
    root.style.setProperty('--canvas', prefs.customBg)
    root.style.setProperty('--surface', prefs.customBg)
    root.style.setProperty('--bg-app', prefs.customBg)
  } else {
    root.style.removeProperty('--canvas')
    root.style.removeProperty('--surface')
    root.style.removeProperty('--bg-app')
  }

  if (prefs.customFg) {
    root.style.setProperty('--text', prefs.customFg)
  } else {
    root.style.removeProperty('--text')
  }
}

applyAppearanceSettings(loadPrefs())


export function AppProvider({ children }) {
  const prefs = useRef(loadPrefs()).current
  const location = useLocation()
  const navigate = useNavigate()
  /* Below this width the rail is a drawer over the page rather than a column
     beside it, so "is the rail showing" stops being one persisted preference
     and becomes two different questions. See `railOpen` below. */
  const compact = useCompact()
  const isPhone = usePhone()

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
  const [overlay, setOverlay] = useState(null) // 'palette' | 'shortcuts' | null

  const [conversations, setConversations] = useState([])
  const [activeId, setActiveIdRaw] = useState((prefs.restoreTabs !== false) ? prefs.activeId || null : null)
  const [userProfile, setUserProfile] = useState(() => {
    try {
      const cached = safeStorage.getItem('amethyst_user_profile')
      return cached ? JSON.parse(cached) : null
    } catch {
      return null
    }
  })
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
  // The context panel on the right of the workbench (artifacts / run details).
  // Defaults to false so each view has its own full clean canvas without unwanted split screen.
  const [panel, setPanelRaw] = useState(prefs.panel === true)
  /* How wide the side panel is, and whether it has taken over the window.

     Width is a preference because it is a decision about this screen and this
     pair of eyes -- it should survive a reload the way the rail's own state
     does. Expanded is deliberately *not* persisted: filling the window is
     something you do to read one document, and coming back tomorrow to an app
     with no conversation in it would be a puzzle rather than a memory. */
  const [panelWidth, setPanelWidthRaw] = useState(() => clampPanel(prefs.panelWidth))
  const [panelExpanded, setPanelExpanded] = useState(false)
  
  const [accentColor, setAccentColorRaw] = useState(prefs.accentColor || '')
  const setAccentColor = useCallback((value) => {
    setAccentColorRaw(value)
    applyAccentColor(value)
    savePrefs({ accentColor: value })
  }, [])

  const [theme, setThemeRaw] = useState(
    () => (THEMES.includes(prefs.theme) ? prefs.theme : 'graphite'),
  )

  /* Text size, density, agent loader animation, default guard mode, reasoning
     effort, and send key — all persisted preferences that shape how the
     interface feels and behaves. */
  const [textSize, setTextSizeRaw] = useState(() => {
    const n = Number(prefs.textSize)
    return Number.isFinite(n) ? Math.min(200, Math.max(50, n)) : 100
  })
  const setTextSize = useCallback((value) => {
    const n = Math.min(200, Math.max(50, Math.round(value)))
    setTextSizeRaw(n)
    applyTextSize(n)
    savePrefs({ textSize: n })
  }, [])

  const [density, setDensityRaw] = useState(prefs.density || 'comfortable')
  const setDensity = useCallback((value) => {
    const v = value === 'compact' ? 'compact' : 'comfortable'
    setDensityRaw(v)
    applyDensity(v)
    savePrefs({ density: v })
  }, [])

  const [agentLoader, setAgentLoaderRaw] = useState(prefs.agentLoader || 'pixels')
  const setAgentLoader = useCallback((value) => {
    setAgentLoaderRaw(value)
    savePrefs({ agentLoader: value })
  }, [])

  const [autoHideTopBar, setAutoHideTopBarRaw] = useState(prefs.autoHideTopBar === true)
  const setAutoHideTopBar = useCallback((value) => {
    setAutoHideTopBarRaw(Boolean(value))
    savePrefs({ autoHideTopBar: Boolean(value) })
  }, [])

  const [defaultGuard, setDefaultGuardRaw] = useState(prefs.defaultGuard || 'guard')
  const setDefaultGuard = useCallback((value) => {
    setDefaultGuardRaw(value)
    savePrefs({ defaultGuard: value })
  }, [])

  const [defaultEffort, setDefaultEffortRaw] = useState(prefs.defaultEffort || 'high')
  const setDefaultEffort = useCallback((value) => {
    setDefaultEffortRaw(value)
    savePrefs({ defaultEffort: value })
  }, [])

  const [sendWith, setSendWithRaw] = useState(prefs.sendWith || 'enter')
  const setSendWith = useCallback((value) => {
    setSendWithRaw(value)
    savePrefs({ sendWith: value })
  }, [])

  const [archiveChats, setArchiveChatsRaw] = useState(prefs.archiveChats !== false)
  const setArchiveChats = useCallback((value) => { setArchiveChatsRaw(value); savePrefs({ archiveChats: value }) }, [])
  const [confirmDestructive, setConfirmDestructiveRaw] = useState(prefs.confirmDestructive !== false)
  const setConfirmDestructive = useCallback((value) => { setConfirmDestructiveRaw(value); savePrefs({ confirmDestructive: value }) }, [])
  const [restoreTabs, setRestoreTabsRaw] = useState(prefs.restoreTabs !== false)
  const setRestoreTabs = useCallback((value) => { setRestoreTabsRaw(value); savePrefs({ restoreTabs: value }) }, [])
  const [showUsage, setShowUsageRaw] = useState(prefs.showUsage === true)
  const setShowUsage = useCallback((value) => { setShowUsageRaw(value); savePrefs({ showUsage: value }) }, [])

  const [draftProvider, setDraftProviderRaw] = useState(prefs.draftProvider || 'auto')
  const setDraftProvider = useCallback((value) => { setDraftProviderRaw(value); savePrefs({ draftProvider: value }) }, [])
  const [draftModel, setDraftModelRaw] = useState(prefs.draftModel || '')
  const setDraftModel = useCallback((value) => { setDraftModelRaw(value); savePrefs({ draftModel: value }) }, [])

  const [spotlightAnimation, setSpotlightAnimationRaw] = useState(prefs.spotlightAnimation || 'spring')
  const setSpotlightAnimation = useCallback((value) => {
    setSpotlightAnimationRaw(value)
    savePrefs({ spotlightAnimation: value })
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-spotlight-anim', value)
    }
  }, [])

  const [glassMaterial, setGlassMaterialRaw] = useState(prefs.glassMaterial || 'full')
  const setGlassMaterial = useCallback((value) => {
    setGlassMaterialRaw(value)
    savePrefs({ glassMaterial: value })
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-glass', value)
    }
  }, [])

  const [thinkingStyle, setThinkingStyleRaw] = useState(prefs.thinkingStyle || 'cards')
  const setThinkingStyle = useCallback((value) => {
    const v = (value === 'chips' || value === 'activity') ? value : 'cards'
    setThinkingStyleRaw(v)
    savePrefs({ thinkingStyle: v })
  }, [])

  /* Codex Appearance Preferences */
  const [uiFontSize, setUiFontSizeRaw] = useState(() => Number(prefs.uiFontSize) || 14)
  const setUiFontSize = useCallback((val) => {
    const n = Math.min(22, Math.max(10, Math.round(Number(val) || 14)))
    setUiFontSizeRaw(n)
    savePrefs({ uiFontSize: n })
    applyAppearanceSettings({ ...loadPrefs(), uiFontSize: n })
  }, [])

  const [codeFontSize, setCodeFontSizeRaw] = useState(() => Number(prefs.codeFontSize) || 12)
  const setCodeFontSize = useCallback((val) => {
    const n = Math.min(22, Math.max(9, Math.round(Number(val) || 12)))
    setCodeFontSizeRaw(n)
    savePrefs({ codeFontSize: n })
    applyAppearanceSettings({ ...loadPrefs(), codeFontSize: n })
  }, [])

  const [reduceMotion, setReduceMotionRaw] = useState(prefs.reduceMotion || 'system')
  const setReduceMotion = useCallback((val) => {
    setReduceMotionRaw(val)
    savePrefs({ reduceMotion: val })
    applyAppearanceSettings({ ...loadPrefs(), reduceMotion: val })
  }, [])

  const [separateLightDark, setSeparateLightDarkRaw] = useState(Boolean(prefs.separateLightDark))
  const setSeparateLightDark = useCallback((val) => {
    const b = Boolean(val)
    setSeparateLightDarkRaw(b)
    savePrefs({ separateLightDark: b })
  }, [])

  const [preferredDarkTheme, setPreferredDarkThemeRaw] = useState(prefs.preferredDarkTheme || 'graphite')
  const setPreferredDarkTheme = useCallback((val) => {
    setPreferredDarkThemeRaw(val)
    savePrefs({ preferredDarkTheme: val })
    if (loadPrefs().theme === 'system') applyTheme('system')
  }, [])

  const [preferredLightTheme, setPreferredLightThemeRaw] = useState(prefs.preferredLightTheme || 'paper')
  const setPreferredLightTheme = useCallback((val) => {
    setPreferredLightThemeRaw(val)
    savePrefs({ preferredLightTheme: val })
    if (loadPrefs().theme === 'system') applyTheme('system')
  }, [])

  const [uiFontStyle, setUiFontStyleRaw] = useState(prefs.uiFontStyle || '400')
  const setUiFontStyle = useCallback((val) => {
    setUiFontStyleRaw(val)
    savePrefs({ uiFontStyle: val })
    applyAppearanceSettings({ ...loadPrefs(), uiFontStyle: val })
  }, [])

  const [contentFont, setContentFontRaw] = useState(prefs.contentFont || 'same')
  const setContentFont = useCallback((val) => {
    setContentFontRaw(val)
    savePrefs({ contentFont: val })
    applyAppearanceSettings({ ...loadPrefs(), contentFont: val })
  }, [])

  const [contentFontWeight, setContentFontWeightRaw] = useState(prefs.contentFontWeight || '400')
  const setContentFontWeight = useCallback((val) => {
    setContentFontWeightRaw(val)
    savePrefs({ contentFontWeight: val })
  }, [])

  const [codeFont, setCodeFontRaw] = useState(prefs.codeFont || 'system')
  const setCodeFont = useCallback((val) => {
    setCodeFontRaw(val)
    savePrefs({ codeFont: val })
    applyAppearanceSettings({ ...loadPrefs(), codeFont: val })
  }, [])

  const [codeFontWeight, setCodeFontWeightRaw] = useState(prefs.codeFontWeight || '400')
  const setCodeFontWeight = useCallback((val) => {
    setCodeFontWeightRaw(val)
    savePrefs({ codeFontWeight: val })
  }, [])

  const [contrast, setContrastRaw] = useState(prefs.contrast !== undefined ? Number(prefs.contrast) : 60)
  const setContrast = useCallback((val) => {
    const n = Math.min(100, Math.max(30, Math.round(Number(val) || 60)))
    setContrastRaw(n)
    savePrefs({ contrast: n })
    applyAppearanceSettings({ ...loadPrefs(), contrast: n })
  }, [])

  const [diffMarkers, setDiffMarkersRaw] = useState(prefs.diffMarkers || 'color')
  const setDiffMarkers = useCallback((val) => {
    setDiffMarkersRaw(val)
    savePrefs({ diffMarkers: val })
    applyAppearanceSettings({ ...loadPrefs(), diffMarkers: val })
  }, [])

  const [pointerCursors, setPointerCursorsRaw] = useState(Boolean(prefs.pointerCursors))
  const setPointerCursors = useCallback((val) => {
    const b = Boolean(val)
    setPointerCursorsRaw(b)
    savePrefs({ pointerCursors: b })
    applyAppearanceSettings({ ...loadPrefs(), pointerCursors: b })
  }, [])

  const [customBg, setCustomBgRaw] = useState(prefs.customBg || '')
  const setCustomBg = useCallback((val) => {
    setCustomBgRaw(val)
    savePrefs({ customBg: val })
    applyAppearanceSettings({ ...loadPrefs(), customBg: val })
  }, [])

  const [customFg, setCustomFgRaw] = useState(prefs.customFg || '')
  const setCustomFg = useCallback((val) => {
    setCustomFgRaw(val)
    savePrefs({ customFg: val })
    applyAppearanceSettings({ ...loadPrefs(), customFg: val })
  }, [])

  const [fontFamily, setFontFamilyRaw] = useState(prefs.fontFamily || 'system')
  const setFontFamily = useCallback((val) => {
    setFontFamilyRaw(val)
    savePrefs({ fontFamily: val })
    applyAppearanceSettings({ ...loadPrefs(), fontFamily: val })
  }, [])

  const [shellConfirm, setShellConfirmRaw] = useState(prefs.shellConfirm !== false)
  const setShellConfirm = useCallback((value) => { setShellConfirmRaw(value); savePrefs({ shellConfirm: value }) }, [])
  const [fileConfirm, setFileConfirmRaw] = useState(prefs.fileConfirm !== false)
  const setFileConfirm = useCallback((value) => { setFileConfirmRaw(value); savePrefs({ fileConfirm: value }) }, [])
  const [netConfirm, setNetConfirmRaw] = useState(prefs.netConfirm !== false)
  const setNetConfirm = useCallback((value) => { setNetConfirmRaw(value); savePrefs({ netConfirm: value }) }, [])

  const [editorDestination, setEditorDestinationRaw] = useState(prefs.editorDestination || 'vscode')
  const setEditorDestination = useCallback((value) => { setEditorDestinationRaw(value); savePrefs({ editorDestination: value }) }, [])

  const [confirmClose, setConfirmCloseRaw] = useState(prefs.confirmClose || 'shortcut-only')
  const setConfirmClose = useCallback((value) => { setConfirmCloseRaw(value); savePrefs({ confirmClose: value }) }, [])

  const [fullViewDefault, setFullViewDefaultRaw] = useState(Boolean(prefs.fullViewDefault))
  const setFullViewDefault = useCallback((value) => { setFullViewDefaultRaw(value); savePrefs({ fullViewDefault: value }) }, [])

  const [preventSleep, setPreventSleepRaw] = useState(Boolean(prefs.preventSleep))
  const setPreventSleep = useCallback((value) => { setPreventSleepRaw(value); savePrefs({ preventSleep: value }) }, [])

  const [autoArchiveDays, setAutoArchiveDaysRaw] = useState(Number(prefs.autoArchiveDays) || 0)
  const setAutoArchiveDays = useCallback((value) => { setAutoArchiveDaysRaw(value); savePrefs({ autoArchiveDays: value }) }, [])

  const [compressHistory, setCompressHistoryRaw] = useState(prefs.compressHistory !== false)
  const setCompressHistory = useCallback((value) => { setCompressHistoryRaw(value); savePrefs({ compressHistory: value }) }, [])

  const [speedProfile, setSpeedProfileRaw] = useState(prefs.speedProfile || 'standard')
  const setSpeedProfile = useCallback((value) => { setSpeedProfileRaw(value); savePrefs({ speedProfile: value }) }, [])

  const [followUpBehavior, setFollowUpBehaviorRaw] = useState(prefs.followUpBehavior || 'queue')
  const setFollowUpBehavior = useCallback((value) => { setFollowUpBehaviorRaw(value); savePrefs({ followUpBehavior: value }) }, [])

  const [plainTextComposer, setPlainTextComposerRaw] = useState(Boolean(prefs.plainTextComposer))
  const setPlainTextComposer = useCallback((value) => { setPlainTextComposerRaw(value); savePrefs({ plainTextComposer: value }) }, [])

  const [showContextUsage, setShowContextUsageRaw] = useState(Boolean(prefs.showContextUsage))
  const setShowContextUsage = useCallback((value) => { setShowContextUsageRaw(value); savePrefs({ showContextUsage: value }) }, [])

  const [confettiEnabled, setConfettiEnabledRaw] = useState(Boolean(prefs.confettiEnabled))
  const setConfettiEnabled = useCallback((value) => { setConfettiEnabledRaw(value); savePrefs({ confettiEnabled: value }) }, [])

  const [defaultStandaloneChat, setDefaultStandaloneChatRaw] = useState(Boolean(prefs.defaultStandaloneChat))
  const setDefaultStandaloneChat = useCallback((value) => { setDefaultStandaloneChatRaw(value); savePrefs({ defaultStandaloneChat: value }) }, [])

  const resetAllPreferences = useCallback(() => {
    safeStorage.clear()
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }, [])

  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(280)
  const [terminalMinimized, setTerminalMinimized] = useState(false)
  const toggleTerminal = useCallback(() => {
    setTerminalOpen((prev) => !prev)
    setTerminalMinimized(false)
  }, [])


  const [onboardingDone, setOnboardingDoneRaw] = useState(prefs.onboardingDone ?? false)
  const setOnboardingDone = useCallback((value) => {
    setOnboardingDoneRaw(value)
    savePrefs({ onboardingDone: value })
    if (value) {
      api.completeSetup().catch(() => {})
    }
  }, [])
  const openOnboarding = useCallback(() => {
    setOnboardingDone(false)
  }, [setOnboardingDone])
  const openSetupWizard = openOnboarding
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

  // Today is the default home. Explicit deep links still open their destination.
  useEffect(() => {
    if (location.pathname === '/') navigate('/today', { replace: true })
  }, [location.pathname, navigate])

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
    if (DARK_THEMES.includes(value)) {
      setPreferredDarkThemeRaw(value)
      savePrefs({ preferredDarkTheme: value })
    } else if (LIGHT_THEMES.includes(value)) {
      setPreferredLightThemeRaw(value)
      savePrefs({ preferredLightTheme: value })
    }
  }, [])

  /* Beta pages -- Mail and Automations -- are hidden until this is on.

     Off by default, and per-browser like the rest of `prefs`: it decides what
     this interface shows, not what the server will do, so it has no business
     in the backend settings. `nav.js` is where "hidden" is spelled out; every
     surface that lists pages reads it from there rather than keeping its own
     idea of which ones exist. */
  const [betaPages, setBetaPagesRaw] = useState(prefs.betaPages !== false)
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
    if (persist) {
      setPanelWidthRaw(next)
      savePrefs({ panelWidth: next })
    }
    // Update the DOM element directly during drag to avoid app-wide re-renders
    const panelEl = document.getElementById('wb-panel')
    if (panelEl) {
      panelEl.style.setProperty('--panel-w', `${next}px`)
    }
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

  const toast = useCallback((payload, tone = 'info') => {
    return showBoardUINotification(payload, tone)
  }, [])

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api.health()
      setHealth((prev) => {
        if (!prev) return h
        if (
          prev.phase === h.phase &&
          prev.tools === h.tools &&
          prev.skills === h.skills &&
          prev.running === h.running &&
          prev.error === h.error &&
          prev.version === h.version
        ) {
          return prev
        }
        return h
      })
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
      const list = Array.isArray(rows) ? rows : []
      setConversations((prev) => {
        if (Array.isArray(prev) && prev.length === list.length) {
          const unchanged = prev.every((p, i) => {
            const r = list[i]
            return p.id === r.id && p.updated_at === r.updated_at && p.title === r.title
          })
          if (unchanged) return prev
        }
        return list
      })
      return list
    } catch (err) {
      setHealthError(err.message)
      return []
    }
  }, [])

  const updateConversationOptimistic = useCallback((id, patch) => {
    if (!id || !patch) return
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    )
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
    const doArchive = loadPrefs().archiveChats !== false;
    try {
      await api.deleteConversation(id, doArchive)
    } catch (err) {
      toast(err.message, 'bad')
      return false
    }
    const rows = await refreshConvs()
    if (id === activeId) {
      const nextId = rows.find((c) => c.id !== id)?.id ?? null
      if (nextId) {
        if (chatRef.current?.selectConversation) {
          chatRef.current.selectConversation(nextId)
        } else {
          setActiveId(nextId)
        }
      } else {
        setActiveId(null)
        chatRef.current?.startFresh?.()
      }
    }
    toast(doArchive ? 'Conversation archived' : 'Conversation deleted', 'info')
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
      setCaps((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
          return prev
        }
        return next
      })
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

  const refreshUserProfile = useCallback(async () => {
    try {
      const p = await api.userProfile()
      if (p?.name) {
        setUserProfile(p)
        try {
          safeStorage.setItem('amethyst_user_profile', JSON.stringify(p))
        } catch {}
        return p
      }
    } catch {}
    try {
      const acc = await api.mailAccount()
      if (acc?.address) {
        const email = acc.address
        const local = email.split('@')[0]
        const name = local.toLowerCase().includes('wayne') ? 'Wayne' : (local.charAt(0).toUpperCase() + local.slice(1))
        const profile = { name, full_name: name, email }
        setUserProfile(profile)
        return profile
      }
    } catch {}
    return null
  }, [])

  const updateUserProfile = useCallback(async (patch) => {
    try {
      const updated = await api.updateUserProfile(patch)
      setUserProfile(updated)
      try {
        safeStorage.setItem('amethyst_user_profile', JSON.stringify(updated))
      } catch {}
      return updated
    } catch (err) {
      toast(err.message || 'Failed to update profile', 'bad')
      throw err
    }
  }, [toast])

  useEffect(() => onServerState(setServer), [])

  // Nothing is fetched until the backend answers. Firing the first load against
  // a container that is still booting spends the whole cold start on requests
  // that time out, and then the interface has to be told to try again -- so the
  // three opening calls wait on the wake instead, and every one of them lands.
  const ready = server.phase === 'ready'
  useEffect(() => { if (ready) refreshHealth() }, [ready, refreshHealth])
  useEffect(() => { if (ready) refreshConvs() }, [ready, refreshConvs])
  useEffect(() => { if (ready) refreshCaps() }, [ready, refreshCaps])
  useEffect(() => { if (ready) refreshUserProfile() }, [ready, refreshUserProfile])
  useEffect(() => {
    if (!ready) return
    api.setupStatus().then((status) => {
      if (status?.setup?.completed) {
        setOnboardingDoneRaw(true)
        savePrefs({ onboardingDone: true })
      }
    }).catch(() => {})
  }, [ready])

  /* The phone's poll.
   *
   * The question this answers is "is this browser a control device, or is it
   * the machine's own interface". A machine syncs through `RelayPoller` in
   * Python already, and a second poll from the browser sitting on top of it
   * would be two devices' worth of requests for one device.
   *
   * "No backend answers" was the whole test, and it is only half of one. It is
   * right for a phone out in the world. It is wrong for a phone on the same
   * network as the machine, where the server does answer -- and that phone is
   * still not the machine. It got the remote view and then never polled, so the
   * transcript it showed was whatever had arrived before, forever.
   *
   * A handheld is never the machine, so it polls either way.
   */
  const onSyncedPrefs = useCallback((changed) => {
    if (changed.theme !== undefined) { setThemeRaw(changed.theme); applyTheme(changed.theme) }
    if (changed.accentColor !== undefined) {
      setAccentColorRaw(changed.accentColor)
      applyAccentColor(changed.accentColor)
    }
    if (changed.thinkingStyle !== undefined) {
      setThinkingStyleRaw(changed.thinkingStyle)
    }
  }, [])
  useSync(server.phase !== 'ready' || isPhone, onSyncedPrefs)

  // What the user changed on another device. Runs once the backend answers, on
  // the same "wait for the wake" rule as the four above. The theme and accent
  // are re-applied by hand because both are written to documentElement before
  // React mounts, so a value that arrives afterwards has nothing else to pick
  // it up. The remaining preferences are read through `loadPrefs` wherever they
  // are used and need no nudge.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    adoptRemotePrefs().then((adopted) => {
      if (cancelled || !adopted) return
      if (adopted.theme !== undefined) { setThemeRaw(adopted.theme); applyTheme(adopted.theme) }
      if (adopted.accentColor !== undefined) {
        setAccentColorRaw(adopted.accentColor)
        applyAccentColor(adopted.accentColor)
      }
      if (adopted.thinkingStyle !== undefined) {
        setThinkingStyleRaw(adopted.thinkingStyle)
      }
    })
    return () => { cancelled = true }
  }, [ready])

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

  const [updateInfo, setUpdateInfo] = useState({
    checking: false,
    available: false,
    downloaded: false,
    version: null,
    releaseUrl: null,
    error: null,
  })

  // Listen for Electron autoUpdater notifications if running in desktop shell
  useEffect(() => {
    if (typeof window !== 'undefined' && window.amethystDesktop) {
      const unsubAvail = window.amethystDesktop.onUpdateAvailable?.((info) => {
        setUpdateInfo((prev) => ({
          ...prev,
          available: true,
          version: info?.version || null,
        }))
        toast(`Amethyst update ${info?.version ? `v${info.version}` : ''} is downloading...`, 'ok')
      })
      const unsubDown = window.amethystDesktop.onUpdateDownloaded?.((info) => {
        setUpdateInfo((prev) => ({
          ...prev,
          available: true,
          downloaded: true,
          version: info?.version || null,
        }))
        toast(`Amethyst update ${info?.version ? `v${info.version}` : ''} is ready to install!`, 'ok')
      })
      return () => {
        unsubAvail?.()
        unsubDown?.()
      }
    }
  }, [toast])

  const checkForUpdates = useCallback(async (manual = false) => {
    setUpdateInfo((prev) => ({ ...prev, checking: true, error: null }))
    try {
      if (typeof window !== 'undefined' && window.amethystDesktop?.checkForUpdates) {
        const res = await window.amethystDesktop.checkForUpdates()
        if (res?.updateInfo?.version) {
          setUpdateInfo((prev) => ({
            ...prev,
            available: true,
            version: res.updateInfo.version,
            checking: false,
          }))
          if (manual) toast(`Update found: v${res.updateInfo.version}`, 'ok')
          return
        }
      }

      // Web/fallback: check GitHub releases
      const res = await fetch('https://api.github.com/repos/wayn-wayn/amethyst/releases/latest', {
        headers: { Accept: 'application/vnd.github.v3+json' },
      }).catch(() => null)

      if (res && res.ok) {
        const data = await res.json()
        const latestTag = data.tag_name ? data.tag_name.replace(/^v/, '') : null
        const currentVersion = '0.1.3-beta'
        if (latestTag && latestTag !== currentVersion) {
          setUpdateInfo((prev) => ({
            ...prev,
            available: true,
            version: latestTag,
            releaseUrl: data.html_url,
            checking: false,
          }))
          if (manual) toast(`Update available: v${latestTag}`, 'ok')
          return
        }
      }

      setUpdateInfo((prev) => ({ ...prev, checking: false, available: false }))
      if (manual) toast('You are using the latest version of Amethyst.', 'ok')
    } catch (err) {
      setUpdateInfo((prev) => ({ ...prev, checking: false, error: err.message }))
      if (manual) toast(`Could not check for updates: ${err.message}`, 'amber')
    }
  }, [toast])

  const quitAndInstallUpdate = useCallback(() => {
    if (typeof window !== 'undefined' && window.amethystDesktop?.quitAndInstall) {
      window.amethystDesktop.quitAndInstall()
    } else if (updateInfo.releaseUrl) {
      window.open(updateInfo.releaseUrl, '_blank')
    }
  }, [updateInfo.releaseUrl])

  const value = useMemo(() => ({
    view, setView,
    server, retryServer: wakeBackend,
    health, healthError, refreshHealth,
    toast,
    overlay, setOverlay,
    conversations, refreshConvs, updateConversationOptimistic,
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
    accentColor, setAccentColor,
    textSize, setTextSize,
    density, setDensity,
    agentLoader, setAgentLoader,
    thinkingStyle, setThinkingStyle,
    autoHideTopBar, setAutoHideTopBar,
    uiFontSize, setUiFontSize,
    codeFontSize, setCodeFontSize,
    reduceMotion, setReduceMotion,
    separateLightDark, setSeparateLightDark,
    preferredDarkTheme, setPreferredDarkTheme,
    preferredLightTheme, setPreferredLightTheme,
    uiFontStyle, setUiFontStyle,
    contentFont, setContentFont,
    contentFontWeight, setContentFontWeight,
    codeFont, setCodeFont,
    codeFontWeight, setCodeFontWeight,
    contrast, setContrast,
    diffMarkers, setDiffMarkers,
    pointerCursors, setPointerCursors,
    customBg, setCustomBg,
    customFg, setCustomFg,
    fontFamily, setFontFamily,
    defaultGuard, setDefaultGuard,
    guard: defaultGuard, setGuard: setDefaultGuard,
    defaultEffort, setDefaultEffort,
    sendWith, setSendWith,
    archiveChats, setArchiveChats, confirmDestructive, setConfirmDestructive, restoreTabs, setRestoreTabs, showUsage, setShowUsage, draftProvider, setDraftProvider, draftModel, setDraftModel, glassMaterial, setGlassMaterial, spotlightAnimation, setSpotlightAnimation,
    editorDestination, setEditorDestination, confirmClose, setConfirmClose, fullViewDefault, setFullViewDefault, preventSleep, setPreventSleep, autoArchiveDays, setAutoArchiveDays, compressHistory, setCompressHistory, speedProfile, setSpeedProfile, followUpBehavior, setFollowUpBehavior, plainTextComposer, setPlainTextComposer, showContextUsage, setShowContextUsage, confettiEnabled, setConfettiEnabled, defaultStandaloneChat, setDefaultStandaloneChat,
    shellConfirm, setShellConfirm, fileConfirm, setFileConfirm, netConfirm, setNetConfirm, resetAllPreferences,
    onboardingDone, setOnboardingDone, openOnboarding, openSetupWizard,
    betaPages, setBetaPages,
    notifyOnDone, setNotifyOnDone, notify,
    capabilitiesTab, setCapabilitiesTab,
    pendingPrompt, setPendingPrompt, openChatWithPrompt,
    userProfile, refreshUserProfile, updateUserProfile,
    terminalOpen, setTerminalOpen, toggleTerminal,
    terminalHeight, setTerminalHeight,
    terminalMinimized, setTerminalMinimized,
    updateInfo, checkForUpdates, quitAndInstallUpdate,
    chat: chatRef.current,
    registerChat: (actions) => Object.assign(chatRef.current, actions),
  }), [
    view, setView, server, health, healthError, refreshHealth, toast, overlay,
    conversations, refreshConvs, updateConversationOptimistic, activeId, setActiveId, caps, refreshCaps,
    setCapEnabled, busyCap, workspace, setWorkspace, sidebar, setSidebar,
    compact, railOpen, toggleRail, closeRail, panel, setPanel, togglePanel,
    panelWidth, setPanelWidth, panelExpanded, setPanelExpanded, togglePanelExpanded,
    theme, setTheme,
    accentColor, setAccentColor,
    textSize, setTextSize,
    density, setDensity,
    agentLoader, setAgentLoader,
    thinkingStyle, setThinkingStyle,
    autoHideTopBar, setAutoHideTopBar,
    uiFontSize, setUiFontSize,
    codeFontSize, setCodeFontSize,
    reduceMotion, setReduceMotion,
    separateLightDark, setSeparateLightDark,
    preferredDarkTheme, setPreferredDarkTheme,
    preferredLightTheme, setPreferredLightTheme,
    uiFontStyle, setUiFontStyle,
    contentFont, setContentFont,
    contentFontWeight, setContentFontWeight,
    codeFont, setCodeFont,
    codeFontWeight, setCodeFontWeight,
    contrast, setContrast,
    diffMarkers, setDiffMarkers,
    pointerCursors, setPointerCursors,
    customBg, setCustomBg,
    customFg, setCustomFg,
    fontFamily, setFontFamily,
    defaultGuard, setDefaultGuard,
    defaultEffort, setDefaultEffort,
    sendWith, setSendWith,
    archiveChats, setArchiveChats, confirmDestructive, setConfirmDestructive, restoreTabs, setRestoreTabs, showUsage, setShowUsage, draftProvider, setDraftProvider, draftModel, setDraftModel, glassMaterial, setGlassMaterial, spotlightAnimation, setSpotlightAnimation,
    editorDestination, setEditorDestination, confirmClose, setConfirmClose, fullViewDefault, setFullViewDefault, preventSleep, setPreventSleep, autoArchiveDays, setAutoArchiveDays, compressHistory, setCompressHistory, speedProfile, setSpeedProfile, followUpBehavior, setFollowUpBehavior, plainTextComposer, setPlainTextComposer, showContextUsage, setShowContextUsage, confettiEnabled, setConfettiEnabled, defaultStandaloneChat, setDefaultStandaloneChat,
    shellConfirm, fileConfirm, netConfirm, resetAllPreferences,
    onboardingDone, setOnboardingDone, openOnboarding, openSetupWizard,
    betaPages, setBetaPages,
    notifyOnDone, setNotifyOnDone, notify,
    capabilitiesTab, setCapabilitiesTab,
    pendingPrompt, openChatWithPrompt,
    userProfile, refreshUserProfile, updateUserProfile,
    renaming, renameConversation, deleteConversation, deleteAllConversations,
    terminalOpen, toggleTerminal, terminalHeight, terminalMinimized,
    updateInfo, checkForUpdates, quitAndInstallUpdate,
  ])

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
