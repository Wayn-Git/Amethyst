import { Button as HouseButton, Input as HouseInput } from '../../components/ui/bento/index.jsx'
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
  lists = [],
  selectedListId = null,
  onSelectList,
  selectedKind = '',
  selectedCategory = '',
  selectedTag = '',
  selectedRating = '',
  selectedProgress = 'all',
  onSelectKind,
  onSelectCategory,
  onSelectTag,
  onSelectRating,
  onSelectProgress,
  onClearFilters,
  onOpenCreateList,
  onOpenSettings,
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

  const hasFilter = Boolean(
    selectedKind ||
    selectedCategory ||
    selectedTag ||
    selectedRating ||
    (selectedProgress && selectedProgress !== 'all') ||
    selectedListId
  )

  return (
    <aside className="lib-rail" aria-label="Library Sidebar">
      {/* Library Brand Header */}
      <div className="lib-rail-header" style={{ padding: '8px 12px 14px' }}>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          Library
        </span>
        {hasFilter && (
          <button
            type="button"
            className="lib-active-filter-clear-all"
            onClick={onClearFilters}
            title="Reset filters"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Primary Navigation: Library, Favorites, Reminders */}
      <div className="lib-rail-group" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <button
          type="button"
          className={`lib-rail-nav-btn ${!hasFilter ? 'lib-rail-nav-btn--active' : ''}`}
          onClick={onClearFilters}
        >
          <Icon name="grid" size={16} />
          <span>Library</span>
          <em className="lib-rail-nav-count">{total}</em>
        </button>

        <button
          type="button"
          className={`lib-rail-nav-btn ${selectedRating === '5' ? 'lib-rail-nav-btn--active' : ''}`}
          onClick={() => onSelectRating?.(selectedRating === '5' ? '' : '5')}
        >
          <Icon name="star" size={16} filled={selectedRating === '5'} />
          <span>Favorites</span>
          {ratingCounts['5'] > 0 && <em className="lib-rail-nav-count">{ratingCounts['5']}</em>}
        </button>

        <button
          type="button"
          className={`lib-rail-nav-btn ${selectedProgress === 'todo' ? 'lib-rail-nav-btn--active' : ''}`}
          onClick={() => onSelectProgress?.(selectedProgress === 'todo' ? 'all' : 'todo')}
        >
          <Icon name="bell" size={16} />
          <span>Reminders</span>
        </button>
      </div>

      {/* Collections section */}
      <div className="lib-rail-group" style={{ marginTop: 12 }}>
        <div className="lib-rail-section-label">Collections</div>
        {lists.map((l) => {
          const isActive = selectedListId === l.id
          const count = (l.item_count || 0) + (l.link_count || 0)
          return (
            <button
              type="button"
              key={l.id}
              className={`lib-rail-nav-btn ${isActive ? 'lib-rail-nav-btn--active' : ''}`}
              onClick={() => onSelectList?.(isActive ? null : l.id)}
            >
              <Icon
                name={l.is_smart ? 'spark' : 'folder'}
                size={15}
                className={l.is_smart ? 'text-amber-400' : ''}
              />
              <span className="truncate">{l.title}</span>
              {count > 0 && <em className="lib-rail-nav-count">{count}</em>}
            </button>
          )
        })}
        <button
          type="button"
          className="lib-rail-nav-btn"
          onClick={onOpenCreateList}
          style={{ color: 'var(--text-muted)' }}
        >
          <Icon name="plus" size={15} />
          <span>New collection</span>
        </button>
      </div>

      {/* Connected Platforms */}
      {activeApps.length > 0 && (
        <div className="lib-rail-group">
          <div className="lib-rail-heading" style={{ padding: '6px 4px 4px' }}>Sources</div>
          {activeApps.map((app) => {
            const isActive = selectedTag === app.id
            return (
              <HouseButton
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
              </HouseButton>
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
              <HouseInput
                type="text"
                placeholder="Filter topics..."
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
                aria-label="Filter topics"
              />
              {tagQuery && (
                <HouseButton
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => setTagQuery('')}
                >
                  <Icon name="x" size={10} />
                </HouseButton>
              )}
            </div>
          )}

          <div className="lib-rail-tag-cloud">
            {filteredTags.map(([tag, count]) => {
              const isActive = selectedTag === tag
              return (
                <HouseButton
                  type="button"
                  key={tag}
                  className={`lib-tag-pill ${isActive ? 'lib-tag-pill--active' : ''}`}
                  onClick={() => onSelectTag?.(isActive ? '' : tag)}
                  title={`Filter #${tag} (${count})`}
                >
                  <span className="lib-tag-pill-name">#{tag}</span>
                  <span className="lib-tag-pill-count">{count}</span>
                </HouseButton>
              )
            })}
          </div>

          {!tagQuery && allTagEntries.length > DEFAULT_VISIBLE_TAGS && (
            <HouseButton
              type="button"
              className="lib-rail-more-tags"
              onClick={() => setShowAllTags((prev) => !prev)}
            >
              <span>{showAllTags ? 'Show fewer topics' : `+${allTagEntries.length - DEFAULT_VISIBLE_TAGS} more topics`}</span>
            </HouseButton>
          )}
        </div>
      )}

      {/* Bottom Settings Link */}
      <div style={{ marginTop: 'auto', paddingTop: 16 }}>
        <button
          type="button"
          className="lib-rail-nav-btn"
          onClick={() => {
            if (onOpenSettings) onOpenSettings()
            else window.location.hash = '#/settings'
          }}
          style={{ color: 'var(--text-muted)' }}
        >
          <Icon name="settings" size={16} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
