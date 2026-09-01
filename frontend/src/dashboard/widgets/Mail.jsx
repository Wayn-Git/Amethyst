import { useState } from 'react'
import { request } from '../api.js'

export default function Mail({ data, refresh, widgetId }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function model(enabled) {
    setBusy(true); setError('')
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { model_enabled: enabled }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div><p>Gmail via Composio · up to 100 messages. Only short snippets are retained.</p>
    {widgetId === 'need.inbox' && <><button disabled={busy} onClick={() => model(!data?.model_enabled)}>{data?.model_enabled ? 'Use unread and recent' : 'Rank with model'}</button>
    {(busy) && <p role="status">Generating…</p>}{error && <p role="alert">{error}</p>}
    {!data?.ranked && <p>Unread, then recent; model ranking is off or unavailable.</p>}
    </>}
    {widgetId === 'comm.unread' ? <ul className="widget-list">{(data?.items || []).map(group => <li key={group.id}><div><strong>{group.from} · {group.items.length} unread</strong><ul>{group.items.map(item => <li key={item.id}><div><strong>{item.subject}</strong><p>{item.date}</p><p>{item.snippet}</p></div></li>)}</ul></div></li>)}</ul> : <ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}><div><strong>{item.subject}</strong><p>{item.from} · {item.date}</p><p>{item.snippet}</p>{item.reason && <p>Why: {item.reason}</p>}</div></li>)}</ul>}
  </div>
}
