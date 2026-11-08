import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import WidgetFrame, { WidgetBoundary } from './WidgetFrame.jsx'
import { DashboardContext } from './context.js'
import { cached, remember, request } from './api.js'
import { ADOPTED_WIDGETS, GLANCE_WIDGETS, SYSTEM_WIDGETS, WIDGET_ICONS, quietNow } from './layout.js'
import { widgetVariations, variationNumber } from './widgetVariations.js'
import { useApp } from '../store.jsx'
import Drawer from './Drawer.jsx'
import HomeSettings from './HomeSettings.jsx'
import useConnections from './useConnections.js'
import Button from '../components/ui/AppButton.jsx'
import { showBoardUINotification } from '../lib/boardui-notifications.js'
import FennelHome from '../views/FennelHome.jsx'
import defaultManifests from '../dev/widgets/manifests.json'
import './home.css'
import './home-shell.css'
import './glance.css'

const WidgetView = memo(function WidgetView({ context, frameless = true, ...props }) {
  return (
    <DashboardContext.Provider value={context}>
      <WidgetBoundary id={props.manifest.id} onRetry={context.refreshAll}>
        <WidgetFrame {...props} frameless={frameless} />
      </WidgetBoundary>
    </DashboardContext.Provider>
  )
})

export const DEFAULT_GLANCE_WIDGETS = [
  { id: 'glance.weather', size: 'l', design: 'weather-sm-01' },
  { id: 'glance.clock', size: 'm', design: 'clock-sm-01' },
  { id: 'glance.sun', size: 's', design: 'sun-sm-01' },
  { id: 'glance.air', size: 's', design: 'air-sm-01' },
  { id: 'glance.pc', size: 'm', design: 'pc-sm-01' },
  { id: 'glance.music', size: 'm', design: 'media-sm-01' },
]

export const ADD_CATEGORIES = [
  { id: 'glance', label: 'Glance' },
  { id: 'system', label: 'System' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'needs-you', label: 'Needs Attention' },
  { id: 'feed', label: 'Feeds' },
  { id: 'communication', label: 'Communication' },
  { id: 'agent', label: 'Agent' },
  { id: 'library', label: 'Library' },
  { id: 'all', label: 'All' },
]

export default function Home({ layoutMode = 'desktop' }) {
  const showFennel = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fennel') === '1'
  if (showFennel) {
    return <FennelHome />
  }

  const navigate = useNavigate()
  const { setOverlay, setCapabilitiesTab, userProfile, openChatWithPrompt } = useApp()
  const connections = useConnections()
  const openPalette = useCallback(() => setOverlay('palette'), [setOverlay])
  const openAppearance = useCallback(() => navigate('/settings?tab=appearance'), [navigate])
  const manageConnections = useCallback(() => { setCapabilitiesTab('connectors'); navigate('/capabilities') }, [navigate, setCapabilitiesTab])
  const connectSource = useCallback(() => setDrawer({ type: 'settings', settingsId: 'sys.connectors' }), [])
  const [drawer, setDrawer] = useState(null)

  useEffect(() => {
    const handleOpenConnectors = () => setDrawer({ type: 'settings', settingsId: 'sys.connectors' })
    window.addEventListener('amethyst:open-connectors', handleOpenConnectors)
    return () => window.removeEventListener('amethyst:open-connectors', handleOpenConnectors)
  }, [])

  const [entries, setEntries] = useState(() => cached('manifests') || [])
  const [layout, setLayout] = useState(() => {
    try {
      const v = localStorage.getItem('amethyst.bento.v5')
      if (v !== 'true') {
        localStorage.setItem('amethyst.bento.v5', 'true')
        remember(`layout.${layoutMode}`, { widgets: DEFAULT_GLANCE_WIDGETS })
        return { widgets: DEFAULT_GLANCE_WIDGETS }
      }
    } catch {}
    return cached(`layout.${layoutMode}`) || { widgets: DEFAULT_GLANCE_WIDGETS }
  })
  const [editing, setEditing] = useState(false)
  const [selectedWidgetId, setSelectedWidgetId] = useState(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addSearchQuery, setAddSearchQuery] = useState('')
  const [addCategory, setAddCategory] = useState('glance')
  const [addSelectedId, setAddSelectedId] = useState(null)
  const [addSelectedSize, setAddSelectedSize] = useState('m')
  const [addSelectedDesign, setAddSelectedDesign] = useState(null)
  const [askQuery, setAskQuery] = useState('')
  const [quietSettings, setQuietSettings] = useState(() => cached('quiet') || {})
  const [records, setRecords] = useState({})
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [now, setNow] = useState(new Date())
  const [loaded, setLoaded] = useState(false)
  const layoutRef = useRef(layout)
  const confirmedLayout = useRef(layout)
  const dirty = useRef(false)
  const saveQueue = useRef(Promise.resolve())
  const mounted = useRef(false)

  // Use live manifests from backend, fall back to default manifests if not yet loaded or blocked
  const manifests = useMemo(() => {
    const list = Array.isArray(entries) && entries.length > 0
      ? entries.filter(e => e?.enabled).map(e => e?.manifest).filter(Boolean)
      : defaultManifests
    return list && list.length > 0 ? list : defaultManifests
  }, [entries])

  const requested = new URLSearchParams(window.location.search).get('widget')

  const currentWidgets = useMemo(() => {
    if (Array.isArray(layout?.widgets) && layout.widgets.length > 0) return layout.widgets
    return DEFAULT_GLANCE_WIDGETS
  }, [layout?.widgets])

  const positions = useMemo(() => {
    if (requested && !SYSTEM_WIDGETS.includes(requested) && manifests.some(m => m.id === requested)) {
      if (!currentWidgets.some(w => w.id === requested)) {
        return [{ id: requested, size: 'm' }, ...currentWidgets]
      }
    }
    return currentWidgets
  }, [requested, manifests, currentWidgets])

  const quiet = quietNow(quietSettings, now)
  const refreshAll = useCallback(() => setRefreshVersion(n => n + 1), [])
  const onData = useCallback((id, data) => setRecords(old => JSON.stringify(old[id]) === JSON.stringify(data) ? old : { ...old, [id]: data }), [])

  useEffect(() => {
    mounted.current = true
    request('/widgets')
      .then(value => {
        if (mounted.current) {
          const list = Array.isArray(value?.widgets) ? value.widgets : []
          if (list.length > 0) {
            setEntries(list)
            remember('manifests', list)
          }
        }
      })
      .catch(err => { if (mounted.current) setError(err.message) })

    request(`/layout?mode=${encodeURIComponent(layoutMode)}`)
      .then(value => {
        if (mounted.current && !dirty.current) {
          const isModern = Array.isArray(value?.widgets) && value.widgets.length > 0 && value.widgets.some(w => w.id === 'glance.pc')
          const nextLayout = isModern ? value : { widgets: DEFAULT_GLANCE_WIDGETS }
          setLayout(nextLayout)
          layoutRef.current = nextLayout
          confirmedLayout.current = nextLayout
          remember(`layout.${layoutMode}`, nextLayout)
        }
      })
      .catch(err => { if (mounted.current) setError(err.message) })
      .finally(() => { if (mounted.current) setLoaded(true) })

    request('/widgets/dash.quiet/settings')
      .then(value => {
        if (mounted.current) {
          setQuietSettings(value || {})
          remember('quiet', value || {})
        }
      })
      .catch(() => {})

    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [layoutMode])

  function persist(next, undo = true, message = 'Layout updated') {
    const previous = layoutRef.current
    if (undo) showBoardUINotification({
      id: 'home-layout',
      title: message,
      type: 'info',
      action: { label: 'Undo', onClick: () => persist(previous, false) },
    })
    dirty.current = true
    layoutRef.current = next
    setLayout(next)
    remember(`layout.${layoutMode}`, next)
    setSaveState('Saving layout…')
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => request(`/layout?mode=${encodeURIComponent(layoutMode)}`, 'PUT', next))
      .then(() => {
        confirmedLayout.current = next
        if (mounted.current && layoutRef.current === next) setSaveState('Layout saved')
      })
      .catch(err => {
        if (!mounted.current) return
        setSaveState(`Layout not saved to server: ${err.message}`)
        if (layoutRef.current === next) {
          layoutRef.current = confirmedLayout.current
          setLayout(confirmedLayout.current)
          remember(`layout.${layoutMode}`, confirmedLayout.current)
        }
      })
  }

  const saveQuiet = useCallback(async value => {
    const saved = await request('/widgets/dash.quiet/settings', 'PUT', value)
    setQuietSettings(saved)
    remember('quiet', saved)
    setRefreshVersion(n => n + 1)
  }, [])

  useEffect(() => {
    function key(event) {
      if (event.target.closest('input,select,textarea,[contenteditable=true]')) return
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); refreshAll() }
      if (event.key.toLowerCase() === 'e') { event.preventDefault(); setEditing(value => !value); setSelectedWidgetId(null) }
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); setAddModalOpen(true) }
      if (event.key.toLowerCase() === 'q') { event.preventDefault(); saveQuiet({ ...quietSettings, snoozed_until: new Date(Date.now() + 3600000).toISOString() }).catch(err => setError(err.message)) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [quietSettings, refreshAll, saveQuiet])

  function changeDesign(id, design) {
    const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    if (!widgets.some(w => w.id === id) || !design) return
    const msg = id === 'glance.clock' ? 'Clock face updated' : 'Widget style updated'
    persist({
      widgets: widgets.map(w => w.id === id ? { ...w, design } : w)
    }, false, msg)
    setAnnouncement(msg)
  }

  function resize(id, patch) {
    if (!patch?.size) return
    const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    const next = widgets.map(w => w.id === id ? { ...w, size: patch.size } : w)
    persist({ ...layoutRef.current, widgets: next }, false, `${id} resized`)
    setAnnouncement(`${id} resized to ${patch.size.toUpperCase()}`)
  }

  function addWidget(id, size, design) {
    const manifest = manifests.find(item => item.id === id)
    if (!manifest || SYSTEM_WIDGETS.includes(id)) return
    const selectedSize = manifest.sizes?.includes(size) ? size : (manifest.sizes?.[0] || 'm')
    const item = { id, size: selectedSize, ...(design ? { design } : {}) }
    const existing = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    const next = [...existing.filter(w => w.id !== id), item]
    persist({ ...layoutRef.current, widgets: next }, true, `${manifest.title} added to Today`)
    setAddModalOpen(false)
  }

  function removeWidget(id) {
    const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    if (widgets.some(w => w.id === id)) {
      persist({ ...layoutRef.current, widgets: widgets.filter(w => w.id !== id) }, true, 'Widget removed')
    }
    if (selectedWidgetId === id) setSelectedWidgetId(null)
  }

  const openWidget = id => setDrawer(SYSTEM_WIDGETS.includes(id) ? { type: 'settings', settingsId: id } : { id })

  const actions = useRef({})
  useLayoutEffect(() => { actions.current = { removeWidget, openWidget, changeDesign, resize, addWidget } })
  const stable = useMemo(() => Object.fromEntries(['removeWidget', 'openWidget', 'changeDesign', 'resize', 'addWidget'].map(key => [key, (...args) => actions.current[key](...args)])), [])

  const frameContext = useMemo(() => ({
    now, quiet, quietSettings, manifests, openPalette, setEditing, editing, connectSource,
    connectionHealth: connections.data, refreshAll, ...stable, layout: { widgets: positions }
  }), [now, quiet, quietSettings, manifests, openPalette, setEditing, editing, connectSource, connections.data, refreshAll, stable, positions])

  const homeWidgets = useMemo(() => {
    return positions.filter(w => !SYSTEM_WIDGETS.includes(w.id) && manifests.some(m => m.id === w.id))
  }, [positions, manifests])

  const selectedWidget = useMemo(() => {
    return selectedWidgetId ? homeWidgets.find(w => w.id === selectedWidgetId) : null
  }, [selectedWidgetId, homeWidgets])

  const selectedWidgetManifest = useMemo(() => {
    return selectedWidget ? manifests.find(m => m.id === selectedWidget.id) : null
  }, [selectedWidget, manifests])

  const selectedWidgetVariations = useMemo(() => {
    return selectedWidget ? widgetVariations(selectedWidget.id) : []
  }, [selectedWidget])

  const filteredAddManifests = useMemo(() => {
    const q = addSearchQuery.trim().toLowerCase()
    let list = manifests.filter(m => !SYSTEM_WIDGETS.includes(m.id))
    if (q) {
      return list.filter(m => m.title.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    }
    if (addCategory && addCategory !== 'all') {
      list = list.filter(m => m.group === addCategory)
    }
    return list
  }, [manifests, addSearchQuery, addCategory])

  const addCurrentId = (filteredAddManifests.some(m => m.id === addSelectedId) ? addSelectedId : filteredAddManifests[0]?.id) || 'glance.weather'
  const addCurrentManifest = useMemo(() => manifests.find(m => m.id === addCurrentId) || manifests[0], [manifests, addCurrentId])
  const addCurrentVariations = useMemo(() => addCurrentId ? widgetVariations(addCurrentId) : [], [addCurrentId])

  const handleAskSubmit = (e) => {
    e.preventDefault()
    if (askQuery.trim()) {
      if (openChatWithPrompt) openChatWithPrompt(askQuery.trim())
      else openPalette()
      setAskQuery('')
    } else {
      openPalette()
    }
  }

  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const userName = userProfile?.name || 'Nova'
  const dateFormatted = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  const closeDrawer = () => setDrawer({ type: 'closed' })

  return (
    <>
      <div className="today-bento-shell">
        <header className="today-bento-header">
          <div>
            <p>{dateFormatted}</p>
            <h1>{greeting}, {userName}</h1>
          </div>
          <form className="today-ask-pill" onSubmit={handleAskSubmit}>
            <input
              type="text"
              placeholder="Ask Amethyst…"
              value={askQuery}
              onChange={e => setAskQuery(e.target.value)}
              aria-label="Ask Amethyst"
            />
            <button type="submit" className="today-ask-btn" aria-label="Send query">
              <Icon name="arrow-up" size={16} />
            </button>
          </form>
        </header>

        {error && (
          <div className="today-message" role="alert" style={{ marginBottom: 16 }}>
            <Icon name="warning" size={16} />
            <p>{error}</p>
            <Button size="small" onClick={() => window.location.reload()}>Retry</Button>
          </div>
        )}

        <motion.div layout className="today-bento-grid">
          <AnimatePresence>
            {homeWidgets.map(widget => {
              const manifest = manifests.find(m => m.id === widget.id)
              if (!manifest) return null
              const size = widget.size || 'm'
              const isSelected = selectedWidgetId === widget.id

              return (
                <motion.div
                  layout
                  key={widget.id}
                  className={`today-widget-cell ${editing ? 'is-editing' : ''} ${isSelected ? 'is-selected' : ''}`}
                  style={{
                    gridColumn: size === 's' ? 'span 1' : 'span 2',
                    gridRow: size === 'l' ? 'span 2' : 'span 1',
                  }}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    rotate: editing ? [0, -0.6, 0.6, -0.4, 0.4, 0] : 0,
                  }}
                  exit={{ opacity: 0, scale: 0.88 }}
                  transition={editing ? {
                    rotate: { repeat: Infinity, duration: 0.4, ease: 'easeInOut' },
                    layout: { type: 'spring', damping: 28, stiffness: 350 },
                  } : {
                    type: 'spring', damping: 28, stiffness: 350,
                    layout: { type: 'spring', damping: 28, stiffness: 350 },
                  }}
                  whileHover={!editing ? { scale: 1.012 } : undefined}
                  whileTap={!editing ? { scale: 0.985 } : undefined}
                  onClick={() => {
                    if (editing) setSelectedWidgetId(widget.id)
                  }}
                >
                  {editing && (
                    <motion.button
                      type="button"
                      className="today-widget-remove-badge"
                      aria-label={`Remove ${manifest.title}`}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      whileHover={{ scale: 1.15, backgroundColor: '#e5484d' }}
                      whileTap={{ scale: 0.9 }}
                      onClick={e => {
                        e.stopPropagation()
                        removeWidget(widget.id)
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </motion.button>
                  )}
                  <WidgetView
                    context={frameContext}
                    manifest={manifest}
                    size={size}
                    design={widget.design}
                    quiet={quiet}
                    refreshVersion={refreshVersion}
                    onData={onData}
                    editing={false}
                    tile={false}
                    full={false}
                  />
                </motion.div>
              )
            })}
          </AnimatePresence>
        </motion.div>

        <div className="today-bento-bar">
          <motion.button
            type="button"
            className="today-pill-btn"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setAddModalOpen(true)}
          >
            <Icon name="plus" size={18} />
            <span>Add widget</span>
          </motion.button>
          <motion.button
            type="button"
            className="today-pill-btn secondary"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => {
              setEditing(v => !v)
              setSelectedWidgetId(null)
            }}
          >
            {editing ? 'Done' : 'Edit'}
          </motion.button>
        </div>
      </div>

      {/* Animated Inspector Modal */}
      <AnimatePresence>
        {editing && selectedWidget && selectedWidgetManifest && (
          <motion.aside
            className="today-inspector-modal"
            role="dialog"
            aria-label={`Edit ${selectedWidgetManifest.title}`}
            initial={{ opacity: 0, scale: 0.9, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 400 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 11,
                background: 'var(--wx)', color: 'var(--wxt)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Icon name={WIDGET_ICONS[selectedWidget.id] || 'grid'} size={20} />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{selectedWidgetManifest.title}</p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--today-mu)' }}>
                  {(selectedWidgetManifest.sizes || ['s', 'm', 'l']).map(s => s === 's' ? 'Small' : s === 'm' ? 'Medium' : 'Large').join(', ')}
                </p>
              </div>
            </div>

            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--today-mu)', margin: '20px 0 8px' }}>Size</p>
            <div className="today-seg-control">
              {['s', 'm', 'l'].map(s => {
                const supported = (selectedWidgetManifest.sizes || []).includes(s)
                const active = (selectedWidget.size || 'm') === s
                return (
                  <motion.button
                    key={s}
                    type="button"
                    disabled={!supported}
                    whileTap={supported ? { scale: 0.95 } : undefined}
                    className={`today-seg-item ${active ? 'is-active' : ''} ${!supported ? 'is-disabled' : ''}`}
                    style={{ opacity: supported ? 1 : 0.35, cursor: supported ? 'pointer' : 'not-allowed' }}
                    onClick={() => supported && resize(selectedWidget.id, { size: s })}
                  >
                    {s === 's' ? 'Small' : s === 'm' ? 'Medium' : 'Large'}
                  </motion.button>
                )
              })}
            </div>

            {selectedWidgetVariations.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--today-mu)', margin: '18px 0 10px' }}>Style</p>
                <div className="today-style-grid">
                  {selectedWidgetVariations.map((v, idx) => {
                    const isCur = variationNumber(selectedWidget.design) === idx + 1
                    return (
                      <motion.div
                        key={v.id}
                        className={`today-style-thumb ${isCur ? 'is-selected' : ''}`}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => changeDesign(selectedWidget.id, v.id)}
                      >
                        <div
                          className="today-style-box"
                          style={{
                            background: idx === 0 ? 'var(--wx)' : idx === 1 ? 'var(--a1)' : idx === 2 ? '#1d1d1f' : 'var(--today-card)',
                            color: idx === 0 ? 'var(--wxt)' : idx === 1 ? '#fff' : idx === 2 ? '#fff' : 'var(--today-tx)',
                          }}
                        >
                          <i style={{ display: 'block', width: '70%', height: 4, borderRadius: 2, background: 'currentColor', marginBottom: 4 }} />
                          <i style={{ display: 'block', width: '45%', height: 4, borderRadius: 2, background: 'currentColor', opacity: 0.5 }} />
                        </div>
                        <span>{v.name}</span>
                      </motion.div>
                    )
                  })}
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--today-ln)' }}>
              <button
                type="button"
                style={{ border: 0, background: 'none', color: '#d70015', font: '600 14px Inter,sans-serif', cursor: 'pointer', minHeight: 44, padding: '0 8px' }}
                onClick={() => {
                  removeWidget(selectedWidget.id)
                  setSelectedWidgetId(null)
                }}
              >
                Remove
              </button>
              <motion.button
                type="button"
                className="today-pill-btn secondary"
                style={{ height: 38, padding: '0 18px', fontSize: 14 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setSelectedWidgetId(null)}
              >
                Done
              </motion.button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Animated Add Widget Modal */}
      <AnimatePresence>
        {addModalOpen && (
          <motion.div
            className="today-add-modal-overlay"
            initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            animate={{ opacity: 1, backdropFilter: 'blur(10px)' }}
            exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={() => setAddModalOpen(false)}
          >
            <motion.div
              className="today-add-modal"
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ type: 'spring', damping: 27, stiffness: 370 }}
              onClick={e => e.stopPropagation()}
            >
              {/* Left sidebar listing available widgets */}
              <div className="today-add-sidebar">
                <div className="today-add-search-box">
                  <Icon name="search" size={16} />
                  <input
                    type="text"
                    placeholder="Search widgets…"
                    value={addSearchQuery}
                    onChange={e => setAddSearchQuery(e.target.value)}
                  />
                </div>

                {/* Category filter pills */}
                <div className="today-add-category-pills">
                  {ADD_CATEGORIES.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`today-add-cat-pill ${addCategory === cat.id ? 'is-active' : ''}`}
                      onClick={() => {
                        setAddCategory(cat.id)
                        setAddSelectedDesign(null)
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', flex: 1 }}>
                  {filteredAddManifests.map(m => {
                    const isSel = addCurrentId === m.id
                    return (
                      <motion.button
                        key={m.id}
                        type="button"
                        whileHover={{ x: 3 }}
                        whileTap={{ scale: 0.98 }}
                        className={`today-add-item ${isSel ? 'is-selected' : ''}`}
                        onClick={() => {
                          setAddSelectedId(m.id)
                          setAddSelectedSize(m.sizes?.[0] || 'm')
                          setAddSelectedDesign(null)
                        }}
                      >
                        <span style={{
                          width: 32, height: 32, borderRadius: 10,
                          background: isSel ? 'var(--today-tx)' : 'rgba(0,0,0,0.06)',
                          color: isSel ? 'var(--today-card)' : 'var(--today-tx)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                        }}>
                          <Icon name={WIDGET_ICONS[m.id] || 'grid'} size={17} />
                        </span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</span>
                      </motion.button>
                    )
                  })}
                </div>
              </div>

              {/* Right details & preview pane */}
              {addCurrentManifest && (
                <div className="today-add-content">
                  <div className="today-add-content-header">
                    <h2>{addCurrentManifest.title}</h2>
                    <p>{addCurrentManifest.description || 'Add this widget to your Today dashboard.'}</p>
                  </div>

                  <div className="today-add-section-label">Size</div>
                  <div className="today-add-previews-row">
                    {(addCurrentManifest.sizes || ['m']).map(s => {
                      const isSel = addSelectedSize === s
                      return (
                        <motion.div
                          key={s}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className={`today-add-preview-card ${isSel ? 'is-selected' : ''}`}
                          style={{
                            width: s === 's' ? 180 : s === 'm' ? 300 : 300,
                            height: s === 's' ? 160 : s === 'm' ? 160 : 250,
                          }}
                          onClick={() => setAddSelectedSize(s)}
                        >
                          <div style={{
                            width: s === 's' ? 284 : s === 'm' ? 584 : 584,
                            height: s === 's' ? 284 : s === 'm' ? 284 : 584,
                            transform: s === 's' ? 'scale(0.53)' : s === 'm' ? 'scale(0.48)' : 'scale(0.48)',
                            transformOrigin: '0 0',
                            pointerEvents: 'none',
                          }}>
                            <WidgetView
                              context={frameContext}
                              manifest={addCurrentManifest}
                              size={s}
                              design={addSelectedDesign}
                              quiet={quiet}
                              refreshVersion={refreshVersion}
                              onData={onData}
                              editing={false}
                              preview={true}
                              frameless={true}
                            />
                          </div>
                          <div className="today-add-preview-label">
                            {s === 's' ? 'Small (1×1)' : s === 'm' ? 'Medium (2×1)' : 'Large (2×2)'}
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {addCurrentVariations.length > 0 && (
                    <>
                      <div className="today-add-section-label">Style</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, maxWidth: 440, marginBottom: 24 }}>
                        {addCurrentVariations.map((v, idx) => {
                          const isCur = addSelectedDesign ? addSelectedDesign === v.id : idx === 0
                          return (
                            <motion.div
                              key={v.id}
                              className={`today-style-thumb ${isCur ? 'is-selected' : ''}`}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setAddSelectedDesign(v.id)}
                            >
                              <div
                                className="today-style-box"
                                style={{
                                  background: idx === 0 ? 'var(--wx)' : idx === 1 ? 'var(--a1)' : idx === 2 ? '#1d1d1f' : 'var(--today-card)',
                                  color: idx === 0 ? 'var(--wxt)' : idx === 1 ? '#fff' : idx === 2 ? '#fff' : 'var(--today-tx)',
                                }}
                              >
                                <i style={{ display: 'block', width: '70%', height: 4, borderRadius: 2, background: 'currentColor', marginBottom: 4 }} />
                                <i style={{ display: 'block', width: '45%', height: 4, borderRadius: 2, background: 'currentColor', opacity: 0.5 }} />
                              </div>
                              <span>{v.name}</span>
                            </motion.div>
                          )
                        })}
                      </div>
                    </>
                  )}

                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <motion.button
                      type="button"
                      className="today-pill-btn secondary"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setAddModalOpen(false)}
                    >
                      Cancel
                    </motion.button>
                    <motion.button
                      type="button"
                      className="today-pill-btn"
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => {
                        addWidget(addCurrentManifest.id, addSelectedSize, addSelectedDesign)
                        setAddModalOpen(false)
                      }}
                    >
                      <Icon name="plus" size={16} />
                      <span>Add widget</span>
                    </motion.button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DashboardContext.Provider value={{ openPalette, openAppearance, manifests, layout, records, quiet, quietSettings, saveQuiet, refreshAll, editing, setEditing, addWidget, resize, changeDesign, removeWidget, now, openWidget, connectSource, manageConnections, connections }}>
        {drawer?.type === 'settings' && <Drawer title="Home settings" description="Refresh, quiet hours, and keyboard shortcuts." onClose={closeDrawer}><HomeSettings key="settings" /></Drawer>}
        {selectedWidgetManifest && drawer?.type === 'detail' && <Drawer title={selectedWidgetManifest.title} onClose={closeDrawer}><div className="today-widgets-canvas"><WidgetView context={frameContext} manifest={selectedWidgetManifest} size={selectedWidgetManifest.sizes[0]} quiet={quiet} refreshVersion={refreshVersion} onData={onData} editing={false} full /></div></Drawer>}
      </DashboardContext.Provider>
    </>
  )
}
