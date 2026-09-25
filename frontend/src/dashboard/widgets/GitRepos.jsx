import { WidgetRow, StateView } from '../primitives.jsx'
import { useEffect, useState } from 'react'
import { request } from '../api.js'

export default function GitRepos({ data, widgetId, refresh }) {
  const [paths, setPaths] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let mounted = true
    request(`/widgets/${widgetId}/settings`).then(value => { if (mounted) setPaths((value.repos || []).join('\n')) }).catch(e => { if (mounted) setError(e.message) })
    return () => { mounted = false }
  }, [widgetId])
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await request(`/widgets/${widgetId}/settings`, 'PUT', { repos: paths.split('\n').map(path => path.trim()).filter(Boolean) }); await refresh() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div><form onSubmit={save}><label htmlFor={`${widgetId}-repos`}>Local repository paths (one per line)</label><textarea id={`${widgetId}-repos`} value={paths} onChange={event => setPaths(event.target.value)} /><button disabled={busy}>Save repositories</button></form>{error && <StateView role="alert">{error}</StateView>}
    {widgetId === 'dev.backup' && <p>Last push means locally recorded push evidence; other hosts may have pushed later. Unavailable evidence is unknown.</p>}
    <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong>{widgetId === 'dev.unpushed' ? <><p>Working tree: {item.dirty === null ? 'unknown' : item.dirty ? 'dirty' : 'clean'}</p><p>Compared with local tracking refs; refresh does not fetch.</p><ul>{item.branches.map(branch => <WidgetRow key={branch.name}>{branch.name} · {branch.upstream ? `${branch.ahead} unpushed commits` : 'No upstream; unpushed count unknown'}</WidgetRow>)}</ul></> : <p>Local clone: {item.local_clone ? 'present' : 'unavailable'}</p>}{item.warnings?.map(warning => <p key={warning}>{warning}</p>)}<ul>{item.remotes?.map(remote => <WidgetRow key={remote.name}><div><p>{remote.name} · {remote.url}</p><p>{remote.reachable === true ? 'Reachable' : remote.reachable === false ? 'Not reachable' : 'Reachability unknown'} · Last locally recorded push: {remote.last_push || 'unknown'}</p></div></WidgetRow>)}</ul></div></WidgetRow>)}</ul>
  </div>
}
