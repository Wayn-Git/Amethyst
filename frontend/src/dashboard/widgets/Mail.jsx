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
    <button disabled={busy} onClick={() => model(!data?.ranked)}>{data?.ranked ? 'Use unread and recent' : 'Rank with model'}</button>
    {(busy) && <p role="status">Generating…</p>}{error && <p role="alert">{error}</p>}
    {!data?.ranked && <p>Unread, then recent; model ranking is off or unavailable.</p>}
    <ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}><div><strong>{item.subject}</strong><p>{item.from} · {item.date}</p><p>{item.snippet}</p>{item.reason && <p>Why: {item.reason}</p>}</div></li>)}</ul>
  </div>
}
