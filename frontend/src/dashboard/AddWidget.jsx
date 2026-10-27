import { useState } from 'react'
import { useDashboard } from './context.js'
import { SYSTEM_WIDGETS, WIDGET_ICONS, widgetTone, preferredWidgetSize } from './layout.js'
import { Button, Input, Select, Segmented, Chip, IconBadge } from '../components/ui/bento/index.jsx'
import Icon from '../components/Icon.jsx'

const GROUPS = [['glance', 'Glance', 'clock'], ['needs-you', 'Needs you', 'mail'], ['communication', 'Communication', 'chat'], ['agent', 'Agent', 'sparkle'], ['library', 'Library', 'bookmark'], ['tasks', 'Tasks', 'tasks'], ['developer', 'Developer', 'branch'], ['student', 'Student', 'book'], ['feed', 'Feed', 'globe'], ['life', 'Life', 'sun'], ['system', 'System', 'settings'], ['proactive', 'Proactive', 'bell'], ['dashboard', 'Home', 'grid']]
const categoryOf = manifest => GROUPS.some(([group]) => group === manifest.group) ? manifest.group : 'system'
const sources = manifest => (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).filter(Boolean)
const connectors = manifest => [...new Set([...(manifest.requires || []).filter(value => value.startsWith('connector:')).map(value => value.slice(10)), ...sources(manifest).filter(source => source.type === 'composio').map(source => source.toolkit).filter(Boolean)])]
const sourceNames = { googlecalendar: 'Google Calendar', gmail: 'Gmail', github: 'GitHub', slack: 'Slack' }

function CatalogCard({ manifest: m, added, addWidget, removeWidget, openWidget, connections, connectSource, selected, select }) {
  const [size, setSize] = useState(() => preferredWidgetSize(m))
  const system = SYSTEM_WIDGETS.includes(m.id)
  return <article className="today-catalog-row home-catalog-row" aria-label={m.title}>
    <Button variant="ghost" className="catalog-thumbnail ui-tile" data-tone={widgetTone(m.id)} data-preview-size={size} aria-label={`Choose ${m.title}`} aria-expanded={selected} aria-controls={`catalog-options-${m.id}`} onClick={select}>
      <IconBadge label={m.title}><Icon name={m.icon || WIDGET_ICONS[m.id] || 'grid'} size={20} /></IconBadge>
      <div className="catalog-silhouette"><span /><span /><span /></div>
      <span className="catalog-preview-label">{selected ? 'Hide options' : 'Choose widget'}</span>
    </Button>
    <div className="today-catalog-copy"><h4>{m.title}</h4><p title={m.description || `View ${m.title.toLowerCase()}.`}>{m.description || `View ${m.title.toLowerCase()}.`}</p></div>
    {added && <span className="catalog-added"><Icon name="check-simple" size={14} />On Home</span>}
    <div id={`catalog-options-${m.id}`} hidden={!selected} className="catalog-options">
    <div className="catalog-connectors">{connectors(m).map(source => <Chip key={source}><span>{sourceNames[source] || source}</span>{connections?.data?.items?.find(item => item.id === source)?.status === 'connected' ? <span>Connected</span> : <Button size="small" variant="ghost" onClick={() => connectSource(source)} aria-label={`Connect ${sourceNames[source] || source} for ${m.title}`}>Connect</Button>}</Chip>)}</div>
    <div className="catalog-card-actions"><Segmented aria-label={`Size for ${m.title}`} value={size} onValueChange={setSize} options={m.sizes.map(value => ({ value, label: value.toUpperCase() }))} />{system ? <Button size="small" onClick={() => openWidget(m.id)}>Open</Button> : added ? <div className="catalog-membership"><span><Icon name="check-simple" size={14} />On Home</span><Button size="small" variant="ghost" onClick={() => removeWidget(m.id)}>Remove</Button></div> : <Button size="small" variant="primary" onClick={() => addWidget(m.id, size)}><Icon name="plus" size={14} />Add</Button>}</div>
    </div>
  </article>
}

export default function AddWidget({ compact = false }) {
  const { manifests, layout, addWidget, removeWidget, openWidget, connections, connectSource } = useDashboard()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [category, setCategory] = useState('all')
  const availableGroups = GROUPS.filter(([group]) => manifests.some(m => categoryOf(m) === group))
  const categories = [['all', 'All widgets', 'grid'], ...availableGroups]
  const count = id => id === 'all' ? manifests.length : manifests.filter(m => categoryOf(m) === id).length
  const matches = manifests.filter(m => (category === 'all' || categoryOf(m) === category) && `${m.title} ${m.id} ${m.group} ${m.description || ''} ${sources(m).map(source => source.toolkit || source.type).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className={`today-catalog${compact ? ' is-compact' : ''}`}>
    <div className="today-catalog-search"><Icon name="search" size={18} /><Input type="search" aria-label="Search widgets" placeholder="Search widgets…" value={query} onChange={event => setQuery(event.target.value)} />{query && <Button size="small" variant="ghost" onClick={() => setQuery('')} aria-label="Clear widget search"><Icon name="x" size={14} /></Button>}</div>
    <div className="today-catalog-browser">
      <nav className="today-catalog-categories" aria-label="Widget categories">{categories.map(([id, title, icon]) => <Button key={id} variant="ghost" aria-pressed={category === id} onClick={() => setCategory(id)}><Icon name={icon} size={16} /><span>{title}</span><small>{count(id)}</small></Button>)}</nav>
      <label className="today-catalog-mobile-category">Category<Select aria-label="Widget category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(([id, title]) => <option key={id} value={id}>{title} ({count(id)})</option>)}</Select></label>
      <div className="today-catalog-results">
        <div className="today-catalog-results-heading"><h3>{categories.find(([id]) => id === category)?.[1]}</h3><span role="status">{matches.length} available</span></div>
        {availableGroups.filter(([group]) => matches.some(m => categoryOf(m) === group)).map(([group, title]) => <section className="today-catalog-group" key={group} aria-label={title}>{category === 'all' && <h4>{title}</h4>}<div className="catalog-card-grid">{matches.filter(m => categoryOf(m) === group).map(m => <CatalogCard key={m.id} manifest={m} selected={selected === m.id} select={() => setSelected(selected === m.id ? null : m.id)} added={layout.widgets.some(item => item.id === m.id)} {...{ addWidget, removeWidget, openWidget, connections, connectSource }} />)}</div></section>)}
        {!matches.length && <div className="today-catalog-empty" role="status"><Icon name="search" size={24} /><strong>No matching widgets</strong><p>Try another name or category.</p><Button size="small" onClick={() => { setQuery(''); setCategory('all') }}>Clear filters</Button></div>}
      </div>
    </div>
    <footer className="today-catalog-footer"><Icon name="grid" size={14} /><span>{layout.widgets.filter(w => !SYSTEM_WIDGETS.includes(w.id)).length} widgets on Home</span></footer>
  </div>
}
