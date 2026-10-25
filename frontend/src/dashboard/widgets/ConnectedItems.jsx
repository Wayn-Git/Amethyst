export default function ConnectedItems({ data, widgetId }) {
  return <div>
    {data?.unavailable?.length > 0 && <p role="status">Unavailable: {data.unavailable.join(', ')}</p>}
    {data?.limited && <p role="status">Results limited. More items may exist.</p>}
    <ul className="widget-list">{(data?.items || []).map(item => <li key={`${item.source}:${item.id}`}><div>
      {widgetId?.startsWith('dev.') && <span className="widget-repo">{item.url?.match(/^https:\/\/github\.com\/([^/]+\/[^/?#]+)/)?.[1]}</span>}
      <strong>{/^https:\/\//.test(item.url || '') ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</strong>
      <p>{item.source}{item.status && <> · <span className="widget-chip">{item.status}</span></>}{item.at ? ` · ${new Date(item.at).toLocaleString()}` : ''}</p>
    </div></li>)}</ul>
  </div>
}
