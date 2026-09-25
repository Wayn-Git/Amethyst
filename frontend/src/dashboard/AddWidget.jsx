import { useState } from 'react'
import { useDashboard } from './context.js'
import Button from '../components/ui/AppButton.jsx'
import { Input } from '../components/ui/input.tsx'

const GROUPS = ['glance', 'needs-you', 'communication', 'agent', 'library', 'tasks', 'developer', 'feed', 'dashboard', 'system', 'student', 'life', 'proactive']
export default function AddWidget() {
  const { manifests, layout, addWidget } = useDashboard()
  const [query, setQuery] = useState('')
  const matches = manifests.filter(m => `${m.title} ${m.id} ${m.group} ${m.empty}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="home-catalog"><Input aria-label="Search widgets" placeholder="Search widgets…" value={query} onChange={event => setQuery(event.target.value)} />
    {GROUPS.map(group => {
      const items = matches.filter(m => m.group === group)
      return items.length > 0 && <section key={group}><h3>{group === 'dashboard' ? 'Home settings' : group.replaceAll('-', ' ')}</h3>{items.map(m => {
        const added = layout.widgets.some(item => item.id === m.id)
        return <div className="home-catalog-row" key={m.id}><div><strong>{m.title}</strong><p>{m.description || m.empty}</p></div><Button disabled={added} onClick={() => addWidget(m.id)}>{added ? 'Added' : 'Add'}</Button></div>
      })}</section>
    })}
    {!matches.length && <p role="status">No widgets match your search.</p>}
  </div>
}
