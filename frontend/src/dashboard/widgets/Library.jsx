export default function Library({ data }) {
  return <>{data?.degraded && <p role="status">Keyword results only; semantic search unavailable.</p>}<ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}><div><strong>{item.title}</strong><p>{item.kind}</p>{item.reason && <p>{item.reason}</p>}{item.excerpt && <p>{item.excerpt}</p>}</div></li>)}</ul></>
}
