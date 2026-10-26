import { Component, Suspense, memo, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useWidget } from './useWidget.js'
import { WIDGETS } from './registry.js'
import Drawer from './Drawer.jsx'
import './widget-pilots.css'
import './widget-adoptions.css'
import NextEvent from './widgets/NextEvent.jsx'
import { WeatherFace } from './widgets/Weather.jsx'
import { ClockFace } from './widgets/Clock.jsx'
import { useDashboard } from './context.js'
import { previewRows, WIDGET_ICONS, widgetTone } from './layout.js'
import { ConnectTile } from '../components/ui/bento/index.jsx'
import { WidgetCard, WidgetHeader, WidgetState, Skeleton, StateView } from './primitives.jsx'

export { WidgetHeader, WidgetState, Skeleton } from './primitives.jsx'

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
    return this.state.failed ? <div role="alert"><StateView>This widget could not render.</StateView><button onClick={() => { this.setState({ failed: false }); this.props.onRetry() }}>Retry widget</button></div> : this.props.children
  }
}

export function ConnectionRow({ manifest, remove, label }) {
  const sources = Array.isArray(manifest.source) ? manifest.source : [manifest.source]
  const required = manifest.requires?.find(value => value.startsWith('connector:'))?.split(':')[1] || sources.find(source => source?.toolkit)?.toolkit
  const source = { gmail: 'Gmail', googlecalendar: 'Calendar', spotify: 'Spotify', github: 'GitHub' }[required] || required || 'source'
  return <div className="widget-connection">{label && <span>{label}</span>}<a href="/capabilities">Connect {source}</a><button onClick={remove} aria-label={`Dismiss ${manifest.title}`} title={`Dismiss ${manifest.title}`}><span aria-hidden="true">×</span></button></div>
}


function Glance({ manifest, data, now, settings }) {
  const item = data?.items?.[0]
  if (manifest.id === 'glance.clock') return <ClockFace now={now} />

  if (manifest.id === 'glance.weather') return data?.set_location ? <div className="glance-setup"><Icon name="cloud" size={40} /><p>Weather, where you are.</p><button onClick={settings}>Set location<Icon name="arrow-up-right" size={16} /></button></div> : <WeatherFace data={data} />

  if (manifest.id === 'glance.next-event') return item ? <NextEvent data={data} /> : <StateView>{manifest.empty}</StateView>

  return null
}

export default memo(function WidgetFrame({ manifest, position, size = position?.size || 'm', quiet, refreshVersion, onData = () => {}, editing, move, resize, grip, tile = false, full = false, preview = false }) {
  const { data, busy, refresh } = useWidget(manifest, quiet, refreshVersion, onData)
  const { removeWidget, now, openWidget, layout, setEditing, connectSource } = useDashboard()
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const Content = WIDGETS[manifest.id]
  const adopted = /^(glance|need)\./.test(manifest.id)

  const previewData = previewRows(data.payload)
  const source = (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).map(source => source?.toolkit || source?.type || 'local').join(', ')
  const added = Array.isArray(layout?.widgets) && layout.widgets.some(w => w.id === manifest.id)
  const sourceManaged = data.payload?.items?.some(item => item.editable === false)
  const settings = () => { if (full || preview) return; openWidget(manifest.id) }
  const content = payload => <WidgetBoundary key={retry} resetKey={JSON.stringify(data.payload)} id={manifest.id} onRetry={() => { setRetry(n => n + 1); refresh() }}><WidgetState data={data} empty={manifest.empty} disconnected={['task.agenda', 'glance.travel'].includes(manifest.id)} editable={!preview && (['glance.travel', 'agent.rules', 'agent.watchers', 'agent.research', 'agent.delegated', 'agent.jobs', 'agent.brief', 'agent.next', 'comm.thread-summary', 'comm.newsletters', 'comm.reachout'].includes(manifest.id) || manifest.id.startsWith('task.') || ['feed.news', 'feed.rss', 'need.mentions', 'need.inbox', 'comm.templates', 'comm.tone', 'need.waiting', 'need.drafts', 'lib.capture', 'lib.search', 'lib.ask', 'lib.readlater', 'lib.highlights', 'lib.daily', 'lib.collections', 'dev.appeal', 'dev.recovery', 'dev.backup', 'dev.unpushed'].includes(manifest.id))}><Suspense fallback={<Skeleton />}>{data.refreshing && (['lib.ask', 'lib.readlater'].includes(manifest.id) || (manifest.id === 'comm.thread-summary' && payload?.model_enabled)) && <StateView role="status">Generating…</StateView>}{Content ? <Content summaryData={data.payload} data={payload} refresh={refresh} widgetId={manifest.id} /> : <StateView role="alert">Widget component unavailable.</StateView>}</Suspense></WidgetState></WidgetBoundary>
  if (data.state === 'not-connected' && !full && !preview) return <ConnectTile className="home-connect" size="s" source={manifest.id === 'dev.prs' ? 'GitHub' : manifest.title} onConnect={connectSource} />
  return <WidgetCard className={`home-widget${adopted ? ' widget-adoption' : ''}${['glance.clock', 'glance.weather', 'need.inbox', 'task.today', 'task.focus', 'agent.feed', 'task.deadlines', 'dev.prs'].includes(manifest.id) ? ' widget-pilot' : ''}${tile ? ' home-tile' : ''}${data.state === 'not-connected' && !preview ? ' is-disconnected' : ''}${preview ? ' is-preview' : ''}`} data-widget={manifest.id} data-tone={widgetTone(manifest.id)} data-size={size} aria-label={manifest.title}>
    <WidgetHeader icon={(adopted && manifest.icon) || WIDGET_ICONS[manifest.id] || WIDGET_ICONS[manifest.id.split('.')[0]]} title={manifest.title} count={previewData.count} source={sourceManaged ? `${data.payload?.items?.some(item => item.editable) ? 'local · ' : ''}connected source` : source} data={data} now={now}>
      {!preview && editing && <button {...grip('move', manifest.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(manifest.id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) } }} aria-label={`Move ${manifest.title}`} title="Drag to move; arrow keys also work"><Icon name="grid" size={18} /></button>}
      {!preview && <button className="widget-refresh" disabled={busy || data.refreshing} onClick={refresh} aria-label={`Refresh ${manifest.title}`}><Icon name="refresh" size={18} /></button>}
      {!preview && <details className="widget-menu"><summary aria-label={`Menu ${manifest.title}`}>···</summary><div><button disabled={busy || data.refreshing} onClick={refresh}>Refresh</button>{!full && <button onClick={settings}>Settings</button>}{!full && <button onClick={event => { event.currentTarget.closest('details').open = false; setEditing(true) }}>Size</button>}{added && <button onClick={() => removeWidget(manifest.id)}>Remove</button>}</div></details>}
    </WidgetHeader>
    <div className="widget-content">{data.state === 'not-connected' && !full && !preview ? <>{tile && <div className="glance-offline-art" aria-hidden="true"><Icon name={manifest.id === 'glance.music' ? 'music' : 'calendar'} size={40} /></div>}<ConnectionRow manifest={manifest} remove={() => removeWidget(manifest.id)} /></> : tile && !full && !['glance.travel', 'glance.music'].includes(manifest.id) && !['loading', 'error'].includes(data.state) ? <Glance manifest={manifest} data={data.payload} now={now} settings={settings} /> : content(full ? data.payload : previewData.payload)}{data.state === 'empty' && !tile && !full && !preview && <button onClick={settings}>Open widget</button>}{data.state === 'error' && !preview && <button disabled={busy} onClick={refresh}>Retry</button>}</div>
    {!full && !preview && previewData.count > 5 && <button className="widget-show-all" onClick={() => setExpanded(true)}>Show all ({previewData.count})</button>}
    {!preview && editing && <div className="widget-edit"><label>Size<select aria-label={`Size ${manifest.title}`} value={size} onChange={e => resize(manifest.id, { size: e.target.value })}>{manifest.sizes.map(size => <option key={size} value={size}>{size.toUpperCase()}</option>)}</select></label><label>Height<input aria-label={`Height ${manifest.title}`} type="number" min={2} max={8} value={position.height} onChange={e => resize(manifest.id, { height: Math.max(2, Math.min(8, Number(e.target.value) || 2)) })} /></label><button {...grip('resize', manifest.id)} aria-label={`Resize ${manifest.title}`} title="Drag to resize; size and height fields also work"><Icon name="expand" size={18} /></button></div>}
    {!preview && expanded && <Drawer title={manifest.title} onClose={() => setExpanded(false)}>{content(data.payload)}</Drawer>}
  </WidgetCard>
})
