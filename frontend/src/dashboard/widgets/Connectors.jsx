import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'

export default function Connectors({ data, refresh }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [links, setLinks] = useState({})
  async function connect(id) {
    setBusy(id); setError('')
    try {
      const value = await request(`/connectors/${encodeURIComponent(id)}/connect`, 'POST')
      const url = new URL(value.redirect_url)
      if (url.protocol !== 'https:') throw new Error('Invalid Connect Link')
      setLinks(old => ({ ...old, [id]: url.href }))
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  return <div>
    {!data?.configured && <p>Set up Composio in Connected apps to connect a toolkit.</p>}
    <p>Read-only access. Existing accounts keep their granted scopes until reconnected.</p>
    {error && <StateView role="alert">{error}</StateView>}
    <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id}><div>
      <strong>{item.id}</strong><p>{item.status}</p>
      <p>{item.last_success ? `Last successful call ${new Date(item.last_success).toLocaleString()}` : 'No successful calls recorded'}</p>
      {item.retry_at && <StateView role="status">{item.circuit_open ? 'Circuit open' : 'Rate limited'} · Retry after {new Date(item.retry_at * 1000).toLocaleTimeString()}</StateView>}
      <button disabled={!!busy || !item.can_connect} onClick={() => connect(item.id)}>{busy === item.id ? 'Creating link…' : `${item.status === 'not set up' ? 'Connect' : 'Reconnect'} ${item.id}`}</button>
      {links[item.id] && <p><a href={links[item.id]} target="_blank" rel="noreferrer">Open Connect Link for {item.id}</a></p>}
      {!item.can_connect && data?.configured && <p>Read-only Connect Link is unavailable for this toolkit.</p>}
    </div></WidgetRow>)}</ul>
  </div>
}
