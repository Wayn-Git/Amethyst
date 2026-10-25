import { useState } from 'react'
import { useDashboard } from '../context.js'
import { SYSTEM_WIDGETS } from '../layout.js'

const categories = [['glance', 'Glance'], ['needs-you', 'Needs you'], ['communication', 'Communication'], ['agent', 'Agent'], ['library', 'Library'], ['tasks', 'Tasks'], ['developer', 'Developer'], ['feed', 'Feed'], ['system', 'System']]
export default function Gallery() {
  const { manifests, layout, toggleWidget, openWidget } = useDashboard()
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const matches = manifests.filter(m => `${m.title} ${m.id} ${m.group}`.toLowerCase().includes(query))
  return <><label className="gallery-search">Search widgets<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>{!matches.length && <p role="status">No matching widgets.</p>}{categories.map(([category, title]) => {
    const rows = matches.filter(m => (['dashboard', 'system', 'student', 'life', 'proactive'].includes(m.group) ? 'system' : m.group) === category)
    return rows.length ? <section key={category} aria-label={title}><h3>{title}</h3>{rows.map(m => {
      const system = SYSTEM_WIDGETS.includes(m.id)
      const added = layout.widgets.some(w => w.id === m.id)
      const source = (Array.isArray(m.source) ? m.source : [m.source]).map(s => s.toolkit || s.type).join(', ')
      return <div className="gallery-row" key={m.id}><div><strong>{m.title}</strong><p>{source} · {m.refresh.mode === 'poll' ? `Refreshes every ${m.refresh.interval_s < 60 ? `${m.refresh.interval_s}s` : `${Math.round(m.refresh.interval_s / 60)}m`}` : `${m.refresh.mode} refresh`}</p></div><button disabled={!system && added} aria-label={`${system ? 'Open' : added ? 'Added' : 'Add'} ${m.title}`} onClick={() => system ? openWidget(m.id) : toggleWidget(m.id)}>{system ? 'Open' : added ? 'Added' : 'Add'}</button></div>
    })}</section> : null
  })}</>
}
