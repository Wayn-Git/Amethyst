import { useState } from 'react'
import Icon from '../../Icon.jsx'
import { copyText } from '../../../api.js'

export default function LibraryView({
  items = [],
  query = '',
  activeIndex = 0,
  onSelect,
  onNavigateLibrary,
  onAddContent,
  onToast,
}) {
  const [filterKind, setFilterKind] = useState('all') // 'all' | 'article' | 'video' | 'note' | 'podcast'

  const cleanQ = query.toLowerCase().trim()

  const filteredItems = items.filter((item) => {
    if (filterKind !== 'all' && item.kind !== filterKind) return false
    if (cleanQ) {
      const matchTitle = item.title?.toLowerCase().includes(cleanQ)
      const matchTags = item.tags?.some((t) => t.toLowerCase().includes(cleanQ))
      const matchCategory = item.category?.toLowerCase().includes(cleanQ)
      const matchSummary = item.summary?.toLowerCase().includes(cleanQ)
      return matchTitle || matchTags || matchCategory || matchSummary
    }
    return true
  })

  const handleCopyLink = async (e, url) => {
    e.stopPropagation()
    const ok = await copyText(url)
    if (ok) onToast?.('Library link copied', 'ok')
  }

  const getKindIcon = (kind) => {
    switch (kind) {
      case 'video':
        return 'play'
      case 'podcast':
        return 'microphone'
      case 'note':
        return 'edit'
      case 'book':
        return 'book-open'
      case 'paper':
        return 'file-text'
      default:
        return 'book'
    }
  }

  return (
    <div className="damon-library-panel" role="region" aria-label="Library Explorer">
      {/* Top Bar: Kind Filters + Jump to Library */}
      <div className="damon-tasks-topbar">
        <div className="damon-tasks-buckets">
          {[
            { id: 'all', label: 'All Items' },
            { id: 'article', label: 'Articles' },
            { id: 'video', label: 'Videos' },
            { id: 'note', label: 'Notes' },
            { id: 'podcast', label: 'Podcasts' },
          ].map((k) => (
            <button
              key={k.id}
              type="button"
              className={`damon-bucket-btn${filterKind === k.id ? ' is-active' : ''}`}
              onClick={() => setFilterKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="damon-nav-jump-btn"
          onClick={onNavigateLibrary}
          title="Open full Library section"
        >
          <span>Open Library</span>
          <Icon name="arrow-up-right" size={13} />
        </button>
      </div>

      {/* Quick Add Content Tile */}
      {query.trim() && (
        <div className="damon-quick-create-task" onClick={onAddContent} role="button" tabIndex={0}>
          <div className="damon-qc-icon">
            <Icon name="bookmark" size={14} />
          </div>
          <div className="damon-qc-content">
            <span className="damon-qc-title">
              {/^https?:\/\//i.test(query.trim())
                ? `Save link to Library: “${query.trim()}”`
                : `Save note to Library: “${query.trim()}”`}
            </span>
            <span className="damon-qc-hint">Click or press Enter to capture</span>
          </div>
          <kbd className="kbd">↵ Save</kbd>
        </div>
      )}

      {/* Library Items List */}
      <div className="damon-library-list" role="listbox">
        {filteredItems.length === 0 ? (
          <div className="damon-empty-state">
            <Icon name="book" size={24} />
            <p>No library items found.</p>
            {query.trim() && (
              <span className="damon-empty-hint">Save it as a new item using the card above.</span>
            )}
          </div>
        ) : (
          filteredItems.map((item, i) => {
            const isSelected = i === activeIndex
            return (
              <div
                key={item.id}
                role="option"
                aria-selected={isSelected}
                data-active={isSelected}
                className={`damon-lib-item${isSelected ? ' is-active' : ''}`}
                onClick={() => onSelect(item)}
              >
                <div className="damon-lib-icon-col">
                  <Icon name={getKindIcon(item.kind)} size={16} />
                </div>

                <div className="damon-lib-main">
                  <div className="damon-lib-title-row">
                    <span className="damon-lib-title">{item.title || 'Untitled item'}</span>
                    <span className="damon-lib-kind">{item.kind}</span>
                  </div>
                  {item.summary ? (
                    <p className="damon-lib-snippet">{item.summary}</p>
                  ) : item.url ? (
                    <span className="damon-lib-url">{item.url}</span>
                  ) : null}
                  {item.tags?.length > 0 && (
                    <div className="damon-lib-tags">
                      {item.tags.slice(0, 4).map((t) => (
                        <span key={t} className="damon-lib-tag-pill">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="damon-lib-actions">
                  {item.url && (
                    <button
                      type="button"
                      className="damon-action-btn"
                      onClick={(e) => handleCopyLink(e, item.url)}
                      title="Copy URL"
                    >
                      <Icon name="copy" size={12} />
                    </button>
                  )}
                  <kbd className="kbd">↵ Open</kbd>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
