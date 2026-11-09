import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import Button from '../../components/ui/AppButton.jsx'
import { notifyConnectorsChanged } from '../../components/connectorState.js'
import { request } from '../api.js'

const sourceName = id => ({ gmail: 'Gmail', googlecalendar: 'Google Calendar', github: 'GitHub', slack: 'Slack' })[id] || id

export default function Connectors({ data, refresh, checking, healthError, manage }) {
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
      await refresh(); notifyConnectorsChanged()
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  return <div className="connection-settings">
    <div className="widget-buttons"><Button loading={checking} onClick={refresh}>Check connections</Button>{manage && <Button onClick={manage}>Manage integrations</Button>}</div>
    {healthError && <StateView role="alert">{healthError}</StateView>}
    {!data?.configured && <div className="widget-setup"><strong>Connect your apps</strong><p>Sign in to Composio in Integrations, then connect the accounts you want on Today.</p>{manage && <Button variant="primary" onClick={manage}>Open Integrations</Button>}</div>}
    <p>Read-only access. Existing accounts keep their granted scopes until reconnected.</p>
    {error && <StateView role="alert">{error}</StateView>}
    <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id}><div>
      <strong>{sourceName(item.id)}</strong><p>{item.status}</p>
      <p>{item.last_success ? `Last successful call ${new Date(item.last_success).toLocaleString()}` : 'No successful calls recorded'}</p>
      {item.retry_at && <StateView role="status">{item.circuit_open ? 'Circuit open' : 'Rate limited'} · Retry after {new Date(item.retry_at * 1000).toLocaleTimeString()}</StateView>}
      <Button disabled={!!busy || !item.can_connect} onClick={() => connect(item.id)}>{busy === item.id ? 'Creating link…' : `${item.status === 'not set up' ? 'Connect' : 'Reconnect'} ${sourceName(item.id)}`}</Button>
      {links[item.id] && <p><a href={links[item.id]} target="_blank" rel="noreferrer" className="connection-link">Continue sign-in for {item.id}</a></p>}
      {!item.can_connect && data?.configured && <p>Read-only Connect Link is unavailable for this toolkit.</p>}
    </div></WidgetRow>)}</ul>
  </div>
}
