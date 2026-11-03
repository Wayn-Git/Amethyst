import { useId, useState } from 'react'
import { useDashboard } from './context.js'
import { SYSTEM_WIDGETS, WIDGET_ICONS, widgetTone, preferredWidgetSize } from './layout.js'
import { Button, Input, Select, Segmented, Chip, IconBadge } from '../components/ui/bento/index.jsx'
import Icon from '../components/Icon.jsx'
import WidgetFrame from './WidgetFrame.jsx'
import DesignCatalog from '../components/wigggle/DesignCatalog.jsx'
import { widgetVariations } from './widgetVariations.js'
import { gridSize } from './grid.js'
import './catalog.css'

const GROUPS = [['glance', 'Glance', 'clock'], ['needs-you', 'Needs you', 'mail'], ['communication', 'Communication', 'chat'], ['agent', 'Agent', 'sparkle'], ['library', 'Library', 'bookmark'], ['tasks', 'Tasks', 'tasks'], ['developer', 'Developer', 'branch'], ['student', 'Student', 'book'], ['feed', 'Feed', 'globe'], ['life', 'Life', 'sun'], ['system', 'System', 'settings'], ['proactive', 'Proactive', 'bell'], ['dashboard', 'Home', 'grid']]
const categoryOf = manifest => GROUPS.some(([group]) => group === manifest.group) ? manifest.group : 'system'
const sources = manifest => (Array.isArray(manifest.source) ? manifest.source : [manifest.source]).filter(Boolean)
const connectors = manifest => [...new Set([...(manifest.requires || []).filter(value => value.startsWith('connector:')).map(value => value.slice(10)), ...sources(manifest).filter(source => source.type === 'composio').map(source => source.toolkit).filter(Boolean)])]
const sourceNames = { googlecalendar: 'Google Calendar', gmail: 'Gmail', github: 'GitHub', slack: 'Slack' }

function CatalogCard({ manifest: m, added, currentSize, addWidget, removeWidget, openWidget, connections, connectSource, changeDesign, selected, select }) {
  const id = useId()
  const [selectedSize, setSelectedSize] = useState(() => preferredWidgetSize(m))
  const size = added ? currentSize : selectedSize
  const system = SYSTEM_WIDGETS.includes(m.id)
  const variations = m.group === 'glance' ? widgetVariations(m.id) : []
  const sizeOptions = m.sizes.filter(value => ['s', 'm', 'l'].includes(value))
  return <article className="today-catalog-row home-catalog-row" aria-label={m.title}>
    <Button variant="ghost" className="catalog-thumbnail ui-tile" data-tone={widgetTone(m.id)} data-preview-size={size} aria-label={`Choose ${m.title}`} aria-expanded={selected} aria-controls={id} onClick={select}>
      <IconBadge label={m.title}><Icon name={m.icon || WIDGET_ICONS[m.id] || 'grid'} size={20} /></IconBadge>
      <span className="catalog-widget-source">{sources(m).map(source => sourceNames[source.toolkit] || source.toolkit || source.type).join(' · ')}</span>
      <span className="catalog-preview-label">{selected ? 'Hide options' : 'Choose widget'}</span>
    </Button>
    <div className="today-catalog-copy"><h4>{m.title}</h4><p title={m.description || `View ${m.title.toLowerCase()}.`}>{m.description || `View ${m.title.toLowerCase()}.`}</p></div>
    {added && <span className="catalog-added"><Icon name="check-simple" size={14} />On Home</span>}
    <div id={id} hidden={!selected} className="catalog-options">
    {selected && variations.length > 0 && <section className="catalog-design-picker" aria-label={`${m.title} design previews`}>
      {!added && <Segmented aria-label={`Size for ${m.title}`} value={size} onValueChange={setSelectedSize} options={sizeOptions.map(value => ({ value, label: { s: 'Small', m: 'Medium', l: 'Large' }[value] }))} />}
      {added && <p className="catalog-size-note">Showing the current {size.toUpperCase()} size. Switching designs keeps this size.</p>}
      <div className="catalog-design-options" data-preview-size={size}>{variations.map(item => <article className="catalog-design-option" key={item.id} data-design={item.id} data-preview-size={size}>
        <strong>{item.name}</strong>
        <div className="catalog-live-preview bento-foundation widget-home" style={gridSize(size)} data-size={size} aria-label={`${m.title} ${item.name} ${size} preview`}><WidgetFrame manifest={m} size={size} design={item.id} preview /></div>
        <Button size="small" variant={added ? 'secondary' : 'primary'} onClick={() => added ? changeDesign?.(m.id, item.id) : addWidget(m.id, size, item.id)}><Icon name={added ? 'check-simple' : 'plus'} size={14} />{added ? `Use design · keeps ${size.toUpperCase()}` : `Add ${size.toUpperCase()} widget`}</Button>
      </article>)}</div>
    </section>}
    {selected && variations.length === 0 && <div className="catalog-live-preview bento-foundation widget-home" style={gridSize(size)} data-size={size} aria-label={`${m.title} ${size.toUpperCase()} preview`}><WidgetFrame manifest={m} size={size} preview /></div>}
    <div className="catalog-connectors">{connectors(m).map(source => <Chip key={source}><span>{sourceNames[source] || source}</span>{connections?.data?.items?.find(item => item.id === source)?.status === 'connected' ? <span>Connected</span> : <Button size="small" variant="ghost" onClick={() => connectSource(source)} aria-label={`Connect ${sourceNames[source] || source} for ${m.title}`}>Connect</Button>}</Chip>)}</div>
    <div className="catalog-card-actions">{variations.length === 0 && !added && <Segmented aria-label={`Size for ${m.title}`} value={size} onValueChange={setSelectedSize} options={m.sizes.map(value => ({ value, label: value.toUpperCase() }))} />}{system ? <Button size="small" onClick={() => openWidget(m.id)}>Open</Button> : added ? <div className="catalog-membership"><span><Icon name="check-simple" size={14} />On Home · {size.toUpperCase()}</span><Button size="small" variant="ghost" onClick={() => removeWidget(m.id)}>Remove</Button></div> : variations.length === 0 && <Button size="small" variant="primary" onClick={() => addWidget(m.id, size)}><Icon name="plus" size={14} />Add {size.toUpperCase()}</Button>}</div>
    </div>
  </article>
}

export default function AddWidget({ compact = false }) {
  const { manifests, layout, addWidget, removeWidget, openWidget, connections, connectSource, changeDesign } = useDashboard()
  const [tab, setTab] = useState('widgets')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [category, setCategory] = useState('all')
  const availableGroups = GROUPS.filter(([group]) => manifests.some(m => categoryOf(m) === group))
  const categories = [['all', 'All widgets', 'grid'], ...availableGroups]
  const count = id => id === 'all' ? manifests.length : manifests.filter(m => categoryOf(m) === id).length
  const matches = manifests.filter(m => (category === 'all' || categoryOf(m) === category) && `${m.title} ${m.id} ${m.group} ${m.description || ''} ${sources(m).map(source => source.toolkit || source.type).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className={`today-catalog${compact ? ' is-compact' : ''}`}>
    <div className="wigggle-catalog-tabs" role="group" aria-label="Widget catalogue"><Button aria-pressed={tab === 'widgets'} onClick={() => setTab('widgets')}>Home widgets</Button><Button aria-pressed={tab === 'designs'} onClick={() => setTab('designs')}>Wigggle designs <span>92</span></Button></div>
    {tab === 'designs' ? <DesignCatalog /> : <>
    <div className="today-catalog-search"><Icon name="search" size={18} /><Input type="search" aria-label="Search widgets" placeholder="Search widgets…" value={query} onChange={event => setQuery(event.target.value)} />{query && <Button size="small" variant="ghost" onClick={() => setQuery('')} aria-label="Clear widget search"><Icon name="x" size={14} /></Button>}</div>
    <div className="today-catalog-browser">
      <nav className="today-catalog-categories" aria-label="Widget categories">{categories.map(([id, title, icon]) => <Button key={id} variant="ghost" aria-pressed={category === id} onClick={() => setCategory(id)}><Icon name={icon} size={16} /><span>{title}</span><small>{count(id)}</small></Button>)}</nav>
      <label className="today-catalog-mobile-category">Category<Select aria-label="Widget category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(([id, title]) => <option key={id} value={id}>{title} ({count(id)})</option>)}</Select></label>
      <div className="today-catalog-results">
        <div className="today-catalog-results-heading"><h3>{categories.find(([id]) => id === category)?.[1]}</h3><span role="status">{matches.length} available</span></div>
        {availableGroups.filter(([group]) => matches.some(m => categoryOf(m) === group)).map(([group, title]) => <section className="today-catalog-group" key={group} aria-label={title}>{category === 'all' && <h4>{title}</h4>}<div className="catalog-card-grid">{matches.filter(m => categoryOf(m) === group).map(m => { const placement = layout.widgets.find(item => item.id === m.id); return <CatalogCard key={m.id} manifest={m} selected={selected === m.id} select={() => setSelected(selected === m.id ? null : m.id)} added={Boolean(placement)} currentSize={placement?.size} {...{ addWidget, removeWidget, openWidget, connections, connectSource, changeDesign }} /> })}</div></section>)}
        {!matches.length && <div className="today-catalog-empty" role="status"><Icon name="search" size={24} /><strong>No matching widgets</strong><p>Try another name or category.</p><Button size="small" onClick={() => { setQuery(''); setCategory('all') }}>Clear filters</Button></div>}
      </div>
    </div>
    </>}
    <footer className="today-catalog-footer"><Icon name="grid" size={14} /><span>{layout.widgets.filter(w => !SYSTEM_WIDGETS.includes(w.id)).length} widgets on Home</span></footer>
  </div>
}
