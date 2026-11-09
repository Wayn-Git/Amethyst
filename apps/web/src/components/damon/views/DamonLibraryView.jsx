import React, { useState } from 'react'
import Icon from '../../Icon.jsx'
import { copyText, openUrl } from '../../../api.js'

export default function DamonLibraryView({
  items = [],
  query = '',
  selectedIndex = 0,
  onSelectItem,
  onOpenItem,
  onToast,
}) {
  const [filterKind, setFilterKind] = useState('all') // 'all' | 'article' | 'video' | 'note' | 'book'
  const [imgErrors, setImgErrors] = useState({})
  const [selectedId, setSelectedId] = useState(null)

  const cleanQ = query.toLowerCase().trim()

  const filteredItems = items.filter((item) => {
    if (filterKind !== 'all' && item.kind?.toLowerCase() !== filterKind) return false
    if (cleanQ) {
      const matchTitle = item.title?.toLowerCase().includes(cleanQ)
      const matchTags = item.tags?.some((t) => t.toLowerCase().includes(cleanQ))
      const matchCategory = item.category?.toLowerCase().includes(cleanQ)
      const matchSummary = (item.summary || item.excerpt)?.toLowerCase().includes(cleanQ)
      const matchSite = item.site?.toLowerCase().includes(cleanQ)
      return matchTitle || matchTags || matchCategory || matchSummary || matchSite
    }
    return true
  })

  const current =
    (selectedId && filteredItems.find((it) => it.id === selectedId)) ||
    filteredItems[selectedIndex] ||
    filteredItems[0] ||
    null

  const handleCopyLink = async (e, url) => {
    e.stopPropagation()
    if (!url) return
    const ok = await copyText(url)
    if (ok && onToast) onToast('Library link copied', 'ok')
  }

  const getKindIcon = (kind) => {
    switch (kind?.toLowerCase()) {
      case 'video':
      case 'reel':
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
        return 'file-text'
    }
  }

  const getThumbnailSrc = (item) => {
    if (!item) return null
    if (imgErrors[item.id]) return null
    if (item.thumbnail_url) return item.thumbnail_url
    if (item.preview_data?.thumbnail_url) return item.preview_data.thumbnail_url
    if (item.id && typeof item.id === 'number') return `/api/library/${item.id}/thumbnail`
    return null
  }

  return (
    <div className="damon-library-split-root">
      {/* 1. Category Filter Chips */}
      <div className="damon-chips-bar">
        <span>Filter</span>
        {[
          { id: 'all', label: 'All Items' },
          { id: 'article', label: 'Articles' },
          { id: 'video', label: 'Videos' },
          { id: 'note', label: 'Notes' },
        ].map((k) => (
          <button
            key={k.id}
            type="button"
            className={`damon-filter-chip${filterKind === k.id ? ' is-active' : ''}`}
            onClick={() => setFilterKind(k.id)}
          >
            <span>{k.label}</span>
          </button>
        ))}
      </div>

      {/* 2. Split Explorer */}
      <div className="damon-split-layout">
        {/* Left: Items list */}
        <div className="damon-split-left damon-library-list-col">
          {filteredItems.length === 0 ? (
            <div className="damon-empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
              <Icon name="book" size={28} />
              <p style={{ marginTop: 10, color: 'var(--damon-text-muted)' }}>
                {cleanQ ? `No library items match “${query}”` : 'No saved library items.'}
              </p>
            </div>
          ) : (
            <div className="damon-list-container">
              {filteredItems.map((item, i) => {
                const isSelected = current?.id === item.id || i === selectedIndex
                const thumb = getThumbnailSrc(item)
                const siteName = item.site || item.preview_data?.site || (item.url ? new URL(item.url, 'http://x').hostname.replace('www.', '') : item.kind)

                return (
                  <button
                    key={item.id || `lib-${i}`}
                    type="button"
                    className={`damon-row damon-library-row${isSelected ? ' is-selected' : ''}`}
                    onClick={() => {
                      setSelectedId(item.id)
                      onSelectItem?.(item)
                    }}
                    onDoubleClick={() => onOpenItem?.(item)}
                  >
                    {/* Visual Thumbnail */}
                    <div className="damon-library-row-thumb">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="damon-library-row-img"
                          onError={() => setImgErrors((prev) => ({ ...prev, [item.id]: true }))}
                        />
                      ) : (
                        <div className="damon-library-row-thumb-fallback">
                          <Icon name={getKindIcon(item.kind)} size={16} />
                        </div>
                      )}
                    </div>

                    {/* Metadata & Title */}
                    <div className="damon-row-main">
                      <div className="damon-row-title damon-library-title">{item.title}</div>
                      <div className="damon-row-subtitle damon-library-sub">
                        <span className="damon-lib-kind-pill">{item.kind || 'Article'}</span>
                        {siteName && <span className="damon-lib-site">· {siteName}</span>}
                        {item.date_label && <span className="damon-lib-date">· {item.date_label}</span>}
                      </div>
                    </div>

                    <div className="damon-row-trailing">
                      {isSelected ? (
                        <span className="damon-row-shortcut">↵</span>
                      ) : (
                        <Icon name="arrow-up-right" size={15} />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Full Preview Panel */}
        <div className="damon-split-right damon-library-preview-col">
          {current ? (
            <div className="damon-library-detail-wrap">
              {/* Hero Thumbnail Preview */}
              {getThumbnailSrc(current) && (
                <div className="damon-library-hero-thumb">
                  <img src={getThumbnailSrc(current)} alt="" className="damon-library-hero-img" />
                </div>
              )}

              <div className="damon-preview-header">
                <div className="damon-preview-meta">
                  <div className="damon-library-pills-row">
                    <span className="damon-tag damon-tag--doc">{current.kind || 'Article'}</span>
                    {current.site && <span className="damon-lib-site-tag">{current.site}</span>}
                    {current.date_label && <span className="damon-lib-date-tag">{current.date_label}</span>}
                  </div>
                  <h3 className="damon-library-preview-title">{current.title}</h3>
                </div>
              </div>

              {/* Excerpt / Summary Card */}
              <div className="damon-preview-content-card damon-library-excerpt-box">
                {current.summary || current.preview_data?.excerpt || current.excerpt || 'No summary available.'}
              </div>

              {/* Tags */}
              {current.tags?.length > 0 && (
                <div className="damon-library-tags-row">
                  {current.tags.slice(0, 5).map((tag) => (
                    <span key={tag} className="damon-library-tag">#{tag}</span>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="damon-preview-actions">
                <button
                  type="button"
                  className="damon-btn-primary"
                  onClick={() => onOpenItem(current)}
                >
                  <span>Open Item</span>
                  <Icon name="arrow-up-right" size={14} />
                </button>
                {current.url && (
                  <button
                    type="button"
                    className="damon-btn-secondary"
                    onClick={(e) => handleCopyLink(e, current.url)}
                  >
                    Copy Link
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--damon-text-muted)', fontSize: 13, padding: 20 }}>
              Select an item to view preview.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

