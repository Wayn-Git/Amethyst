import { WidgetRow } from '../primitives.jsx'
export default function NeedsItems({ data }) {
  return <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={`${item.source}:${item.id}`}>
    <div><strong>{item.title}</strong><p>{item.source} · {item.until ? (item.return_state === 'ready' ? 'Ready now' : 'Returns today') : 'Overdue'} · {new Date(item.until || item.due_at).toLocaleString()}</p></div>
  </WidgetRow>)}</ul>
}
