import { WidgetRow } from '../primitives.jsx'

export default function Usage({ data }) {
  return <>
    <p>{data?.window}</p>
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.location} · {item.calls} model calls</p><p>Input tokens: {item.input_tokens ?? 'Unavailable'} · Output tokens: {item.output_tokens ?? 'Unavailable'}</p><p>Model latency: {item.latency_ms} ms</p>{item.location === 'cloud' && <p>Estimated cost: {item.estimated_cost_usd == null ? 'Unavailable' : `$${item.estimated_cost_usd.toFixed(6)} USD at published token rates`}</p>}</div></WidgetRow>)}</ul>
  </>
}
