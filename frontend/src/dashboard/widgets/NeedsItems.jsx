export default function NeedsItems({ data }) {
  return <ul className="widget-list">{(data?.items || []).map(item => <li key={`${item.source}:${item.id}`}>
    <div><strong>{item.title}</strong><p>{item.source} · Overdue · {new Date(item.due_at).toLocaleString()}</p></div>
  </li>)}</ul>
}
