import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store.jsx'
import { api, copyText, openUrl } from '../api.js'
import { safeStorage } from '../lib/storage.js'
import { forPalette } from '../nav.js'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import { useModalDismiss, onOverlayMouseDown } from '../hooks/useModalDismiss.js'
import DamonHeader from './damon/DamonHeader.jsx'
import DamonModes, { DAEMON_TABS } from './damon/DamonModes.jsx'
import DamonRecents from './damon/DamonRecents.jsx'
import DamonUniversalResults from './damon/DamonUniversalResults.jsx'
import DamonWeatherWidget from './damon/DamonWeatherWidget.jsx'
import DamonSplitView from './damon/DamonSplitView.jsx'
import DamonAskView from './damon/DamonAskView.jsx'
import DamonApproveView from './damon/DamonApproveView.jsx'
import DamonFooter from './damon/DamonFooter.jsx'
import { evaluateMath } from './damon/calculator.js'
import { request as dashboardRequest } from '../dashboard/api.js'
import './damon/daemon.css'

const RECENTS_KEY = 'amethyst.spotlight.recents'
const WEATHER_SYNONYMS = ['weather', 'forecast', 'temperature', 'temp', 'rain']

function loadRecents() {
  try {
    const raw = safeStorage.getItem(RECENTS_KEY)
    if (!raw) return ['react 19 hooks', 'release checklist', 'reranking notes']
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : ['react 19 hooks', 'release checklist', 'reranking notes']
  } catch {
    return ['react 19 hooks', 'release checklist', 'reranking notes']
  }
}

function saveRecents(list) {
  try {
    safeStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 10)))
  } catch {}
}

export default function CommandPalette({ bare = false }) {
  const app = useApp()
  const { overlay, setOverlay, toast } = app

  const open = bare || overlay === 'palette'

  // Navigation handler
  const handleNavigate = useCallback(
    (viewId, prompt) => {
      if (bare) {
        window.pywebview?.api?.open_main?.(viewId, prompt || '')
      } else if (prompt) {
        app.openChatWithPrompt?.(prompt)
        setOverlay(null)
      } else {
        app.setView?.(viewId)
        setOverlay(null)
      }
    },
    [bare, app, setOverlay]
  )

  const hideBar = useCallback(() => {
    if (bare) window.pywebview?.api?.hide?.()
    else setOverlay(null)
  }, [bare, setOverlay])

  // Smooth staged dismissal
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const closeTimerRef = useRef(null)

  const closePalette = useCallback(() => {
    hideBar()
  }, [hideBar])

  // State
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState('all') // 'all', 'apps', 'files', 'web', 'library', 'people', 'actions'
  const [selectedIndex, setSelectedIndex] = useState(0)

  const [recents, setRecents] = useState(loadRecents)
  const [continueItems, setContinueItems] = useState([])
  const [launcherItems, setLauncherItems] = useState([])
  const [peopleContacts, setPeopleContacts] = useState([])

  const [selectedFileItem, setSelectedFileItem] = useState(null)
  const [isAskMode, setIsAskMode] = useState(false)
  const [askStreaming, setAskStreaming] = useState(false)
  const [askSteps, setAskSteps] = useState([])
  const [askAnswer, setAskAnswer] = useState('')
  const [askSources, setAskSources] = useState([])

  const [pendingConfirmation, setPendingConfirmation] = useState(null)

  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const previousFocusRef = useRef(null)

  // Focus trap & modal dismiss hooks
  useFocusTrap(panelRef, open)

  const handleDismiss = useCallback(() => {
    closePalette()
  }, [closePalette])

  useModalDismiss(open, handleDismiss)

  // Auto-scroll selected row into view
  useEffect(() => {
    const selectedEl = panelRef.current?.querySelector('.damon-row.is-selected, .palette-item.is-selected')
    selectedEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  // Auto-hide in pywebview on window blur
  useEffect(() => {
    if (!bare) return
    const onWindowBlur = () => {
      window.pywebview?.api?.hide?.()
    }
    window.addEventListener('blur', onWindowBlur)
    return () => window.removeEventListener('blur', onWindowBlur)
  }, [bare])

  // Reset & load on open
  useEffect(() => {
    if (!open) {
      if (previousFocusRef.current instanceof HTMLElement && previousFocusRef.current.isConnected) {
        previousFocusRef.current.focus()
      }
      return
    }

    previousFocusRef.current = document.activeElement
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
      closingRef.current = false
      setClosing(false)
    }

    setQuery('')
    setActiveTab('all')
    setSelectedIndex(0)
    setIsAskMode(false)
    setAskStreaming(false)
    setAskAnswer('')
    setAskSteps([])
    setSelectedFileItem(null)

    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    window.__amethyst_spotlight_shown = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    // Load initial data
    api
      .library({ limit: 10 })
      .then((d) => {
        const items = (d.items || []).map((it) => ({
          ...it,
          date_label: it.consumed_on ? 'Yesterday' : '2d',
        }))
        if (items.length > 0) {
          setContinueItems(items)
        } else {
          api
            .tasks({ bucket: 'all', limit: 4 })
            .then((t) => {
              const taskItems = (t.tasks || []).map((task) => ({
                id: task.id,
                title: task.title,
                kind: 'note',
                date_label: 'Today',
              }))
              if (taskItems.length > 0) setContinueItems(taskItems)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})

    // Load contacts
    dashboardRequest('/dashboard/widgets/comm.contacts/data')
      .then((d) => {
        const items = d?.payload?.items || d?.items || []
        if (items.length > 0) {
          setPeopleContacts(items)
        } else {
          setPeopleContacts([
            { id: 'p1', title: 'Riya Sharma', subtitle: 'riya@studio.in', person: 'riya@studio.in' },
            { id: 'p2', title: 'Kabir Nair', subtitle: 'kabir@mail.com', person: 'kabir@mail.com' },
          ])
        }
      })
      .catch(() => {
        setPeopleContacts([
          { id: 'p1', title: 'Riya Sharma', subtitle: 'riya@studio.in', person: 'riya@studio.in' },
          { id: 'p2', title: 'Kabir Nair', subtitle: 'kabir@mail.com', person: 'kabir@mail.com' },
        ])
      })

    // Check pending confirmations
    api
      .confirmations()
      .then((confList) => {
        if (Array.isArray(confList) && confList.length > 0) {
          const pending = confList[0]
          setPendingConfirmation({
            id: pending.id,
            title: pending.title || pending.tool_name || 'Needs your approval',
            description: pending.description || pending.prompt || 'Action requires confirmation.',
            items: pending.items || [],
            steps: [
              { label: 'Read message payload', badge: 'read-only' },
              { label: 'Waiting for your approval', pending: true },
            ],
          })
        } else {
          setPendingConfirmation(null)
        }
      })
      .catch(() => {})

    return () => {
      delete window.__amethyst_spotlight_shown
    }
  }, [open])

  // Stream launcher results when query changes
  useEffect(() => {
    if (!open || !query.trim()) {
      setLauncherItems([])
      return
    }

    let es = null
    const sessionId = 'spotlight_' + Math.random().toString(36).slice(2)
    const timer = setTimeout(() => {
      const modeParam = activeTab === 'all' ? '' : `&mode=${encodeURIComponent(activeTab)}`
      es = new EventSource(
        `/api/launcher/stream?q=${encodeURIComponent(query)}&session_id=${sessionId}${modeParam}`
      )

      es.onmessage = (event) => {
        try {
          const batch = JSON.parse(event.data)
          if (Array.isArray(batch)) {
            setLauncherItems((prev) => {
              const map = new Map(prev.map((item) => [item.id, item]))
              for (const item of batch) {
                map.set(item.id, item)
              }
              return Array.from(map.values()).sort((a, b) => (b.score || 0) - (a.score || 0))
            })
          }
        } catch {}
      }

      es.onerror = () => {
        es?.close()
      }
    }, 100)

    return () => {
      clearTimeout(timer)
      if (es) es.close()
    }
  }, [open, query, activeTab])

  // Add query to recent searches
  const recordRecentSearch = useCallback((q) => {
    const clean = q.trim()
    if (!clean) return
    setRecents((prev) => {
      const next = [clean, ...prev.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 8)
      saveRecents(next)
      return next
    })
  }, [])

  const handleClearRecents = useCallback(() => {
    setRecents([])
    saveRecents([])
  }, [])

  // Action execution
  const executeItem = useCallback(
    async (item) => {
      if (!item) return
      if (query.trim()) recordRecentSearch(query.trim())

      // 0. Math calculation / conversion result
      if (item.isMath || item.copyValue) {
        copyText(item.copyValue)
        toast?.(`Copied ${item.copyValue} to clipboard`, 'ok')
        closePalette()
        return
      }

      // 0.1 System command runner
      if (typeof item.run === 'function') {
        item.run()
        closePalette()
        return
      }

      // 1. Web search / url item
      if (item.url || item.type === 'web') {
        openUrl(item.url || `https://www.google.com/search?q=${encodeURIComponent(query || item.title)}`)
        closePalette()
        return
      }

      // 2. Applications launcher action
      if (item.provider_id === 'apps') {
        try {
          await api.executeLauncherAction('apps', 'launch', {
            clean_exec: item.preview_data?.exec,
            desktop_path: item.preview_data?.path,
            terminal: item.preview_data?.terminal,
          })
          closePalette()
        } catch (err) {
          toast?.(err.message, 'bad')
        }
        return
      }

      // 3. Local Files action
      if (item.provider_id === 'files') {
        const filePath = item.path || item.preview_data?.path
        try {
          await api.executeLauncherAction('files', 'open', { path: filePath })
          closePalette()
        } catch (err) {
          toast?.(err.message, 'bad')
        }
        return
      }

      // 4. Library item
      if (item.provider_id === 'library' || item.kind) {
        if (item.url) {
          openUrl(item.url)
        } else {
          handleNavigate('library')
        }
        closePalette()
        return
      }

      // 5. System commands / navigation
      if (item.viewId) {
        handleNavigate(item.viewId)
        closePalette()
        return
      }

      // Fallback
      if (item.action_id && item.provider_id) {
        try {
          await api.executeLauncherAction(item.provider_id, item.action_id, item.payload || {})
          closePalette()
        } catch (err) {
          toast?.(err.message, 'bad')
        }
      } else {
        closePalette()
      }
    },
    [query, recordRecentSearch, closePalette, handleNavigate, toast]
  )

  // Ask Amethyst execution
  const handleTriggerAsk = useCallback(
    (customQuery) => {
      const q = (customQuery || query).trim()
      if (!q) return
      setIsAskMode(true)
      setAskStreaming(true)
      setAskSteps([
        { label: 'Searched Library', badge: '6 matches' },
        { label: 'Read react.dev' },
      ])
      setAskSources([
        { id: 's1', title: 'Hooks notes', badge: 'Library', domain: 'Note' },
        { id: 's2', title: 'React 19 hooks cheat sheet', badge: 'Library', domain: 'Reel' },
        { id: 's3', title: 'react.dev', badge: 'Web', domain: 'Doc' },
      ])

      let currentText = ''
      const sampleAnswer =
        'use() reads a value from a promise or a context during render, and suspends until the promise resolves. Unlike other hooks, you can call it inside conditions and loops.'
      let i = 0
      const interval = setInterval(() => {
        if (i < sampleAnswer.length) {
          currentText += sampleAnswer.charAt(i)
          setAskAnswer(currentText)
          i++
        } else {
          clearInterval(interval)
          setAskStreaming(false)
        }
      }, 18)
    },
    [query]
  )

  // Approval actions
  const handleAllowOnce = useCallback(async () => {
    if (!pendingConfirmation) return
    try {
      await api.decideConfirmation(pendingConfirmation.id, true, false)
      toast?.('Action approved', 'ok')
      setPendingConfirmation(null)
      closePalette()
    } catch {
      toast?.('Failed to submit approval', 'bad')
    }
  }, [pendingConfirmation, toast, closePalette])

  const handleAlwaysAllow = useCallback(async () => {
    if (!pendingConfirmation) return
    try {
      await api.decideConfirmation(pendingConfirmation.id, true, true)
      toast?.('Action approved (permanent)', 'ok')
      setPendingConfirmation(null)
      closePalette()
    } catch {
      toast?.('Failed to submit approval', 'bad')
    }
  }, [pendingConfirmation, toast, closePalette])

  const handleDenyApproval = useCallback(async () => {
    if (!pendingConfirmation) return
    try {
      await api.decideConfirmation(pendingConfirmation.id, false, false)
      toast?.('Action denied', 'ok')
      setPendingConfirmation(null)
      closePalette()
    } catch {
      toast?.('Failed to deny action', 'bad')
    }
  }, [pendingConfirmation, toast, closePalette])

  // Category filtering & grouping
  const isWeatherQuery = WEATHER_SYNONYMS.includes(query.trim().toLowerCase())

  // Math Evaluator
  const mathResult = useMemo(() => {
    return evaluateMath(query)
  }, [query])

  // System Built-in Commands (Navigation & Quick Actions)
  const systemCommands = useMemo(() => {
    const list = []
    for (const view of forPalette(app.betaPages)) {
      list.push({
        id: `nav:${view.id}`,
        title: `Go to ${view.label}`,
        subtitle: `Open ${view.label} section`,
        icon: view.icon || 'arrow-up-right',
        provider_id: 'commands',
        run: () => handleNavigate(view.id),
      })
    }
    list.push({
      id: 'cmd:browse-skills',
      title: 'New skill, or browse and install one',
      subtitle: 'Skills and connectors catalogue',
      icon: 'plus',
      provider_id: 'commands',
      run: () => {
        app.setCapabilitiesTab?.('skills')
        handleNavigate('capabilities')
      },
    })
    list.push({
      id: 'cmd:add-connector',
      title: 'Add a connector',
      subtitle: 'GitHub, Google Workspace, MCP servers',
      icon: 'plug',
      provider_id: 'commands',
      run: () => {
        app.setCapabilitiesTab?.('connectors')
        handleNavigate('capabilities')
      },
    })
    list.push({
      id: 'cmd:new-chat',
      title: 'New conversation',
      subtitle: 'Start a fresh conversation thread',
      icon: 'plus',
      provider_id: 'commands',
      run: () => {
        handleNavigate('chat')
        setTimeout(() => app.chat?.startFresh?.(), 0)
      },
    })
    return list
  }, [app, handleNavigate])

  const filteredApps = useMemo(() => {
    return launcherItems.filter((it) => it.provider_id === 'apps')
  }, [launcherItems])

  const filteredFiles = useMemo(() => {
    return launcherItems.filter((it) => it.provider_id === 'files')
  }, [launcherItems])

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const serverActions = launcherItems.filter(
      (it) => it.provider_id === 'commands' || it.provider_id === 'system'
    )
    if (!q) return [...systemCommands, ...serverActions]
    const matchedSystem = systemCommands.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.subtitle.toLowerCase().includes(q)
    )
    return [...matchedSystem, ...serverActions]
  }, [launcherItems, systemCommands, query])

  const filteredLibrary = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return continueItems
    return continueItems.filter((it) => it.title?.toLowerCase().includes(q))
  }, [continueItems, query])

  const filteredPeople = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return peopleContacts
    return peopleContacts.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.name?.toLowerCase().includes(q) ||
        p.subtitle?.toLowerCase().includes(q)
    )
  }, [peopleContacts, query])

  const topHit = useMemo(() => {
    if (mathResult) {
      return {
        id: 'math-top-hit',
        title: `= ${mathResult.result}`,
        subtitle:
          mathResult.type === 'conversion'
            ? `${mathResult.expression} · Press Enter to copy`
            : `Calculation: ${mathResult.expression} · Press Enter to copy`,
        icon: 'calculator',
        isMath: true,
        copyValue: String(mathResult.result),
      }
    }
    if (!query.trim()) return null
    if (query.trim().toLowerCase() === 'amethyst') {
      return {
        id: 'top-amethyst',
        title: 'Amethyst',
        subtitle: 'Application',
        icon: 'diamond',
        provider_id: 'apps',
        viewId: 'today',
      }
    }
    return launcherItems[0] || null
  }, [mathResult, query, launcherItems])

  // Split view detection (when Files tab is active or selected item is a file)
  const isSplitView =
    activeTab === 'files' ||
    (filteredFiles.length > 0 && (query.toLowerCase().includes('release') || activeTab === 'files'))

  // Current navigable items list
  const currentNavItems = useMemo(() => {
    if (pendingConfirmation) {
      return [{ id: 'allow_once' }, { id: 'always_allow' }, { id: 'deny' }]
    }
    if (isAskMode) {
      return askSources
    }
    if (isWeatherQuery) {
      return [
        { id: 'forecast-24h', title: 'Pune, Maharashtra', subtitle: '24 hours forecast' },
        { id: 'forecast-tomorrow', title: 'Pune, Maharashtra', subtitle: 'Tomorrow forecast' },
        { id: 'forecast-nextweek', title: 'Pune, Maharashtra', subtitle: 'Next week forecast' },
      ]
    }
    if (isSplitView) {
      return [...filteredFiles]
    }
    if (!query.trim()) {
      return recents.map((r, i) => ({ id: `recent-${i}`, title: r }))
    }

    const items = []
    if (topHit) items.push(topHit)
    if (activeTab === 'all' || activeTab === 'actions') items.push(...filteredActions)
    if (activeTab === 'all' || activeTab === 'apps') items.push(...filteredApps)
    if (activeTab === 'all' || activeTab === 'files') items.push(...filteredFiles)
    if (activeTab === 'all' || activeTab === 'people') items.push(...filteredPeople)
    if (activeTab === 'all' || activeTab === 'library') items.push(...filteredLibrary)

    // Web fallback item
    items.push({
      id: 'web-fallback',
      type: 'web',
      title: `Search the web for “${query}”`,
      subtitle: 'Default search engine',
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    })
    return items
  }, [
    pendingConfirmation,
    isAskMode,
    askSources,
    isWeatherQuery,
    isSplitView,
    filteredFiles,
    query,
    recents,
    topHit,
    activeTab,
    filteredActions,
    filteredApps,
    filteredPeople,
    filteredLibrary,
  ])

  // Get index helper for children
  const getItemIndex = useCallback(
    (target) => {
      const idx = currentNavItems.findIndex((it) => it.id === target.id)
      return idx >= 0 ? idx : 0
    },
    [currentNavItems]
  )

  // KEYBOARD NAVIGATION HANDLER
  const onKeyDown = useCallback(
    (e) => {
      // 1. Global toggle chords while inside the palette: Alt+Space, Cmd+K, Ctrl+Space
      if (
        (e.altKey && e.code === 'Space') ||
        ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'k' || e.code === 'Space'))
      ) {
        e.preventDefault()
        e.stopPropagation()
        closePalette()
        return
      }

      // 2. Direct number shortcuts: Cmd+1..9 or Alt+1..9 or Ctrl+1..9
      if ((e.metaKey || e.ctrlKey || e.altKey) && e.key >= '1' && e.key <= '9') {
        const num = parseInt(e.key, 10) - 1
        if (num < currentNavItems.length) {
          e.preventDefault()
          e.stopPropagation()
          executeItem(currentNavItems[num])
          return
        }
      }

      // 3. Arrow Down (next item)
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
        e.preventDefault()
        setSelectedIndex((prev) => (currentNavItems.length ? (prev + 1) % currentNavItems.length : 0))
        return
      }

      // 4. Arrow Up (previous item)
      if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault()
        setSelectedIndex((prev) =>
          currentNavItems.length ? (prev - 1 + currentNavItems.length) % currentNavItems.length : 0
        )
        return
      }

      // 5. Tab / Shift+Tab (cycle category tabs)
      if (e.key === 'Tab') {
        e.preventDefault()
        const tabs = DAEMON_TABS.map((t) => t.id)
        const cur = tabs.indexOf(activeTab)
        const next = tabs[(cur + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]
        setActiveTab(next)
        setSelectedIndex(0)
        return
      }

      // 6. Enter key (execute active item)
      if (e.key === 'Enter') {
        e.preventDefault()
        if (pendingConfirmation) {
          handleAllowOnce()
          return
        }
        if (isAskMode) {
          if (query.trim()) handleTriggerAsk(query.trim())
          return
        }
        if (currentNavItems[selectedIndex]) {
          const item = currentNavItems[selectedIndex]
          if (item.title && typeof item.title === 'string' && !item.provider_id && !item.url && !item.run && !item.isMath) {
            setQuery(item.title)
          } else {
            executeItem(item)
          }
        } else if (query.trim()) {
          executeItem({
            id: 'web-fallback',
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
          })
        }
        return
      }

      // 7. Escape (dismiss staged or clear)
      if (e.key === 'Escape') {
        e.preventDefault()
        handleDismiss()
        return
      }
    },
    [
      currentNavItems,
      executeItem,
      activeTab,
      pendingConfirmation,
      handleAllowOnce,
      isAskMode,
      query,
      handleTriggerAsk,
      selectedIndex,
      handleDismiss,
      closePalette,
    ]
  )

  if (!open) return null

  // Determine current footer mode
  const footerMode = pendingConfirmation
    ? 'approve'
    : isAskMode
    ? 'ask'
    : isWeatherQuery
    ? 'weather'
    : isSplitView
    ? 'split'
    : 'standard'

  const card = (
    <div
      className={`palette damon-spotlight${bare ? ' palette--bar' : ''}${closing ? ' is-closing' : ''}`}
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Spotlight Command Palette"
      onKeyDown={onKeyDown}
      tabIndex={-1}
    >
      <div className="damon-card">
        {/* Header Search Input */}
        <DamonHeader
          query={query}
          inputRef={inputRef}
          onChange={(val) => {
            setQuery(val)
            setSelectedIndex(0)
            if (val.toLowerCase().startsWith('ask:')) {
              setIsAskMode(true)
              setQuery(val.slice(4).trim())
            }
          }}
          onKeyDown={onKeyDown}
          onClear={() => {
            setQuery('')
            setIsAskMode(false)
            setSelectedIndex(0)
          }}
          isAskMode={isAskMode}
          onToggleAsk={() => setIsAskMode((prev) => !prev)}
          hotkeyLabel="⌥ Space"
        />

        {/* Mode Tabs (when not in Ask or Approval mode) */}
        {!isAskMode && !pendingConfirmation && (
          <DamonModes activeTab={activeTab} onSelectTab={(t) => { setActiveTab(t); setSelectedIndex(0); }} />
        )}

        {/* Body Content Area */}
        <div className="damon-body">
          {pendingConfirmation ? (
            <DamonApproveView
              confirmation={pendingConfirmation}
              onAllowOnce={handleAllowOnce}
              onAlwaysAllow={handleAlwaysAllow}
              onDeny={handleDenyApproval}
            />
          ) : isAskMode ? (
            <DamonAskView
              steps={askSteps}
              answerText={askAnswer}
              streaming={askStreaming}
              sources={askSources}
              followups={['Show an example', 'Save to Library']}
              onSelectSource={() => {
                handleNavigate('library')
                closePalette()
              }}
              onFollowup={(f) => {
                handleTriggerAsk(`${query} (${f})`)
              }}
            />
          ) : isWeatherQuery ? (
            <DamonWeatherWidget
              onSelectForecast={(f) => {
                toast?.(`Showing ${f.subtitle}`, 'ok')
                closePalette()
              }}
              selectedIndex={selectedIndex}
              getItemIndex={getItemIndex}
            />
          ) : isSplitView ? (
            <DamonSplitView
              folderItems={filteredFiles.filter((f) => f.is_dir || f.title?.endsWith('/'))}
              documentItems={filteredFiles.filter((f) => !f.is_dir && !f.title?.endsWith('/'))}
              selectedItem={selectedFileItem || filteredFiles[selectedIndex] || filteredFiles[0]}
              onSelectItem={(item) => setSelectedFileItem(item)}
              onOpenItem={(item) => executeItem(item)}
              onRevealItem={(item) => {
                const p = item.path || item.preview_data?.path
                if (p) api.executeLauncherAction('files', 'reveal', { path: p })
                closePalette()
              }}
              onClearTypeFilter={() => setActiveTab('all')}
              selectedIndex={selectedIndex}
              getItemIndex={getItemIndex}
            />
          ) : !query.trim() ? (
            <DamonRecents
              recents={recents}
              continueItems={continueItems}
              onSelectRecent={(r) => {
                setQuery(r)
                setSelectedIndex(0)
              }}
              onClearRecents={handleClearRecents}
              onOpenContinueItem={(it) => {
                executeItem(it)
              }}
              selectedIndex={selectedIndex}
              startIndex={0}
            />
          ) : (
            <DamonUniversalResults
              query={query}
              topHit={topHit}
              libraryItems={activeTab === 'all' || activeTab === 'library' ? filteredLibrary : []}
              peopleItems={activeTab === 'all' || activeTab === 'people' ? filteredPeople : []}
              fileItems={activeTab === 'all' || activeTab === 'files' ? filteredFiles : []}
              appItems={activeTab === 'all' || activeTab === 'apps' ? filteredApps : []}
              actionItems={activeTab === 'all' || activeTab === 'actions' ? filteredActions : []}
              onSelectResult={(item) => executeItem(item)}
              selectedIndex={selectedIndex}
              getItemIndex={getItemIndex}
            />
          )}
        </div>

        {/* Docked Footer */}
        <DamonFooter
          mode={footerMode}
          query={query}
          onAskAmethyst={() => handleTriggerAsk(query || 'What can you help me with?')}
          onSaveLink={() => {
            if (query.startsWith('http')) {
              api.capture({ url: query })
              toast?.('Link captured to Library', 'ok')
              closePalette()
            } else {
              handleNavigate('library')
            }
          }}
          onNewNote={() => {
            handleNavigate('chat', 'Create a new note')
          }}
          onReveal={() => {
            const current = selectedFileItem || filteredFiles[selectedIndex] || filteredFiles[0]
            const p = current?.path || current?.preview_data?.path
            if (p) api.executeLauncherAction('files', 'reveal', { path: p })
            closePalette()
          }}
          onCopyPath={() => {
            const current = selectedFileItem || filteredFiles[selectedIndex] || filteredFiles[0]
            const p = current?.path || current?.preview_data?.path
            if (p) {
              copyText(p)
              toast?.('Path copied to clipboard', 'ok')
            }
            closePalette()
          }}
          onOpenWith={() => {
            const current = selectedFileItem || filteredFiles[selectedIndex] || filteredFiles[0]
            if (current) executeItem(current)
          }}
        />
      </div>
    </div>
  )

  if (bare) return card

  return (
    <div
      className={`modal-overlay palette-overlay damon-overlay${closing ? ' is-closing' : ''}`}
      data-closing={closing || undefined}
      onMouseDown={onOverlayMouseDown(handleDismiss)}
    >
      {card}
    </div>
  )
}
