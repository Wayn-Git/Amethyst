import { useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion } from 'framer-motion'
import { KIND_ICON } from './LibraryCard.jsx'

const DEFAULT_VISIBLE_TAGS = 14

export default function LibraryTagRail({
  total,
  counts = {},
  categoryCounts = {},
  tagCounts = {},
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

  // Filter and sort tags
  const allTagEntries = useMemo(() => {
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [tagCounts])

  // Filter tags based on user typing
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
    <motion.aside 
      className={`lib-tag-rail ${isOpen ? 'lib-tag-rail--open' : 'lib-tag-rail--closed'}`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="lib-tag-rail-header">
        <div className="lib-tag-rail-title">
          <Icon name="grid" size={14} />
          <span>Knowledge Index</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="icon-btn lib-tag-rail-close"
            onClick={onClose}
            aria-label="Close tag sidebar"
          >
            <Icon name="x" size={13} />
          </button>
        )}
      </div>

      {hasFilter && (
        <div className="lib-tag-rail-active">
          <span className="lib-active-label mono">Active Filter</span>
          <div className="lib-active-badge">
            <span>
              {selectedTag ? `#${selectedTag}` : selectedKind || selectedCategory}
            </span>
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
        </div>
      )}

      <div className="lib-tag-rail-scroll">
        {/* All items button */}
        <button
          type="button"
          className={`lib-rail-item ${!hasFilter ? 'lib-rail-item--active' : ''}`}
          onClick={onClearFilters}
        >
          <span className="lib-rail-item-label">
            <Icon name="archive" size={14} />
            <span>All Resources</span>
          </span>
          <span className="lib-rail-badge mono">{total}</span>
        </button>

        {/* Resource Types */}
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

        {/* Categories */}
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

        {/* Curated Tags */}
        <div className="lib-rail-section">
          <div className="lib-rail-section-header">
            <span className="lib-rail-section-title mono">
              Topics & Tags ({allTagEntries.length})
            </span>
          </div>

          {allTagEntries.length > 8 && (
            <div className="lib-rail-search">
              <Icon name="search" size={12} />
              <input
                className="lib-rail-search-input"
                placeholder="Search tags..."
                value={tagQuery}
                onChange={(e) => setTagQuery(e.target.value)}
              />
              {tagQuery && (
                <button
                  type="button"
                  className="lib-rail-search-clear"
                  onClick={() => setTagQuery('')}
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
                ? 'Show top tags only ↑'
                : `+ ${allTagEntries.length - DEFAULT_VISIBLE_TAGS} more tags ↓`}
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  )
}
