import { Component, Suspense, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useWidget } from './useWidget.js'
import { WIDGETS } from './registry.js'

export class WidgetBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(previous) {
    // Recover only when fresh data replaces the payload that failed to render.
    // oxlint-disable-next-line react/no-did-update-set-state
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }
  componentDidCatch(error) { console.error(`Widget ${this.props.id} failed`, error) }
  render() {
    return this.state.failed ? <div role="alert"><p>This widget could not render.</p><button onClick={() => { this.setState({ failed: false }); this.props.onRetry() }}>Retry widget</button></div> : this.props.children
  }
}

export function WidgetState({ data, empty, editable, disconnected, children }) {
  if (data.state === 'loading') return <p role="status">Loading widget…</p>
  if (data.state === 'not-connected') return <><p role="status">Not connected. Required source or setting is unavailable.</p>{disconnected && children}</>
  if (data.state === 'empty') return <><p role="status">{empty}</p>{editable && children}</>
  if (data.state === 'error') return <p role="alert">{data.error || 'This widget could not refresh.'}</p>
  return <>{data.state === 'stale' && <p className="widget-status" role="status">Stale data. {data.error || 'Showing the last saved result.'}</p>}{children}</>
}

export default function WidgetFrame({ manifest, position, quiet, refreshVersion, onData, editing, move, resize, grip }) {
  const { data, busy, refresh } = useWidget(manifest, quiet, refreshVersion, onData)
  const [retry, setRetry] = useState(0)
  const Content = WIDGETS[manifest.id]
  return <article className="home-widget" data-widget={manifest.id} style={{ '--widget-span': { s: 3, m: 6, l: 12 }[position.size], '--widget-height': position.height }} aria-label={manifest.title}>
    <header className="widget-header"><h2>{manifest.title}</h2><div className="widget-actions">
      {editing && <button {...grip('move', manifest.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(manifest.id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) } }} aria-label={`Move ${manifest.title}`} title="Drag to move; arrow keys also work"><Icon name="grid" size={18} /></button>}
      <button disabled={busy || data.refreshing} onClick={refresh} aria-label={`Refresh ${manifest.title}`}><Icon name="refresh" size={18} /></button>
    </div></header>
    <div className="widget-content"><WidgetBoundary key={retry} resetKey={JSON.stringify(data.payload)} id={manifest.id} onRetry={() => { setRetry(n => n + 1); refresh() }}><WidgetState data={data} empty={manifest.empty} disconnected={manifest.id === 'task.agenda'} editable={manifest.id.startsWith('task.') || ['comm.tone', 'need.waiting', 'need.drafts', 'lib.capture', 'lib.search', 'dev.appeal', 'dev.recovery', 'dev.backup', 'dev.unpushed'].includes(manifest.id)}><Suspense fallback={<p role="status">Loading widget…</p>}>{Content ? <Content data={data.payload} refresh={refresh} widgetId={manifest.id} /> : <p role="alert">Widget component unavailable.</p>}</Suspense></WidgetState></WidgetBoundary></div>
    <footer><span>{manifest.source?.type === 'composio' ? `Composio · ${manifest.source.toolkit}` : 'Local'} · {data.synced_at ? `Last synced ${new Date(data.synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Not synced yet'}{busy || data.refreshing ? ' · Refreshing' : ''}</span></footer>
    {editing && <div className="widget-edit"><label>Size<select aria-label={`Size ${manifest.title}`} value={position.size} onChange={e => resize(manifest.id, { size: e.target.value })}>{manifest.sizes.map(size => <option key={size} value={size}>{size.toUpperCase()}</option>)}</select></label><label>Height<input aria-label={`Height ${manifest.title}`} type="number" min={2} max={8} value={position.height} onChange={e => resize(manifest.id, { height: Math.max(2, Math.min(8, Number(e.target.value) || 2)) })} /></label><button {...grip('resize', manifest.id)} aria-label={`Resize ${manifest.title}`} title="Drag to resize; size and height fields also work"><Icon name="expand" size={18} /></button></div>}
  </article>
}
