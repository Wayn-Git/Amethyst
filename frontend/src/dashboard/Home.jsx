import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import WidgetFrame, { WidgetBoundary } from './WidgetFrame.jsx'
import { DashboardContext } from './context.js'
import { cached, remember, request } from './api.js'
import { GLANCE_WIDGETS, NEED_WIDGETS, SYSTEM_WIDGETS, quietNow, widgetDisplaySize } from './layout.js'
import { useApp } from '../store.jsx'
import Drawer from './Drawer.jsx'
import HomeSettings from './HomeSettings.jsx'
import useConnections from './useConnections.js'
import SourceItem from './SourceItem.jsx'
import Button from '../components/ui/AppButton.jsx'
import WidgetSlot from './WidgetSlot.jsx'
import AddWidget from './AddWidget.jsx'
import { showBoardUINotification } from '../lib/boardui-notifications.js'
import { GRID_GEOMETRY, gridCellAt, gridPosition, insertGridWidget, moveGridWidget, normalizeLayout, removeGridWidget, resizeGridWidget } from './grid.js'
import FennelHome from '../views/FennelHome.jsx'
import './home.css'
import './home-shell.css'

const WidgetView = memo(function WidgetView({ context, ...props }) {
  return (
    <DashboardContext.Provider value={context}>
      <WidgetBoundary id={props.manifest.id} onRetry={context.refreshAll}>
        <WidgetFrame {...props} />
      </WidgetBoundary>
    </DashboardContext.Provider>
  )
})

export default function Home({ layoutMode = "default" }) {
  const showClassic = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('classic') === '1'
  if (!showClassic) {
    return <FennelHome />
  }

  const navigate = useNavigate()
  const { setOverlay, setCapabilitiesTab } = useApp()
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
  const [layout, setLayout] = useState(() => normalizeLayout(cached(`layout.${layoutMode}`)))
  const [editing, setEditing] = useState(false)
  const [previewWidgets, setPreviewWidgets] = useState(null)
  const [dragging, setDragging] = useState(null)
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
  const gesture = useRef(null)
  const gridViewport = useRef(null)
  const [gridViewportWidth, setGridViewportWidth] = useState(0)

  const manifests = useMemo(() => (Array.isArray(entries) ? entries : []).filter(e => e?.enabled).map(e => e?.manifest).filter(Boolean), [entries])
  const requested = new URLSearchParams(window.location.search).get('widget')
  const currentWidgets = useMemo(() => Array.isArray(layout?.widgets) ? layout.widgets : [], [layout?.widgets])
  const initialWidgets = useMemo(() => {
    if (currentWidgets.length || loaded) return currentWidgets
    return [
      { id: 'glance.clock', size: 'm', design: 'clock-sm-05' },
      { id: 'glance.weather', size: 'm', design: 'weather-sm-03' },
      { id: 'glance.music', size: 'm', design: 'media-sm-03' },
    ]
  }, [currentWidgets, loaded])
  const positionSource = previewWidgets || initialWidgets
  const positions = useMemo(() => normalizeLayout({ widgets: (
    requested && !SYSTEM_WIDGETS.includes(requested) && !NEED_WIDGETS.includes(requested) && manifests.some(m => m.id === requested)
      ? [positionSource.find(w => w.id === requested) || { id: requested, size: 'm', height: 4 }, ...positionSource.filter(w => w.id !== requested)] : positionSource
  ) }).widgets, [requested, manifests, positionSource])
  const requiredColumns = positions.reduce((max, item) => Math.max(max, item.x + item.w), 0)
  const visibleColumns = Math.max(1, Math.floor((gridViewportWidth + GRID_GEOMETRY.gap) / (GRID_GEOMETRY.cellWidth + GRID_GEOMETRY.gap)))
  const gridColumns = Math.max(visibleColumns, requiredColumns)
  const gridRows = positions.reduce((max, item) => Math.max(max, item.y + item.h), 0)
  const gridStyle = {
    width: GRID_GEOMETRY.insetX * 2 + gridColumns * GRID_GEOMETRY.cellWidth + Math.max(0, gridColumns - 1) * GRID_GEOMETRY.gap,
    height: GRID_GEOMETRY.insetY * 2 + gridRows * GRID_GEOMETRY.rowHeight + Math.max(0, gridRows - 1) * GRID_GEOMETRY.gap,
  }
  const quiet = quietNow(quietSettings, now)
  const refreshAll = useCallback(() => setRefreshVersion(n => n + 1), [])
  const onData = useCallback((id, data) => setRecords(old => JSON.stringify(old[id]) === JSON.stringify(data) ? old : { ...old, [id]: data }), [])

  useEffect(() => {
    mounted.current = true
    request('/widgets')
      .then(value => {
        if (mounted.current) {
          const list = Array.isArray(value?.widgets) ? value.widgets : []
          setEntries(list)
          remember('manifests', list)
        }
      })
      .catch(err => { if (mounted.current) setError(err.message) })

    request(`/layout?mode=${encodeURIComponent(layoutMode)}`)
      .then(value => {
        if (mounted.current && !dirty.current) {
          const nextLayout = normalizeLayout(value)
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

  useEffect(() => {
    const element = gridViewport.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setGridViewportWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [loaded])

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
      if (event.key.toLowerCase() === 'e') { event.preventDefault(); setEditing(value => !value) }
      if (event.key.toLowerCase() === 'a') { event.preventDefault(); setDrawer({ type: 'add' }) }
      if (event.key.toLowerCase() === 'q') { event.preventDefault(); saveQuiet({ ...quietSettings, snoozed_until: new Date(Date.now() + 3600000).toISOString() }).catch(err => setError(err.message)) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [quietSettings, refreshAll, saveQuiet])

  function changeDesign(id, design) {
    const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    if (!widgets.some(w => w.id === id) || !design) return
    const msg = id === 'glance.clock' ? 'Clock face updated' : 'Widget design updated'
    persist({
      widgets: widgets.map(w => w.id === id ? { ...w, design } : w)
    }, true, msg)
    setAnnouncement(msg)
  }

  function move(id, direction) {
    const item = positions.find(widget => widget.id === id)
    if (!item) return
    const delta = typeof direction === 'number' ? { x: direction, y: 0 } : {
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
    }[direction]
    if (!delta) return
    const next = moveGridWidget(positions, id, item.x + delta.x, item.y + delta.y)
    if (!next) { setAnnouncement(`Could not move ${id} there`); return }
    setPreviewWidgets(null)
    persist({ ...layoutRef.current, widgets: next })
    setAnnouncement(`${id} moved`)
  }

  function resize(id, patch) {
    if (!patch?.size) return
    const manifest = manifests.find(item => item.id === id)
    if (!manifest?.sizes?.includes(patch.size)) return
    const next = resizeGridWidget(positions, id, patch.size)
    if (!next) { setAnnouncement(`Could not resize ${id} in this layout`); return }
    setPreviewWidgets(null)
    persist({ ...layoutRef.current, widgets: next })
    setAnnouncement(`${id} resized to ${patch.size.toUpperCase()}`)
  }

  function addWidget(id, size, design) {
    const manifest = manifests.find(item => item.id === id)
    if (!manifest || SYSTEM_WIDGETS.includes(id)) return
    const selectedSize = manifest.sizes.includes(size) ? size : manifest.sizes[0]
    const item = { id, size: selectedSize, height: 3, ...(design ? { design } : {}) }
    const next = insertGridWidget(positions, item)
    if (!next) { setAnnouncement(`Could not add ${manifest.title}; the grid has no valid placement`); return }
    setPreviewWidgets(null)
    persist({ ...layoutRef.current, widgets: next }, true, `${manifest.title} added to Home`)
    setDrawer(null)
  }

  function toggleWidget(id) {
    if (layoutRef.current.widgets.some(item => item.id === id)) removeWidget(id)
    else addWidget(id)
  }

  function grip(kind, id) {
    return {
      onPointerDown(event) {
        if (event.button !== 0 || !editing) return
        event.preventDefault()
        const element = event.currentTarget.closest('[data-slot-id]')
        const viewport = gridViewport.current
        const item = positions.find(widget => widget.id === id)
        if (!element || !viewport || !item) return
        element.getAnimations().forEach(animation => animation.cancel())
        const rect = element.getBoundingClientRect()
        gesture.current = {
          kind, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
          original: positions, candidate: positions,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove(event) {
        const active = gesture.current
        if (!active || active.pointerId !== event.pointerId) return
        if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 5) return
        setDragging(id)
        let next
        if (kind === 'resize') {
          const manifest = manifests.find(item => item.id === id)
          const item = active.original.find(widget => widget.id === id)
          const horizontal = Math.abs(event.clientX - active.startX) >= Math.abs(event.clientY - active.startY)
          const steps = horizontal
            ? Math.round((event.clientX - active.startX) / (GRID_GEOMETRY.cellWidth + GRID_GEOMETRY.gap))
            : Math.round((event.clientY - active.startY) / (GRID_GEOMETRY.rowHeight + GRID_GEOMETRY.gap))
          const sizes = manifest?.sizes || []
          const index = sizes.indexOf(item?.size)
          const size = sizes[Math.max(0, Math.min(sizes.length - 1, index + steps))]
          next = size ? resizeGridWidget(active.original, id, size) : null
        } else {
          const viewport = gridViewport.current
          if (!viewport) return
          const local = {
            x: event.clientX - viewport.getBoundingClientRect().left + viewport.scrollLeft - active.grabX,
            y: event.clientY - viewport.getBoundingClientRect().top + viewport.scrollTop - active.grabY,
          }
          const cell = gridCellAt(local)
          next = moveGridWidget(active.original, id, cell.x, cell.y)
        }
        if (next) { active.candidate = next; setPreviewWidgets(next) }
        else { active.candidate = active.original; setPreviewWidgets(active.original) }
      },
      onPointerUp(event) {
        const active = gesture.current
        if (!active || active.pointerId !== event.pointerId) return
        if (active.candidate !== active.original) persist({ ...layoutRef.current, widgets: active.candidate })
        gesture.current = null
        setDragging(null)
        setPreviewWidgets(null)
      },
      onPointerCancel() {
        if (!gesture.current) return
        gesture.current = null
        setDragging(null)
        setPreviewWidgets(null)
      },
      onLostPointerCapture() {
        if (!gesture.current) return
        gesture.current = null
        setDragging(null)
        setPreviewWidgets(null)
      },
      onKeyDown(event) {
        if (!event.key.startsWith('Arrow')) return
        event.preventDefault()
        if (kind === 'move') move(id, event.key)
        else {
          const item = positions.find(widget => widget.id === id), sizes = manifests.find(widget => widget.id === id)?.sizes || []
          const index = sizes.indexOf(item?.size), step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1
          const size = sizes[Math.max(0, Math.min(sizes.length - 1, index + step))]
          if (size) resize(id, { size })
        }
      },
    }
  }

  useEffect(() => {
    const cancel = event => {
      if (event.key !== 'Escape' || !gesture.current) return
      event.preventDefault()
      gesture.current = null
      setDragging(null)
      setPreviewWidgets(null)
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])

  function removeWidget(id) {
    const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    if (widgets.some(w => w.id === id)) {
      persist({ ...layoutRef.current, widgets: removeGridWidget(widgets, id) })
    }
    if (selectedId === id || requested === id) {
      const url = new URL(window.location.href)
      url.searchParams.delete('widget')
      window.history.replaceState({}, '', url)
      setDrawer({ type: 'closed' })
    }
  }

  const openWidget = id => setDrawer(SYSTEM_WIDGETS.includes(id) ? { type: 'settings', settingsId: id } : { id })
  const selectedId = drawer?.id || (drawer === null && NEED_WIDGETS.includes(requested) ? requested : null)
  const selected = selectedId && manifests.find(m => m.id === selectedId)
  const membership = [...new Set(currentWidgets.map(w => w.id))].sort().join('|')

  const actions = useRef({})
  useLayoutEffect(() => { actions.current = { removeWidget, openWidget, changeDesign, move, resize, grip, addWidget } })
  const stable = useMemo(() => Object.fromEntries(['removeWidget', 'openWidget', 'changeDesign', 'move', 'resize', 'grip', 'addWidget'].map(key => [key, (...args) => actions.current[key](...args)])), [])
  const frameContext = useMemo(() => ({
    now, quiet, quietSettings, manifests, openPalette, setEditing, editing, connectSource,
    connectionHealth: connections.data, refreshAll, ...stable, layout: { widgets: membership.split('|').map(id => ({ id })) }
  }), [now, quiet, quietSettings, manifests, openPalette, setEditing, editing, connectSource, connections.data, refreshAll, stable, membership])

  const views = useMemo(() => new Map(positions.map(position => {
    const manifest = manifests.find(m => m.id === position.id)
    return [position.id, manifest && (
      <WidgetView
        key={manifest.id}
        context={frameContext}
        manifest={manifest}
        size={position.size || 'm'}
        design={position.design}
        quiet={quiet}
        refreshVersion={refreshVersion}
        onData={onData}
        editing={false}
        tile={false}
        full={false}
      />
    )]
  })), [manifests, frameContext, quiet, refreshVersion, onData, positions])

  const renderWidget = (position, full = false) => {
    const manifest = manifests.find(m => m.id === position.id)
    if (!manifest) return null
    if (full) return <WidgetView context={frameContext} manifest={manifest} size={position.size || 'm'} design={position.design} quiet={quiet} refreshVersion={refreshVersion} onData={onData} editing={false} full />
    return (
      <WidgetSlot
        key={manifest.id}
        id={manifest.id}
        title={manifest.title}
        size={position.size || 'm'}
        displaySize={widgetDisplaySize(position.id, position.size || 'm')}
        sizes={manifest.sizes}
        editing={editing}
        dragging={dragging === position.id}
        placement={gridPosition(position)}
        move={stable.move}
        resize={stable.resize}
        grip={stable.grip}
        remove={stable.removeWidget}
      >
        {views.get(position.id)}
      </WidgetSlot>
    )
  }

  const homePositions = positions.filter(w => !SYSTEM_WIDGETS.includes(w.id) && manifests.some(manifest => manifest.id === w.id))
  const requestedSystem = SYSTEM_WIDGETS.includes(requested) && manifests.find(m => m.id === requested)
  const settingsId = drawer?.settingsId || (drawer === null && requestedSystem ? requested : null)
  const previousRects = useRef(new Map())

  useLayoutEffect(() => {
    const nodes = gridViewport.current?.querySelectorAll('[data-slot-id]') || []
    const currentRects = new Map()
    for (const node of nodes) currentRects.set(node.dataset.slotId, node.getBoundingClientRect())
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) for (const node of nodes) {
      const before = previousRects.current.get(node.dataset.slotId), after = currentRects.get(node.dataset.slotId)
      if (!before || (before.left === after.left && before.top === after.top)) continue
      node.getAnimations().forEach(animation => animation.cancel())
      node.animate([
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` },
        { transform: 'none' },
      ], { duration: 180, easing: 'cubic-bezier(.2,0,0,1)' })
    }
    previousRects.current = currentRects
  }, [positions])

  useEffect(() => {
    const section = settingsId && document.getElementById(`home-${settingsId}`)
    if (section) { section.scrollIntoView({ block: 'start' }); section.focus({ preventScroll: true }) }
  }, [settingsId, drawer])

  const closeDrawer = () => {
    setDrawer({ type: 'closed' })
    if (requestedSystem || NEED_WIDGETS.includes(requested)) {
      const url = new URL(window.location.href)
      url.searchParams.delete('widget')
      window.history.replaceState({}, '', url)
    }
  }

  return (
    <>
      <div className="view today-dashboard home-shell bento-foundation">
        <div className="today-page">
          <header className="today-heading">
            <div className="today-greeting">
              <time className="today-date" dateTime={now.toISOString()}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</time>
              <h1>Today</h1>
              <p className="today-intro">Your work, plans, and activity in one place.</p>
            </div>
            <nav className="today-actions" aria-label="Today actions">
              <Button className="today-action-refresh" variant="ghost" onClick={refreshAll} title="Refresh dashboard data"><Icon name="refresh" size={16} /><span>Refresh</span></Button>
              <Button className="today-action-add" variant="primary" onClick={() => setDrawer({ type: 'add' })}><Icon name="plus" size={16} /><span>Add widget</span></Button>
              {editing
                ? <Button variant="secondary" onClick={() => { gesture.current = null; setEditing(false); setDragging(null); setPreviewWidgets(null) }} aria-pressed="true"><Icon name="check-simple" size={16} /><span>Done</span></Button>
                : <Button variant="ghost" onClick={() => setEditing(true)} aria-pressed="false"><Icon name="grid" size={16} /><span>Edit layout</span></Button>}
              <Button variant="ghost" size="icon" onClick={() => setDrawer({ type: 'settings' })} aria-label="Today settings" title="Today settings"><Icon name="settings" size={18} /></Button>
            </nav>
          </header>

          <div className="today-utility-row">
            <Button className="today-capture" variant="ghost" onClick={openPalette} aria-label="Search or capture a thought, Command K or Control K">
              <Icon name="search" size={17} /><span>Search or capture</span><kbd>⌘K / Ctrl+K</kbd>
            </Button>
            <div className="today-status" aria-live="polite">
              <span>{homePositions.length} {homePositions.length === 1 ? 'widget' : 'widgets'}</span>
              {quiet && <span className="today-quiet-status"><Icon name="moon" size={14} />Refresh paused</span>}
              {saveState && !saveState.startsWith('Layout not saved') && <span className="today-save-status" role="status">{saveState}</span>}
            </div>
          </div>

          <SourceItem />
          {error && <div className="today-message" role="alert"><Icon name="warning" size={16} /><p>{error}</p><Button size="small" onClick={() => window.location.reload()}>Retry</Button></div>}
          <span className="home-announcement" role="status" aria-live="polite">{announcement}</span>
          {saveState.startsWith('Layout not saved') && <div className="today-message" role="alert"><Icon name="warning" size={16} /><p>{saveState}</p></div>}

          {!loaded && !layout.widgets.length && <div className="today-layout-loading" role="status" aria-label="Loading layout"><span /><span /><span /><span /></div>}

          <section className={`today-workspace${editing ? ' is-editing' : ''}`} aria-label="Your Today dashboard">
            {editing && <div className="today-editing-note" role="status"><Icon name="dots-six" size={16} /><span>Move widgets with their handles. Resize or remove them here.</span></div>}
            <div ref={gridViewport} className="today-grid-viewport" data-editing={editing || undefined}>
              <div className="today-widgets-canvas" style={gridStyle}>
                {homePositions.map(p => renderWidget(p))}
              </div>
            </div>

            {loaded && !homePositions.length && (
              <section className="today-empty-layout">
                <span className="today-empty-icon"><Icon name="grid" size={24} /></span>
                <h2>Make Today yours</h2>
                <p>Add the widgets and connected views you want to keep close.</p>
                <Button variant="primary" onClick={() => setDrawer({ type: 'add' })}><Icon name="plus" size={16} />Add your first widget</Button>
              </section>
            )}
          </section>
        </div>
      </div>

      <DashboardContext.Provider value={{ openPalette, openAppearance, manifests, layout, records, quiet, quietSettings, saveQuiet, refreshAll, editing, setEditing, toggleWidget, addWidget, resize, changeDesign, removeWidget, move, grip, now, openWidget, connectSource, manageConnections, connections }}>
        {(drawer?.type === 'settings' || settingsId) && <Drawer title="Home settings" description="Refresh, quiet hours, and keyboard shortcuts." onClose={closeDrawer}><HomeSettings key={settingsId || 'settings'} settingsId={settingsId} /></Drawer>}
        {drawer?.type === 'add' && <Drawer title="Add widget" description="Choose what belongs in your day." onClose={closeDrawer} className="today-catalog-drawer"><AddWidget /></Drawer>}
        {selected && <Drawer title={selected.title} onClose={closeDrawer}><div className="today-widgets-canvas">{renderWidget(layout.widgets.find(w => w.id === selected.id) || { id: selected.id, size: selected.sizes[0], height: 3 }, true)}</div></Drawer>}
      </DashboardContext.Provider>
    </>
  )
}
