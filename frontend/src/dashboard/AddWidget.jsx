import { useState } from 'react'
import { useDashboard } from './context.js'
import { SYSTEM_WIDGETS } from './layout.js'
import Button from '../components/ui/AppButton.jsx'
import { Input } from '../components/ui/input.tsx'
import Select from '../components/ui/NativeSelect.jsx'
import Icon from '../components/Icon.jsx'

const GROUPS = [['glance', 'Glance', 'clock'], ['needs-you', 'Needs you', 'mail'], ['communication', 'Communication', 'chat'], ['agent', 'Agent', 'sparkle'], ['library', 'Library', 'bookmark'], ['tasks', 'Tasks', 'tasks'], ['developer', 'Developer', 'github'], ['feed', 'Feed', 'globe'], ['system', 'System', 'settings']]
const categoryOf = manifest => GROUPS.some(([group]) => group === manifest.group) ? manifest.group : 'system'
const sourceOf = manifest => (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).map(source => source?.toolkit || source?.type).filter(Boolean).join(', ')

export default function AddWidget({ compact = false }) {
  const { manifests, layout, addWidget, openWidget } = useDashboard()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const availableGroups = GROUPS.filter(([group]) => manifests.some(m => categoryOf(m) === group))
  const categories = [['all', 'All widgets', 'grid'], ...availableGroups]
  const matches = manifests.filter(m => (category === 'all' || categoryOf(m) === category) && `${m.title} ${m.id} ${m.group} ${m.description || ''} ${sourceOf(m)}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className={`today-catalog${compact ? ' is-compact' : ''}`}>
    <div className="today-catalog-search"><Icon name="search" size={18} /><Input type="search" aria-label="Search widgets" placeholder="Search widgets…" value={query} onChange={event => setQuery(event.target.value)} />{query && <Button size="small" variant="ghost" onClick={() => setQuery('')} aria-label="Clear widget search"><Icon name="x" size={14} /></Button>}</div>
    <div className="today-catalog-browser">
      <nav className="today-catalog-categories" aria-label="Widget categories">{categories.map(([id, title, icon]) => <Button key={id} variant="ghost" aria-pressed={category === id} onClick={() => setCategory(id)}><Icon name={icon} size={16} /><span>{title}</span><small>{id === 'all' ? manifests.length : manifests.filter(m => categoryOf(m) === id).length}</small></Button>)}</nav>
      <label className="today-catalog-mobile-category">Category<Select aria-label="Widget category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</Select></label>
      <div className="today-catalog-results">
        <div className="today-catalog-results-heading"><h3>{categories.find(([id]) => id === category)?.[1]}</h3><span>{matches.length} available</span></div>
        {availableGroups.filter(([group]) => matches.some(m => categoryOf(m) === group)).map(([group, title, icon]) => <section className="today-catalog-group" key={group} aria-label={title}>{category === 'all' && <h4>{title}</h4>}{matches.filter(m => categoryOf(m) === group).map(m => {
          const added = layout.widgets.some(item => item.id === m.id)
          const system = SYSTEM_WIDGETS.includes(m.id)
          return <div className="today-catalog-row home-catalog-row" key={m.id}><span className="today-catalog-icon"><Icon name={icon} size={20} /></span><div className="today-catalog-copy"><strong>{m.title}</strong><p>{m.description || m.empty}</p><small>{sourceOf(m)}<span aria-hidden="true"> · </span>{m.sizes.map(size => ({ s: 'Small', m: 'Medium', l: 'Large' })[size]).join(', ')}</small></div><Button size="small" variant={added ? 'ghost' : 'secondary'} disabled={added && !system} onClick={() => system ? openWidget(m.id) : addWidget(m.id)}>{system ? 'Open' : added ? <><Icon name="check-simple" size={14} />Added</> : <><Icon name="plus" size={14} />Add</>}</Button></div>
        })}</section>)}
        {!matches.length && <div className="today-catalog-empty" role="status"><Icon name="search" size={24} /><strong>No matching widgets</strong><p>Try another name or category.</p><Button size="small" onClick={() => { setQuery(''); setCategory('all') }}>Clear filters</Button></div>}
      </div>
    </div>
    <footer className="today-catalog-footer"><Icon name="grid" size={14} /><span>{layout.widgets.filter(w => !SYSTEM_WIDGETS.includes(w.id)).length} widgets on Home</span></footer>
  </div>
}
