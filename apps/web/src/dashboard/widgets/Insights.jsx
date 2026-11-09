import { Button } from '../../components/ui/bento/index.jsx'
import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'

export default function Insights({ data, widgetId, refresh }) {
  const [error, setError] = useState('')
  async function enable(model_enabled) {
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { model_enabled }); await refresh() }
    catch (err) { setError(err.message) }
  }
  return <>{error && <StateView role="alert">{error}</StateView>}<p>Optional model selection · local Ollama or configured free model.</p><Button type="submit" onClick={() => enable(Boolean(data?.disabled))}>{data?.disabled ? 'Enable model selection' : 'Disable model selection'}</Button>{!data?.disabled && !data?.items?.length && <StateView>{widgetId === 'agent.next' ? 'No existing action to suggest.' : 'Nothing to report from cached widgets.'}</StateView>}<ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><a href={item.href}>{item.title}</a>{item.reason && <p>{item.reason}</p>}<p>{item.detail}</p></div></WidgetRow>)}</ul></>
}
