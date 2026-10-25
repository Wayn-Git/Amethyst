import { useMemo, useState } from 'react'
import { WidgetChip, StateView } from '../primitives.jsx'
import { useDashboard } from '../context.js'
import { SYSTEM_WIDGETS } from '../layout.js'
import Icon from '../../components/Icon.jsx'
import WidgetFrame from '../WidgetFrame.jsx'

const CATEGORIES = [
  ['all', 'All widgets', 'grid'],
  ['glance', 'Glance', 'clock'],
  ['tasks', 'Tasks', 'tasks'],
  ['needs-you', 'Needs', 'mail'],
  ['agent', 'Agent', 'sparkle'],
  ['developer', 'Developer', 'github'],
  ['communication', 'Messages', 'chat'],
  ['library', 'Library', 'bookmark'],
  ['feed', 'Feeds', 'globe'],
  ['system', 'System', 'settings'],
]

const ICONS = {
  'glance.clock': 'clock',
  'glance.weather': 'cloud',
  'glance.next-event': 'calendar',
  'glance.music': 'music',
  agent: 'sparkle',
  task: 'tasks',
  dev: 'github',
  lib: 'bookmark',
  feed: 'globe',
  sys: 'settings',
  need: 'mail',
  comm: 'mail',
}

const SYSTEM_GROUPS = ['dashboard', 'system', 'student', 'life', 'proactive']

function groupOf(manifest) {
  return SYSTEM_GROUPS.includes(manifest.group) ? 'system' : manifest.group
}

function sourceOf(manifest) {
  return (Array.isArray(manifest.source) ? manifest.source : [manifest.source])
    .map(source => source?.toolkit || source?.type || 'local')
    .join(', ')
}

function cadenceOf(manifest) {
  if (manifest.refresh?.mode !== 'poll') return manifest.refresh?.mode || 'manual'
  const seconds = manifest.refresh.interval_s
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`
}

function defaultSize(manifest) {
  return manifest.sizes.includes('m') ? 'm' : manifest.sizes[0] || 's'
}

function iconOf(manifest) {
  return ICONS[manifest.id] || ICONS[manifest.id.split('.')[0]] || 'grid'
}

function SearchField({ value, onChange }) {
  return (
    <label className="studio-search" htmlFor="gallery-search-input">
      <Icon name="search" size={14} className="studio-search-icon" />
      <input
        id="gallery-search-input"
        type="search"
        aria-label="Search widgets"
        className="studio-search-input"
        placeholder="Search widgets"
        value={value}
        onChange={event => onChange(event.target.value)}
        autoComplete="off"
      />
      {value && (
        <button type="button" className="studio-search-clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={12} />
        </button>
      )}
    </label>
  )
}

export default function Gallery({ compact = false }) {
  const { manifests, layout, toggleWidget, addWidget, openWidget } = useDashboard()
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [widgetSizes, setWidgetSizes] = useState({})
  const [selectedId, setSelectedId] = useState(null)

  const query = search.trim().toLowerCase()
  const added = id => (layout?.widgets || []).some(widget => widget.id === id)

  const matches = useMemo(() => manifests.filter(manifest => {
    const text = `${manifest.title} ${manifest.id} ${manifest.group} ${sourceOf(manifest)}`.toLowerCase()
    return (!query || text.includes(query)) && (selectedCategory === 'all' || groupOf(manifest) === selectedCategory)
  }), [manifests, query, selectedCategory])

  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map(([id]) => [
    id,
    id === 'all' ? manifests.length : manifests.filter(manifest => groupOf(manifest) === id).length,
  ])), [manifests])

  const active = matches.find(manifest => manifest.id === selectedId) || matches[0] || null
  const activeSize = active ? widgetSizes[active.id] || defaultSize(active) : 'm'
  const activeAdded = active ? added(active.id) : false
  const activeSystem = active ? SYSTEM_WIDGETS.includes(active.id) : false

  function handleAdd(manifest, size) {
    if (addWidget) addWidget(manifest.id, size)
    else toggleWidget(manifest.id)
  }

  if (compact) {
    return (
      <div className="gallery-compact">
        <SearchField value={search} onChange={setSearch} />
        <div className="gallery-compact-list">
          {!matches.length && <StateView role="status" className="gallery-empty">No matching widgets found.</StateView>}
          {matches.map(manifest => {
            const isAdded = added(manifest.id)
            const system = SYSTEM_WIDGETS.includes(manifest.id)
            return (
              <div className="gallery-compact-row" key={manifest.id}>
                <span className="gallery-compact-icon"><Icon name={iconOf(manifest)} size={14} /></span>
                <span className="gallery-compact-copy">
                  <strong>{manifest.title}</strong>
                  <small>{sourceOf(manifest)} · {cadenceOf(manifest)}</small>
                </span>
                <button
                  type="button"
                  disabled={!system && isAdded}
                  onClick={() => system ? openWidget(manifest.id) : isAdded ? toggleWidget(manifest.id) : handleAdd(manifest, defaultSize(manifest))}
                >
                  {system ? 'Open' : isAdded ? 'Added' : 'Add'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="gallery-studio">
      <aside className="studio-rail" aria-label="Widget categories">
        <SearchField value={search} onChange={setSearch} />
        <nav className="studio-categories">
          {CATEGORIES.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              className={`studio-category${selectedCategory === id ? ' is-active' : ''}`}
              onClick={() => setSelectedCategory(id)}
              aria-pressed={selectedCategory === id}
            >
              <Icon name={icon} size={14} />
              <span>{label}</span>
              <span className="studio-category-count">{counts[id]}</span>
            </button>
          ))}
        </nav>
        <p className="studio-rail-count">{matches.length} of {manifests.length} widgets</p>
      </aside>

      <section className="studio-browser" aria-label="Widgets">
        <header className="studio-browser-head">
          <strong>{CATEGORIES.find(([id]) => id === selectedCategory)?.[1]}</strong>
          <span>{matches.length}</span>
        </header>
        <div className="studio-browser-list">
          {!matches.length && <StateView role="status" className="gallery-empty">No matching widgets found.</StateView>}
          {CATEGORIES.filter(([id]) => id !== 'all' && (selectedCategory === 'all' || selectedCategory === id)).map(([category, title]) => {
            const rows = matches.filter(manifest => groupOf(manifest) === category)
            if (!rows.length) return null
            return (
              <section className="studio-group" key={category} aria-label={title}>
                <h3 className="studio-group-title">{title}</h3>
                {rows.map(manifest => {
                  const isAdded = added(manifest.id)
                  return (
                    <button
                      key={manifest.id}
                      type="button"
                      className={`studio-item${active?.id === manifest.id ? ' is-active' : ''}`}
                      onClick={() => setSelectedId(manifest.id)}
                      aria-pressed={active?.id === manifest.id}
                    >
                      <span className="studio-item-icon"><Icon name={iconOf(manifest)} size={14} /></span>
                      <span className="studio-item-copy">
                        <strong>{manifest.title}</strong>
                        <small>{sourceOf(manifest)} · {cadenceOf(manifest)}</small>
                      </span>
                      {isAdded && <span className="studio-item-added" title="On Home"><Icon name="check-simple" size={12} /></span>}
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      </section>

      <aside className="studio-preview" aria-label="Widget preview">
        {active ? (
          <>
            <header className="studio-preview-head">
              <div>
                <span className="studio-kicker">{CATEGORIES.find(([id]) => id === groupOf(active))?.[1] || 'Widget'}</span>
                <h3>{active.title}</h3>
                <p>{sourceOf(active)} · {cadenceOf(active)}</p>
              </div>
              <WidgetChip className={`studio-state${activeAdded ? ' is-added' : ''}`}>{activeAdded ? 'On Home' : 'Available'}</WidgetChip>
            </header>
            <div className="studio-stage" data-size={activeSize}>
              <WidgetFrame
                manifest={active}
                position={{ id: active.id, size: activeSize, height: activeSize === 's' ? 3 : activeSize === 'l' ? 4 : 3 }}
                preview={true}
                onData={() => {}}
              />
            </div>
            <div className="studio-sizes" role="group" aria-label={`Size choices for ${active.title}`}>
              <span>Size</span>
              <div className="studio-size-pills">
                {['s', 'm', 'l'].map(sizeKey => (
                  <button
                    key={sizeKey}
                    type="button"
                    className={`studio-size-pill${activeSize === sizeKey ? ' is-active' : ''}`}
                    onClick={() => setWidgetSizes(previous => ({ ...previous, [active.id]: sizeKey }))}
                    disabled={!active.sizes.includes(sizeKey)}
                    aria-label={`Size ${sizeKey.toUpperCase()} for ${active.title}`}
                  >
                    {sizeKey.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <footer className="studio-preview-foot">
              <span>{active.sizes.map(size => size.toUpperCase()).join(' · ')}</span>
              <button
                type="button"
                className="studio-add"
                disabled={!activeSystem && activeAdded}
                aria-label={activeSystem ? `Open ${active.title}` : activeAdded ? `Added ${active.title}` : `Add ${active.title}`}
                onClick={() => activeSystem ? openWidget(active.id) : handleAdd(active, activeSize)}
              >
                <Icon name={activeAdded && !activeSystem ? 'check-simple' : 'plus'} size={13} />
                <span>{activeSystem ? 'Open settings' : activeAdded ? 'Added' : 'Add to Home'}</span>
              </button>
            </footer>
          </>
        ) : (
          <div className="studio-preview-empty">
            <Icon name="grid" size={24} />
            <p>Select a widget to preview it.</p>
          </div>
        )}
      </aside>
    </div>
  )
}
