import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { useApp } from '../store.jsx'
import { api, copyText, openUrl } from '../api.js'
import { pretty } from '../keys.js'
import { connectorState } from './connectorState.js'
import { forPalette } from '../nav.js'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import { useModalDismiss, onOverlayMouseDown } from '../hooks/useModalDismiss.js'
import DamonHeader from './damon/DamonHeader.jsx'
import DamonModes, { MODES } from './damon/DamonModes.jsx'
import WebResultsView from './damon/views/WebResultsView.jsx'
import YouTubeBentoView from './damon/views/YouTubeBentoView.jsx'
import ImageGridView from './damon/views/ImageGridView.jsx'
import GitHubResultsView from './damon/views/GitHubResultsView.jsx'
import WikiSummaryView from './damon/views/WikiSummaryView.jsx'
import AnswerCardView from './damon/views/AnswerCardView.jsx'
import TasksView from './damon/views/TasksView.jsx'
import LibraryView from './damon/views/LibraryView.jsx'
import { evaluateMath } from './damon/calculator.js'
import { peek, put } from './damon/searchCache.js'

const THEMES = [
  { id: 'paper', icon: 'sun', label: 'Switch to Paper', hint: 'warm light palette' },
  { id: 'sand', icon: 'sun', label: 'Switch to Sand', hint: 'warm parchment light' },
  { id: 'graphite', icon: 'cpu', label: 'Switch to Graphite', hint: 'neutral dark palette' },
  { id: 'ink', icon: 'cpu', label: 'Switch to Ink', hint: 'deepest dark palette' },
  { id: 'nocturne', icon: 'cpu', label: 'Switch to Nocturne', hint: 'cool blue dark palette' },
  { id: 'system', icon: 'sliders', label: 'Follow the system theme', hint: 'light or dark, as the machine is set' },
]

const JOB_ACTIONS = {
  paused: { action: 'resume', label: 'Resume', icon: 'play' },
  queued: { action: 'pause', label: 'Pause', icon: 'stop' },
  running: { action: 'pause', label: 'Pause', icon: 'stop' },
  waiting: { action: 'pause', label: 'Pause', icon: 'stop' },
  failed: { action: 'retry', label: 'Retry', icon: 'refresh' },
}

/** Subsequence match scoring algorithm */
function score(haystack, needle) {
  if (!needle) return 0
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  const direct = h.indexOf(n)
  if (direct !== -1) return 1000 - direct - (h.length - n.length) * 0.1
  let i = 0
  let hits = 0
  let last = -1
  let gaps = 0
  for (let c = 0; c < h.length && i < n.length; c++) {
    if (h[c] === n[i]) {
      if (last !== -1) gaps += c - last - 1
      last = c
      i++
      hits++
    }
  }
  if (i < n.length) return -1
  return 400 - gaps * 2 + hits
}

/** Parse query to extract detected service and clean subject text */
function parseQueryIntent(raw) {
  const text = raw.trim()
  if (!text) return { service: null, subject: '' }

  // YouTube
  if (/^(?:>\s*youtube|youtube|yt)\s+/i.test(text)) {
    return { service: 'youtube', subject: text.replace(/^(?:>\s*youtube|youtube|yt)\s+/i, '').trim() }
  }
  // Web / Google
  if (/^(?:>\s*google|google|web)\s+/i.test(text)) {
    return { service: 'web', subject: text.replace(/^(?:>\s*google|google|web)\s+/i, '').trim() }
  }
  // Images
  if (/^(?:>\s*images?|images?|img)\s+/i.test(text)) {
    return { service: 'images', subject: text.replace(/^(?:>\s*images?|images?|img)\s+/i, '').trim() }
  }
  // Tasks
  if (/^(?:>\s*tasks?|tasks?|todo)\s+/i.test(text)) {
    return { service: 'tasks', subject: text.replace(/^(?:>\s*tasks?|tasks?|todo)\s+/i, '').trim() }
  }
  // Library
  if (/^(?:>\s*library|library|lib)\s+/i.test(text)) {
    return { service: 'library', subject: text.replace(/^(?:>\s*library|library|lib)\s+/i, '').trim() }
  }
  // GitHub
  if (/^(?:>\s*github|github|gh)\s+/i.test(text)) {
    return { service: 'github', subject: text.replace(/^(?:>\s*github|github|gh)\s+/i, '').trim() }
  }
  // Wiki
  if (/^(?:>\s*wiki|wiki)\s+/i.test(text)) {
    return { service: 'wiki', subject: text.replace(/^(?:>\s*wiki|wiki)\s+/i, '').trim() }
  }
  // Pure commands prefix
  if (/^>\s*/.test(text)) {
    return { service: 'commands', subject: text.replace(/^>\s*/, '').trim() }
  }

  return { service: null, subject: text }
}

/** Question words and shapes that mean "answer this", not "list articles".
 *
 *  Deliberately cheap: no model call to classify, no regex zoo. The words
 *  people type when they want a fact start with these, and anything that
 *  doesn't is treated as a search, which is what it was before. 'youtube' and
 *  friends never reach here -- they carry their own service prefix.
 */
const QUESTION_SHAPES = [
  /^(when|where|who|what|why|how|which|whose)\b/i,
  /\b(is|are|was|were|did|does|do|can|could|will|would|has|have)\b.*\?$/i,
  /\?$/,
]

function looksLikeQuestion(q) {
  const t = q.trim()
  if (t.length < 8) return false
  return QUESTION_SHAPES.some((re) => re.test(t))
}

export default function CommandPalette({ bare = false }) {
  const app = useApp()
  const {
    overlay, setOverlay, conversations, activeId, caps,
    setCapEnabled, busyCap, chat, toast, refreshHealth, refreshCaps,
    theme, setTheme, betaPages, openOnboarding,
  } = app

  const open = bare || overlay === 'palette'

  // Dedicated navigation handler: works seamlessly in web app and desktop pywebview
  const handleNavigate = useCallback((viewId) => {
    if (bare) {
      window.pywebview?.api?.open_main?.(viewId)
    } else {
      app.setView(viewId)
      setOverlay(null)
    }
  }, [bare, app, setOverlay])

  const hideBar = useCallback(() => {
    if (bare) window.pywebview?.api?.hide?.()
    else setOverlay(null)
  }, [bare, setOverlay])

  /* Staged close: the card fades out first, and the actual close lands after.
   *
   * An instant unmount is a visual cut, and a cut on every Esc is what makes a
   * palette feel cheap no matter how fast it opens. 120ms is short enough that
   * a second summon inside it still feels instant, and a `closingRef` guards
   * the one race there is: close then reopen inside the window.
   */
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeTimerRef = useRef(null)
  const closePalette = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      closingRef.current = false
      setClosing(false)
      hideBar()
    }, 80)
  }, [hideBar])

  const [rawQuery, setRawQuery] = useState('')
  const [selectedMode, setSelectedMode] = useState('all') // User-chosen mode
  const [index, setIndex] = useState(0)
  const [memory, setMemory] = useState(null)
  const [flash, setFlash] = useState(null)
  const [jobs, setJobs] = useState([])
  const [automations, setAutomations] = useState([])
  const [libraryItems, setLibraryItems] = useState([])
  const [tasksList, setTasksList] = useState([])

  // Search results state
  const [webResults, setWebResults] = useState([])
  // Why the results look the way they do. Only ever set to something when the
  // search fell all the way through to Wikipedia, which is the one outcome
  // that looks fine and is not.
  const [webNote, setWebNote] = useState(null)
  const [ytResults, setYtResults] = useState([])
  const [imageResults, setImageResults] = useState([])
  const [githubResults, setGithubResults] = useState([])
  const [wikiResult, setWikiResult] = useState(null)
  const [answerCard, setAnswerCard] = useState(null)
  const [searchingExternal, setSearchingExternal] = useState(false)
  const [answerPending, setAnswerPending] = useState(false)
  // Which kind, if any, failed to fetch -- so a network error reads as an error
  // with a retry, not as "no results", which is what a swallowed catch produced.
  const [searchError, setSearchError] = useState(null)
  // Infinite scroll: how deep each pool is paged, whether more exists, and
  // whether a page is in flight. Kept per kind so web and YouTube scroll on
  // their own. Reset whenever the query changes.
  const [pageState, setPageState] = useState({})
  const loadingMoreRef = useRef({})

  const listRef = useRef(null)
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const previousFocusRef = useRef(null)
  const abortCtrlRef = useRef(null)

  // Parse intent dynamically
  const { service: detectedService, subject: querySubject } = useMemo(() => {
    return parseQueryIntent(rawQuery)
  }, [rawQuery])

  // Effective mode: explicit mode tab wins, otherwise detected prefix service, otherwise 'all'
  const activeMode = useMemo(() => {
    if (selectedMode !== 'all') return selectedMode
    return detectedService || 'all'
  }, [selectedMode, detectedService])

  // Effective search keyword: if in a specific mode, use clean subject
  const effectiveQuery = useMemo(() => {
    if (detectedService) return querySubject
    return rawQuery.trim()
  }, [detectedService, querySubject, rawQuery])

  // Seamless mode switcher that cleans up the query string
  const handleSelectMode = useCallback((newMode) => {
    setSelectedMode(newMode)
    if (detectedService) {
      setRawQuery(querySubject)
    }
  }, [detectedService, querySubject])

  // Clear active mode pill (revert to 'all' while preserving query text)
  const handleClearMode = useCallback(() => {
    setSelectedMode('all')
    if (detectedService) {
      setRawQuery(querySubject)
    }
  }, [detectedService, querySubject])

  // Reliable dismissal logic: 1st Escape resets sub-mode/query, 2nd Escape closes Damon
  const handleDismiss = useCallback(() => {
    if (rawQuery.trim() || selectedMode !== 'all') {
      setRawQuery('')
      setSelectedMode('all')
      return
    }
    closePalette()
  }, [rawQuery, selectedMode, closePalette])

  useModalDismiss(open, handleDismiss)
  useFocusTrap(panelRef, open)

  // Focus management & state reload on mount
  useEffect(() => {
    if (!open) {
      if (previousFocusRef.current instanceof HTMLElement && previousFocusRef.current.isConnected) {
        previousFocusRef.current.focus()
      }
      return
    }

    previousFocusRef.current = document.activeElement
    // A summon that lands inside the exit window cancels it: the timer is
    // still holding a close for a palette that is, again, open.
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
      closingRef.current = false
      setClosing(false)
    }
    setRawQuery('')
    setSelectedMode('all')
    setIndex(0)
    setWebResults([])
    setYtResults([])
    setImageResults([])
    setGithubResults([])
    setWikiResult(null)
    setAnswerCard(null)

    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    // The native spotlight window is hidden and re-shown, and `autoFocus` only
    // fires on the first mount. The bridge calls this hook on every `shown`
    // event, which is every summon -- so the caret is in the field before the
    // hand has left the hotkey. In a browser tab the hook simply never fires.
    window.__amethyst_spotlight_shown = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    // Load initial context
    api.memory(activeId || null).then(setMemory).catch(() => setMemory(null))
    api.jobs('?limit=25').then((d) => setJobs(d.jobs || [])).catch(() => setJobs([]))
    api.automations().then((d) => setAutomations(d.automations || [])).catch(() => setAutomations([]))
    api.library({ limit: 12 }).then((d) => setLibraryItems(d.items || [])).catch(() => setLibraryItems([]))
    api.tasks({ bucket: 'all', limit: 50 }).then((d) => setTasksList(d.tasks || [])).catch(() => setTasksList([]))

    return () => { delete window.__amethyst_spotlight_shown }
  }, [open, activeId])

  // Refresh tasks callback
  const refreshTasks = useCallback(() => {
    api.tasks({ bucket: 'all', limit: 50 }).then((d) => setTasksList(d.tasks || [])).catch(() => {})
  }, [])

  // Math & unit conversion evaluation
  const mathResult = useMemo(() => {
    return evaluateMath(effectiveQuery)
  }, [effectiveQuery])

  /* External search, painted in two ages.
   *
   * What the keystroke cache already holds paints synchronously -- a query
   * retyped after a backspace shows its results before the debounce has even
   * been scheduled, with no spinner laid over content that is already true.
   * Only what memory lacks goes to the network, and each kind of result
   * lands on its own beat: the video strip no longer waits on the image
   * grid, and neither waits on the answer card.
   *
   * The answer card is the one ask that spends a model call, so it waits
   * out a half-second of true silence past the debounce. A question typed
   * word by word pays one call for the finished sentence, not one for every
   * pause between words -- and a keystroke inside that window cancels the
   * ask before it is made.
   */
  useEffect(() => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort()
      abortCtrlRef.current = null
    }

    const q = effectiveQuery.trim()
    if (!q || q.length < 2) {
      setWebResults([])
      setWebNote(null)
      setYtResults([])
      setImageResults([])
      setGithubResults([])
      setWikiResult(null)
      setAnswerCard(null)
      setSearchingExternal(false)
      setAnswerPending(false)
      setSearchError(null)
      setPageState({})
      return undefined
    }

    // A new query starts a fresh pool: forget how deep the last one was paged.
    setSearchError(null)
    setPageState({})

    const ctrl = new AbortController()
    abortCtrlRef.current = ctrl
    const gone = () => ctrl.signal.aborted
    const isQ = looksLikeQuestion(q)
    const wantsAnswer = activeMode === 'web' || (activeMode === 'all' && isQ)

    const listKinds = {
      web: ['web'], youtube: ['yt'], images: ['img'], github: ['gh'], wiki: ['wiki'],
    }[activeMode] || (activeMode === 'all' && isQ ? ['wiki', 'web', 'yt', 'img']
      : activeMode === 'all' ? ['wiki'] : [])

    const applyKind = {
      web: (v) => {
        setWebResults(v?.results || [])
        setPageState((s) => ({
          ...s,
          web: { offset: v?.next_offset ?? (v?.results || []).length, hasMore: !!v?.has_more },
        }))
        setWebNote(
          v?.source === 'wikipedia' && !v?.search_api
            ? 'No web search provider is set up, and this network blocks the free ones. These are Wikipedia articles.'
            : null,
        )
      },
      yt: (v) => {
        setYtResults(v?.results || [])
        setPageState((s) => ({
          ...s,
          yt: { offset: v?.next_offset ?? (v?.results || []).length, hasMore: !!v?.has_more },
        }))
      },
      img: (v) => setImageResults(v?.results || []),
      gh: (v) => setGithubResults(v?.results || []),
      wiki: (v) => setWikiResult(v?.result || null),
    }
    const fetchKind = {
      web: () => api.searchWeb(q, 8, ctrl.signal),
      yt: () => api.searchYouTube(q, 8, ctrl.signal),
      img: () => api.searchImages(q, 16, ctrl.signal),
      gh: () => api.searchGitHub(q, 6, ctrl.signal),
      wiki: () => api.searchWiki(q, ctrl.signal),
    }

    // The synchronous paint: whatever the cache holds is on screen now,
    // and the spinner only stands where there is nothing to stand instead.
    const hits = {}
    const got = {}
    for (const kind of listKinds) {
      const hit = peek(kind, q)
      if (hit) {
        hits[kind] = hit
        got[kind] = hit.value
        applyKind[kind](hit.value)
      }
    }
    const answerHit = wantsAnswer ? peek('answer', q) : null
    if (answerHit) setAnswerCard(answerHit.value?.answer ? answerHit.value : null)
    if (activeMode === 'all' && !isQ) {
      setWebResults([])
      setYtResults([])
      setImageResults([])
      setAnswerCard(null)
    }
    setSearchingExternal(listKinds.some((k) => !hits[k]?.fresh))
    setAnswerPending(wantsAnswer && !answerHit?.fresh)

    // One in-flight promise per kind, shared by whoever asks for it first --
    // a kind requested both as a result and as answer evidence is fetched
    // once. Stale hits refresh behind the content they are under.
    let pending = 0
    const runs = {}
    const run = (kind) => {
      if (runs[kind]) return runs[kind]
      if (hits[kind]?.fresh) return Promise.resolve(got[kind])
      pending += 1
      runs[kind] = fetchKind[kind]()
        .then((value) => {
          got[kind] = value
          put(kind, q, value)
          if (!gone()) applyKind[kind](value)
          return value
        })
        .catch(() => {
          // A swallowed failure used to be indistinguishable from "no results".
          // Only flag it when there is nothing cached to fall back to, so a
          // stale-but-shown result is not overwritten with an error.
          if (!gone() && !hits[kind]) setSearchError(kind)
          return hits[kind] ? hits[kind].value : null
        })
        .finally(() => {
          pending -= 1
          if (pending === 0 && !gone()) setSearchingExternal(false)
        })
      return runs[kind]
    }

    const timer = setTimeout(() => {
      for (const kind of listKinds) run(kind)

      if (activeMode === 'library') {
        api.library({ q, limit: 10 }).then((d) => setLibraryItems(d.items || [])).catch(() => {})
      } else if (activeMode === 'tasks') {
        // Tasks search handled client-side over tasksList
      } else if (wantsAnswer && !(answerHit && answerHit.fresh)) {
        // The answer is written from the evidence already on screen, not
        // from a second search: the web mode hands over its article list
        // and says there is no wiki to wait for; the universal mode hands
        // over both, in whatever state they landed.
        const need = activeMode === 'web' ? ['web'] : ['web', 'wiki']
        Promise.all(need.map(run)).then(([web, wiki]) => {
          setTimeout(async () => {
            if (gone()) return
            try {
              const value = await api.searchAnswer(
                q,
                ctrl.signal,
                web?.results || [],
                activeMode === 'web' ? null : (wiki ? wiki.result ?? null : undefined),
              )
              if (value?.answer) put('answer', q, value)
              if (!gone()) setAnswerCard(value?.answer ? value : null)
            } catch {
              // A missing card is not worth reporting: the evidence is on screen.
            } finally {
              if (!gone()) setAnswerPending(false)
            }
          }, 500)
        })
      }
      // 140ms rather than 220: the debounce was sized for a backend that could
      // spend six seconds on one query, where waiting longer to ask was the
      // cheapest way to ask less. The engines race now and cancel cleanly on a
      // keystroke, so the wait is only there to skip the middle of a word.
    }, 140)

    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [effectiveQuery, activeMode])

  /* Fetch the next page of a pool and append it, for infinite scroll.
   *
   * Appends rather than replaces, dedups on the key each view already uses
   * (url for web, id for video), and keeps the offset/hasMore cursor moving.
   * A ref guards against a second call firing while one is in flight -- the
   * observer can trip several times before state settles.
   */
  const loadMore = useCallback(async (kind) => {
    const page = pageState[kind]
    if (!page?.hasMore || loadingMoreRef.current[kind]) return
    const q = effectiveQuery.trim()
    if (!q) return
    loadingMoreRef.current[kind] = true
    setPageState((s) => ({ ...s, [kind]: { ...s[kind], loading: true } }))
    try {
      const fetchMore = kind === 'web' ? api.searchWeb : api.searchYouTube
      const perPage = kind === 'web' ? 8 : 8
      const value = await fetchMore(q, perPage, undefined, page.offset)
      const fresh = value?.results || []
      const seenKey = kind === 'web' ? (r) => r.url : (r) => r.id || r.url
      const setter = kind === 'web' ? setWebResults : setYtResults
      setter((prev) => {
        const seen = new Set(prev.map(seenKey))
        return [...prev, ...fresh.filter((r) => !seen.has(seenKey(r)))]
      })
      setPageState((s) => ({
        ...s,
        [kind]: {
          offset: value?.next_offset ?? page.offset + fresh.length,
          hasMore: !!value?.has_more,
          loading: false,
        },
      }))
    } catch {
      setPageState((s) => ({ ...s, [kind]: { ...s[kind], loading: false, error: true } }))
    } finally {
      loadingMoreRef.current[kind] = false
    }
  }, [pageState, effectiveQuery])

  // Master commands list
  const commands = useMemo(() => {
    const out = []

    // 1. Navigation (Core Views - Always Available & Prioritized)
    for (const view of forPalette(betaPages)) {
      out.push({
        id: `nav:${view.id}`,
        group: 'Navigation',
        icon: view.icon,
        label: `Go to ${view.label}`,
        hint: `Open ${view.label} section`,
        binding: view.digit ? `mod+${view.digit}` : undefined,
        beta: view.beta,
        run: () => handleNavigate(view.id),
      })
    }

    // 2. Chat actions
    out.push({
      id: 'chat:new',
      group: 'Chat',
      icon: 'plus',
      label: 'New conversation',
      hint: 'Start a fresh conversation thread',
      binding: 'mod+shift+o',
      run: () => {
        handleNavigate('chat')
        setTimeout(() => chat.startFresh?.(), 0)
      },
    })

    if (chat.turnRunning) {
      out.push({
        id: 'chat:stop',
        group: 'Chat',
        icon: 'stop',
        label: 'Stop this turn',
        hint: 'Halt active generation immediately',
        binding: 'escape',
        run: () => chat.stop?.(),
      })
    }

    // 3. Tasks Quick Actions
    out.push({
      id: 'task:view',
      group: 'Tasks',
      icon: 'check',
      label: 'Go to Tasks',
      hint: 'Open your task list and schedules',
      binding: 'mod+2',
      run: () => handleNavigate('tasks'),
    })
    out.push({
      id: 'tasks:sync',
      group: 'Tasks',
      icon: 'refresh',
      label: 'Sync tasks with Microsoft To Do',
      hint: 'Push and pull latest updates now',
      run: async () => {
        await api.syncTasks()
        toast('Tasks synced with Microsoft To Do', 'ok')
      },
    })

    // 4. Library Quick Actions
    out.push({
      id: 'library:view',
      group: 'Library',
      icon: 'book',
      label: 'Go to Library',
      hint: 'Explore captured notes, articles and media',
      binding: 'mod+9',
      run: () => handleNavigate('library'),
    })

    // 5. Skills & Connectors
    for (const skill of caps.skills || []) {
      out.push({
        id: `skill:${skill.name}`,
        group: 'Skills',
        icon: 'book',
        label: `${skill.enabled ? 'Disable' : 'Enable'} /${skill.name}`,
        hint: skill.description?.slice(0, 74),
        state: skill.enabled ? 'on' : 'off',
        run: () => setCapEnabled(skill, !skill.enabled),
      })
    }

    for (const connector of caps.connectors || []) {
      const state = connectorState(connector, busyCap === `connector:${connector.name}`)
      out.push({
        id: `connector:${connector.name}`,
        group: 'Connectors',
        icon: 'plug',
        label: `${connector.enabled ? 'Disconnect' : 'Connect'} ${connector.name}`,
        hint: state.detail ? state.detail.slice(0, 74) : state.label,
        state: state.tone === 'live' ? 'on' : state.tone === 'error' ? 'bad' : 'off',
        run: () => setCapEnabled(connector, !connector.enabled),
      })
    }

    // 6. Background Jobs & Automations
    for (const job of jobs) {
      const move = JOB_ACTIONS[job.state]
      if (!move) continue
      out.push({
        id: `job:${job.id}`,
        group: 'Background Jobs',
        icon: move.icon,
        label: `${move.label} ${job.kind}`,
        hint: [job.state, `attempt ${job.attempts}/${job.max_attempts}`, job.last_error]
          .filter(Boolean).join(' · ').slice(0, 74),
        run: async () => {
          try {
            const next = await api.actOnJob(job.id, move.action)
            toast(`${job.kind} is ${next.state}`, 'ok')
          } catch (err) {
            toast(err.message, 'bad')
          }
        },
      })
    }

    for (const automation of automations) {
      out.push({
        id: `automation:${automation.id}`,
        group: 'Automations',
        icon: 'play',
        label: `Run ${automation.name} now`,
        hint: automation.enabled ? `every ${automation.every_minutes} min` : 'runs once',
        run: async () => {
          try {
            await api.runAutomation(automation.id)
            toast(`${automation.name} started`, 'ok')
          } catch (err) {
            toast(err.message, 'bad')
          }
        },
      })
    }

    // 7. Appearance & System
    for (const choice of THEMES) {
      if (choice.id === theme) continue
      out.push({
        id: `theme:${choice.id}`,
        group: 'Appearance',
        icon: choice.icon,
        label: choice.label,
        hint: choice.hint,
        run: () => setTheme(choice.id),
      })
    }

    out.push({
      id: 'settings',
      group: 'Settings',
      icon: 'sliders',
      label: 'Open Settings',
      binding: 'mod+,',
      run: () => handleNavigate('settings'),
    })
    out.push({
      id: 'shortcuts',
      group: 'Settings',
      icon: 'keyboard',
      label: 'Keyboard shortcuts cheatsheet',
      binding: 'shift+?',
      run: () => setOverlay('shortcuts'),
    })
    out.push({
      id: 'reconnect',
      group: 'Settings',
      icon: 'refresh',
      label: 'Re-check system connectivity & health',
      hint: 'health, tool count, and connector errors',
      run: () => {
        refreshHealth()
        refreshCaps()
        toast('System health refreshed', 'ok')
      },
    })
    out.push({
      id: 'onboarding-wizard',
      group: 'Settings',
      icon: 'spark',
      label: 'Launch Setup Wizard',
      hint: 'Configure appearance, loader, and chat defaults',
      run: () => {
        setOverlay(null)
        openOnboarding()
      },
    })

    return out
  }, [
    betaPages, handleNavigate, chat, toast, caps, busyCap, setCapEnabled,
    jobs, automations, theme, setTheme, setOverlay, refreshHealth, refreshCaps, openOnboarding,
  ])

  // Contextual synthesis dynamic items
  const dynamicItems = useMemo(() => {
    const q = effectiveQuery.trim()
    if (!q) return []
    const out = []

    // 1. Math / Conversion item
    if (mathResult) {
      out.push({
        id: 'math:result',
        group: 'Calculator',
        icon: 'zap',
        label: `${mathResult.expression} = ${mathResult.result}`,
        hint: 'Press Enter to copy result to clipboard',
        isInline: true,
        run: async () => {
          await copyText(String(mathResult.raw ?? mathResult.result))
          toast(`Copied ${mathResult.result}`, 'ok')
        },
      })
    }

    // 2. URL detected
    const isUrl = /^https?:\/\//i.test(q)
    if (isUrl) {
      out.push({
        id: 'url:open',
        group: 'Web',
        icon: 'arrow-up-right',
        label: `Open “${q}” in browser`,
        hint: 'Navigate to URL',
        isInline: true,
        run: () => openUrl(q),
      })
      out.push({
        id: 'library:add-url',
        group: 'Library',
        icon: 'bookmark',
        label: 'Save link to Library',
        hint: 'Captures and indexes article text',
        isInline: true,
        run: async () => {
          await api.addLibraryItem({ url: q })
          toast('Link saved to Library', 'ok')
        },
      })
    }

    // 3. Ask Amethyst
    out.push({
      id: 'ask',
      group: 'Ask AMETHYST',
      icon: 'send',
      label: `Ask AMETHYST: “${q}”`,
      hint: 'Starts an interactive turn in Chat',
      isInline: true,
      run: () => {
        handleNavigate('chat')
        setTimeout(() => chat.ask?.(q), 0)
      },
    })

    // 4. Search triggers (Clicking changes mode WITHOUT closing Damon)
    if (activeMode === 'all') {
      out.push({
        id: 'trigger:web',
        group: 'Search Destinations',
        icon: 'globe',
        label: `Search Web for “${q}”`,
        hint: 'Switch to Google / DuckDuckGo web results',
        isModeSwitch: true,
        run: () => handleSelectMode('web'),
      })
      out.push({
        id: 'trigger:youtube',
        group: 'Search Destinations',
        icon: 'play',
        label: `Search YouTube for “${q}”`,
        hint: 'Switch to YouTube video bento results',
        isModeSwitch: true,
        run: () => handleSelectMode('youtube'),
      })
      out.push({
        id: 'trigger:images',
        group: 'Search Destinations',
        icon: 'image',
        label: `Search Images for “${q}”`,
        hint: 'Switch to visual high-res image grid',
        isModeSwitch: true,
        run: () => handleSelectMode('images'),
      })
    }

    return out
  }, [effectiveQuery, mathResult, handleNavigate, chat, activeMode, handleSelectMode, toast])

  // Filtered results
  const results = useMemo(() => {
    // Dedicated view modes return empty list for generic list
    if (activeMode === 'web' || activeMode === 'youtube' || activeMode === 'images' ||
        activeMode === 'tasks' || activeMode === 'library' || activeMode === 'github') {
      return []
    }

    const q = effectiveQuery.trim()

    // Mode: Commands only
    if (activeMode === 'commands') {
      if (!q) return commands
      return commands
        .map((c) => ({ c, s: Math.max(score(c.label, q), score(`${c.group} ${c.label}`, q) - 60) }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((r) => r.c)
    }

    // Mode: 'all' (Universal Spotlight)
    if (!q) {
      // Show core navigation and recent conversations
      const recentConvs = conversations.slice(0, 5).map((c) => ({
        id: `conv:${c.id}`,
        group: 'Recent Conversations',
        icon: 'chat',
        label: c.title || 'Untitled conversation',
        hint: `${c.provider} · ${c.model}`,
        run: () => {
          handleNavigate('chat')
          setTimeout(() => chat.selectConversation?.(c.id), 0)
        },
      }))
      return [...commands.slice(0, 6), ...recentConvs]
    }

    // Scored command matching
    const matchedCommands = commands
      .map((c) => ({ c, s: Math.max(score(c.label, q), score(`${c.group} ${c.label}`, q) - 60) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c)

    // Matching library items
    const matchedLib = libraryItems.slice(0, 3).map((item) => ({
      id: `lib:${item.id}`,
      group: 'Library Items',
      icon: item.kind === 'video' ? 'play' : 'bookmark',
      label: item.title || 'Untitled item',
      hint: item.url || item.kind,
      run: () => {
        if (item.url) window.open(item.url, '_blank')
        else handleNavigate('library')
      },
    }))

    // Matching memory facts
    const matchedMemory = (memory?.facts || [])
      .filter((f) => f.fact.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 2)
      .map((f) => ({
        id: `fact:${f.id}`,
        group: 'Memory Facts',
        icon: 'spark',
        label: f.fact,
        hint: 'Recalled personal knowledge',
        run: () => handleNavigate('memory'),
      }))

    return [...dynamicItems, ...matchedCommands, ...matchedLib, ...matchedMemory]
  }, [
    activeMode, effectiveQuery, commands, dynamicItems, libraryItems, memory,
    conversations, handleNavigate, chat,
  ])

  // Count items for keyboard navigation
  const currentItemCount = useMemo(() => {
    if (activeMode === 'web') return webResults.length
    if (activeMode === 'youtube') return ytResults.length
    if (activeMode === 'images') return imageResults.length
    if (activeMode === 'github') return githubResults.length
    return results.length
  }, [activeMode, webResults.length, ytResults.length, imageResults.length, githubResults.length, results.length])

  useEffect(() => { setIndex(0) }, [rawQuery, activeMode])

  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [index, open, results, webResults, ytResults, imageResults])

  const runCommand = async (command) => {
    // Mode switch commands should NOT close Damon
    if (command.isModeSwitch) {
      command.run()
      return
    }

    // Regular commands: run and close Damon
    try {
      if (bare) {
        setFlash(command.done || 'Done')
        await command.run()
        setTimeout(() => { setFlash(null); closePalette() }, 600)
      } else {
        closePalette()
        setTimeout(() => command.run(), 0)
      }
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  // Keyboard navigation & toggle handler
  const onKeyDown = (e) => {
    // 1. Shortcut toggle: Cmd+K / Ctrl+K while Damon is open ALWAYS closes Damon
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      e.stopPropagation()
      closePalette()
      return
    }

    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => (currentItemCount ? (i + 1) % currentItemCount : 0))
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setIndex((i) => (currentItemCount ? (i - 1 + currentItemCount) % currentItemCount : 0))
    } else if (e.key === 'Tab') {
      e.preventDefault()
      // Cycle filter modes seamlessly
      const modeKeys = MODES.map((m) => m.id)
      const cur = modeKeys.indexOf(activeMode)
      const next = modeKeys[(cur + (e.shiftKey ? -1 : 1) + modeKeys.length) % modeKeys.length]
      handleSelectMode(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeMode === 'web') {
        const item = webResults[index]
        if (item) openUrl(item.url)
        else if (effectiveQuery) openUrl(`https://www.google.com/search?q=${encodeURIComponent(effectiveQuery)}`)
      } else if (activeMode === 'youtube') {
        const item = ytResults[index]
        if (item) openUrl(item.url)
      } else if (activeMode === 'images') {
        const item = imageResults[index]
        if (item) openUrl(item.image || item.source_url)
      } else if (activeMode === 'github') {
        const item = githubResults[index]
        if (item) openUrl(item.url)
      } else {
        const cmd = results[index]
        if (cmd) runCommand(cmd)
      }
    } else if (e.key === 'Backspace' && !rawQuery && activeMode !== 'all') {
      e.preventDefault()
      handleClearMode()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleDismiss()
    }
  }

  if (!open) return null

  // Rows with group headers
  const rows = results.map((command, i) => ({
    command,
    header: command.group === results[i - 1]?.group ? null : command.group,
  }))

  const card = (
    <div
      className={`palette damon-spotlight${bare ? ' palette--bar' : ''}`}
      data-closing={closing || undefined}
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Spotlight Command Palette"
    >
      {/* Search Header */}
      <DamonHeader
        query={rawQuery}
        activeMode={activeMode}
        flash={flash}
        inputRef={inputRef}
        onChange={setRawQuery}
        onKeyDown={onKeyDown}
        onClearMode={handleClearMode}
      />

      {/* Mode Filter Pills */}
      <DamonModes
        activeMode={activeMode}
        onSelectMode={handleSelectMode}
      />

      {/* Results Container */}
      {/* Keyed by mode, so switching modes is a fade into the new list
          rather than an in-place reshuffle of everything at once. */}
      <div className="palette-list damon-list-container" ref={listRef} key={activeMode}>
        <div className="damon-list-swap">
        {/* Dedicated Web Search View */}
        {activeMode === 'web' && (
          <>
            <AnswerCardView
              answer={answerCard?.answer}
              sources={answerCard?.sources || []}
              loading={(answerPending || searchingExternal) && !answerCard?.answer}
              onOpen={(src) => openUrl(src.url)}
              onToast={toast}
            />
            <WebResultsView
              results={webResults}
              query={effectiveQuery}
              loading={searchingExternal && !answerCard?.answer}
              note={webNote}
              error={searchError === 'web' && webResults.length === 0}
              hasMore={pageState.web?.hasMore}
              loadingMore={pageState.web?.loading}
              onLoadMore={() => loadMore('web')}
              activeIndex={index}
              onSelect={(res) => openUrl(res.url)}
              onToast={toast}
            />
          </>
        )}

        {/* Dedicated YouTube Bento View */}
        {activeMode === 'youtube' && (
          <YouTubeBentoView
            results={ytResults}
            loading={searchingExternal}
            error={searchError === 'yt' && ytResults.length === 0}
            hasMore={pageState.yt?.hasMore}
            loadingMore={pageState.yt?.loading}
            onLoadMore={() => loadMore('yt')}
            activeIndex={index}
            onSelect={(vid) => openUrl(vid.url)}
            onToast={toast}
          />
        )}

        {/* Dedicated Images View */}
        {activeMode === 'images' && (
          <ImageGridView
            results={imageResults}
            loading={searchingExternal}
            activeIndex={index}
            onSelect={(img) => openUrl(img.image || img.source_url)}
            onToast={toast}
          />
        )}

        {/* Dedicated Tasks View */}
        {activeMode === 'tasks' && (
          <TasksView
            tasks={tasksList}
            query={effectiveQuery}
            activeIndex={index}
            onSelect={() => handleNavigate('tasks')}
            onNavigateTasks={() => handleNavigate('tasks')}
            onRefreshTasks={refreshTasks}
            onToast={toast}
          />
        )}

        {/* Dedicated Library View */}
        {activeMode === 'library' && (
          <LibraryView
            items={libraryItems}
            query={effectiveQuery}
            activeIndex={index}
            onSelect={(item) => {
              if (item.url) openUrl(item.url)
              else handleNavigate('library')
            }}
            onNavigateLibrary={() => handleNavigate('library')}
            onAddContent={async () => {
              try {
                const isUrl = /^https?:\/\//i.test(effectiveQuery)
                await api.addLibraryItem(isUrl ? { url: effectiveQuery } : { title: effectiveQuery, kind: 'note' })
                toast('Saved to Library', 'ok')
                api.library({ limit: 12 }).then((d) => setLibraryItems(d.items || []))
              } catch {
                toast('Could not save to Library', 'bad')
              }
            }}
            onToast={toast}
          />
        )}

        {/* Dedicated GitHub View */}
        {activeMode === 'github' && (
          <GitHubResultsView
            results={githubResults}
            loading={searchingExternal}
            activeIndex={index}
            onSelect={(repo) => openUrl(repo.url)}
          />
        )}

        {/* Answer first in universal mode, when the query was a question */}
        {(activeMode === 'all' && answerCard?.answer) ||
         (activeMode === 'all' && (searchingExternal || answerPending)
           && looksLikeQuestion(effectiveQuery) && !answerCard) ? (
          <AnswerCardView
            answer={answerCard?.answer}
            sources={answerCard?.sources || []}
            loading={(answerPending || searchingExternal) && !answerCard?.answer}
            onOpen={(src) => openUrl(src.url)}
            onToast={toast}
          />
        ) : null}

        {/* A question in universal mode gets one short row of each kind of
            evidence under the answer -- web, video, images -- the way a
            question is answered everywhere else on the machine: briefly,
            with a way to go deeper. Each row is a strip, not the full grid
            the dedicated modes show. */}
        {activeMode === 'all' && looksLikeQuestion(effectiveQuery) && !searchingExternal && (
          <div className="damon-mixed">
            {webResults.length > 0 && (
              <section className="damon-mixed-row" data-kind="web">
                <header className="damon-mixed-head">
                  <Icon name="globe" size={13} />
                  <span>Web</span>
                  <button type="button" onClick={() => handleSelectMode('web')}>All web results</button>
                </header>
                {webNote && <p className="damon-mixed-note">{webNote}</p>}
                <ul>
                  {webResults.slice(0, 3).map((r) => (
                    <li key={r.url}>
                      <button type="button" onClick={() => openUrl(r.url)}>
                        <span className="damon-mixed-title">{r.title}</span>
                        <span className="damon-mixed-domain mono">{r.domain}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {ytResults.length > 0 && (
              <section className="damon-mixed-row" data-kind="youtube">
                <header className="damon-mixed-head">
                  <Icon name="play" size={13} />
                  <span>Video</span>
                  <button type="button" onClick={() => handleSelectMode('youtube')}>All videos</button>
                </header>
                <ul>
                  {ytResults.slice(0, 2).map((v) => (
                    <li key={v.url}>
                      <button type="button" onClick={() => openUrl(v.url)}>
                        <span className="damon-mixed-title">{v.title}</span>
                        <span className="damon-mixed-domain mono">{v.channel || 'YouTube'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {imageResults.length > 0 && (
              <section className="damon-mixed-row" data-kind="images">
                <header className="damon-mixed-head">
                  <Icon name="image" size={13} />
                  <span>Images</span>
                  <button type="button" onClick={() => handleSelectMode('images')}>All images</button>
                </header>
                <div className="damon-mixed-images">
                  {imageResults.slice(0, 6).map((img) => (
                    <button
                      key={img.image || img.source_url}
                      type="button"
                      className="damon-mixed-thumb"
                      onClick={() => openUrl(img.image || img.source_url)}
                    >
                      <img src={img.thumbnail || img.image} alt={img.title || ''} loading="lazy" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Wikipedia Card in Universal Mode */}
        {(activeMode === 'all' || activeMode === 'wiki') && wikiResult && (
          <WikiSummaryView
            wiki={wikiResult}
            loading={searchingExternal && !wikiResult}
            onSelect={(w) => openUrl(w.url)}
          />
        )}

        {/* Universal Mode / Commands Mode List */}
        {activeMode !== 'web' && activeMode !== 'youtube' && activeMode !== 'images' &&
         activeMode !== 'tasks' && activeMode !== 'library' && activeMode !== 'github' && (
          <>
            {results.length === 0 && (
              <div className="palette-empty damon-empty-state">
                <Icon name="search" size={24} />
                <p>Nothing matches “{effectiveQuery}”.</p>
                <span className="damon-empty-hint">
                  Try typing <code>&gt; google {effectiveQuery}</code> or <code>&gt; youtube {effectiveQuery}</code>
                </span>
              </div>
            )}

            {rows.map(({ command, header }, i) => (
              <div key={command.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  className={`palette-item${i === index ? ' active' : ''}`}
                  data-active={i === index}
                  onClick={() => runCommand(command)}
                >
                  <Icon name={command.icon} size={15} />
                  <span className="palette-label">
                    {command.label}
                    {command.beta && <span className="beta">beta</span>}
                    {command.hint && <span className="palette-hint">{command.hint}</span>}
                  </span>
                  {command.state && (
                    <span className={`state state--${command.state}`}>
                      {command.state === 'on' ? 'on' : command.state === 'bad' ? 'failed' : 'off'}
                    </span>
                  )}
                  {command.binding && (
                    <span className="palette-keys">
                      {pretty(command.binding).map((k, n) => (
                        <kbd key={n} className="kbd">{k}</kbd>
                      ))}
                    </span>
                  )}
                </button>
              </div>
            ))}
          </>
        )}
        </div>
      </div>

      {/* Floating Spotlight Footer */}
      <footer className="damon-footer">
        <div className="damon-footer-hints">
          <span className="damon-hint-item">
            <kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> Navigate
          </span>
          <span className="damon-hint-item">
            <kbd className="kbd">↵</kbd> Open
          </span>
          <span className="damon-hint-item">
            <kbd className="kbd">Tab</kbd> Filter Mode
          </span>
          <span className="damon-hint-item">
            <kbd className="kbd">Esc</kbd> Close
          </span>
        </div>
        <div className="damon-footer-brand">
          <span>AMETHYST SPOTLIGHT</span>
        </div>
      </footer>
    </div>
  )

  if (bare) return card

  return (
    <div
      className="modal-overlay palette-overlay damon-overlay"
      data-closing={closing || undefined}
      onMouseDown={onOverlayMouseDown(handleDismiss)}
    >
      {card}
    </div>
  )
}
