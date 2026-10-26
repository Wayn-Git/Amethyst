import { useState } from 'react'
import { request } from '../api.js'
import { WidgetRow, StateView } from '../primitives.jsx'
import { Initials } from '../../components/ui/bento/index.jsx'

export default function Communication({ data, widgetId, refresh }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function toggleModel() {
    setBusy(true); setError('')
    try {
      await request(`/widgets/${widgetId}/settings`, 'PUT', { model_enabled: !data?.model_enabled })
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div>
    {['comm.thread-summary', 'comm.newsletters'].includes(widgetId) && <><button disabled={busy} onClick={toggleModel}>{data?.model_enabled ? 'Disable summaries' : 'Enable summaries'}</button><StateView role="status">{busy ? 'Generating…' : data?.model_enabled ? 'Summaries use partial source snippets.' : 'Summaries off. Enable a configured local or free model.'}</StateView></>}
    {error && <StateView role="alert">{error}</StateView>}
    {data?.unavailable?.length > 0 && <StateView role="status">Unavailable: {data.unavailable.join(', ')}</StateView>}
    {data?.limited && <StateView role="status">Results limited to available source metadata.</StateView>}
    <ul className={widgetId === 'need.lor-slack' ? 'widget-list adoption-people' : undefined}>{(data?.items || []).map(item => <WidgetRow key={item.id}>{widgetId === 'need.lor-slack' && <Initials name={item.person || item.source || 'Slack'} />}<div>
      <strong>{/^https:\/\//.test(item.url || '') ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</strong>
      {item.at && <p>Last contact: {new Date(item.at).toLocaleString()}</p>}
      {item.threads && <ul aria-label="Shared threads">{item.threads.filter(url => /^https:\/\//.test(url)).map(url => <WidgetRow key={url}><a href={url} target="_blank" rel="noreferrer">Shared thread</a></WidgetRow>)}</ul>}
      <p>{item.summary}</p>{item.suggestion && <p>{item.suggestion}</p>}
      <p>{item.source}{item.person && ` · ${item.person}`}</p>
    </div></WidgetRow>)}</ul>
  </div>
}
