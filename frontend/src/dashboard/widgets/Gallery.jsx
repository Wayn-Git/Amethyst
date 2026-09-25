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

export default function Gallery({ compact = false }) {
  const { manifests, layout, toggleWidget, addWidget, openWidget } = useDashboard()
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedId, setSelectedId] = useState(() => manifests[0]?.id || 'glance.clock')
  const [selectedSize, setSelectedSize] = useState('m')

  const query = search.trim().toLowerCase()

  // Match filtering
  const matches = useMemo(() => {
    return manifests.filter(m => {
      const text = `${m.title} ${m.id} ${m.group} ${Array.isArray(m.source) ? m.source.map(s => s.toolkit || s.type).join(' ') : m.source?.toolkit || m.source?.type || ''}`.toLowerCase()
      const matchesSearch = !query || text.includes(query)
      const mappedGroup = ['dashboard', 'system', 'student', 'life', 'proactive'].includes(m.group) ? 'system' : m.group
      const matchesCat = selectedCategory === 'all' || mappedGroup === selectedCategory
      return matchesSearch && matchesCat
    })
  }, [manifests, query, selectedCategory])

  // Current active preview manifest
  const selectedManifest = manifests.find(m => m.id === selectedId) || matches[0] || manifests[0]

  // Adjust preview size if selected manifest doesn't support it
  const effectiveSize = selectedManifest?.sizes?.includes(selectedSize)
    ? selectedSize
    : selectedManifest?.sizes?.includes('m')
      ? 'm'
      : selectedManifest?.sizes?.[0] || 'm'

  const isSystem = selectedManifest && SYSTEM_WIDGETS.includes(selectedManifest.id)
  const isAdded = selectedManifest && (layout?.widgets || []).some(w => w.id === selectedManifest.id)

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
        <>
          {/* Category Pills Bar */}
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

          {/* Live Interactive Preview Stage */}
          {selectedManifest && (
            <section className="gallery-stage-card" aria-label={`Live preview of ${selectedManifest.title}`}>
              <div className="gallery-stage-header">
                <div className="gallery-stage-info">
                  <span className="widget-heading-icon">
                    <Icon name={ICONS[selectedManifest.id] || ICONS[selectedManifest.id.split('.')[0]] || 'grid'} size={20} />
                  </span>
                  <div>
                    <div className="gallery-stage-title-wrap">
                      <h3>{selectedManifest.title}</h3>
                      <WidgetChip className="bento-badge">{selectedManifest.group}</WidgetChip>
                    </div>
                    <p className="gallery-stage-sub">
                      {(Array.isArray(selectedManifest.source) ? selectedManifest.source : [selectedManifest.source]).map(s => s.toolkit || s.type).join(', ')} · {selectedManifest.refresh.mode === 'poll' ? `Refreshes every ${selectedManifest.refresh.interval_s < 60 ? `${selectedManifest.refresh.interval_s}s` : `${Math.round(selectedManifest.refresh.interval_s / 60)}m`}` : `${selectedManifest.refresh.mode} refresh`}
                    </p>
                  </div>
                </div>

                {/* Variant Switcher */}
                <div className="gallery-variant-selector" role="group" aria-label="Widget size options">
                  {['s', 'm', 'l'].map(sizeKey => {
                    const isSupported = selectedManifest.sizes.includes(sizeKey)
                    const label = sizeKey === 's' ? 'Small' : sizeKey === 'm' ? 'Medium' : 'Large'
                    return (
                      <button
                        key={sizeKey}
                        type="button"
                        disabled={!isSupported}
                        className={`gallery-size-btn${effectiveSize === sizeKey ? ' is-active' : ''}`}
                        onClick={() => setSelectedSize(sizeKey)}
                        aria-label={`Size ${label} for ${selectedManifest.title}`}
                        title={isSupported ? `${label} (${sizeKey.toUpperCase()})` : `Not supported in this size`}
                      >
                        {sizeKey.toUpperCase()}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Live Preview Stage Body */}
              <div className="gallery-stage-body">
                <div className="gallery-preview-wrapper" data-size={effectiveSize}>
                  <WidgetFrame
                    manifest={selectedManifest}
                    position={{ id: selectedManifest.id, size: effectiveSize, height: effectiveSize === 's' ? 3 : effectiveSize === 'l' ? 4 : 3 }}
                    tile={selectedManifest.group === 'glance'}
                    preview={true}
                    onData={() => {}}
                  />
                </div>
              </div>

              {/* Stage Actions */}
              <div className="gallery-stage-footer">
                <span className="gallery-stage-hint">
                  {effectiveSize === 's' ? 'Compact 3-column tile — ideal for quick metrics.' : effectiveSize === 'm' ? 'Balanced 6-column card — ideal for standard lists.' : 'Expanded 12-column bento span — ideal for high-density streams.'}
                </span>
                <button
                  type="button"
                  disabled={!isSystem && isAdded}
                  className={`gallery-primary-add-btn${isAdded && !isSystem ? ' is-added' : ' home-primary'}`}
                  aria-label={isSystem ? 'Open Settings' : isAdded ? 'Already on Dashboard' : 'Add to Dashboard'}
                  onClick={() => isSystem ? openWidget(selectedManifest.id) : handleAddWidget(selectedManifest.id, effectiveSize)}
                >
                  <Icon name={isAdded && !isSystem ? 'check-simple' : 'plus'} size={18} />
                  <span>{isSystem ? 'Open Settings' : isAdded ? 'Already on Dashboard' : 'Add to Dashboard'}</span>
                </button>
              </div>
            </section>
          )}
        </>
      )}

      {/* Catalog Grid / Categorized List */}
      <div className="gallery-catalog-section">
        {!matches.length && <StateView role="status" className="gallery-empty">No matching widgets found.</StateView>}

        {CATEGORIES.filter(([cat]) => selectedCategory === 'all' || selectedCategory === cat).map(([category, title]) => {
          if (category === 'all') return null
          const rows = matches.filter(m => (['dashboard', 'system', 'student', 'life', 'proactive'].includes(m.group) ? 'system' : m.group) === category)
          if (!rows.length) return null

          return (
            <section key={category} className="gallery-category-group" aria-label={title}>
              <h3 className="home-section-label">{title}</h3>
              <div className="gallery-items-grid">
                {rows.map(m => {
                  const system = SYSTEM_WIDGETS.includes(m.id)
                  const added = (layout?.widgets || []).some(w => w.id === m.id)
                  const source = (Array.isArray(m.source) ? m.source : [m.source]).map(s => s.toolkit || s.type).join(', ')
                  const isSelected = selectedManifest?.id === m.id

                  return (
                    <div
                      key={m.id}
                      className={`gallery-item-card${isSelected ? ' is-selected' : ''}`}
                      onClick={() => {
                        setSelectedId(m.id)
                        if (!m.sizes.includes(selectedSize)) {
                          setSelectedSize(m.sizes.includes('m') ? 'm' : m.sizes[0] || 's')
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedId(m.id)
                        }
                      }}
                    >
                      <div className="gallery-item-header">
                        <span className="widget-heading-icon">
                          <Icon name={ICONS[m.id] || ICONS[m.id.split('.')[0]] || 'grid'} size={18} />
                        </span>
                        <div className="gallery-item-title-wrap">
                          <strong>{m.title}</strong>
                          <span className="gallery-item-source">{source}</span>
                        </div>
                      </div>

                      <div className="gallery-item-tags">
                        {m.sizes.map(s => (
                          <span key={s} className="gallery-size-chip">{s.toUpperCase()}</span>
                        ))}
                      </div>

                      <div className="gallery-item-action">
                        <button
                          type="button"
                          disabled={!system && added}
                          aria-label={`${system ? 'Open' : added ? 'Added' : 'Add'} ${m.title}`}
                          onClick={e => {
                            e.stopPropagation()
                            if (system) {
                              openWidget(m.id)
                            } else {
                              toggleWidget(m.id)
                            }
                          }}
                        >
                          {system ? 'Open' : added ? 'Added' : 'Add'}
                        </button>
                      </div>
                    </div>
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
