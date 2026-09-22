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
  onSelectKind,
  onSelectCategory,
  onSelectTag,
  onSelectRating,
  onClearFilters,
  isOpen = true,
}) {
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [ratingMenuOpen, setRatingMenuOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')

  const categoryRef = useRef(null)
  const tagRef = useRef(null)
  const ratingRef = useRef(null)

  useDismiss(categoryRef, categoryMenuOpen, {
    onAway: () => setCategoryMenuOpen(false),
    onEscape: () => setCategoryMenuOpen(false),
  })

  useDismiss(tagRef, tagMenuOpen, {
    onAway: () => setTagMenuOpen(false),
    onEscape: () => setTagMenuOpen(false),
  })

  useDismiss(ratingRef, ratingMenuOpen, {
    onAway: () => setRatingMenuOpen(false),
    onEscape: () => setRatingMenuOpen(false),
  })

  // Format kinds list
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
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [tagCounts])

  const filteredTags = useMemo(() => {
    if (!tagQuery.trim()) return allTagEntries.slice(0, 30)
    const q = tagQuery.toLowerCase().trim()
    return allTagEntries.filter(([tag]) => tag.toLowerCase().includes(q)).slice(0, 30)
  }, [allTagEntries, tagQuery])

  const hasFilter = Boolean(selectedKind || selectedCategory || selectedTag || selectedRating)

  if (!isOpen) return null

  return (
    <div className="lib-top-filter-hub w-full flex flex-col gap-2.5 pb-2">
      <div className="lib-filter-scroll-row flex items-center justify-between gap-3 w-full">
        {/* Horizontal Quick-Filter Pills */}
        <div className="lib-filter-pills-wrap flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none flex-1 min-w-0">
          {/* All button */}
          <button
            type="button"
            className={`lib-filter-pill ${!hasFilter ? 'lib-filter-pill--active' : ''}`}
            onClick={onClearFilters}
          >
            <Icon name="grid" size={13} />
            <span>All</span>
            <span className="lib-filter-pill-count">{total}</span>
          </button>

          {/* Curated Significance Filters */}
          {(ratingCounts['5'] > 0 || selectedRating === '5') && (
            <button
              type="button"
              className={`lib-filter-pill lib-filter-pill--curated ${selectedRating === '5' ? 'lib-filter-pill--active' : ''}`}
              onClick={() => onSelectRating?.(selectedRating === '5' ? '' : '5')}
              title="Filter by Essential (5-star) knowledge"
            >
              <Icon name="star" size={12} filled={selectedRating === '5'} />
              <span>Essential</span>
              <span className="lib-filter-pill-count">{ratingCounts['5'] || 0}</span>
            </button>
          )}

          {(ratingCounts['4+'] > 0 || selectedRating === '4+') && (
            <button
              type="button"
              className={`lib-filter-pill lib-filter-pill--curated ${selectedRating === '4+' ? 'lib-filter-pill--active' : ''}`}
              onClick={() => onSelectRating?.(selectedRating === '4+' ? '' : '4+')}
              title="Filter by High Impact (4+ stars) resources"
            >
              <Icon name="star" size={12} filled={selectedRating === '4+'} />
              <span>High Impact (4★+)</span>
              <span className="lib-filter-pill-count">{ratingCounts['4+'] || 0}</span>
            </button>
          )}

          {/* Divider if curated ratings present */}
          {(ratingCounts['5'] > 0 || ratingCounts['4+'] > 0) && <span className="lib-filter-pill-divider" />}

          {/* Formats (Videos, Articles, etc.) */}
          {activeKinds.map(([kind, count]) => {
            const isActive = selectedKind === kind
            return (
              <button
                key={kind}
                type="button"
                className={`lib-filter-pill ${isActive ? 'lib-filter-pill--active' : ''}`}
                onClick={() => onSelectKind?.(isActive ? '' : kind)}
              >
                <Icon name={KIND_ICON[kind] || 'link'} size={13} />
                <span className="capitalize">{kind}s</span>
                <span className="lib-filter-pill-count">{count}</span>
              </button>
            )
          })}

          {/* Platform separators */}
          {activeApps.length > 0 && <span className="lib-filter-pill-divider" />}

          {/* Platforms (Instagram, YouTube, Spotify, etc.) */}
          {activeApps.map((app) => {
            const isActive = selectedTag === app.id
            return (
              <button
                key={app.id}
                type="button"
                className={`lib-filter-pill ${isActive ? 'lib-filter-pill--active' : ''}`}
                onClick={() => onSelectTag?.(isActive ? '' : app.id)}
              >
                <Icon name={app.icon} size={13} />
                <span>{app.label}</span>
                <span className="lib-filter-pill-count">{app.count}</span>
              </button>
            )
          })}
        </div>

        {/* Taxonomy Dropdowns on Right (Category, Tags, Rating) */}
        <div className="lib-filter-dropdowns flex items-center gap-2 flex-shrink-0">
          {/* Significance Rating Dropdown */}
          <div className="relative" ref={ratingRef}>
            <button
              type="button"
              className={`lib-filter-menu-btn ${selectedRating ? 'lib-filter-menu-btn--active' : ''}`}
              onClick={() => {
                setRatingMenuOpen((prev) => !prev)
                setCategoryMenuOpen(false)
                setTagMenuOpen(false)
              }}
              aria-expanded={ratingMenuOpen}
              aria-label="Filter by curator rating"
            >
              <Icon name="star" size={12} filled={Boolean(selectedRating)} />
              <span>
                {selectedRating === '5'
                  ? 'Rating: 5★ Essential'
                  : selectedRating === '4+'
                  ? 'Rating: 4★+ High Impact'
                  : selectedRating === 'rated'
                  ? 'Rating: Any Rated'
                  : 'Rating'}
              </span>
              <Icon name="down" size={11} className="opacity-60" />
            </button>

            {ratingMenuOpen && (
              <div className="lib-dropdown-menu">
                <div className="lib-dropdown-header">
                  <span>Curator Significance</span>
                  {selectedRating && (
                    <button
                      type="button"
                      className="lib-dropdown-clear"
                      onClick={() => {
                        onSelectRating?.('')
                        setRatingMenuOpen(false)
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="lib-dropdown-list">
                  <button
                    type="button"
                    className={`lib-dropdown-item ${selectedRating === '5' ? 'is-active' : ''}`}
                    onClick={() => {
                      onSelectRating?.(selectedRating === '5' ? '' : '5')
                      setRatingMenuOpen(false)
                    }}
                  >
                    <span>★ 5 — Essential Reference</span>
                    <span className="lib-dropdown-count">{ratingCounts['5'] || 0}</span>
                  </button>
                  <button
                    type="button"
                    className={`lib-dropdown-item ${selectedRating === '4+' ? 'is-active' : ''}`}
                    onClick={() => {
                      onSelectRating?.(selectedRating === '4+' ? '' : '4+')
                      setRatingMenuOpen(false)
                    }}
                  >
                    <span>★ 4+ — High Impact</span>
                    <span className="lib-dropdown-count">{ratingCounts['4+'] || 0}</span>
                  </button>
                  <button
                    type="button"
                    className={`lib-dropdown-item ${selectedRating === 'rated' ? 'is-active' : ''}`}
                    onClick={() => {
                      onSelectRating?.(selectedRating === 'rated' ? '' : 'rated')
                      setRatingMenuOpen(false)
                    }}
                  >
                    <span>★ Any Rated Knowledge</span>
                    <span className="lib-dropdown-count">{ratingCounts['rated'] || 0}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

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
                    <span>Filter by Category</span>
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
                className={`lib-filter-menu-btn ${selectedTag && !PLATFORMS_META.some((p) => p.id === selectedTag) ? 'lib-filter-menu-btn--active' : ''}`}
                onClick={() => {
                  setTagMenuOpen((prev) => !prev)
                  setCategoryMenuOpen(false)
                  setRatingMenuOpen(false)
                }}
                aria-expanded={tagMenuOpen}
                aria-label="Filter by tag"
              >
                <span className="font-mono text-xs opacity-70">#</span>
                <span>{selectedTag && !PLATFORMS_META.some((p) => p.id === selectedTag) ? selectedTag : 'Tags'}</span>
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

          {/* Clear all active filters */}
          {hasFilter && (
            <button
              type="button"
              className="lib-filter-clear-btn"
              onClick={onClearFilters}
              title="Clear all active filters"
            >
              <Icon name="x" size={12} />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
