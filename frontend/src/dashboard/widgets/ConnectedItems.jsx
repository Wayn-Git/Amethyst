export default function ConnectedItems({ data }) {
  return <div>
    {data?.unavailable?.length > 0 && <p role="status">Unavailable: {data.unavailable.join(', ')}</p>}
    {data?.limited && <p role="status">Results limited. More items may exist.</p>}
    <ul className="widget-list">{(data?.items || []).map(item => <li key={`${item.source}:${item.id}`}><div>
      <strong>{/^https:\/\//.test(item.url || '') ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</strong>
      <p>{item.source}{item.status ? ` · ${item.status}` : ''}{item.at ? ` · ${new Date(item.at).toLocaleString()}` : ''}</p>
    </div></li>)}</ul>
  </div>
}
