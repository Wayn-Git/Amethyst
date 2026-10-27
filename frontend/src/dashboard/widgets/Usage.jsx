import { Stat, SegmentedBar } from '../../components/ui/bento/index.jsx'
import { WidgetRow } from '../primitives.jsx'

export default function Usage({ data }) {
  return <>
    <p>{data?.window}</p>
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><div className="widget-metric"><Stat value={item.calls ?? 'Unavailable'} label={`${item.location} model calls`} />{Number.isFinite(item.input_tokens) && Number.isFinite(item.output_tokens) && item.input_tokens + item.output_tokens > 0 && <><SegmentedBar value={item.output_tokens} max={item.input_tokens + item.output_tokens} label="Output share of recorded tokens" /><span className="adoption-label">Output share of recorded tokens</span></>}</div><p>Input tokens: {item.input_tokens ?? 'Unavailable'} · Output tokens: {item.output_tokens ?? 'Unavailable'}</p><p>Model latency: {item.latency_ms} ms</p>{item.location === 'cloud' && <p>Estimated cost: {item.estimated_cost_usd == null ? 'Unavailable' : `$${item.estimated_cost_usd.toFixed(6)} USD at published token rates`}</p>}</div></WidgetRow>)}</ul>
  </>
}
