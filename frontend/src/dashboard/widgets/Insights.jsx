import { useState } from 'react'
import { request } from '../api.js'

export default function Insights({ data, widgetId, refresh }) {
  const [error, setError] = useState('')
  async function enable(model_enabled) {
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { model_enabled }); await refresh() }
    catch (err) { setError(err.message) }
  }
  return <>{error && <p role="alert">{error}</p>}<p>Optional model selection · local Ollama or configured free model.</p><button onClick={() => enable(Boolean(data?.disabled))}>{data?.disabled ? 'Enable model selection' : 'Disable model selection'}</button>{!data?.disabled && !data?.items?.length && <p>{widgetId === 'agent.next' ? 'No existing action to suggest.' : 'Nothing to report from cached widgets.'}</p>}<ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}><div><a href={item.href}>{item.title}</a>{item.reason && <p>{item.reason}</p>}<p>{item.detail}</p></div></li>)}</ul></>
}
