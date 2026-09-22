import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'
import Button from '../../components/ui/AppButton.jsx'

export default function Mail({ data, refresh, widgetId }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function model(enabled) {
    setBusy(true); setError('')
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { model_enabled: enabled }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className={widgetId === 'need.inbox' ? 'widget-mail' : undefined}><details className="mail-source-note"><summary>About this inbox</summary><p>Gmail via Composio · up to 100 messages. Only short snippets are retained.</p></details>
    {widgetId === 'need.inbox' && <><div className="mail-toolbar"><Button size="small" variant="ghost" loading={busy} onClick={() => model(!data?.model_enabled)}>{data?.model_enabled ? 'Use unread and recent' : 'Rank with model'}</Button></div>
    {(busy) && <StateView role="status">Generating…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    {!data?.ranked && <p className="mail-ranking-note">Unread, then recent; model ranking is off or unavailable.</p>}
    </>}
    {widgetId === 'comm.unread' ? <ul className="widget-list">{(data?.items || []).map(group => <WidgetRow key={group.id}><div><strong>{group.from} · {group.items.length} unread</strong><ul>{group.items.map(item => <WidgetRow key={item.id}><div><strong>{item.subject}</strong><p>{item.date}</p><p>{item.snippet}</p></div></WidgetRow>)}</ul></div></WidgetRow>)}</ul> : <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id} className="mail-item-row"><div className="mail-row-copy"><div className="mail-row-meta"><span>{item.from}</span><span className="mail-date">{item.date}</span></div><strong>{item.subject}</strong><div className="mail-row-context"><p className="widget-row-secondary mail-snippet">{item.snippet}</p>{item.reason && <p className="mail-reason">Why: {item.reason}</p>}</div></div></WidgetRow>)}</ul>}
  </div>
}
