import { useCallback, useEffect, useRef, useState } from 'react'
import WidgetFrame, { WidgetBoundary } from './WidgetFrame.jsx'
import { DashboardContext } from './context.js'
import { cached, remember, request } from './api.js'
import { GLANCE_WIDGETS, NEED_WIDGETS, SYSTEM_WIDGETS, moveWidget, quietNow, resizeWidget } from './layout.js'
import { useApp } from '../store.jsx'
import Drawer from './Drawer.jsx'
import Gallery from './widgets/Gallery.jsx'
import Quiet from './widgets/Quiet.jsx'
import Sync from './widgets/Sync.jsx'
import Shortcuts from './widgets/Shortcuts.jsx'
import NeedsYou from './NeedsYou.jsx'
import SourceItem from './SourceItem.jsx'
import './home.css'

export default function Home() {
  const { setOverlay } = useApp()
  const [drawer, setDrawer] = useState(null)
  const [entries, setEntries] = useState(() => cached('manifests') || [])
  const [layout, setLayout] = useState(() => cached('layout') || { widgets: [] })
  const [quietSettings, setQuietSettings] = useState(() => cached('quiet') || {})
  const [records, setRecords] = useState({})
  const [editing, setEditing] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('')
  const [now, setNow] = useState(new Date())
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const layoutRef = useRef(layout)
  const dirty = useRef(false)
  const saveQueue = useRef(Promise.resolve())
  const gesture = useRef(null)
  const grid = useRef(null)
  const mounted = useRef(false)
  const manifests = entries.filter(e => e.enabled).map(e => e.manifest)
  const requested = new URLSearchParams(window.location.search).get('widget')
  const positions = requested && !SYSTEM_WIDGETS.includes(requested) && manifests.some(m => m.id === requested)
    ? [layout.widgets.find(w => w.id === requested) || { id: requested, size: 'm', height: 4 }, ...layout.widgets.filter(w => w.id !== requested)] : layout.widgets
  const quiet = quietNow(quietSettings, now)
  const refreshAll = useCallback(() => setRefreshVersion(n => n + 1), [])
  const onData = useCallback((id, data) => setRecords(old => JSON.stringify(old[id]) === JSON.stringify(data) ? old : { ...old, [id]: data }), [])
  useEffect(() => {
    mounted.current = true
    // Separate reads: a layout or settings failure does not discard working manifests.
    request('/widgets').then(value => { if (mounted.current) { setEntries(value.widgets); remember('manifests', value.widgets) } }).catch(err => { if (mounted.current) setError(err.message) })
    request('/layout?mode=default').then(value => { if (mounted.current && !dirty.current) { setLayout(value); layoutRef.current = value; remember('layout', value) } }).catch(err => { if (mounted.current) setError(err.message) }).finally(() => { if (mounted.current) setLoaded(true) })
    request('/widgets/dash.quiet/settings').then(value => { if (mounted.current) { setQuietSettings(value); remember('quiet', value) } }).catch(() => {})
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [])
  function persist(next) {
    dirty.current = true; layoutRef.current = next; setLayout(next); remember('layout', next); setSaveState('Saving layout…')
    // Serialize saves so a slower earlier request cannot overwrite the last drag.
    saveQueue.current = saveQueue.current.catch(() => {}).then(() => request('/layout?mode=default', 'PUT', next)).then(() => { if (mounted.current && layoutRef.current === next) setSaveState('Layout saved') }).catch(err => { if (mounted.current) setSaveState(`Layout not saved to server: ${err.message}`) })
  }
  const saveQuiet = useCallback(async value => { const saved = await request('/widgets/dash.quiet/settings', 'PUT', value); setQuietSettings(saved); remember('quiet', saved); setRefreshVersion(n => n + 1) }, [])
  useEffect(() => {
    function key(event) {
      if (event.target.closest('input,select,textarea,[contenteditable=true]')) return
      if (event.key === 'Escape') { gesture.current = null; setDragging(false); return }
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); refreshAll() }
      if (event.key.toLowerCase() === 'e') { event.preventDefault(); setEditing(value => !value) }
      if (event.key.toLowerCase() === 'q') { event.preventDefault(); saveQuiet({ ...quietSettings, snoozed_until: new Date(Date.now() + 3600000).toISOString() }).catch(err => setError(err.message)) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [quietSettings, refreshAll, saveQuiet])
  function move(id, step) { const widgets = layoutRef.current.widgets; const index = widgets.findIndex(w => w.id === id); if (widgets[index + step]) persist({ widgets: moveWidget(widgets, id, widgets[index + step].id) }) }
  function resize(id, patch) { persist({ widgets: layoutRef.current.widgets.map(w => w.id === id ? { ...w, ...patch } : w) }) }
  function grip(kind, id) {
    return {
      onPointerDown(event) { if (event.button !== 0) return; event.preventDefault(); gesture.current = { kind, id, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true) },
      onPointerCancel() { gesture.current = null; setDragging(false) },
      onPointerUp(event) {
        const start = gesture.current; gesture.current = null; setDragging(false)
        if (!start) return
        const widgets = layoutRef.current.widgets
        if (start.kind === 'move') {
          const target = document.elementsFromPoint(event.clientX, event.clientY).map(el => el.closest('[data-widget]')).find(Boolean)?.dataset.widget
          if (target && target !== id) persist({ widgets: moveWidget(widgets, id, target) })
        } else {
          const item = widgets.find(w => w.id === id), manifest = manifests.find(m => m.id === id)
          const row = 100
          resize(id, resizeWidget(item, manifest.sizes, event.clientX - start.x, event.clientY - start.y, grid.current.clientWidth, row))
        }
      },
    }
  }
  function toggleWidget(id) { const widgets = layoutRef.current.widgets; persist({ widgets: widgets.some(w => w.id === id) ? widgets.filter(w => w.id !== id) : [...widgets, { id, size: manifests.find(m => m.id === id).sizes.includes('m') ? 'm' : 's', height: 3 }] }) }
  const openWidget = (id, mode) => setDrawer({ id, mode })
  const selected = drawer?.id && manifests.find(m => m.id === drawer.id)
  const renderWidget = (position, full = false, tile = false) => {
    const manifest = manifests.find(m => m.id === position.id)
    if (!manifest) return null
    return <WidgetBoundary key={manifest.id} id={manifest.id} onRetry={refreshAll}><WidgetFrame manifest={manifest} position={position} quiet={quiet} refreshVersion={refreshVersion} onData={onData} editing={(editing || drawer?.mode === 'size') && layout.widgets.some(w => w.id === manifest.id)} move={move} resize={resize} grip={grip} tile={tile} full={full} /></WidgetBoundary>
  }
  const homePositions = positions.filter(w => !SYSTEM_WIDGETS.includes(w.id))
  const glance = homePositions.filter(w => GLANCE_WIDGETS.includes(w.id))
  const needs = homePositions.filter(w => NEED_WIDGETS.includes(w.id)).map(w => manifests.find(m => m.id === w.id)).filter(Boolean)
  const content = homePositions.filter(w => !GLANCE_WIDGETS.includes(w.id) && !NEED_WIDGETS.includes(w.id))
  const main = content.filter(w => w.id.startsWith('agent.') || w.size === 'l')
  const side = content.filter(w => !main.includes(w))
  const requestedSystem = SYSTEM_WIDGETS.includes(requested) && manifests.find(m => m.id === requested)
  const settingsId = drawer?.settingsId || (drawer === null && requestedSystem ? requested : null)
  const closeDrawer = () => {
    setDrawer({ type: 'closed' })
    if (requestedSystem) { const url = new URL(window.location.href); url.searchParams.delete('widget'); window.history.replaceState({}, '', url) }
  }
  return <DashboardContext.Provider value={{ manifests, layout, records, quiet, quietSettings, saveQuiet, refreshAll, editing, setEditing, toggleWidget, now, openWidget }}><div className="view widget-home"><header className="home-heading"><div><time className="home-date" dateTime={now.toISOString()}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</time><h1>{now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'}</h1></div><button className="home-capture" onClick={() => setOverlay('palette')}>Capture or search… <kbd>⌘K / Ctrl+K</kbd></button><div className="widget-buttons"><button onClick={() => setEditing(!editing)}>{editing ? 'Finish editing' : 'Edit layout'}</button><button className="home-primary" onClick={() => setDrawer({ type: 'add' })}>Add widget</button><button onClick={() => setDrawer({ type: 'settings' })}>Home settings</button></div></header>
    <SourceItem />
    {error && <p role="alert">{error} {entries.length ? 'Using saved shell data where available.' : ''}<button onClick={() => window.location.reload()}>Retry Home</button></p>}
    <p role="status" className="home-save-status">{dragging ? 'Release to place. Escape cancels.' : saveState}</p>
    {entries.filter(e => !e.enabled).map(e => <p key={e.manifest.id} role="alert">{e.manifest.title}: {e.error}</p>)}
    {!loaded && !layout.widgets.length && <p role="status">Loading layout…</p>}
    <div ref={grid}>
      <div className="home-glance">{glance.map(p => renderWidget(p, false, true))}</div>
      {editing ? <div className="home-grid">{homePositions.filter(w => !GLANCE_WIDGETS.includes(w.id)).map(p => renderWidget(p))}</div> : <div className="home-columns"><div className="home-column">{needs.length > 0 && <NeedsYou manifests={needs} quiet={quiet} refreshVersion={refreshVersion} onData={onData} />}{main.map(p => renderWidget(p))}</div><div className="home-column">{side.map(p => <section key={p.id} aria-label={{ 'task.today': 'Today', 'dev.prs': 'Dev', 'lib.resurface': 'Library', 'feed.news': 'Feed' }[p.id]}>{renderWidget(p)}</section>)}</div></div>}
    </div>
    {loaded && !homePositions.length && <p>No widgets selected. Use Add widget to choose one.</p>}
    {(drawer?.type === 'settings' || settingsId) && <Drawer title="Home settings" onClose={closeDrawer}><div className="home-settings"><section><h3>Refresh status</h3><Sync /></section><section><h3>Quiet hours</h3><Quiet /></section><section><h3>Keyboard shortcuts</h3><Shortcuts data={{ shortcuts: [['⌘K / Ctrl+K', 'Search and capture'], ['Alt+R', 'Refresh Home'], ['Alt+E', 'Edit layout'], ['Alt+Q', 'Snooze refresh for one hour'], ['Escape', 'Close drawer or cancel drag']] }} /></section><section><h3>Widget gallery</h3><Gallery /></section></div></Drawer>}
    {drawer?.type === 'add' && <Drawer title="Add widget" onClose={closeDrawer}><Gallery /></Drawer>}
    {selected && <Drawer title={selected.title} onClose={closeDrawer}>{renderWidget(layout.widgets.find(w => w.id === selected.id) || { id: selected.id, size: selected.sizes[0], height: 3 }, true)}</Drawer>}
  </div></DashboardContext.Provider>
}
