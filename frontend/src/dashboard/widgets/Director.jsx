import { useState } from 'react'
import { request } from '../api'

export default function Director({ data, widgetId, refresh }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(path, body = {}) {
    setBusy(true); setError('')
    try { await request(path, 'POST', body); await refresh() }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  return <>{error && <p role="alert">{error}</p>}<ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}>
    <div><strong>{item.title}</strong><p>{item.detail}</p>
      {item.arguments && <pre>{item.arguments}</pre>}
      {widgetId === 'need.approvals' && <div>
        <button disabled={busy} onClick={() => act(`/confirmations/${encodeURIComponent(item.id)}`, { allow: true })}>Approve</button>
        <button disabled={busy} onClick={() => act(`/confirmations/${encodeURIComponent(item.id)}`, { allow: false })}>Deny</button>
      </div>}
      {widgetId === 'agent.running' && <button disabled={busy} onClick={() => act(`/conversations/${encodeURIComponent(item.conversation_id)}/turn/stop`)}>Stop</button>}
    </div>
  </li>)}</ul></>
}
