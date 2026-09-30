import { WidgetChip, StateView } from '../primitives.jsx'
import { useState, useMemo } from 'react'
import { useDashboard } from '../context.js'
import { SYSTEM_WIDGETS } from '../layout.js'
import Icon from '../../components/Icon.jsx'
import WidgetFrame from '../WidgetFrame.jsx'

const CATEGORIES = [
  ['all', 'All Widgets', 'grid'],
  ['glance', 'Glance', 'clock'],
  ['tasks', 'Tasks', 'tasks'],
  ['needs-you', 'Needs Attention', 'mail'],
  ['agent', 'Intelligence', 'sparkle'],
  ['developer', 'Developer', 'github'],
  ['communication', 'Communication', 'chat'],
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

const CATEGORY_COLORS = {
  glance: 'var(--accent, #6366f1)',
  tasks: '#059669',
  'needs-you': '#ea580c',
  agent: '#7c3aed',
  developer: '#0284c7',
  communication: '#e11d48',
  library: '#0d9488',
  feed: '#2563eb',
  system: '#64748b',
}

export default function Gallery({ compact = false }) {
  const { manifests, layout, toggleWidget, addWidget, openWidget } = useDashboard()
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [widgetSizes, setWidgetSizes] = useState({})
  const [previewId, setPreviewId] = useState(null)

  const query = search.trim().toLowerCase()

  const matches = useMemo(() => {
    return manifests.filter(m => {
      const text = `${m.title} ${m.id} ${m.group} ${Array.isArray(m.source) ? m.source.map(s => s.toolkit || s.type).join(' ') : m.source?.toolkit || m.source?.type || ''}`.toLowerCase()
      const matchesSearch = !query || text.includes(query)
      const mappedGroup = ['dashboard', 'system', 'student', 'life', 'proactive'].includes(m.group) ? 'system' : m.group
      const matchesCat = selectedCategory === 'all' || mappedGroup === selectedCategory
      return matchesSearch && matchesCat
    })
  }, [manifests, query, selectedCategory])

  const handleAddWidget = (id, size) => {
    if (addWidget) {
      addWidget(id, size)
    } else {
      toggleWidget(id)
    }
  }

  return (
    <div className={`gallery-container${compact ? ' is-compact' : ''}`}>
      {/* Search Header */}
      <div className="gallery-header-row">
        <label className="gallery-search" htmlFor="gallery-search-input">
          <span className="gallery-search-title">Search widgets</span>
          <div className="gallery-search-field">
            <Icon name="search" size={17} className="gallery-search-icon" />
            <input
              id="gallery-search-input"
              type="search"
              aria-label="Search widgets"
              className="gallery-search-input"
              placeholder="Search widgets by name, group, or source…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoComplete="off"
            />
            {search && (
              <button
                type="button"
                className="gallery-search-clear-btn"
                onClick={() => setSearch('')}
                aria-label="Clear search"
              >
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
        </label>
      </div>

      {!compact && (
        <nav className="gallery-category-bar" aria-label="Widget Categories">
          {CATEGORIES.map(([catId, catLabel, catIcon]) => {
            const count = catId === 'all'
              ? manifests.length
              : manifests.filter(m => (['dashboard', 'system', 'student', 'life', 'proactive'].includes(m.group) ? 'system' : m.group) === catId).length
            return (
              <button
                key={catId}
                type="button"
                className={`gallery-cat-pill${selectedCategory === catId ? ' is-active' : ''}`}
                onClick={() => setSelectedCategory(catId)}
                aria-pressed={selectedCategory === catId}
              >
                <Icon name={catIcon} size={15} />
                <span className="gallery-cat-text">{catLabel}</span>
                <span className="gallery-cat-count">{count}</span>
              </button>
            )
          })}
        </nav>
      )}

      {/* Catalog Grid / Categorized List */}
      <div className="gallery-catalog-section">
        {!matches.length && <StateView role="status" className="gallery-empty">No matching widgets found.</StateView>}

        {CATEGORIES.filter(([cat]) => selectedCategory === 'all' || selectedCategory === cat).map(([category, catTitle]) => {
          if (category === 'all') return null
          const rows = matches.filter(m => (['dashboard', 'system', 'student', 'life', 'proactive'].includes(m.group) ? 'system' : m.group) === category)
          if (!rows.length) return null

          return (
            <section key={category} className="gallery-category-group" aria-label={catTitle}>
              <h3 className="home-section-label">{catTitle}</h3>
              <div className="gallery-items-grid">
                {rows.map(m => {
                  const system = SYSTEM_WIDGETS.includes(m.id)
                  const isAdded = (layout?.widgets || []).some(w => w.id === m.id)
                  const source = (Array.isArray(m.source) ? m.source : [m.source]).map(s => s.toolkit || s.type).join(', ')
                  const effectiveSize = widgetSizes[m.id] || (m.sizes.includes('m') ? 'm' : m.sizes[0] || 's')
                  const isPreviewOpen = previewId === m.id
                  const catColor = CATEGORY_COLORS[category] || 'var(--accent)'

                  return (
                    <article
                      key={m.id}
                      className={`gallery-item-card${isAdded ? ' is-added-card' : ''}`}
                      data-widget={m.id}
                    >
                      <div className="gallery-card-main-row">
                        <div className="gallery-card-identity">
                          <span className="gallery-card-icon" style={{ '--icon-cat-color': catColor }}>
                            <Icon name={ICONS[m.id] || ICONS[m.id.split('.')[0]] || 'grid'} size={18} />
                          </span>
                          <div className="gallery-card-heading">
                            <div className="gallery-title-row">
                              <strong className="gallery-card-title">{m.title}</strong>
                              <WidgetChip className="bento-badge">{m.group}</WidgetChip>
                            </div>
                            <span className="gallery-card-sub">
                              {source || 'local'} · {m.refresh?.mode === 'poll' ? `${m.refresh?.interval_s < 60 ? `${m.refresh.interval_s}s` : `${Math.round(m.refresh.interval_s / 60)}m`}` : `${m.refresh?.mode || 'manual'}`}
                            </span>
                          </div>
                        </div>

                        <div className="gallery-card-controls">
                          <div className="gallery-card-sizes" role="group" aria-label={`Size choices for ${m.title}`}>
                            <span className="gallery-size-label">Size:</span>
                            <div className="gallery-size-pills">
                              {['s', 'm', 'l'].map(sizeKey => {
                                const isSupported = m.sizes.includes(sizeKey)
                                if (!isSupported) return null
                                return (
                                  <button
                                    key={sizeKey}
                                    type="button"
                                    className={`gallery-size-pill${effectiveSize === sizeKey ? ' is-active' : ''}`}
                                    onClick={() => setWidgetSizes(prev => ({ ...prev, [m.id]: sizeKey }))}
                                    aria-label={`Size ${sizeKey.toUpperCase()} for ${m.title}`}
                                  >
                                    {sizeKey.toUpperCase()}
                                  </button>
                                )
                              })}
                            </div>
                            {!compact && (
                              <button
                                type="button"
                                className="gallery-preview-toggle-btn"
                                onClick={() => setPreviewId(isPreviewOpen ? null : m.id)}
                                aria-label={`${isPreviewOpen ? 'Hide' : 'Preview'} ${m.title}`}
                              >
                                <Icon name={isPreviewOpen ? 'x' : 'sparkle'} size={13} />
                                <span>{isPreviewOpen ? 'Close' : 'Preview'}</span>
                              </button>
                            )}
                          </div>

                          <div className="gallery-card-action">
                            <button
                              type="button"
                              disabled={!system && isAdded}
                              className={`gallery-primary-add-btn${isAdded && !system ? ' is-added' : ' home-primary'}`}
                              aria-label={`${system ? 'Open' : isAdded ? 'Added' : 'Add'} ${m.title}`}
                              onClick={() => {
                                if (system) {
                                  openWidget(m.id)
                                } else {
                                  handleAddWidget(m.id, effectiveSize)
                                }
                              }}
                            >
                              <Icon name={isAdded && !system ? 'check-simple' : 'plus'} size={15} />
                              <span>{system ? `Open ${m.title}` : isAdded ? `Added ${m.title}` : `Add ${m.title}`}</span>
                            </button>
                          </div>
                        </div>
                      </div>

                      {isPreviewOpen && (
                        <div className="gallery-card-inline-preview" data-size={effectiveSize}>
                          <WidgetFrame
                            manifest={m}
                            position={{ id: m.id, size: effectiveSize, height: effectiveSize === 's' ? 3 : effectiveSize === 'l' ? 4 : 3 }}
                            tile={m.group === 'glance'}
                            preview={true}
                            onData={() => {}}
                          />
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
