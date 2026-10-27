import React, { useState, useEffect, useRef } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function LibraryRightRail({
  item,
  tags = [],
  onAddTag,
  onRemoveTag,
  rating,
  onToggleFavorite,
  notes = '',
  onOpenNotesTab,
  onNavigateItem,
}) {
  const [tagInput, setTagInput] = useState('')
  const [isAddingCollection, setIsAddingCollection] = useState(false)
  const [collectionInput, setCollectionInput] = useState('')
  const [collections, setCollections] = useState(() => {
    if (Array.isArray(item?.collections)) return item.collections
    if (item?.collection) return [item.collection]
    return []
  })
  const [relatedItems, setRelatedItems] = useState([])
  const [loadingRelated, setLoadingRelated] = useState(false)

  const tagInputRef = useRef(null)

  // Sync collections when item changes
  useEffect(() => {
    if (Array.isArray(item?.collections)) {
      setCollections(item.collections)
    } else if (item?.collection) {
      setCollections([item.collection])
    } else {
      setCollections([])
    }
  }, [item?.id, item?.collections, item?.collection])

  // Fetch 3-5 related saves via semantic / text search query
  useEffect(() => {
    if (!item?.title && !item?.id) return
    let active = true
    setLoadingRelated(true)

    const query = (item.title || '').replace(/[^\w\s]/gi, ' ').trim().slice(0, 80)
    if (!query) {
      setRelatedItems([])
      setLoadingRelated(false)
      return
    }

    const fetchRelated = api.library
      ? api.library({ q: query, limit: 6 })
      : null

    if (fetchRelated && typeof fetchRelated.then === 'function') {
      fetchRelated
        .then((res) => {
          if (!active) return
          const raw = res?.items || (Array.isArray(res) ? res : [])
          // Filter out the active item itself
          const filtered = raw.filter((it) => it && it.id !== item.id).slice(0, 4)
          setRelatedItems(filtered)
        })
        .catch(() => {
          if (active) setRelatedItems([])
        })
        .finally(() => {
          if (active) setLoadingRelated(false)
        })
    } else {
      setLoadingRelated(false)
    }

    return () => {
      active = false
    }
  }, [item?.id, item?.title])

  const isFavorite = Boolean(rating && rating >= 4) || Boolean(item?.is_favorite)

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const clean = tagInput.trim().replace(/^#/, '')
      if (clean) {
        onAddTag?.(clean)
        setTagInput('')
      }
    } else if (e.key === 'Backspace' && !tagInput && tags.length > 0) {
      e.preventDefault()
      const lastTag = tags[tags.length - 1]
      onRemoveTag?.(lastTag)
    }
  }

  const handleAddCollectionSubmit = (e) => {
    e.preventDefault()
    const clean = collectionInput.trim()
    if (clean) {
      const next = Array.from(new Set([...collections, clean]))
      setCollections(next)
      setCollectionInput('')
      setIsAddingCollection(false)
      // Persist to item via onAddTag or custom update
      onAddTag?.(`collection:${clean}`)
    }
  }

  return (
    <aside className="lib-right-rail" aria-label="Item metadata and curation">
      {/* 1. Favorite / Pin Toggle + Prior Rating */}
      <div className="lib-rail-section">
        <div className="lib-rail-favorite-row">
          <button
            type="button"
            className={`lib-rail-fav-btn ${isFavorite ? 'lib-rail-fav-btn--active' : ''}`}
            onClick={onToggleFavorite}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={isFavorite}
          >
            <Icon
              name="star"
              size={14}
              filled={isFavorite}
              className={isFavorite ? 'lib-star--active' : ''}
            />
            <span>{isFavorite ? 'Favorited' : 'Favorite'}</span>
          </button>

          {/* Show stars only if prior rating data already exists */}
          {rating && rating > 0 && (
            <div className="lib-rail-prior-rating" title={`Rated ${rating}/5`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Icon
                  key={i}
                  name="star"
                  size={11}
                  filled={i < rating}
                  className={i < rating ? 'lib-star-gold' : 'lib-star-dim'}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="lib-rail-divider" />

      {/* 2. Tags Section */}
      <div className="lib-rail-section">
        <div className="lib-rail-section-header">
          <span className="lib-rail-label">Tags</span>
        </div>

        <div className="lib-rail-tags-wrap">
          {tags.map((t) => (
            <span key={t} className="lib-rail-tag-chip">
              <span className="lib-rail-tag-text">#{t}</span>
              <button
                type="button"
                className="lib-rail-tag-del"
                onClick={() => onRemoveTag?.(t)}
                title={`Remove tag #${t}`}
                aria-label={`Remove tag #${t}`}
              >
                <Icon name="x" size={9} />
              </button>
            </span>
          ))}

          <input
            ref={tagInputRef}
            type="text"
            className="lib-rail-tag-input"
            placeholder={tags.length === 0 ? 'Add tag (press Enter)...' : '+ tag...'}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            aria-label="Add new tag"
          />
        </div>
      </div>

      <div className="lib-rail-divider" />

      {/* 3. Collections Section */}
      <div className="lib-rail-section">
        <div className="lib-rail-section-header">
          <span className="lib-rail-label">Collections</span>
        </div>

        <div className="lib-rail-collections-wrap">
          {collections.map((col) => (
            <span key={col} className="lib-rail-collection-chip">
              <Icon name="folder" size={11} className="lib-rail-col-icon" />
              <span>{col}</span>
            </span>
          ))}

          {isAddingCollection ? (
            <form onSubmit={handleAddCollectionSubmit} className="lib-rail-col-form">
              <input
                type="text"
                autoFocus
                className="lib-rail-col-input"
                placeholder="Collection name..."
                value={collectionInput}
                onChange={(e) => setCollectionInput(e.target.value)}
                onBlur={() => {
                  if (!collectionInput.trim()) setIsAddingCollection(false)
                }}
              />
            </form>
          ) : (
            <button
              type="button"
              className="lib-rail-add-btn"
              onClick={() => setIsAddingCollection(true)}
              title="Add to collection"
              aria-label="Add to collection"
            >
              <Icon name="plus" size={11} />
              <span>Collection</span>
            </button>
          )}
        </div>
      </div>

      <div className="lib-rail-divider" />

      {/* 4. Notes Preview */}
      <div className="lib-rail-section">
        <div className="lib-rail-section-header">
          <span className="lib-rail-label">Notes</span>
          {notes && (
            <button
              type="button"
              className="lib-rail-notes-link"
              onClick={onOpenNotesTab}
              title="Edit notes in Notes tab (N)"
            >
              Edit
            </button>
          )}
        </div>

        {notes ? (
          <div
            className="lib-rail-notes-preview"
            onClick={onOpenNotesTab}
            role="button"
            tabIndex={0}
            title="Click to edit notes"
          >
            <p className="lib-rail-notes-text">{notes}</p>
          </div>
        ) : (
          <button
            type="button"
            className="lib-rail-empty-notes"
            onClick={onOpenNotesTab}
          >
            <Icon name="edit" size={12} />
            <span>Add personal notes (N)</span>
          </button>
        )}
      </div>

      {/* 5. Related Saves */}
      {relatedItems.length > 0 && (
        <>
          <div className="lib-rail-divider" />
          <div className="lib-rail-section">
            <div className="lib-rail-section-header">
              <span className="lib-rail-label">Related Saves</span>
              <span className="lib-rail-count">{relatedItems.length}</span>
            </div>

            <div className="lib-rail-related-list">
              {relatedItems.map((rel) => {
                const thumbUrl = api.thumbnailUrl ? api.thumbnailUrl(rel.id) : null
                return (
                  <div
                    key={rel.id}
                    className="lib-rail-related-card"
                    onClick={() => onNavigateItem?.(rel)}
                    role="button"
                    tabIndex={0}
                    title={rel.title}
                  >
                    <div className="lib-rail-related-thumb">
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt=""
                          className="lib-rail-related-img"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                      ) : null}
                      <div className="lib-rail-related-thumb-placeholder">
                        <Icon name={rel.kind === 'video' ? 'play' : 'link'} size={12} />
                      </div>
                    </div>

                    <div className="lib-rail-related-info">
                      <span className="lib-rail-related-title">{rel.title}</span>
                      <span className="lib-rail-related-source">
                        {rel.author || rel.site || rel.app || 'Saved item'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
