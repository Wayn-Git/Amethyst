import { WidgetRow, StateView } from '../primitives.jsx'

export default function Communication({ data }) {
  return <div>
    {data?.limited && <StateView role="status">Results limited to available source metadata.</StateView>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div>
      <strong>{/^https:\/\//.test(item.url || '') ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</strong>
      <p>{item.source}{item.person && ` · ${item.person}`}</p>
    </div></WidgetRow>)}</ul>
  </div>
}
