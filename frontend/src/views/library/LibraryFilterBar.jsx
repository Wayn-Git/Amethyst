import { useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { KIND_ICON } from './LibraryCard.jsx'
import { useDismiss } from '../../hooks/useDismiss.js'

const PLATFORMS_META = [
  { id: 'youtube', label: 'YouTube', icon: 'play' },
  { id: 'instagram', label: 'Instagram', icon: 'spark' },
  { id: 'spotify', label: 'Spotify', icon: 'music' },
  { id: 'pinterest', label: 'Pinterest', icon: 'pin' },
  { id: 'github', label: 'GitHub', icon: 'code' },
  { id: 'x', label: 'X (Twitter)', icon: 'chat' },
  { id: 'reddit', label: 'Reddit', icon: 'chat' },
]

export default function LibraryFilterBar({
  total = 0,
  counts = {},
  categoryCounts = {},
  tagCounts = {},
  appCounts = {},
  ratingCounts = {},
  selectedKind = '',
  selectedCategory = '',
  selectedTag = '',
  selectedRating = '',
  query = '',
  onSelectKind,
  onSelectCategory,
  onSelectTag,
  onSelectRating,
  onClearQuery,
  onClearFilters,
  isOpen = true,
}) {
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [platformMenuOpen, setPlatformMenuOpen] = useState(false)
  const [ratingMenuOpen, setRatingMenuOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

  const categoryRef = useRef(null)
  const tagRef = useRef(null)
  const platformRef = useRef(null)
  const ratingRef = useRef(null)

  useDismiss(categoryRef, categoryMenuOpen, {
    onAway: () => setCategoryMenuOpen(false),
    onEscape: () => setCategoryMenuOpen(false),
  })

  useDismiss(tagRef, tagMenuOpen, {
    onAway: () => setTagMenuOpen(false),
    onEscape: () => setTagMenuOpen(false),
  })

  useDismiss(platformRef, platformMenuOpen, {
    onAway: () => setPlatformMenuOpen(false),
    onEscape: () => setPlatformMenuOpen(false),
  })

  useDismiss(ratingRef, ratingMenuOpen, {
    onAway: () => setRatingMenuOpen(false),
    onEscape: () => setRatingMenuOpen(false),
  })

  // Format kinds list (filter out zero counts, sorted by frequency)
  const activeKinds = useMemo(() => {
    return Object.entries(counts)
      .filter(([kind, count]) => count > 0 && kind !== 'total')
      .sort((a, b) => b[1] - a[1])
  }, [counts])

  // Active platforms list
  const activeApps = useMemo(() => {
    const list = []
    for (const app of PLATFORMS_META) {
      const count = appCounts[app.id] || tagCounts[app.id] || 0
      if (count > 0) {
        list.push({ ...app, count })
      }
    }
    return list
  }, [appCounts, tagCounts])

  // Categories list
  const categoriesList = useMemo(() => {
    return Object.entries(categoryCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
  }, [categoryCounts])

  // Filtered tags for tag popover
  const allTagEntries = useMemo(() => {
    return Object.entries(tagCounts)
      .filter(([tag]) => !PLATFORMS_META.some((p) => p.id === tag))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [tagCounts])

  const filteredTags = useMemo(() => {
    if (!tagQuery.trim()) return allTagEntries.slice(0, 30)
    const q = tagQuery.toLowerCase().trim()
    return allTagEntries.filter(([tag]) => tag.toLowerCase().includes(q)).slice(0, 30)
  }, [allTagEntries, tagQuery])

  // Check which platform is currently active (if any)
  const activePlatform = useMemo(() => {
    return PLATFORMS_META.find((p) => p.id === selectedTag)
  }, [selectedTag])

  const hasFilter = Boolean(
    selectedKind || selectedCategory || selectedTag || selectedRating || query
  )

  if (!isOpen) return null

  return (
    <div className="lib-filter-nav w-full flex flex-col gap-2 pb-1" data-enter>
      {/* Tier 1: Primary Segmented Type Tabs & Secondary Dimension Menus */}
      <div className="lib-filter-controls-row flex items-center justify-between gap-3 w-full flex-wrap">
        {/* Left: Segmented Format Tabs (Linear-style) */}
        <div className="lib-segmented-tabs" role="tablist" aria-label="Media format filters">
          {/* All tab */}
          <button
            type="button"
            className={`lib-tab-btn ${!selectedKind ? 'lib-tab-btn--active' : ''}`}
            onClick={() => onSelectKind?.('')}
            role="tab"
            aria-selected={!selectedKind}
          >
            <Icon name="grid" size={13} />
            <span>All</span>
            <span className="lib-tab-count">{total}</span>
          </button>

          {/* Individual Kind Tabs (Articles, Videos, Notes, etc.) */}
          {activeKinds.map(([kind, count]) => {
            const isActive = selectedKind === kind
            const label =
              kind === 'article'
                ? 'Articles'
                : kind === 'video'
                ? 'Videos'
                : kind === 'note'
                ? 'Notes'
                : `${kind}s`

            return (
              <button
                key={kind}
                type="button"
                className={`lib-tab-btn ${isActive ? 'lib-tab-btn--active' : ''}`}
                onClick={() => onSelectKind?.(isActive ? '' : kind)}
                role="tab"
                aria-selected={isActive}
              >
                <Icon name={KIND_ICON[kind] || 'link'} size={13} />
                <span className="capitalize">{label}</span>
                <span className="lib-tab-count">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Right: Secondary Dimension Popovers & Curated Ratings */}
        <div className="lib-filter-secondary-group flex items-center gap-1.5 flex-wrap">
          {/* Curated Significance Pills */}
          {ratingCounts['5'] > 0 && (
            <button
              type="button"
              className={`lib-filter-curated-pill ${selectedRating === '5' ? 'lib-filter-curated-pill--active' : ''}`}
              onClick={() => onSelectRating?.(selectedRating === '5' ? '' : '5')}
              title="Curator Tier: 5★ Essential Reference"
            >
              <Icon name="star" size={12} filled={selectedRating === '5'} className="text-amber-400" />
              <span>Essential</span>
              <span className="lib-pill-count">{ratingCounts['5'] || 0}</span>
            </button>
          )}

          {ratingCounts['4+'] > 0 && (
            <button
              type="button"
              className={`lib-filter-curated-pill ${selectedRating === '4+' ? 'lib-filter-curated-pill--active' : ''}`}
              onClick={() => onSelectRating?.(selectedRating === '4+' ? '' : '4+')}
              title="Curator Tier: 4★+ High Impact Knowledge"
            >
              <Icon name="star" size={12} filled={selectedRating === '4+'} className="text-amber-400" />
              <span>High Impact</span>
              <span className="lib-pill-count">{ratingCounts['4+'] || 0}</span>
            </button>
          )}

          {/* Divider between curated ratings and dropdowns */}
          {(ratingCounts['5'] > 0 || ratingCounts['4+'] > 0) && (
            <span className="lib-filter-divider" aria-hidden="true" />
          )}

          {/* Platform / Source Dropdown */}
          {activeApps.length > 0 && (
            <div className="relative" ref={platformRef}>
              <button
                type="button"
                className={`lib-filter-menu-btn ${activePlatform ? 'lib-filter-menu-btn--active' : ''}`}
                onClick={() => {
                  setPlatformMenuOpen((prev) => !prev)
                  setCategoryMenuOpen(false)
                  setTagMenuOpen(false)
                  setRatingMenuOpen(false)
                }}
                aria-expanded={platformMenuOpen}
                aria-label="Filter by source platform"
              >
                <Icon name={activePlatform ? activePlatform.icon : 'globe'} size={12} />
                <span>{activePlatform ? activePlatform.label : 'Sources'}</span>
                <Icon name="down" size={11} className="opacity-60" />
              </button>

              {platformMenuOpen && (
                <div className="lib-dropdown-menu">
                  <div className="lib-dropdown-header">
                    <span>Source Platforms</span>
                    {activePlatform && (
                      <button
                        type="button"
                        className="lib-dropdown-clear"
                        onClick={() => {
                          onSelectTag?.('')
                          setPlatformMenuOpen(false)
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="lib-dropdown-list">
                    {activeApps.map((app) => (
                      <button
                        key={app.id}
                        type="button"
                        className={`lib-dropdown-item ${selectedTag === app.id ? 'is-active' : ''}`}
                        onClick={() => {
                          onSelectTag?.(selectedTag === app.id ? '' : app.id)
                          setPlatformMenuOpen(false)
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Icon name={app.icon} size={13} />
                          <span>{app.label}</span>
                        </div>
                        <span className="lib-dropdown-count">{app.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Category Dropdown */}
          {categoriesList.length > 0 && (
            <div className="relative" ref={categoryRef}>
              <button
                type="button"
                className={`lib-filter-menu-btn ${selectedCategory ? 'lib-filter-menu-btn--active' : ''}`}
                onClick={() => {
                  setCategoryMenuOpen((prev) => !prev)
                  setTagMenuOpen(false)
                  setRatingMenuOpen(false)
                  setPlatformMenuOpen(false)
                }}
                aria-expanded={categoryMenuOpen}
                aria-label="Filter by category"
              >
                <Icon name="tag" size={12} />
                <span>{selectedCategory ? `Category: ${selectedCategory}` : 'Categories'}</span>
                <Icon name="down" size={11} className="opacity-60" />
              </button>

              {categoryMenuOpen && (
                <div className="lib-dropdown-menu">
                  <div className="lib-dropdown-header">
                    <span>Categories</span>
                    {selectedCategory && (
                      <button
                        type="button"
                        className="lib-dropdown-clear"
                        onClick={() => {
                          onSelectCategory?.('')
                          setCategoryMenuOpen(false)
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="lib-dropdown-list">
                    {categoriesList.map(([cat, count]) => (
                      <button
                        key={cat}
                        type="button"
                        className={`lib-dropdown-item ${selectedCategory === cat ? 'is-active' : ''}`}
                        onClick={() => {
                          onSelectCategory?.(selectedCategory === cat ? '' : cat)
                          setCategoryMenuOpen(false)
                        }}
                      >
                        <span className="capitalize">{cat}</span>
                        <span className="lib-dropdown-count">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tags Dropdown */}
          {allTagEntries.length > 0 && (
            <div className="relative" ref={tagRef}>
              <button
                type="button"
                className={`lib-filter-menu-btn ${selectedTag && !activePlatform ? 'lib-filter-menu-btn--active' : ''}`}
                onClick={() => {
                  setTagMenuOpen((prev) => !prev)
                  setCategoryMenuOpen(false)
                  setRatingMenuOpen(false)
                  setPlatformMenuOpen(false)
                }}
                aria-expanded={tagMenuOpen}
                aria-label="Filter by tag"
              >
                <span className="font-mono text-xs opacity-70">#</span>
                <span>{selectedTag && !activePlatform ? selectedTag : 'Tags'}</span>
                <Icon name="down" size={11} className="opacity-60" />
              </button>

              {tagMenuOpen && (
                <div className="lib-dropdown-menu lib-dropdown-menu--tags">
                  <div className="lib-dropdown-search">
                    <Icon name="search" size={12} className="opacity-60" />
                    <input
                      type="text"
                      placeholder="Search tags..."
                      value={tagQuery}
                      onChange={(e) => setTagQuery(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="lib-dropdown-list">
                    {filteredTags.map(([tag, count]) => (
                      <button
                        key={tag}
                        type="button"
                        className={`lib-dropdown-item ${selectedTag === tag ? 'is-active' : ''}`}
                        onClick={() => {
                          onSelectTag?.(selectedTag === tag ? '' : tag)
                          setTagMenuOpen(false)
                        }}
                      >
                        <span>#{tag}</span>
                        <span className="lib-dropdown-count">{count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reset all active filters */}
          {hasFilter && (
            <button
              type="button"
              className="lib-filter-clear-btn"
              onClick={onClearFilters}
              title="Reset all active filters"
            >
              <Icon name="x" size={12} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Tier 2: Active Filter Chips Strip (Only appears when filters are active) */}
      {hasFilter && (
        <div className="lib-active-filter-strip" data-enter>
          <span className="lib-active-filter-title">Active:</span>

          {selectedKind && (
            <span className="lib-active-filter-chip">
              <span>Format: {selectedKind}</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectKind?.('')}
                title="Remove format filter"
                aria-label="Remove format filter"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          )}

          {selectedRating && (
            <span className="lib-active-filter-chip">
              <Icon name="star" size={10} filled className="text-amber-400" />
              <span>
                {selectedRating === '5'
                  ? '5★ Essential'
                  : selectedRating === '4+'
                  ? '4★+ High Impact'
                  : 'Any Rated'}
              </span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectRating?.('')}
                title="Remove rating filter"
                aria-label="Remove rating filter"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          )}

          {selectedCategory && (
            <span className="lib-active-filter-chip">
              <span>Category: {selectedCategory}</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectCategory?.('')}
                title="Remove category filter"
                aria-label="Remove category filter"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          )}

          {selectedTag && (
            <span className="lib-active-filter-chip">
              <span>{activePlatform ? `Source: ${activePlatform.label}` : `#${selectedTag}`}</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onSelectTag?.('')}
                title="Remove tag filter"
                aria-label="Remove tag filter"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          )}

          {query && (
            <span className="lib-active-filter-chip">
              <span>Search: "{query}"</span>
              <button
                type="button"
                className="lib-active-filter-remove"
                onClick={() => onClearQuery?.()}
                title="Clear search query"
                aria-label="Clear search query"
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          )}

          <button
            type="button"
            className="lib-active-filter-clear-all"
            onClick={onClearFilters}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
