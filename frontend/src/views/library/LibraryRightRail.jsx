import React, { useState, useEffect, useRef } from 'react'
import Icon from '../../components/Icon.jsx'
import AppButton from '../../components/ui/AppButton.jsx'
import LibraryDetailRow from './LibraryDetailRow.jsx'
import { formatRelativeDate } from './dateUtils.js'
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
  const [isAddingTag, setIsAddingTag] = useState(false)
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
    if (!item?.id) return
    let active = true
    setLoadingRelated(true)

    // Filter out common noise words to find meaningful topic keywords
    const STOPWORDS = new Set([
      'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'it', 'by', 'as', 'this',
      'that', 'from', 'wake', 'up', 'just', 'new', 'brand', 'dropped', 'banger', 'post', 'item', 'save', 'video',
      'reel', 'tiktok', 'instagram', 'youtube', 'clip', 'shorts', 'watch', 'now', 'today'
    ])

    const titleWords = (item.title || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))

    const firstTag = tags.length > 0 ? tags[0].replace(/^#/, '') : ''
    const searchQuery = firstTag || titleWords.slice(0, 3).join(' ') || item.author || ''

    const fetchRelated = api.library
      ? api.library({
          q: searchQuery,
          kind: item.kind === 'video' ? 'video' : undefined,
          limit: 12,
        })
      : null

    if (fetchRelated && typeof fetchRelated.then === 'function') {
      fetchRelated
        .then((res) => {
          if (!active) return
          const raw = res?.items || (Array.isArray(res) ? res : [])
          // Filter out the active item itself and rank matches
          const candidates = raw.filter((it) => it && it.id !== item.id)
          // Sort by relevance: matching kind (+4), matching author (+2)
          candidates.sort((a, b) => {
            const aSameKind = a.kind === item.kind ? 4 : 0
            const bSameKind = b.kind === item.kind ? 4 : 0
            const aSameAuthor = a.author && a.author === item.author ? 2 : 0
            const bSameAuthor = b.author && b.author === item.author ? 2 : 0
            return (bSameKind + bSameAuthor) - (aSameKind + aSameAuthor)
          })
          setRelatedItems(candidates.slice(0, 4))
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
  }, [item?.id, item?.title, item?.kind, item?.author, tags])

  const isFavorite = Boolean(rating && rating >= 4) || Boolean(item?.is_favorite)

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const clean = tagInput.trim().replace(/^#/, '')
      if (clean) {
        onAddTag?.(clean)
        setTagInput('')
        setIsAddingTag(false)
      }
    } else if (e.key === 'Escape') {
      setIsAddingTag(false)
      setTagInput('')
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
      onAddTag?.(`collection:${clean}`)
    }
  }

  return (
    <aside className="lib-right-rail" aria-label="Item metadata and curation">
      {/* 1. Favorite / Pin Toggle + Prior Rating */}
      <div className="lib-rail-section">
        <div className="lib-rail-favorite-row">
          <AppButton
            variant="secondary"
            size="medium"
            className={`lib-rail-fav-btn ${isFavorite ? 'lib-rail-fav-btn--active' : ''}`}
            onClick={onToggleFavorite}
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={isFavorite}
            icon={
              <Icon
                name="star"
                size={14}
                filled={isFavorite}
                className={isFavorite ? 'lib-star--active' : ''}
              />
            }
          >
            {isFavorite ? 'Favorited' : 'Favorite'}
          </AppButton>

          {/* Show stars only if prior rating data already exists */}
          {rating && rating > 0 && (
            <div className="lib-rail-prior-rating" title={`Rated ${rating}/5`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Icon
                  key={i}
                  name="star"
                  size={12}
                  filled={i < rating}
                  className={i < rating ? 'lib-star-gold' : 'lib-star-dim'}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="lib-rail-divider" />

      {/* 2. Tags Section (UI font, not mono) */}
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
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}

          {isAddingTag ? (
            <input
              ref={tagInputRef}
              type="text"
              autoFocus
              className="lib-rail-tag-input"
              placeholder="Tag name..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => {
                if (!tagInput.trim()) setIsAddingTag(false)
              }}
              aria-label="Add new tag"
            />
          ) : (
            <button
              type="button"
              className="lib-rail-text-btn"
              onClick={() => {
                setIsAddingTag(true)
                setTimeout(() => tagInputRef.current?.focus(), 50)
              }}
              aria-label="Add tag"
            >
              + Add tag
            </button>
          )}
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
              <Icon name="folder" size={12} className="lib-rail-col-icon" />
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
              className="lib-rail-text-btn"
              onClick={() => setIsAddingCollection(true)}
              aria-label="Add collection"
            >
              + Collection
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
            className="lib-rail-text-btn"
            onClick={onOpenNotesTab}
          >
            + Add notes
          </button>
        )}
      </div>

      {/* 5. Related Saves: Plain section with dividers, using shared LibraryDetailRow */}
      {(loadingRelated || relatedItems.length > 0) && (
        <>
          <div className="lib-rail-divider" />
          <div className="lib-rail-section">
            <div className="lib-rail-section-header">
              <span className="lib-rail-label">Related Saves</span>
              {relatedItems.length > 0 && (
                <span className="lib-rail-count">{relatedItems.length}</span>
              )}
            </div>

            <div className="lib-rail-related-list">
              {loadingRelated && relatedItems.length === 0 ? (
                <div className="lib-rail-related-skeleton" aria-label="Loading related saves">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="lib-related-skeleton-row">
                      <div className="lib-related-skeleton-thumb" />
                      <div className="lib-related-skeleton-content">
                        <div className="lib-related-skeleton-line lib-related-skeleton-line--title" />
                        <div className="lib-related-skeleton-line lib-related-skeleton-line--sub" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                relatedItems.map((rel, i) => {
                  const thumbUrl = api.thumbnailUrl ? api.thumbnailUrl(rel.id) : null
                  const source = rel.author || rel.site || rel.app || 'Saved item'
                  const isVid = rel.kind === 'video'
                  const relDate = rel.created_at || rel.consumed_on ? formatRelativeDate(rel.created_at || rel.consumed_on) : null
                  const subtitle = relDate ? `${source} · ${relDate}` : source

                  return (
                    <React.Fragment key={rel.id}>
                      {i > 0 && <div className="lib-detail-divider" />}
                      <LibraryDetailRow
                        thumbnail={thumbUrl}
                        icon={<Icon name={isVid ? 'play' : 'link'} size={14} />}
                        title={rel.title}
                        titleFallback={source}
                        subtitle={subtitle}
                        kind={rel.kind && rel.kind !== 'other' ? rel.kind : null}
                        isVideo={isVid}
                        onClick={() => onNavigateItem?.(rel)}
                        actions={
                          <AppButton
                            variant="ghost"
                            size="sm"
                            onClick={() => onNavigateItem?.(rel)}
                            title="Open item"
                            icon={<Icon name="arrow-up-right" size={14} />}
                          />
                        }
                      />
                    </React.Fragment>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  )
}
