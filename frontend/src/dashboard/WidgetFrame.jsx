import { Component, Suspense, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useWidget } from './useWidget.js'
import { WIDGETS } from './registry.js'
import Drawer from './Drawer.jsx'
import { useDashboard } from './context.js'
import { previewRows, freshness } from './layout.js'

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

export function Skeleton() {
  return <div className="widget-skeleton" role="status" aria-label="Loading widget…"><span /><span /><span /></div>
}

export function WidgetState({ data, empty, editable, disconnected, children }) {
  if (data.state === 'loading') return <Skeleton />
  if (data.state === 'not-connected') return <><p role="status">Not connected. Required source or setting is unavailable.</p>{disconnected && children}</>
  if (data.state === 'error') return <p role="alert">{data.error || 'This widget could not refresh.'}</p>
  // Keep the content in the same slot when refresh changes an empty list to populated or back.
  return <>{data.state === 'empty' && <p role="status">{empty}</p>}{(data.state !== 'empty' || editable) && children}</>
}

export function ConnectionRow({ manifest, remove, label }) {
  const sources = Array.isArray(manifest.source) ? manifest.source : [manifest.source]
  const required = manifest.requires?.find(value => value.startsWith('connector:'))?.split(':')[1] || sources.find(source => source?.toolkit)?.toolkit
  const source = { gmail: 'Gmail', googlecalendar: 'Calendar', spotify: 'Spotify', github: 'GitHub' }[required] || required || 'source'
  return <div className="widget-connection">{label && <span>{label}</span>}<a href="/capabilities">Connect {source}</a><button onClick={remove} aria-label={`Dismiss ${manifest.title}`} title={`Dismiss ${manifest.title}`}><span aria-hidden="true">×</span></button></div>
}

export function WidgetHeader({ title, count, source, data, now, children }) {
  const synced = data.synced_at ? `Last synced ${new Date(data.synced_at).toLocaleString()}` : 'Not synced yet'
  return <header className="widget-header"><div className="widget-title"><h2>{title}</h2>{count > 0 && <span className="widget-chip">{count}</span>}{source && <span className="widget-source">{source}</span>}</div><div className="widget-actions"><span className="widget-freshness" title={synced} aria-label={synced}>{freshness(data.synced_at, now)}</span>{['stale', 'error'].includes(data.state) && <span className={`widget-chip state-${data.state}`} title={data.error || ''}>{data.state === 'stale' ? 'Stale data.' : 'Error'}</span>}{children}</div></header>
}

function Glance({ manifest, data, now, settings }) {
  const item = data?.items?.[0]
  if (manifest.id === 'glance.clock') return <><time className="home-clock" dateTime={now.toISOString()}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><p>{Intl.DateTimeFormat().resolvedOptions().timeZone}</p></>
  if (manifest.id === 'glance.weather') return data?.set_location ? <button onClick={settings}>Set location</button> : <><strong className="glance-value">{data?.temperature ?? 'Unavailable'} °C</strong><p>{data?.timezone}</p></>
  if (manifest.id === 'glance.next-event') return <><strong className="glance-value">{item?.title || 'No upcoming event'}</strong><p>{item?.start && new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></>
  return <><strong className="glance-value">{item?.title || 'Nothing playing'}</strong><p>{item?.artists?.join(', ') || 'Now playing'}</p></>
}

export default function WidgetFrame({ manifest, position, quiet, refreshVersion, onData, editing, move, resize, grip, tile = false, full = false }) {
  const { data, busy, refresh } = useWidget(manifest, quiet, refreshVersion, onData)
  const { removeWidget, now, openWidget, layout, setEditing } = useDashboard()
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const Content = WIDGETS[manifest.id]
  const preview = previewRows(data.payload)
  const source = (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).map(source => source?.toolkit || source?.type || 'local').join(', ')
  const added = layout.widgets.some(w => w.id === manifest.id)
  const sourceManaged = data.payload?.items?.some(item => item.editable === false)
  const settings = () => { if (full) return; openWidget(manifest.id) }
  const content = payload => <WidgetBoundary key={retry} resetKey={JSON.stringify(data.payload)} id={manifest.id} onRetry={() => { setRetry(n => n + 1); refresh() }}><WidgetState data={data} empty={manifest.empty} disconnected={manifest.id === 'task.agenda'} editable={['agent.brief', 'agent.next'].includes(manifest.id) || manifest.id.startsWith('task.') || ['feed.news', 'feed.rss', 'need.mentions', 'need.inbox', 'comm.templates', 'comm.tone', 'need.waiting', 'need.drafts', 'lib.capture', 'lib.search', 'dev.appeal', 'dev.recovery', 'dev.backup', 'dev.unpushed'].includes(manifest.id)}><Suspense fallback={<Skeleton />}>{Content ? <Content data={payload} refresh={refresh} widgetId={manifest.id} /> : <p role="alert">Widget component unavailable.</p>}</Suspense></WidgetState></WidgetBoundary>
  return <article className={`home-widget${tile ? ' home-tile' : ''}${data.state === 'not-connected' ? ' is-disconnected' : ''}`} data-widget={manifest.id} data-size={position.size} aria-label={manifest.title}>
    <WidgetHeader title={manifest.title} count={preview.count} source={sourceManaged ? `${data.payload.items.some(item => item.editable) ? 'local · ' : ''}connected source` : source} data={data} now={now}>
      {editing && <button {...grip('move', manifest.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(manifest.id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) } }} aria-label={`Move ${manifest.title}`} title="Drag to move; arrow keys also work"><Icon name="grid" size={18} /></button>}
      <button className="widget-refresh" disabled={busy || data.refreshing} onClick={refresh} aria-label={`Refresh ${manifest.title}`}><Icon name="refresh" size={18} /></button>
      <details className="widget-menu"><summary aria-label={`Menu ${manifest.title}`}>···</summary><div><button disabled={busy || data.refreshing} onClick={refresh}>Refresh</button>{!full && <button onClick={settings}>Settings</button>}{!full && <button onClick={event => { event.currentTarget.closest('details').open = false; setEditing(true) }}>Size</button>}{added && <button onClick={() => removeWidget(manifest.id)}>Remove</button>}</div></details>
    </WidgetHeader>
    <div className="widget-content">{data.state === 'not-connected' && !full ? <ConnectionRow manifest={manifest} remove={() => removeWidget(manifest.id)} /> : tile && !full && !['loading', 'error'].includes(data.state) ? <Glance manifest={manifest} data={data.payload} now={now} settings={settings} /> : content(full ? data.payload : preview.payload)}{data.state === 'empty' && !tile && !full && <button onClick={settings}>Open widget</button>}{data.state === 'error' && <button disabled={busy} onClick={refresh}>Retry</button>}</div>
    {!full && preview.count > 5 && <button className="widget-show-all" onClick={() => setExpanded(true)}>Show all ({preview.count})</button>}
    {editing && <div className="widget-edit"><label>Size<select aria-label={`Size ${manifest.title}`} value={position.size} onChange={e => resize(manifest.id, { size: e.target.value })}>{manifest.sizes.map(size => <option key={size} value={size}>{size.toUpperCase()}</option>)}</select></label><label>Height<input aria-label={`Height ${manifest.title}`} type="number" min={2} max={8} value={position.height} onChange={e => resize(manifest.id, { height: Math.max(2, Math.min(8, Number(e.target.value) || 2)) })} /></label><button {...grip('resize', manifest.id)} aria-label={`Resize ${manifest.title}`} title="Drag to resize; size and height fields also work"><Icon name="expand" size={18} /></button></div>}
    {expanded && <Drawer title={manifest.title} onClose={() => setExpanded(false)}>{content(data.payload)}</Drawer>}
  </article>
}
