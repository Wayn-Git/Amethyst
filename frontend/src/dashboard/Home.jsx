import { useCallback, useEffect, useRef, useState } from 'react'
import WidgetFrame, { WidgetBoundary } from './WidgetFrame.jsx'
import { DashboardContext } from './context.js'
import { cached, remember, request } from './api.js'
import { moveWidget, quietNow, resizeWidget } from './layout.js'
import './home.css'

export default function Home() {
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
          const row = parseFloat(getComputedStyle(grid.current).gridAutoRows) + parseFloat(getComputedStyle(grid.current).rowGap)
          resize(id, resizeWidget(item, manifest.sizes, event.clientX - start.x, event.clientY - start.y, grid.current.clientWidth, row))
        }
      },
    }
  }
  function toggleWidget(id) { const widgets = layoutRef.current.widgets; persist({ widgets: widgets.some(w => w.id === id) ? widgets.filter(w => w.id !== id) : [...widgets, { id, size: manifests.find(m => m.id === id).sizes.includes('m') ? 'm' : 's', height: 3 }] }) }
  return <DashboardContext.Provider value={{ manifests, layout, records, quiet, quietSettings, saveQuiet, refreshAll, editing, setEditing, toggleWidget }}><div className="view widget-home"><header className="home-heading"><div><h1>Home</h1><p>Local widgets · {quiet ? 'Quiet hours' : 'Automatic refresh on'}</p></div><div className="widget-buttons"><button onClick={refreshAll}>Refresh all</button><button onClick={() => setEditing(!editing)}>{editing ? 'Finish editing' : 'Edit layout'}</button></div></header>
    {error && <p role="alert">{error} {entries.length ? 'Using saved shell data where available.' : ''}<button onClick={() => window.location.reload()}>Retry Home</button></p>}
    <p role="status" className="home-save-status">{dragging ? 'Release to place. Escape cancels.' : saveState}</p>
    {entries.filter(e => !e.enabled).map(e => <p key={e.manifest.id} role="alert">{e.manifest.title}: {e.error}</p>)}
    {!loaded && !layout.widgets.length && <p role="status">Loading layout…</p>}
    <div className="home-grid" ref={grid}>{layout.widgets.map(position => { const manifest = manifests.find(m => m.id === position.id); if (!manifest) return null; return <WidgetBoundary key={manifest.id} id={manifest.id} onRetry={refreshAll}><WidgetFrame manifest={manifest} position={position} quiet={quiet} refreshVersion={refreshVersion} onData={onData} editing={editing} move={move} resize={resize} grip={grip} /></WidgetBoundary> })}</div>
    {loaded && !layout.widgets.length && <p>No widgets selected. Add one below.</p>}
    <details className="home-add"><summary>Add widgets</summary><div className="widget-buttons">{manifests.filter(m => !layout.widgets.some(w => w.id === m.id)).map(m => <button key={m.id} onClick={() => toggleWidget(m.id)}>Add {m.title}</button>)}</div></details>
  </div></DashboardContext.Provider>
}
