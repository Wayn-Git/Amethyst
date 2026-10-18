import { useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { KIND_ICON } from './LibraryCard.jsx'
import { useDismiss } from '../../hooks/useDismiss.js'

const PLATFORMS_META = [
  { id: 'youtube', label: 'YouTube', icon: 'play' },
  { id: 'instagram', label: 'Instagram', icon: 'spark' },
  { id: 'spotify', label: 'Spotify', icon: 'music' },
  { id: 'threads', label: 'Threads', icon: 'threads' },
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
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

  const filterRef = useRef(null)

  useDismiss(filterRef, filterMenuOpen, {
    onAway: () => setFilterMenuOpen(false),
    onEscape: () => setFilterMenuOpen(false),
  })

  // Format kinds list (filter out zero counts, sorted by frequency)
  const activeKinds = useMemo(() => {
    return Object.entries(counts)
      .filter(([kind, count]) => count > 0 && kind !== 'total')
      .sort((a, b) => b[1] - a[1])
  }, [counts])

  // Top 4 kinds for prominent horizontal tabs (covers 95%+ of items: videos, articles, posts, notes)
  const primaryKinds = useMemo(() => activeKinds.slice(0, 4), [activeKinds])
  const extraKinds = useMemo(() => activeKinds.slice(4), [activeKinds])

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

  // Count active secondary filters inside the Filter popover
  const activeSecondaryCount = useMemo(() => {
    let count = 0
    if (selectedRating && selectedRating !== '5') count += 1
    if (selectedCategory) count += 1
    if (selectedTag) count += 1
    if (selectedKind && !primaryKinds.some(([k]) => k === selectedKind)) count += 1
    return count
  }, [selectedRating, selectedCategory, selectedTag, selectedKind, primaryKinds])

  const hasFilter = Boolean(
    selectedKind || selectedCategory || selectedTag || selectedRating || query
  )

  if (!isOpen) return null

  return (
    <div className="lib-filter-nav w-full flex flex-col gap-2 pb-1" data-enter>
      {/* Tier 1: Primary Segmented Type Tabs & Sleek Secondary Dimension Menus */}
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

          {/* Core Kind Tabs (Articles, Videos, Posts, Notes) */}
          {primaryKinds.map(([kind, count]) => {
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

        {/* Right: Consolidated Clean Filter Deck */}
        <div className="lib-filter-secondary-group flex items-center gap-2 flex-wrap">
          {/* Curated 5★ Essential Quick Toggle Pill */}
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

          {/* Unified Filters Popover Button */}
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              className={`lib-filter-menu-btn ${activeSecondaryCount > 0 ? 'lib-filter-menu-btn--active' : ''}`}
              onClick={() => setFilterMenuOpen((prev) => !prev)}
              aria-expanded={filterMenuOpen}
              aria-label="Filter knowledge by rating, source, category, or tag"
            >
              <Icon name="sliders" size={12} />
              <span>Filter</span>
              {activeSecondaryCount > 0 && (
                <span className="lib-pill-count">{activeSecondaryCount}</span>
              )}
              <Icon name="down" size={11} className="opacity-60" />
            </button>

            {filterMenuOpen && (
              <div className="lib-dropdown-menu lib-dropdown-menu--filter-popover">
                <div className="lib-dropdown-header">
                  <span>Filter Library</span>
                  {hasFilter && (
                    <button
                      type="button"
                      className="lib-dropdown-clear"
                      onClick={() => {
                        onClearFilters?.()
                        setFilterMenuOpen(false)
                      }}
                    >
                      Reset all
                    </button>
                  )}
                </div>

                <div className="lib-filter-popover-body">
                  {/* Significance / Ratings */}
                  {(ratingCounts['5'] > 0 || ratingCounts['4+'] > 0) && (
                    <div className="lib-filter-section">
                      <span className="lib-filter-section-title">Significance</span>
                      <div className="lib-filter-chip-group">
                        {ratingCounts['5'] > 0 && (
                          <button
                            type="button"
                            className={`lib-filter-chip ${selectedRating === '5' ? 'is-active' : ''}`}
                            onClick={() => onSelectRating?.(selectedRating === '5' ? '' : '5')}
                          >
                            <Icon name="star" size={11} filled className="text-amber-400" />
                            <span>5★ Essential</span>
                            <span className="lib-pill-count">{ratingCounts['5']}</span>
                          </button>
                        )}
                        {ratingCounts['4+'] > 0 && (
                          <button
                            type="button"
                            className={`lib-filter-chip ${selectedRating === '4+' ? 'is-active' : ''}`}
                            onClick={() => onSelectRating?.(selectedRating === '4+' ? '' : '4+')}
                          >
                            <Icon name="star" size={11} filled className="text-amber-400" />
                            <span>4★+ High Impact</span>
                            <span className="lib-pill-count">{ratingCounts['4+']}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Platforms / Sources */}
                  {activeApps.length > 0 && (
                    <div className="lib-filter-section">
                      <span className="lib-filter-section-title">Source Platform</span>
                      <div className="lib-filter-chip-group">
                        {activeApps.map((app) => (
                          <button
                            key={app.id}
                            type="button"
                            className={`lib-filter-chip ${selectedTag === app.id ? 'is-active' : ''}`}
                            onClick={() => onSelectTag?.(selectedTag === app.id ? '' : app.id)}
                          >
                            <Icon name={app.icon} size={11} />
                            <span>{app.label}</span>
                            <span className="lib-pill-count">{app.count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Categories */}
                  {categoriesList.length > 0 && (
                    <div className="lib-filter-section">
                      <span className="lib-filter-section-title">Categories</span>
                      <div className="lib-filter-chip-group">
                        {categoriesList.map(([cat, count]) => (
                          <button
                            key={cat}
                            type="button"
                            className={`lib-filter-chip ${selectedCategory === cat ? 'is-active' : ''}`}
                            onClick={() => onSelectCategory?.(selectedCategory === cat ? '' : cat)}
                          >
                            <span className="capitalize">{cat}</span>
                            <span className="lib-pill-count">{count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other Formats (beyond top 4) */}
                  {extraKinds.length > 0 && (
                    <div className="lib-filter-section">
                      <span className="lib-filter-section-title">Other Formats</span>
                      <div className="lib-filter-chip-group">
                        {extraKinds.map(([k, count]) => (
                          <button
                            key={k}
                            type="button"
                            className={`lib-filter-chip ${selectedKind === k ? 'is-active' : ''}`}
                            onClick={() => onSelectKind?.(selectedKind === k ? '' : k)}
                          >
                            <Icon name={KIND_ICON[k] || 'link'} size={11} />
                            <span className="capitalize">{k === 'note' ? 'Notes' : `${k}s`}</span>
                            <span className="lib-pill-count">{count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {allTagEntries.length > 0 && (
                    <div className="lib-filter-section">
                      <span className="lib-filter-section-title">Tags</span>
                      <div className="lib-dropdown-search lib-filter-tag-search">
                        <Icon name="search" size={11} className="opacity-60" />
                        <input
                          type="text"
                          placeholder="Search tags..."
                          value={tagQuery}
                          onChange={(e) => setTagQuery(e.target.value)}
                        />
                      </div>
                      <div className="lib-filter-chip-group" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                        {filteredTags.map(([tag, count]) => (
                          <button
                            key={tag}
                            type="button"
                            className={`lib-filter-chip ${selectedTag === tag ? 'is-active' : ''}`}
                            onClick={() => onSelectTag?.(selectedTag === tag ? '' : tag)}
                          >
                            <span>#{tag}</span>
                            <span className="lib-pill-count">{count}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
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
