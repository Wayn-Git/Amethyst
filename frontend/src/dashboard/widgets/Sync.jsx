import { useDashboard } from '../context.js'
export default function Sync() {
  const { records, manifests, refreshAll, quiet } = useDashboard()
  return <><p>{quiet ? 'Automatic refresh paused. Manual refresh still works.' : 'Widgets refresh independently.'}</p><ul className="widget-list">{manifests.map(m => <li key={m.id}><span>{m.title}</span><span>{records[m.id]?.state || 'loading'} · {records[m.id]?.synced_at ? new Date(records[m.id].synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not synced'}</span></li>)}</ul><button onClick={refreshAll}>Refresh all</button></>
}
