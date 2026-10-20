import { useState } from 'react'
import { useDashboard } from './context.js'
import { useWidget } from './useWidget.js'
import { ConnectionRow, Skeleton, WidgetHeader } from './WidgetFrame.jsx'
import Drawer from './Drawer.jsx'
import { rankNeeds } from './layout.js'

function Observe({ manifest, quiet, refreshVersion, onData }) {
  useWidget(manifest, quiet, refreshVersion, onData)
  return null
}
export default function NeedsYou({ manifests, quiet, refreshVersion, onData }) {
  const { records, openWidget, removeWidget, now } = useDashboard()
  const [refresh, setRefresh] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const rows = rankNeeds(manifests, records)
  const waiting = manifests.some(m => !records[m.id] || records[m.id].state === 'loading')
  const timestamps = manifests.map(m => records[m.id]?.synced_at).filter(Boolean).sort()
  const status = { synced_at: timestamps.length === manifests.length ? timestamps[0] : null, state: manifests.some(m => records[m.id]?.state === 'stale') ? 'stale' : 'ok' }
  const list = all => <ul className="widget-list">{(all ? rows : rows.slice(0, 5)).map(row => <li key={`${row.widgetId}:${row.id}`}><div><span className={`widget-chip chip-kind-${row.kind?.toLowerCase() || 'default'}`}>{row.kind}</span><strong>{row.title}</strong><p>{row.why}</p></div><button onClick={() => { setExpanded(false); openWidget(row.widgetId) }}>{row.action}</button></li>)}</ul>
  return <section className="home-widget home-needs" aria-label="Needs you">{manifests.map(m => <Observe key={m.id} manifest={m} quiet={quiet} refreshVersion={refreshVersion + refresh} onData={onData} />)}<WidgetHeader icon="mail" title="Needs you" count={rows.length} source="Across sources" data={status} now={now}><button className="widget-refresh" aria-label="Refresh Needs you" onClick={() => setRefresh(n => n + 1)}>Refresh</button><details className="widget-menu"><summary aria-label="Menu Needs you">···</summary><div><button onClick={() => setRefresh(n => n + 1)}>Refresh</button>{manifests.map(m => <button key={m.id} onClick={() => openWidget(m.id)}>{m.title}</button>)}</div></details></WidgetHeader>
    {waiting && <Skeleton />}{list(false)}{!waiting && !rows.length && <p>Nothing needs you right now.</p>}
    {manifests.map(m => {
      const record = records[m.id]
      if (record?.state === 'not-connected' || record?.payload?.connected === false) return <ConnectionRow key={m.id} label={m.title} manifest={m} remove={() => removeWidget(m.id)} />
      if (['error', 'stale'].includes(record?.state)) return <p key={m.id} role={record.state === 'error' ? 'alert' : 'status'}><span className={`widget-chip state-${record.state}`}>{record.state}</span> {m.title}: {record.error || 'Showing saved items.'}<button onClick={() => setRefresh(n => n + 1)}>Retry</button></p>
      if (record?.payload?.unavailable?.length || record?.payload?.limited) return <p key={m.id} role="status">{m.title}: {record.payload.unavailable?.length ? `Unavailable: ${record.payload.unavailable.join(', ')}. ` : ''}{record.payload.limited ? 'Results limited.' : ''}</p>
      return null
    })}
    {rows.length > 5 && <button onClick={() => setExpanded(true)}>Show all ({rows.length})</button>}{expanded && <Drawer title="Needs you" onClose={() => setExpanded(false)}>{list(true)}</Drawer>}
  </section>
}
