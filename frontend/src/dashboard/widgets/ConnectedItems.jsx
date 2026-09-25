import { WidgetRow, WidgetChip, StateView } from '../primitives.jsx'
export default function ConnectedItems({ data, widgetId }) {
  return <div>
    {data?.unavailable?.length > 0 && <StateView role="status">Unavailable: {data.unavailable.join(', ')}</StateView>}
    {data?.limited && <StateView role="status">Results limited. More items may exist.</StateView>}
    <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={`${item.source}:${item.id}`}><div>
      {widgetId?.startsWith('dev.') && <span className="widget-repo">{item.url?.match(/^https:\/\/github\.com\/([^/]+\/[^/?#]+)/)?.[1]}</span>}
      <strong>{/^https:\/\//.test(item.url || '') ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</strong>
      <p>{item.source}{item.status && <> · <WidgetChip className="widget-chip">{item.status}</WidgetChip></>}{item.at ? ` · ${new Date(item.at).toLocaleString()}` : ''}</p>
    </div></WidgetRow>)}</ul>
  </div>
}
