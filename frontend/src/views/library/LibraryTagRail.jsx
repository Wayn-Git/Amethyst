import { useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { KIND_ICON } from './LibraryCard.jsx'

const DEFAULT_VISIBLE_TAGS = 14

const PLATFORMS_META = [
  { id: 'youtube', label: 'YouTube', icon: 'play' },
  { id: 'spotify', label: 'Spotify', icon: 'music' },
  { id: 'github', label: 'GitHub', icon: 'code' },
  { id: 'instagram', label: 'Instagram', icon: 'spark' },
  { id: 'x', label: 'X (Twitter)', icon: 'chat' },
  { id: 'reddit', label: 'Reddit', icon: 'chat' },
  { id: 'pinterest', label: 'Pinterest', icon: 'pin' },
  { id: 'apple-music', label: 'Apple Music', icon: 'music' },
  { id: 'soundcloud', label: 'SoundCloud', icon: 'music' },
]

export default function LibraryTagRail({
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
  onClose,
}) {
  const [tagQuery, setTagQuery] = useState('')
  const [showAllTags, setShowAllTags] = useState(false)

  // Sort tags by frequency
  const allTagEntries = useMemo(() => {
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [tagCounts])

  // Filter active apps that have items
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

  // Filter tags based on search
  const filteredTags = useMemo(() => {
    if (!tagQuery.trim()) {
      return showAllTags ? allTagEntries : allTagEntries.slice(0, DEFAULT_VISIBLE_TAGS)
    }
    const q = tagQuery.toLowerCase().trim()
    return allTagEntries.filter(([tag]) => tag.toLowerCase().includes(q))
  }, [allTagEntries, tagQuery, showAllTags])

  const hasFilter = Boolean(selectedKind || selectedCategory || selectedTag || selectedRating)
  const activeKinds = useMemo(() => {
    return Object.entries(counts).filter(([, count]) => count > 0)
  }, [counts])

  return (
    <aside className="lib-rail" aria-label="Knowledge Taxonomy">
      {/* Rail Top Header */}
      <div className="lib-rail-header">
        <span className="lib-rail-heading">Taxonomy</span>
        {hasFilter && (
          <button
            type="button"
            className="lib-active-filter-clear-all"
            onClick={onClearFilters}
            title="Reset all taxonomy filters"
          >
            Reset
          </button>
        )}
      </div>

      {/* Primary Section: All Items */}
      <div className="lib-rail-group">
        <button
          type="button"
          className={`lib-rail-item ${!hasFilter ? 'lib-rail-item--active' : ''}`}
          onClick={onClearFilters}
        >
          <div className="lib-rail-item-left">
            <span className="lib-rail-item-icon">
              <Icon name="grid" size={15} />
            </span>
            <span>All Knowledge</span>
          </div>
          <span className="lib-rail-item-badge">{total}</span>
        </button>
      </div>

      {/* Curated Significance (Rating) */}
      {(ratingCounts['5'] > 0 || ratingCounts['4+'] > 0) && (
        <div className="lib-rail-group">
          <div className="lib-rail-heading" style={{ padding: '6px 4px 4px' }}>Significance</div>
          {ratingCounts['5'] > 0 && (
            <button
              type="button"
              className={`lib-rail-item ${selectedRating === '5' ? 'lib-rail-item--active' : ''}`}
              onClick={() => onSelectRating?.(selectedRating === '5' ? '' : '5')}
            >
              <div className="lib-rail-item-left">
                <span className="lib-rail-item-icon" style={{ color: '#f59e0b' }}>
                  <Icon name="star" size={13} filled />
                </span>
                <span>Essential (5★)</span>
              </div>
              <span className="lib-rail-item-badge">{ratingCounts['5']}</span>
            </button>
          )}

          {ratingCounts['4+'] > 0 && (
            <button
              type="button"
              className={`lib-rail-item ${selectedRating === '4+' ? 'lib-rail-item--active' : ''}`}
              onClick={() => onSelectRating?.(selectedRating === '4+' ? '' : '4+')}
            >
              <div className="lib-rail-item-left">
                <span className="lib-rail-item-icon" style={{ color: '#fbbf24' }}>
                  <Icon name="star" size={13} filled />
                </span>
                <span>High Impact (4★+)</span>
              </div>
              <span className="lib-rail-item-badge">{ratingCounts['4+']}</span>
            </button>
          )}
        </div>
      )}

      {/* Formats / Kinds */}
      {activeKinds.length > 0 && (
        <div className="lib-rail-group">
          <div className="lib-rail-heading" style={{ padding: '6px 4px 4px' }}>Formats</div>
          {activeKinds.map(([kind, count]) => {
            const isActive = selectedKind === kind
            return (
              <button
                type="button"
                key={kind}
                className={`lib-rail-item ${isActive ? 'lib-rail-item--active' : ''}`}
                onClick={() => onSelectKind?.(isActive ? '' : kind)}
              >
                <div className="lib-rail-item-left">
                  <span className="lib-rail-item-icon">
                    <Icon name={KIND_ICON[kind] || 'link'} size={14} />
                  </span>
                  <span style={{ textTransform: 'capitalize' }}>{kind}</span>
                </div>
                <span className="lib-rail-item-badge">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Connected Platforms */}
      {activeApps.length > 0 && (
        <div className="lib-rail-group">
          <div className="lib-rail-heading" style={{ padding: '6px 4px 4px' }}>Sources</div>
          {activeApps.map((app) => {
            const isActive = selectedTag === app.id
            return (
              <button
                type="button"
                key={app.id}
                className={`lib-rail-item ${isActive ? 'lib-rail-item--active' : ''}`}
                onClick={() => onSelectTag?.(isActive ? '' : app.id)}
              >
                <div className="lib-rail-item-left">
                  <span className="lib-rail-item-icon">
                    <Icon name={app.icon} size={14} />
                  </span>
                  <span>{app.label}</span>
                </div>
                <span className="lib-rail-item-badge">{app.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Topics & Tags */}
      {allTagEntries.length > 0 && (
        <div className="lib-rail-group">
          <div className="lib-rail-heading" style={{ padding: '6px 4px 4px' }}>Topics</div>
          {allTagEntries.length > 6 && (
            <div className="lib-rail-tag-search">
              <Icon name="search" size={12} />
              <input
                type="text"
                placeholder="Filter topics..."
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                aria-label="Filter topics"
              />
              {tagQuery && (
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => setTagQuery('')}
                >
                  <Icon name="x" size={10} />
                </button>
              )}
            </div>
          )}

          <div className="lib-rail-tag-cloud">
            {filteredTags.map(([tag, count]) => {
              const isActive = selectedTag === tag
              return (
                <button
                  type="button"
                  key={tag}
                  className={`lib-tag-pill ${isActive ? 'lib-tag-pill--active' : ''}`}
                  onClick={() => onSelectTag?.(isActive ? '' : tag)}
                  title={`Filter #${tag} (${count})`}
                >
                  <span className="lib-tag-pill-name">#{tag}</span>
                  <span className="lib-tag-pill-count">{count}</span>
                </button>
              )
            })}
          </div>

          {!tagQuery && allTagEntries.length > DEFAULT_VISIBLE_TAGS && (
            <button
              type="button"
              className="lib-rail-more-tags"
              onClick={() => setShowAllTags((prev) => !prev)}
            >
              <span>{showAllTags ? 'Show fewer topics' : `+${allTagEntries.length - DEFAULT_VISIBLE_TAGS} more topics`}</span>
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
