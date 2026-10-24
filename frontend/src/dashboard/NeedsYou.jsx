import { useState } from 'react'
import { useDashboard } from './context.js'
import { useWidget } from './useWidget.js'
import { ConnectionRow, Skeleton } from './WidgetFrame.jsx'
import Drawer from './Drawer.jsx'
import { rankNeeds } from './layout.js'

function Observe({ manifest, quiet, refreshVersion, onData }) {
  useWidget(manifest, quiet, refreshVersion, onData)
  return null
}
export default function NeedsYou({ manifests, quiet, refreshVersion, onData }) {
  const { records, openWidget, toggleWidget } = useDashboard()
  const [expanded, setExpanded] = useState(false)
  const rows = rankNeeds(manifests, records)
  const waiting = manifests.some(m => !records[m.id] || records[m.id].state === 'loading')
  const list = all => <ul className="widget-list">{(all ? rows : rows.slice(0, 5)).map(row => <li key={`${row.widgetId}:${row.id}`}><div><span className="widget-chip">{row.kind}</span><strong>{row.title}</strong><p>{row.why}</p></div><button onClick={() => { setExpanded(false); openWidget(row.widgetId) }}>{row.action}</button></li>)}</ul>
  return <section className="home-widget" aria-label="Needs you">{manifests.map(m => <Observe key={m.id} manifest={m} quiet={quiet} refreshVersion={refreshVersion} onData={onData} />)}<header className="widget-header"><h2>Needs you</h2><span className="widget-chip">{rows.length}</span></header>
    {waiting && <Skeleton />}{list(false)}{!waiting && !rows.length && <p>Nothing needs you right now.</p>}
    {manifests.map(m => {
      const record = records[m.id]
      if (record?.state === 'not-connected' || record?.payload?.connected === false) return <ConnectionRow key={m.id} manifest={m} remove={() => toggleWidget(m.id)} />
      if (['error', 'stale'].includes(record?.state)) return <p key={m.id} role="status"><span className={`widget-chip state-${record.state}`}>{record.state}</span> {m.title}: {record.error || 'Showing saved items.'}<button onClick={() => openWidget(m.id)}>Review</button></p>
      return null
    })}
    <details><summary>Sources and settings</summary><div className="widget-buttons">{manifests.map(m => <button key={m.id} onClick={() => openWidget(m.id)}>{m.title}</button>)}</div></details>
    {rows.length > 5 && <button onClick={() => setExpanded(true)}>Show all ({rows.length})</button>}{expanded && <Drawer title="Needs you" onClose={() => setExpanded(false)}>{list(true)}</Drawer>}
  </section>
}
