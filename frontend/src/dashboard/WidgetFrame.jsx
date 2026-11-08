import { Component, Suspense, memo, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useWidget } from './useWidget.js'
import { WIDGETS } from './registry.js'
import Drawer from './Drawer.jsx'
import './widget-pilots.css'
import WidgetPreview from './WidgetPreview.jsx'
import { DETAIL_LABELS, WIDGET_PRESENTATIONS } from './presentation.js'
import { useDashboard } from './context.js'
import { ADOPTED_WIDGETS, previewRows, WIDGET_ICONS, widgetTone } from './layout.js'
import { Button, Input, Select } from '../components/ui/bento/index.jsx'
import { WidgetCard, WidgetHeader, WidgetState, Skeleton, StateView } from './primitives.jsx'
import './widget-compositions.css'
import './widget-motion.css'
import '../components/wigggle/wigggle.css'
import './widget-adoptions.css'
import { defaultDesign } from '../components/wigggle/designs.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '../components/ui/dropdown-menu.tsx'
import WidgetSetup from './WidgetSetup.jsx'
import { widgetStatus } from './setup.js'
import { variationNumber, widgetVariations } from './widgetVariations.js'
import { gridSize } from './grid.js'

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
    return this.state.failed ? <div role="alert"><StateView>This widget could not render.</StateView><Button type="submit" onClick={() => { this.setState({ failed: false }); this.props.onRetry() }}>Retry widget</Button></div> : this.props.children
  }
}

export function ConnectionRow({ manifest, remove, label }) {
  const sources = Array.isArray(manifest.source) ? manifest.source : [manifest.source]
  const required = manifest.requires?.find(value => value.startsWith('connector:'))?.split(':')[1] || sources.find(source => source?.toolkit)?.toolkit
  const source = { gmail: 'Gmail', googlecalendar: 'Calendar', spotify: 'Spotify', github: 'GitHub' }[required] || required || 'source'
  return <div className="widget-connection">{label && <span>{label}</span>}<a href="/capabilities">Connect {source}</a><Button type="submit" onClick={remove} aria-label={`Dismiss ${manifest.title}`} title={`Dismiss ${manifest.title}`}><span aria-hidden="true">×</span></Button></div>
}


export default memo(function WidgetFrame(props) {
  const result = useWidget(props.manifest, props.quiet, props.refreshVersion, props.onData)
  return <WidgetPresentation {...props} {...result} />
})

export function WidgetPresentation({ manifest, position, size = position?.size || 'm', data, busy, refresh, editing, move, resize, grip, tile = false, full = false, preview = false, design = defaultDesign(manifest.id), frameless = false }) {
  const { removeWidget, now, layout, setEditing, connectSource, connectionHealth, openPalette, openAppearance, changeDesign } = useDashboard()
  const [retry, setRetry] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const variationSize = size
  const Content = WIDGETS[manifest.id]
  const pattern = WIDGET_PRESENTATIONS[manifest.id] || 'controls'
  const instrument = ['clock', 'weather', 'sun', 'air', 'player', 'timer'].includes(pattern) || manifest.id === 'glance.next-event'
  const workbench = instrument || (['l', 'tall'].includes(size) && !(preview && manifest.id === 'dash.gallery'))
  const body = useRef(null)
  const previousSize = useRef(size)
  useLayoutEffect(() => {
    if (previousSize.current !== size && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const node = body.current
      node?.getAnimations().forEach(animation => animation.cancel())
      node?.animate([{ opacity: .5, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,0,0,1)' })
    }
    previousSize.current = size
  }, [size])

  const adopted = ADOPTED_WIDGETS.has(manifest.id)

  const previewData = previewRows(data.payload)
  const source = (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).map(source => source?.toolkit || source?.type || 'local').join(', ')
  const added = Array.isArray(layout?.widgets) && layout.widgets.some(w => w.id === manifest.id)
  const variations = manifest.group === 'glance' ? widgetVariations(manifest.id) : []
  const selectedVariation = variations.find(item => variationNumber(item.id) === variationNumber(design))?.id || variations[0]?.id
  const activeDesign = selectedVariation || design
  const sourceManaged = data.payload?.items?.some(item => item.editable === false)
  const detailName = `${DETAIL_LABELS[manifest.id] || `Open ${manifest.title}`}${!instrument && previewData.count > 5 ? ` (${previewData.count})` : ''}`
  const settings = () => { if (full || preview) return; setExpanded(true) }
  const protect = children => <WidgetBoundary key={retry} resetKey={JSON.stringify(data.payload)} id={manifest.id} onRetry={() => { setRetry(n => n + 1); refresh() }}>{children}</WidgetBoundary>
  const content = (payload, inDrawer = false) => protect(<WidgetState data={data} empty={manifest.id === 'glance.music' ? null : manifest.empty} disconnected={['task.agenda', 'glance.travel'].includes(manifest.id)} editable={preview || manifest.id === 'glance.music' || adopted || instrument || ['glance.travel', 'need.overdue', 'need.decisions', 'need.approvals', 'need.lor-slack', 'agent.rules', 'agent.watchers', 'agent.research', 'agent.delegated', 'agent.jobs', 'agent.brief', 'agent.next', 'comm.thread-summary', 'comm.newsletters', 'comm.reachout'].includes(manifest.id) || manifest.id.startsWith('task.') || ['feed.news', 'feed.rss', 'need.mentions', 'need.inbox', 'comm.templates', 'comm.tone', 'need.waiting', 'need.drafts', 'lib.capture', 'lib.search', 'lib.ask', 'lib.readlater', 'lib.highlights', 'lib.daily', 'lib.collections', 'dev.appeal', 'dev.recovery', 'dev.backup', 'dev.unpushed'].includes(manifest.id)}><Suspense fallback={<Skeleton />}>{data.refreshing && (['lib.ask', 'lib.readlater'].includes(manifest.id) || (manifest.id === 'comm.thread-summary' && payload?.model_enabled)) && <StateView role="status">Generating…</StateView>}{Content ? <Content design={activeDesign} full={inDrawer ? true : full} size={inDrawer ? 'l' : size} slotSize={size} summaryData={data.payload} data={payload} refresh={refresh} widgetId={manifest.id} onOpen={settings} preview={preview} /> : <StateView role="alert">Widget component unavailable.</StateView>}</Suspense></WidgetState>)
  const requiredSource = manifest.requires?.find(value => value.startsWith('connector:'))?.slice(10) || (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).find(source => source?.toolkit)?.toolkit
  const sourceName = { gmail: 'Gmail', googlecalendar: 'Google Calendar', github: 'GitHub', slack: 'Slack' }[requiredSource] || requiredSource || manifest.title
  const connectionStatus = connectionHealth?.items?.find(item => item.id === requiredSource)?.status

  if (frameless || manifest.group === 'glance') {
    return (
      <div
        ref={body}
        className={`home-widget widget-adoption frameless ${data.state === 'not-connected' && !preview ? 'is-disconnected' : ''}`}
        data-widget={manifest.id}
        data-size={size}
        data-design={activeDesign}
        style={{ width: '100%', height: '100%', padding: 0, margin: 0, border: 0, background: 'transparent' }}
      >
        {['not-connected', 'error'].includes(data.state) && !preview ? (
          <div className="home-connect widget-setup" role={data.state === 'error' ? 'alert' : 'status'} style={{ width: '100%', height: '100%', borderRadius: 24, padding: 20, boxSizing: 'border-box' }}>
            <span className="widget-setup-icon" aria-hidden="true"><Icon name={WIDGET_ICONS[manifest.id] || 'link'} size={28} /></span>
            <strong>{data.state === 'not-connected' && requiredSource ? connectionStatus === 'connected' ? `${sourceName} unavailable` : connectionStatus === 'needs reconnect' ? `Reconnect ${sourceName}` : `Connect ${sourceName}` : widgetStatus(manifest, data)}</strong>
            <p>{data.error || 'The required source or setting is unavailable.'}</p>
            <div className="widget-buttons">
              <Button onClick={() => setSetupOpen(true)}>Setup & status</Button>
              {requiredSource && connectSource && <Button onClick={() => connectSource(requiredSource)}>{connectionStatus === 'connected' ? 'Check connection' : `${connectionStatus === 'needs reconnect' ? 'Reconnect' : 'Connect'} ${sourceName}`}</Button>}
            </div>
          </div>
        ) : Content ? (
          content(data.payload, false)
        ) : (
          <StateView role="alert">Widget component unavailable.</StateView>
        )}
      </div>
    )
  }

  return <WidgetCard className={`home-widget${adopted ? ' widget-adoption' : ''}${['glance.clock', 'glance.weather', 'need.inbox', 'task.today', 'task.focus', 'agent.feed', 'task.deadlines', 'dev.prs'].includes(manifest.id) ? ' widget-pilot' : ''}${tile ? ' home-tile' : ''}${data.state === 'not-connected' && !preview ? ' is-disconnected' : ''}${preview ? ' is-preview' : ''}`} data-widget={manifest.id} data-tone={widgetTone(manifest.id)} data-size={full ? 'l' : size} data-pattern={pattern} data-view={full ? 'detail' : workbench ? 'workbench' : 'preview'} data-design={activeDesign} data-variation={variationNumber(activeDesign)} data-composition={`${pattern}-${full ? 'detail' : size}`} aria-label={manifest.id === 'glance.clock' ? undefined : manifest.title}>
    <WidgetHeader icon={(adopted && manifest.icon) || WIDGET_ICONS[manifest.id] || WIDGET_ICONS[manifest.id.split('.')[0]]} title={manifest.title} count={previewData.count} source={sourceManaged ? `${data.payload?.items?.some(item => item.editable) ? 'local · ' : ''}connected source` : source} data={data} now={now}>
      {!preview && editing && <Button type="submit" {...grip('move', manifest.id)} onKeyDown={event => { if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) { event.preventDefault(); move(manifest.id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) } }} aria-label={`Move ${manifest.title}`} title="Drag to move; arrow keys also work"><Icon name="grid" size={18} /></Button>}
      {!preview && manifest.group !== 'glance' && manifest.id !== 'glance.clock' && <Button type="submit" className="widget-refresh" disabled={busy || data.refreshing} onClick={refresh} aria-label={`Refresh ${manifest.title}`}><Icon name="refresh" size={18} /></Button>}
      {!preview && <DropdownMenu modal={false}><DropdownMenuTrigger render={<Button className="widget-menu-trigger" variant="ghost" size="icon" aria-label={`Options and settings for ${manifest.title}`} />}><Icon name="more" size={20} /></DropdownMenuTrigger><DropdownMenuContent className="dashboard-widget-menu" align="end"><DropdownMenuItem disabled={busy || data.refreshing} onClick={refresh}>Refresh</DropdownMenuItem><DropdownMenuItem onClick={() => setSetupOpen(true)}>Setup & status</DropdownMenuItem>{!full && <DropdownMenuItem onClick={settings}>Widget settings</DropdownMenuItem>}{!full && manifest.group === 'glance' && openAppearance && <DropdownMenuItem onClick={openAppearance}>Appearance & theme</DropdownMenuItem>}{!full && <DropdownMenuItem onClick={() => setEditing(true)}>Size</DropdownMenuItem>}{added && <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => removeWidget(manifest.id)}>Remove</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu>}

    </WidgetHeader>
    <div ref={body} className="widget-content" inert={preview || undefined}>
      {['not-connected', 'error'].includes(data.state) && !preview ? <div className="home-connect widget-setup" role={data.state === 'error' ? 'alert' : 'status'}><span className="widget-setup-icon" aria-hidden="true"><Icon name={WIDGET_ICONS[manifest.id] || 'link'} size={28} /></span><strong>{data.state === 'not-connected' && requiredSource ? connectionStatus === 'connected' ? `${sourceName} unavailable` : connectionStatus === 'needs reconnect' ? `Reconnect ${sourceName}` : `Connect ${sourceName}` : widgetStatus(manifest, data)}</strong><p>{data.error || 'The required source or setting is unavailable. Open setup for the requirements and recovery steps.'}</p><div className="widget-buttons"><Button onClick={() => setSetupOpen(true)}>Setup & status</Button>{requiredSource && connectSource && <Button onClick={() => connectSource(requiredSource)}>{connectionStatus === 'connected' ? 'Check connection' : `${connectionStatus === 'needs reconnect' ? 'Reconnect' : 'Connect'} ${sourceName}`}</Button>}</div></div> : Content ? <>
        {content(data.payload, false)}
        {expanded && <Drawer title={manifest.title} onClose={() => setExpanded(false)} open={expanded} portal={true} className="widget-workbench">
          {variations.length > 0 && <section className="widget-variation-picker" aria-label={`${manifest.title} design variations`}>
            <h3>Choose a design</h3>
            <p className="widget-variation-size-note">Previewing the current {size.toUpperCase()} size. Switching designs keeps this size.</p>
            <div className="widget-variation-options" data-preview-size={variationSize}>
              {variations.map(item => <article className={`widget-variation-option${selectedVariation === item.id ? ' is-selected' : ''}`} key={item.id} data-design={item.id}>
                <header><strong>{item.name}</strong><span>{variationSize === 's' ? 'Small' : variationSize === 'm' ? 'Medium' : 'Large'} preview</span></header>
                <div className="widget-variation-preview-frame" data-size={variationSize} style={gridSize(variationSize)} inert>
                  <WidgetBoundary key={`${item.id}-${variationSize}`} resetKey={JSON.stringify(data.payload)} id={`${manifest.id}-${item.id}`} onRetry={refresh}>
                    <Suspense fallback={<Skeleton />}><Content design={item.id} size={variationSize} slotSize={variationSize} data={data.payload} summaryData={data.payload} refresh={refresh} widgetId={manifest.id} preview={true} /></Suspense>
                  </WidgetBoundary>
                </div>
                <Button size="small" variant={selectedVariation === item.id ? 'secondary' : 'primary'} onClick={() => changeDesign?.(manifest.id, item.id)}>{selectedVariation === item.id ? 'Selected' : 'Use this design'}</Button>
              </article>)}
            </div>
          </section>}
          {content(data.payload, true)}
        </Drawer>}
      </> : <>
        {!full && !workbench && protect(<WidgetState data={data} empty={manifest.empty}><WidgetPreview data={data.payload} manifest={manifest} pattern={pattern} size={size} /></WidgetState>)}
        {full ? content(data.payload, false) : preview ? (workbench ? content(previewData.payload, false) : null) : <Drawer title={manifest.title} onClose={() => setExpanded(false)} open={expanded} inline={workbench} portal={false} className="widget-workbench">{content(expanded ? data.payload : previewData.payload, true)}</Drawer>}
      </>}
      {data.state === 'error' && !preview && <Button disabled={busy} onClick={refresh}>Retry</Button>}
    </div>
    {!full && !preview && !adopted && !['loading', 'error', 'not-connected'].includes(data.state) && !Content && <footer className="widget-footer"><Button className="widget-open" variant={manifest.id === 'glance.clock' ? 'ghost' : ['player', 'timer'].includes(pattern) ? 'ghost' : 'primary'} onClick={manifest.id === 'dash.palette' ? openPalette : settings} aria-label={detailName}><span className="widget-open-label">{detailName}</span><Icon name="arrow-up-right" size={18} /></Button></footer>}
    {setupOpen && <Drawer title={`${manifest.title} · Setup & status`} onClose={() => setSetupOpen(false)}><WidgetSetup manifest={manifest} data={data} busy={busy} refresh={refresh} onConfigure={full ? undefined : () => { setSetupOpen(false); settings() }} /></Drawer>}

    {!preview && editing && <div className="widget-edit"><label>Size<Select aria-label={`Size ${manifest.title}`} value={size} onChange={e => resize(manifest.id, { size: e.target.value })}>{manifest.sizes.map(size => <option key={size} value={size}>{size.toUpperCase()}</option>)}</Select></label><label>Height<Input aria-label={`Height ${manifest.title}`} type="number" min={2} max={8} value={position.height} onChange={e => resize(manifest.id, { height: Math.max(2, Math.min(8, Number(e.target.value) || 2)) })} /></label><Button type="submit" {...grip('resize', manifest.id)} aria-label={`Resize ${manifest.title}`} title="Drag to resize; size and height fields also work"><Icon name="expand" size={18} /></Button></div>}
  </WidgetCard>
}
