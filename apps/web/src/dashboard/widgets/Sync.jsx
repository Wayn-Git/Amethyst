import { Button } from '../../components/ui/bento/index.jsx'
import { WidgetRow } from '../primitives.jsx'
import { useDashboard } from '../context.js'
export default function Sync() {
  const { records, manifests, layout, refreshAll, quiet } = useDashboard()
  return <><p>{quiet ? 'Automatic refresh paused. Manual refresh still works.' : 'Widgets refresh independently.'}</p><ul className="widget-list">{manifests.filter(m => layout.widgets.some(w => w.id === m.id)).map(m => <WidgetRow key={m.id}><span>{m.title}</span><span>{records[m.id]?.state || 'loading'} · {records[m.id]?.synced_at ? new Date(records[m.id].synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not synced'}</span></WidgetRow>)}</ul><Button type="submit" onClick={refreshAll}>Refresh all</Button></>
}
