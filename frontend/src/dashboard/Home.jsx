import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import WidgetFrame, { WidgetBoundary } from './WidgetFrame.jsx'
import { DashboardContext } from './context.js'
import { cached, remember, request } from './api.js'
import { GLANCE_WIDGETS, NEED_WIDGETS, SYSTEM_WIDGETS, morningLayout, moveWidget, quietNow, resizeWidget, preferredWidgetSize, widgetDisplaySize } from './layout.js'
import { useApp } from '../store.jsx'
import Drawer from './Drawer.jsx'
import HomeSettings from './HomeSettings.jsx'
import useConnections from './useConnections.js'
import { BentoGrid } from '../components/ui/bento/index.jsx'
import SourceItem from './SourceItem.jsx'
import Button from '../components/ui/AppButton.jsx'
import Kbd from '../components/ui/Kbd.jsx'
import WidgetSlot from './WidgetSlot.jsx'
import AddWidget from './AddWidget.jsx'
import { toast } from 'sonner'
import './home.css'
import './home-shell.css'
import './widget-patterns.css'
import './home-bento.css'
import './catalog.css'

const WidgetView = memo(function WidgetView({ context, ...props }) {
  return <DashboardContext.Provider value={context}><WidgetBoundary id={props.manifest.id} onRetry={context.refreshAll}><WidgetFrame {...props} /></WidgetBoundary></DashboardContext.Provider>
})

export default function Home({ layoutMode = "default" }) {
  const navigate = useNavigate()
  const { setOverlay, setCapabilitiesTab } = useApp()
  const connections = useConnections()
  const openPalette = useCallback(() => setOverlay('palette'), [setOverlay])
  const manageConnections = useCallback(() => { setCapabilitiesTab('connectors'); navigate('/capabilities') }, [navigate, setCapabilitiesTab])
  const connectSource = useCallback(() => setDrawer({ type: 'settings', settingsId: 'sys.connectors' }), [])
  const [drawer, setDrawer] = useState(null)

  useEffect(() => {
    const handleOpenConnectors = () => setDrawer({ type: 'settings', settingsId: 'sys.connectors' })
    window.addEventListener('amethyst:open-connectors', handleOpenConnectors)
    return () => window.removeEventListener('amethyst:open-connectors', handleOpenConnectors)
  }, [])
  const [entries, setEntries] = useState(() => cached('manifests') || [])
  const [layout, setLayout] = useState(() => (cached(`layout.${layoutMode}`)?.widgets ? morningLayout(cached(`layout.${layoutMode}`)) : { widgets: [] }))
  const [quietSettings, setQuietSettings] = useState(() => cached('quiet') || {})
  const [records, setRecords] = useState({})
  const [editing, setEditing] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [now, setNow] = useState(new Date())
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState(null)
  const layoutRef = useRef(layout)
  const dirty = useRef(false)
  const saveQueue = useRef(Promise.resolve())
  const gesture = useRef(null)
  const grid = useRef(null)
  const mounted = useRef(false)
  const manifests = useMemo(() => (Array.isArray(entries) ? entries : []).filter(e => e?.enabled).map(e => e?.manifest).filter(Boolean), [entries])
  const requested = new URLSearchParams(window.location.search).get('widget')
  const currentWidgets = Array.isArray(layout?.widgets) ? layout.widgets : []
  const positions = requested && !SYSTEM_WIDGETS.includes(requested) && !NEED_WIDGETS.includes(requested) && manifests.some(m => m.id === requested)
    ? [currentWidgets.find(w => w.id === requested) || { id: requested, size: 'm', height: 4 }, ...currentWidgets.filter(w => w.id !== requested)] : currentWidgets
  const quiet = quietNow(quietSettings, now)
  const refreshAll = useCallback(() => setRefreshVersion(n => n + 1), [])
  const onData = useCallback((id, data) => setRecords(old => JSON.stringify(old[id]) === JSON.stringify(data) ? old : { ...old, [id]: data }), [])
  useEffect(() => {
    mounted.current = true
    // Separate reads: a layout or settings failure does not discard working manifests.
    request('/widgets').then(value => { if (mounted.current) { const list = Array.isArray(value?.widgets) ? value.widgets : []; setEntries(list); remember('manifests', list) } }).catch(err => { if (mounted.current) setError(err.message) })
    request(`/layout?mode=${encodeURIComponent(layoutMode)}`).then(value => { if (mounted.current && !dirty.current) { const nextLayout = value && Array.isArray(value.widgets) ? morningLayout(value) : { widgets: [] }; setLayout(nextLayout); layoutRef.current = nextLayout; remember(`layout.${layoutMode}`, nextLayout) } }).catch(err => { if (mounted.current) setError(err.message) }).finally(() => { if (mounted.current) setLoaded(true) })
    request('/widgets/dash.quiet/settings').then(value => { if (mounted.current) { setQuietSettings(value || {}); remember('quiet', value || {}) } }).catch(() => {})
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [])
  function persist(next, undo = true, message = 'Layout updated') {
    const previous = gesture.current?.original || layoutRef.current
    if (undo) toast(message, { id: 'home-layout', toasterId: settingsId || selectedId || ['add', 'settings'].includes(drawer?.type) ? 'home-drawer' : undefined, action: { label: 'Undo', onClick: () => persist(previous, false) } })
    dirty.current = true; layoutRef.current = next; setLayout(next); remember(`layout.${layoutMode}`, next); setSaveState('Saving layout…')
    // Serialize saves so a slower earlier request cannot overwrite the last drag.
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => request(`/layout?mode=${encodeURIComponent(layoutMode)}`, 'PUT', next)).then(() => { if (mounted.current && layoutRef.current === next) setSaveState('Layout saved') }).catch(err => { if (mounted.current) setSaveState(`Layout not saved to server: ${err.message}`) })
  }
  const saveQuiet = useCallback(async value => { const saved = await request('/widgets/dash.quiet/settings', 'PUT', value); setQuietSettings(saved); remember('quiet', saved); setRefreshVersion(n => n + 1) }, [])
  useEffect(() => {
    function key(event) {
      if (event.target.closest('input,select,textarea,[contenteditable=true]')) return
      if (event.key === 'Escape') { if (gesture.current?.original) { setLayout(gesture.current.original); layoutRef.current = gesture.current.original }; gesture.current = null; setDragging(false); setDropTarget(null); return }
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); refreshAll() }
      if (event.key.toLowerCase() === 'e') { event.preventDefault(); setEditing(value => !value) }
      if (event.key.toLowerCase() === 'q') { event.preventDefault(); saveQuiet({ ...quietSettings, snoozed_until: new Date(Date.now() + 3600000).toISOString() }).catch(err => setError(err.message)) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [quietSettings, refreshAll, saveQuiet])
  function move(id, step) { const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []; const index = widgets.findIndex(w => w.id === id); if (widgets[index + step]) { persist({ widgets: moveWidget(widgets, id, widgets[index + step].id) }); setAnnouncement(`${id} moved to position ${index + step + 1}`) } }
  function resize(id, patch) { const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []; persist({ widgets: widgets.map(w => w.id === id ? { ...w, ...patch } : w) }); setAnnouncement(`${id} resized to ${patch.size || 'custom height'}`) }
  function fitWidgets() {
    const widgets = layoutRef.current.widgets.map(item => {
      const manifest = manifests.find(m => m.id === item.id)
      return manifest ? { ...item, size: preferredWidgetSize(manifest) } : item
    })
    if (widgets.some((item, index) => item.size !== layoutRef.current.widgets[index].size)) persist({ ...layoutRef.current, widgets }, true, 'Widget sizes fitted')
    setAnnouncement('Widget sizes fitted. Order preserved.')
  }
  function grip(kind, id) {
    return {
      onPointerDown(event) { if (event.button !== 0) return; event.preventDefault(); gesture.current = { kind, id, x: event.clientX, y: event.clientY, original: layoutRef.current }; grid.current.setPointerCapture(event.pointerId); setDragging(id) },
      onPointerCancel() { if (gesture.current?.original) { setLayout(gesture.current.original); layoutRef.current = gesture.current.original }; gesture.current = null; setDragging(false); setDropTarget(null) },
      onPointerMove(event) {
        const start = gesture.current
        if (!start) return
        const { id } = start
        if (start.kind === 'resize') {
          const item = start.original.widgets.find(w => w.id === id), manifest = manifests.find(m => m.id === id)
          const patch = resizeWidget(item, manifest?.sizes || ['m'], event.clientX - start.x, event.clientY - start.y, grid.current.clientWidth, parseFloat(getComputedStyle(grid.current.querySelector('.bento-grid')).gridAutoRows) || 152)
          if (layoutRef.current.widgets.find(w => w.id === id)?.size === patch.size) return
          const next = { widgets: start.original.widgets.map(w => w.id === id ? patch : w) }; layoutRef.current = next; setLayout(next); return
        }
        const target = document.elementsFromPoint(event.clientX, event.clientY).map(el => el.closest('[data-slot-id]')).find(Boolean)?.dataset.slotId
        start.target = target && target !== id ? target : null
        setDropTarget(start.target)
      },
      onPointerUp(event) {
        const start = gesture.current; setDragging(false); setDropTarget(null)
        if (!start) return
        const { id } = start
        if (start.kind === 'move') {
          if (start.target) persist({ ...start.original, widgets: moveWidget(start.original.widgets, id, start.target) })
        } else {
          const item = start.original.widgets.find(w => w.id === id), manifest = manifests.find(m => m.id === id)
          const row = parseFloat(getComputedStyle(grid.current.querySelector('.bento-grid')).gridAutoRows) || 152
          resize(id, resizeWidget(item, manifest?.sizes || ['m'], event.clientX - start.x, event.clientY - start.y, grid.current.clientWidth, row))
        }
        gesture.current = null
      },
    }
  }
  function addWidget(id, size, design) {
    const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    if (widgets.some(w => w.id === id)) return
    const manifest = manifests.find(m => m.id === id)
    const validSizes = manifest?.sizes || ['m']
    const chosenSize = size && validSizes.includes(size) ? size : manifest ? preferredWidgetSize(manifest) : 's'
    addedTile.current = id
    persist({ widgets: [...widgets, { id, size: chosenSize, height: chosenSize === 's' ? 3 : chosenSize === 'l' ? 4 : 3, ...(design ? { design } : {}) }] }, true, `${manifest?.title || 'Widget'} added to Home`)
  }
  function toggleWidget(id) { const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []; persist({ widgets: widgets.some(w => w.id === id) ? widgets.filter(w => w.id !== id) : [...widgets, { id, size: manifests.find(m => m.id === id)?.sizes?.includes('m') ? 'm' : 's', height: 3 }] }) }
  const openWidget = id => setDrawer(SYSTEM_WIDGETS.includes(id) ? { type: 'settings', settingsId: id } : { id })
  const selectedId = drawer?.id || (drawer === null && NEED_WIDGETS.includes(requested) ? requested : null)
  const selected = selectedId && manifests.find(m => m.id === selectedId)
  const membership = [...new Set(currentWidgets.map(w => w.id))].sort().join('|')
  const actions = useRef({})
  useLayoutEffect(() => { actions.current = { removeWidget, openWidget, move, resize, grip } })
  const stable = useMemo(() => Object.fromEntries(['removeWidget', 'openWidget', 'move', 'resize', 'grip'].map(key => [key, (...args) => actions.current[key](...args)])), [])
  const frameContext = useMemo(() => ({ now, quiet, quietSettings, manifests, openPalette, setEditing, connectSource, connectionHealth: connections.data, refreshAll, ...stable, layout: { widgets: membership.split('|').map(id => ({ id })) } }), [now, quiet, quietSettings, manifests, openPalette, connectSource, connections.data, refreshAll, stable, membership])
  const sizeKey = positions.map(p => `${p.id}:${p.size}:${p.design || ""}`).sort().join('|')
  // Size/membership encode content dependencies; order changes only move existing slots.
  // oxlint-disable react-hooks/exhaustive-deps
  const views = useMemo(() => new Map(positions.map(position => {
    const manifest = manifests.find(m => m.id === position.id)
    return [position.id, manifest && <WidgetView key={manifest.id} context={frameContext} manifest={manifest} size={position.size} design={position.design} quiet={quiet} refreshVersion={refreshVersion} onData={onData} editing={false} tile={GLANCE_WIDGETS.includes(position.id)} full={false} />]
  })), [manifests, frameContext, quiet, refreshVersion, onData, sizeKey])
  // oxlint-enable react-hooks/exhaustive-deps
  const renderWidget = (position, full = false) => {
    const manifest = manifests.find(m => m.id === position.id)
    if (!manifest) return null
    if (full) return <WidgetView context={frameContext} manifest={manifest} size={position.size} design={position.design} quiet={quiet} refreshVersion={refreshVersion} onData={onData} editing={false} full />
    return <WidgetSlot key={manifest.id} id={manifest.id} title={manifest.title} size={position.size} displaySize={widgetDisplaySize(position.id, position.size)} sizes={manifest.sizes} editing={editing} dragging={dragging === manifest.id} dropTarget={dropTarget === manifest.id} move={stable.move} resize={stable.resize} grip={stable.grip}>{views.get(position.id)}</WidgetSlot>
  }
  const previousRects = useRef(new Map())
  const addedTile = useRef(null)
  useLayoutEffect(() => {
    const nodes = grid.current?.querySelectorAll('[data-slot-id]') || []
    const next = new Map()
    for (const node of nodes) for (const animation of node.getAnimations()) animation.cancel()
    for (const node of nodes) next.set(node.dataset.slotId, node.getBoundingClientRect())
    if (!dragging && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) for (const node of nodes) {
      const before = previousRects.current.get(node.dataset.slotId), after = next.get(node.dataset.slotId)
      if (!before && node.dataset.slotId === addedTile.current) node.animate([{ opacity: 0, transform: 'translateY(16px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 250, easing: 'cubic-bezier(.2,.8,.2,1)' })
      if (before && (before.x !== after.x || before.y !== after.y)) node.animate([{ transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' })
    }
    addedTile.current = null
    previousRects.current = next
  }, [layout, editing, dragging])
  const homePositions = positions.filter(w => !SYSTEM_WIDGETS.includes(w.id))
  const requestedSystem = SYSTEM_WIDGETS.includes(requested) && manifests.find(m => m.id === requested)
  const settingsId = drawer?.settingsId || (drawer === null && requestedSystem ? requested : null)
  useEffect(() => {
    const section = settingsId && document.getElementById(`home-${settingsId}`)
    if (section) { section.scrollIntoView({ block: 'start' }); section.focus({ preventScroll: true }) }
  }, [settingsId, drawer])
  const closeDrawer = () => {
    setDrawer({ type: 'closed' })
    if (requestedSystem || NEED_WIDGETS.includes(requested)) { const url = new URL(window.location.href); url.searchParams.delete('widget'); window.history.replaceState({}, '', url) }
  }
  function removeWidget(id) {
    const widgets = Array.isArray(layoutRef.current?.widgets) ? layoutRef.current.widgets : []
    if (widgets.some(w => w.id === id)) toggleWidget(id)
    if (selectedId === id || requested === id) {
      const url = new URL(window.location.href)
      url.searchParams.delete('widget')
      window.history.replaceState({}, '', url)
      setDrawer({ type: 'closed' })
    }
  }
  return <>
    <div className="view today-dashboard home-shell bento-foundation">
      <div className="today-page">
        <header className="today-heading">
          <div className="today-greeting">
            <time className="today-date" dateTime={now.toISOString()}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</time>
            <h1>{now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'}</h1>
          </div>
          <div className="today-actions">
            <Button variant={editing ? 'secondary' : 'ghost'} onClick={() => setEditing(!editing)} aria-pressed={editing} aria-label={editing ? 'Finish editing' : 'Edit layout'}><Icon name={editing ? 'check-simple' : 'sliders'} size={16} />{editing ? 'Done' : 'Edit layout'}</Button>
            <Button variant="primary" onClick={() => setDrawer({ type: 'add' })}><Icon name="plus" size={16} />Add widget</Button>
            <Button variant="ghost" size="icon" onClick={() => setDrawer({ type: 'settings' })} aria-label="Home settings" title="Home settings"><Icon name="settings" size={18} /></Button>
          </div>
        </header>
        <div className="today-command-row">
          <Button variant="ghost" className="today-capture" onClick={() => setOverlay('palette')}><Icon name="search" size={16} /><span>Search or capture a thought…</span><Kbd>⌘K / Ctrl+K</Kbd></Button>
          <span className="today-layout-label">Home · {homePositions.length} widgets{quiet ? ' · Refresh paused' : ''}</span>
        </div>
        {editing && <div className="today-edit-bar"><span className="today-edit-icon"><Icon name="grid" size={18} /></span><div><strong>Arrange your workspace</strong><p>Drag to reorder, resize, or fit widgets to their suggested sizes.</p></div><Button size="small" className="today-fit-widgets" onClick={fitWidgets}>Fit widgets</Button><Button size="small" variant="ghost" onClick={() => setDrawer({ type: 'add' })}><Icon name="plus" size={14} />Add widget</Button></div>}
        <SourceItem />
        {error && <div className="today-message" role="alert"><Icon name="warning" size={16} /><p>{error} {entries.length ? 'Using saved shell data where available.' : ''}</p><Button size="small" onClick={() => window.location.reload()}>Retry Home</Button></div>}
        <span className="home-announcement" role="status" aria-live="polite">{announcement}</span>
        <span role="status" className="home-save-status home-announcement">{dragging ? 'Release to place. Escape cancels.' : saveState}</span>
        {saveState.startsWith('Layout not saved') && <p className="today-message" role="alert">{saveState}</p>}
        {entries.filter(e => !e.enabled).map(e => <p key={e.manifest.id} role="alert">{e.manifest.title}: {e.error}</p>)}
        {!loaded && !layout.widgets.length && <div className="today-layout-loading" role="status" aria-label="Loading layout"><span /><span /><span /><span /></div>}
        <div ref={grid} className="widget-home today-widgets" onPointerMove={grip().onPointerMove} onPointerUp={grip().onPointerUp} onPointerCancel={grip().onPointerCancel}>
          <BentoGrid className={`home-layout-grid${editing ? ' is-editing' : ''}`} data-dragging={dragging || undefined}>
            {homePositions.map(p => renderWidget(p))}
          </BentoGrid>
        </div>
        {loaded && !homePositions.length && <section className="today-empty-layout"><span><Icon name="grid" size={28} /></span><h2>Make room for your day</h2><p>Add the widgets you want to see here.</p><Button variant="primary" onClick={() => setDrawer({ type: 'add' })}><Icon name="plus" size={16} />Add widget</Button></section>}
      </div>
    </div>
    <DashboardContext.Provider value={{ openPalette, manifests, layout, records, quiet, quietSettings, saveQuiet, refreshAll, editing, setEditing, toggleWidget, addWidget, resize, removeWidget, now, openWidget, connectSource, manageConnections, connections }}>
    {(drawer?.type === 'settings' || settingsId) && <Drawer title="Home settings" description="Refresh, quiet hours, and keyboard shortcuts." onClose={closeDrawer}><HomeSettings key={settingsId || 'settings'} settingsId={settingsId} /></Drawer>}
    {drawer?.type === 'add' && <Drawer title="Add widget" description="Choose what belongs in your day." onClose={closeDrawer} className="today-catalog-drawer"><AddWidget /></Drawer>}
    {selected && <Drawer title={selected.title} onClose={closeDrawer}><div className="widget-home today-widgets">{renderWidget(layout.widgets.find(w => w.id === selected.id) || { id: selected.id, size: selected.sizes[0], height: 3 }, true)}</div></Drawer>}
    </DashboardContext.Provider>
  </>
}
