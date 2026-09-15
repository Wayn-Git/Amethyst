import { useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { KIND_ICON } from './LibraryCard.jsx'

const DEFAULT_VISIBLE_TAGS = 12

const APPS_META = [
  { id: 'pinterest', label: 'Pinterest', icon: 'pin', color: '#E60023' },
  { id: 'youtube', label: 'YouTube', icon: 'play', color: '#FF0000' },
  { id: 'instagram', label: 'Instagram', icon: 'spark', color: '#E4405F' },
  { id: 'x', label: 'X (Twitter)', icon: 'chat', color: '#1DA1F2' },
  { id: 'github', label: 'GitHub', icon: 'code', color: '#8b949e' },
  { id: 'reddit', label: 'Reddit', icon: 'chat', color: '#FF4500' },
  { id: 'spotify', label: 'Spotify', icon: 'music', color: '#1DB954' },
  { id: 'apple-music', label: 'Apple Music', icon: 'music', color: '#FC3C44' },
  { id: 'soundcloud', label: 'SoundCloud', icon: 'music', color: '#FF5500' },
  { id: 'bandcamp', label: 'Bandcamp', icon: 'music', color: '#1DA0C3' },
]

export default function LibraryTagRail({
  total = 0,
  counts = {},
  categoryCounts = {},
  tagCounts = {},
  appCounts = {},
  selectedKind = '',
  selectedCategory = '',
  selectedTag = '',
  onSelectKind,
  onSelectCategory,
  onSelectTag,
  onClearFilters,
  isOpen = true,
  onClose,
}) {
  const [tagQuery, setTagQuery] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)

  // Filter and sort tags, excluding raw app tags from generic tag cloud if desired or showing top
  const allTagEntries = useMemo(() => {
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [tagCounts])

  // Active apps (apps that have at least 1 item saved)
  const activeApps = useMemo(() => {
    const list = []
    for (const app of APPS_META) {
      const count = appCounts[app.id] || tagCounts[app.id] || 0
      if (count > 0) {
        list.push({ ...app, count })
      }
    }
    return list
  }, [appCounts, tagCounts])

  // Filter tags based on search query
  const filteredTags = useMemo(() => {
    if (!tagQuery.trim()) {
      return showAllTags ? allTagEntries : allTagEntries.slice(0, DEFAULT_VISIBLE_TAGS)
    }
    const q = tagQuery.toLowerCase().trim()
    return allTagEntries.filter(([tag]) => tag.toLowerCase().includes(q))
  }, [allTagEntries, tagQuery, showAllTags])

  const hasFilter = Boolean(selectedKind || selectedCategory || selectedTag)
  const hasHiddenTags = !tagQuery.trim() && allTagEntries.length > DEFAULT_VISIBLE_TAGS

  // Filter resource types to only those with count > 0
  const activeKinds = useMemo(() => {
    return Object.entries(counts).filter(([, count]) => count > 0)
  }, [counts])

  return (
    <aside
      className={`lib-tag-rail ${isOpen ? 'lib-tag-rail--open' : 'lib-tag-rail--closed'}`}
      aria-label="Library Navigation Sidebar"
    >
      {/* Apple-style sidebar header */}
      <div className="lib-tag-rail-header">
        <div className="lib-tag-rail-title">
          <Icon name="grid" size={14} />
          <span>Library</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-btn lib-tag-rail-close"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      {/* Active Filter Pill */}
      {hasFilter && (
        <div className="lib-tag-rail-active">
          <div className="lib-active-badge">
            <span className="lib-active-dot" />
            <span className="lib-active-text">
              {selectedTag ? `#${selectedTag}` : selectedKind || selectedCategory}
            </span>
          </div>
          <button
            type="button"
            className="lib-clear-btn"
            onClick={onClearFilters}
            title="Clear active filter"
            aria-label="Clear active filter"
          >
            <Icon name="x" size={11} />
          </button>
        </div>
      )}

      <div className="lib-tag-rail-scroll">
        {/* All Resources Item */}
        <button
          type="button"
          className={`lib-rail-item ${!hasFilter ? 'lib-rail-item--active' : ''}`}
          onClick={onClearFilters}
        >
          <span className="lib-rail-item-label">
            <Icon name="archive" size={15} />
            <span className="lib-rail-name">All Resources</span>
          </span>
          <span className="lib-rail-badge mono">{total}</span>
        </button>

        {/* Apps & Platforms Section */}
        {activeApps.length > 0 && (
          <div className="lib-rail-section">
            <div className="lib-rail-section-title mono">Apps & Platforms</div>
            <div className="lib-rail-list">
              {activeApps.map((app) => {
                const isSelected = selectedTag === app.id
                return (
                  <button
                    type="button"
                    key={app.id}
                    className={`lib-rail-item lib-rail-item--app ${
                      isSelected ? 'lib-rail-item--active' : ''
                    }`}
                    onClick={() => onSelectTag(isSelected ? '' : app.id)}
                    title={`Filter by ${app.label}`}
                  >
                    <span className="lib-rail-item-label">
                      <span
                        className="lib-app-dot"
                        style={{ backgroundColor: app.color }}
                      />
                      <Icon name={app.icon || 'link'} size={14} />
                      <span className="lib-rail-name">{app.label}</span>
                    </span>
                    <span className="lib-rail-badge mono">{app.count}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Resource Types Section */}
        {activeKinds.length > 0 && (
          <div className="lib-rail-section">
            <div className="lib-rail-section-title mono">Resource Types</div>
            <div className="lib-rail-list">
              {activeKinds.map(([k, count]) => (
                <button
                  type="button"
                  key={k}
                  className={`lib-rail-item ${selectedKind === k ? 'lib-rail-item--active' : ''}`}
                  onClick={() => onSelectKind(selectedKind === k ? '' : k)}
                >
                  <span className="lib-rail-item-label">
                    <Icon name={KIND_ICON[k] || 'link'} size={14} />
                    <span className="lib-rail-name">{k}</span>
                  </span>
                  <span className="lib-rail-badge mono">{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Categories Section */}
        {Object.keys(categoryCounts).length > 0 && (
          <div className="lib-rail-section">
            <div className="lib-rail-section-title mono">Categories</div>
            <div className="lib-rail-list">
              {Object.entries(categoryCounts).map(([cat, count]) => (
                <button
                  type="button"
                  key={cat}
                  className={`lib-rail-item ${selectedCategory === cat ? 'lib-rail-item--active' : ''}`}
                  onClick={() => onSelectCategory?.(selectedCategory === cat ? '' : cat)}
                >
                  <span className="lib-rail-item-label">
                    <Icon name="grid" size={13} />
                    <span className="lib-rail-name">{cat}</span>
                  </span>
                  <span className="lib-rail-badge mono">{count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Curated Tags Section */}
        {allTagEntries.length > 0 && (
          <div className="lib-rail-section">
            <div className="lib-rail-section-header">
              <span className="lib-rail-section-title mono">
                Tags ({allTagEntries.length})
              </span>
            </div>

            {allTagEntries.length > 6 && (
              <div className="lib-rail-search">
                <Icon name="search" size={12} />
                <input
                  className="lib-rail-search-input"
                  placeholder="Filter tags..."
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                />
                {tagQuery && (
                  <button
                    type="button"
                    className="lib-rail-search-clear"
                    onClick={() => setTagQuery('')}
                    aria-label="Clear search"
                  >
                    <Icon name="x" size={10} />
                  </button>
                )}
              </div>
            )}

            <div className="lib-rail-list lib-rail-list--tags">
              {filteredTags.length === 0 ? (
                <div className="lib-rail-empty mono">No tags match "{tagQuery}"</div>
              ) : (
                filteredTags.map(([tag, count]) => (
                  <button
                    type="button"
                    key={tag}
                    className={`lib-rail-item lib-rail-item--tag ${
                      selectedTag === tag ? 'lib-rail-item--active' : ''
                    }`}
                    onClick={() => onSelectTag(selectedTag === tag ? '' : tag)}
                    title={`Filter by #${tag}`}
                  >
                    <span className="lib-rail-item-label">
                      <span className="lib-rail-hash mono">#</span>
                      <span className="lib-rail-tag-name">{tag}</span>
                    </span>
                    <span className="lib-rail-badge mono">{count}</span>
                  </button>
                ))
              )}
            </div>

            {hasHiddenTags && (
              <button
                type="button"
                className="lib-rail-more-btn mono"
                onClick={() => setShowAllTags(!showAllTags)}
              >
                {showAllTags
                  ? 'Show fewer tags ↑'
                  : `+ ${allTagEntries.length - DEFAULT_VISIBLE_TAGS} more tags ↓`}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
