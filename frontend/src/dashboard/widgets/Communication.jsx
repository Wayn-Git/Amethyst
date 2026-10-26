import { useState } from 'react'
import { request } from '../api.js'
import { WidgetRow, StateView } from '../primitives.jsx'
import { Initials, Button, Chip } from '../../components/ui/bento/index.jsx'

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
  return <div className="adoption-stack">
    {['comm.thread-summary', 'comm.newsletters'].includes(widgetId) && <><Button variant={data?.model_enabled ? 'secondary' : 'primary'} loading={busy} onClick={toggleModel}>{data?.model_enabled ? 'Disable summaries' : 'Enable summaries'}</Button><StateView role="status">{busy ? 'Generating…' : data?.model_enabled ? 'Summaries use partial source snippets.' : 'Summaries off. Enable a configured local or free model.'}</StateView></>}
    {error && <StateView role="alert">{error}</StateView>}
    {data?.unavailable?.length > 0 && <StateView role="status">Unavailable: {data.unavailable.join(', ')}</StateView>}
    {data?.limited && <StateView role="status">Results limited to available source metadata.</StateView>}
    <ul className="widget-list adoption-people">{(data?.items || []).map(item => <WidgetRow key={item.id}><Initials name={item.person || item.source || 'Source'} /><div>
      <strong>{/^https:\/\//.test(item.url || '') ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</strong>
      {item.at && <p className="adoption-label">Last contact: <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></p>}
      {item.threads && <details><summary>Shared threads</summary><ul aria-label="Shared threads">{item.threads.filter(url => /^https:\/\//.test(url)).map(url => <WidgetRow key={url}><a href={url} target="_blank" rel="noreferrer">Shared thread</a></WidgetRow>)}</ul></details>}
      <p>{item.summary}</p>{item.suggestion && <p>{item.suggestion}</p>}
      <div className="adoption-meta">{item.source && <Chip>{item.source}</Chip>}{item.person && <span>{item.person}</span>}</div>
    </div></WidgetRow>)}</ul>
  </div>
}
