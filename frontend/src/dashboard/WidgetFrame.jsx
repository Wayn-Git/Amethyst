import { Component, Suspense, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useWidget } from './useWidget.js'
import { WIDGETS } from './registry.js'
import Drawer from './Drawer.jsx'
import { ClockFace } from './widgets/Clock.jsx'
import { useDashboard } from './context.js'
import { previewRows } from './layout.js'
import { WidgetCard, WidgetHeader, WidgetState, Skeleton, StateView } from './primitives.jsx'

export { WidgetHeader, WidgetState, Skeleton } from './primitives.jsx'

const ICONS = {
  'glance.clock': 'clock', 'glance.weather': 'cloud', 'glance.next-event': 'calendar', 'glance.music': 'music',
  agent: 'sparkle', task: 'tasks', dev: 'github', lib: 'bookmark', feed: 'globe', sys: 'settings', need: 'mail', comm: 'mail',
}

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

  if (manifest.id === 'glance.weather') return data?.set_location ? <div className="glance-setup"><Icon name="cloud" size={40} /><p>Weather, where you are.</p><button onClick={settings}>Set location<Icon name="arrow-up-right" size={16} /></button></div> : <div className="glance-weather-face">
    <Icon name="cloud" size={38} />
    <strong className="glance-value">{data?.temperature ?? 'Unavailable'}<span className="glance-unit"> °C</span></strong>
    <p>{data?.timezone?.replaceAll('_', ' ')}</p>
    {data?.rain_alert && <p className="glance-alert-pill">Rain likely in the next 12 hours</p>}
  </div>

  if (manifest.id === 'glance.next-event') return <div className="glance-event-face">
    {item?.start && <div className="glance-date" aria-hidden="true">
      <span>{new Date(item.start).toLocaleDateString([], { month: 'short' })}</span>
      <b>{new Date(item.start).getDate()}</b>
    </div>}
    <div>
      <span className="glance-caption">Up next</span>
      <strong className="glance-value">{item?.title || 'No upcoming event'}</strong>
      <p>{item?.start && new Date(item.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
    </div>
  </div>

  return <div className="glance-music-face">
    <div className="glance-record" aria-hidden="true">
      <Icon name="music" size={24} />
    </div>
    <div>
      <span className="glance-caption">Now playing
        {item?.title && <span className="glance-soundwave" aria-hidden="true"><span /><span /><span /><span /></span>}
      </span>
      <strong className="glance-value">{item?.title || 'Nothing playing'}</strong>
      <p>{item?.artists?.join(', ') || 'Play something on your connected account.'}</p>
    </div>
  </div>
}

export const PREVIEW_FIXTURES = {
  'glance.clock': { zones: ['Europe/London', 'America/New_York', 'Asia/Tokyo'] },
  'glance.weather': { temperature: 21, timezone: 'Cupertino', rain_alert: false, hours: [{ time: '12:00', temperature: 21, rain: 0 }, { time: '15:00', temperature: 23, rain: 5 }, { time: '18:00', temperature: 19, rain: 10 }] },
  'glance.next-event': { items: [{ title: 'Product Sync & Design Review', start: new Date(Date.now() + 3600000).toISOString(), artists: [] }] },
  'glance.music': { items: [{ title: 'Midnight City', artists: ['M83'], album: 'Hurry Up, We’re Dreaming' }] },
  'task.today': { items: [{ id: 1, title: 'Finalize Apple-inspired bento grid', completed: true, status: 'done', editable: true }, { id: 2, title: 'Review live widget previews & variants', completed: false, status: 'todo', editable: true }, { id: 3, title: 'Tune spring transitions & touch targets', completed: false, status: 'todo', editable: true }] },
  'task.backlog': { items: [{ id: 10, title: 'Multi-device sync pipeline', idle_days: 3, editable: true }, { id: 11, title: 'Offline vector cache indexes', idle_days: 7, editable: true }] },
  'task.deadlines': { items: [{ id: 20, title: 'Beta 0.2 milestone release', due_at: new Date(Date.now() + 86400000 * 2).toISOString(), editable: true }] },
  'agent.brief': { items: [{ id: 30, title: 'Agent monitored 4 background jobs. All healthy.', status: 'ok', detail: 'No anomalies detected in last 24h.' }] },
  'agent.feed': { items: [{ id: 40, title: 'Synced repositories & validated tokens', status: 'done', at: '10m ago' }, { id: 41, title: 'Indexed vault notes into hybrid search', status: 'done', at: '25m ago' }] },
  'dev.prs': { items: [{ id: 50, title: 'PR #142: Bento grid architecture & responsive layout', source: 'github', branch: 'feat/bento-ui', status: 'passing', at: '15m ago' }] },
  'dev.ci': { items: [{ id: 60, title: 'Frontend Vitest & Playwright suite: Passing', status: 'success', repo: 'amethyst/desktop' }] },
  'feed.news': { items: [{ id: 70, title: 'Apple design principles and spatial interfaces', source: 'Design Weekly · 20m ago', url: '#' }] },
  'lib.resurface': { items: [{ id: 80, title: 'Designing fluid, tactile desktop software', reason: 'Recent capture in Vault', excerpt: 'Great interfaces blend precision and personality.' }] },
}

export default function WidgetFrame({ manifest, position, quiet, refreshVersion, onData = () => {}, editing, move, resize, grip, tile = false, full = false, preview = false }) {
  const { data: realData, busy, refresh } = useWidget(manifest, quiet, refreshVersion, onData)
  const { removeWidget, now, openWidget, layout, setEditing } = useDashboard()
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const Content = WIDGETS[manifest.id]

  // Use realistic fixture in preview mode if real data is empty, loading, or disconnected
  const isPreviewFallback = preview && (!realData.payload || ['loading', 'not-connected', 'empty'].includes(realData.state))
  const data = isPreviewFallback ? { state: 'ok', payload: PREVIEW_FIXTURES[manifest.id] || { items: [{ id: 1, title: `${manifest.title} ready`, snippet: 'Configure source or view on dashboard.' }] } } : realData

  const previewData = previewRows(data.payload)
  const source = (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).map(source => source?.toolkit || source?.type || 'local').join(', ')
  const added = Array.isArray(layout?.widgets) && layout.widgets.some(w => w.id === manifest.id)
  const sourceManaged = data.payload?.items?.some(item => item.editable === false)
  const settings = () => { if (full || preview) return; openWidget(manifest.id) }
  const content = payload => <WidgetBoundary key={retry} resetKey={JSON.stringify(data.payload)} id={manifest.id} onRetry={() => { setRetry(n => n + 1); refresh() }}><WidgetState data={data} empty={manifest.empty} disconnected={['task.agenda', 'glance.travel'].includes(manifest.id)} editable={!preview && (['glance.travel', 'agent.rules', 'agent.watchers', 'agent.research', 'agent.delegated', 'agent.jobs', 'agent.brief', 'agent.next', 'comm.thread-summary', 'comm.newsletters', 'comm.reachout'].includes(manifest.id) || manifest.id.startsWith('task.') || ['feed.news', 'feed.rss', 'need.mentions', 'need.inbox', 'comm.templates', 'comm.tone', 'need.waiting', 'need.drafts', 'lib.capture', 'lib.search', 'lib.ask', 'lib.readlater', 'lib.highlights', 'lib.daily', 'lib.collections', 'dev.appeal', 'dev.recovery', 'dev.backup', 'dev.unpushed'].includes(manifest.id))}><Suspense fallback={<Skeleton />}>{data.refreshing && (['lib.ask', 'lib.readlater'].includes(manifest.id) || (manifest.id === 'comm.thread-summary' && payload?.model_enabled)) && <StateView role="status">Generating…</StateView>}{Content ? <Content data={payload} refresh={refresh} widgetId={manifest.id} /> : <StateView role="alert">Widget component unavailable.</StateView>}</Suspense></WidgetState></WidgetBoundary>
  return <WidgetCard className={`home-widget${tile ? ' home-tile' : ''}${data.state === 'not-connected' && !preview ? ' is-disconnected' : ''}${preview ? ' is-preview' : ''}`} data-widget={manifest.id} data-size={position.size} aria-label={manifest.title}>
    <WidgetHeader icon={ICONS[manifest.id] || ICONS[manifest.id.split('.')[0]]} title={manifest.title} count={previewData.count} source={sourceManaged ? `${data.payload?.items?.some(item => item.editable) ? 'local · ' : ''}connected source` : source} data={data} now={now}>
      {!preview && editing && <button {...grip('move', manifest.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(manifest.id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) } }} aria-label={`Move ${manifest.title}`} title="Drag to move; arrow keys also work"><Icon name="grid" size={18} /></button>}
      {!preview && <button className="widget-refresh" disabled={busy || data.refreshing} onClick={refresh} aria-label={`Refresh ${manifest.title}`}><Icon name="refresh" size={18} /></button>}
      {!preview && <details className="widget-menu"><summary aria-label={`Menu ${manifest.title}`}>···</summary><div><button disabled={busy || data.refreshing} onClick={refresh}>Refresh</button>{!full && <button onClick={settings}>Settings</button>}{!full && <button onClick={event => { event.currentTarget.closest('details').open = false; setEditing(true) }}>Size</button>}{added && <button onClick={() => removeWidget(manifest.id)}>Remove</button>}</div></details>}
    </WidgetHeader>
    <div className="widget-content">{data.state === 'not-connected' && !full && !preview ? <>{tile && <div className="glance-offline-art" aria-hidden="true"><Icon name={manifest.id === 'glance.music' ? 'music' : 'calendar'} size={40} /></div>}<ConnectionRow manifest={manifest} remove={() => removeWidget(manifest.id)} /></> : tile && !full && manifest.id !== 'glance.travel' && !['loading', 'error'].includes(data.state) ? <Glance manifest={manifest} data={data.payload} now={now} settings={settings} /> : content(full ? data.payload : previewData.payload)}{data.state === 'empty' && !tile && !full && !preview && <button onClick={settings}>Open widget</button>}{data.state === 'error' && !preview && <button disabled={busy} onClick={refresh}>Retry</button>}</div>
    {!full && !preview && previewData.count > 5 && <button className="widget-show-all" onClick={() => setExpanded(true)}>Show all ({previewData.count})</button>}
    {!preview && editing && <div className="widget-edit"><label>Size<select aria-label={`Size ${manifest.title}`} value={position.size} onChange={e => resize(manifest.id, { size: e.target.value })}>{manifest.sizes.map(size => <option key={size} value={size}>{size.toUpperCase()}</option>)}</select></label><label>Height<input aria-label={`Height ${manifest.title}`} type="number" min={2} max={8} value={position.height} onChange={e => resize(manifest.id, { height: Math.max(2, Math.min(8, Number(e.target.value) || 2)) })} /></label><button {...grip('resize', manifest.id)} aria-label={`Resize ${manifest.title}`} title="Drag to resize; size and height fields also work"><Icon name="expand" size={18} /></button></div>}
    {!preview && expanded && <Drawer title={manifest.title} onClose={() => setExpanded(false)}>{content(data.payload)}</Drawer>}
  </WidgetCard>
}
