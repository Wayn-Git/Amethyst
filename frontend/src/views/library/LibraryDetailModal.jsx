import { useRef, useState, useEffect } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api, fmtDate } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'
import { formatDuration, getDomain, getFaviconUrl, KIND_ICON } from './LibraryCard.jsx'

export default function LibraryDetailModal({
  item,
  onClose,
  onUpdate,
  onDelete,
  toast,
}) {
  const panelRef = useRef(null)
  const menuRef = useRef(null)
  const ratingRef = useRef(null)
  useModalDismiss(Boolean(item), onClose)

  const [notes, setNotes] = useState(item?.notes || '')
  const [tagInput, setTagInput] = useState('')
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [tags, setTags] = useState(item?.tags || [])
  const [rating, setRating] = useState(item?.rating || null)
  const [savingNotes, setSavingNotes] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showRatingPicker, setShowRatingPicker] = useState(false)

  // Sync state if item changes
  useEffect(() => {
    if (item) {
      setNotes(item.notes || '')
      setTags(item.tags || [])
      setRating(item.rating || null)
    }
  }, [item])

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false)
      }
      if (ratingRef.current && !ratingRef.current.contains(e.target)) {
        setShowRatingPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!item) return null

  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)
  const favicon = getFaviconUrl(item.url)
  const isProcessing =
    Boolean(item.isProcessing) ||
    busyAction === 'enrich' ||
    item.status === 'enriching' ||
    item.status === 'processing' ||
    item.status === 'received'

  const handleRating = async (stars) => {
    const newRating = rating === stars ? null : stars
    setRating(newRating)
    setShowRatingPicker(false)
    try {
      const updated = await api.updateLibraryItem(item.id, { rating: newRating })
      onUpdate?.(updated)
      toast(newRating ? `Rated ${newRating} ★` : 'Rating cleared', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleAddTag = async (e) => {
    e?.preventDefault()
    const clean = tagInput.trim().toLowerCase().replace(/^#/, '')
    if (!clean || tags.includes(clean)) {
      setIsAddingTag(false)
      setTagInput('')
      return
    }
    const nextTags = [...tags, clean]
    setTags(nextTags)
    setTagInput('')
    setIsAddingTag(false)
    try {
      const updated = await api.updateLibraryItem(item.id, { tags: nextTags })
      onUpdate?.(updated)
      toast(`Added #${clean}`, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleRemoveTag = async (tagToRemove) => {
    const nextTags = tags.filter((t) => t !== tagToRemove)
    setTags(nextTags)
    try {
      const updated = await api.updateLibraryItem(item.id, { tags: nextTags })
      onUpdate?.(updated)
      toast(`Removed #${tagToRemove}`, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleSaveNotes = async () => {
    if (savingNotes) return
    setSavingNotes(true)
    try {
      const updated = await api.updateLibraryItem(item.id, { notes: notes.trim() || null })
      onUpdate?.(updated)
      toast('Comment saved', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSavingNotes(false)
    }
  }

  const handleShare = async () => {
    const shareUrl = item.url || window.location.href
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast('Link copied to clipboard', 'ok')
    } catch {
      toast('Could not copy link', 'bad')
    }
  }

  const runAction = async (name, fn, successNote) => {
    setBusyAction(name)
    setShowMenu(false)
    try {
      const res = await fn()
      if (res && typeof res === 'object') onUpdate?.(res)
      if (successNote) toast(successNote, 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusyAction('')
    }
  }

  // Kind label
  const rawKind = item.kind || 'video'
  const kindLabel = rawKind.charAt(0).toUpperCase() + rawKind.slice(1)
  const kindIconName = rawKind === 'video' ? 'video' : KIND_ICON[rawKind] || 'book'

  // Categories list (filter out 'general')
  const categories = item.category && item.category.toLowerCase() !== 'general'
    ? item.category.split(',').map((c) => c.trim()).filter((c) => Boolean(c) && c.toLowerCase() !== 'general')
    : []

  return (
    <motion.div
      className="modal-overlay lib-modal-backdrop"
      onMouseDown={onOverlayMouseDown(onClose)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="modal lib-detail-card-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={item.title || 'Resource Details'}
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="lib-detail-scroll-area">
          {/* Top Media Header */}
          <div className="lib-detail-media-wrap">
            <div className="lib-detail-media-frame">
              {item.media_path ? (
                <video
                  className="lib-detail-media-el"
                  src={api.mediaUrl(item.id)}
                  autoPlay
                  muted
                  loop
                  playsInline
                />
              ) : item.thumbnail_path ? (
                <img
                  className="lib-detail-media-el"
                  src={api.thumbnailUrl(item.id)}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="lib-detail-media-placeholder">
                  <Icon name={kindIconName} size={48} />
                </div>
              )}

              {/* Floating Back Button — Top Left */}
              <button
                type="button"
                className="lib-detail-float-btn lib-detail-float-btn--left"
                onClick={onClose}
                aria-label="Back / Close"
              >
                <Icon name="back" size={16} />
              </button>

              {/* Floating Options Button — Top Right */}
              <div className="lib-detail-menu-anchor" ref={menuRef}>
                <button
                  type="button"
                  className="lib-detail-float-btn lib-detail-float-btn--right"
                  onClick={() => setShowMenu(!showMenu)}
                  aria-label="More options"
                >
                  <Icon name="dots" size={18} />
                </button>

                {showMenu && (
                  <div className="lib-detail-dropdown-menu">
                    <button
                      type="button"
                      className="lib-detail-dropdown-item"
                      onClick={() => runAction('enrich', () => api.enrichLibraryItem(item.id), 'AI summary refreshed')}
                      disabled={busyAction === 'enrich'}
                    >
                      <Icon name="spark" size={14} />
                      <span>{busyAction === 'enrich' ? 'Analysing…' : 'Re-summarise with AI'}</span>
                    </button>
                    {item.indexed && (
                      <button
                        type="button"
                        className="lib-detail-dropdown-item"
                        onClick={() => runAction('reindex', () => api.reindexLibraryItem(item.id), 'Re-indexed')}
                        disabled={busyAction === 'reindex'}
                      >
                        <Icon name="refresh" size={14} />
                        <span>Re-index item</span>
                      </button>
                    )}
                    {item.url && (
                      <button
                        type="button"
                        className="lib-detail-dropdown-item"
                        onClick={() => { handleShare(); setShowMenu(false); }}
                      >
                        <Icon name="copy" size={14} />
                        <span>Copy URL</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="lib-detail-dropdown-item lib-detail-dropdown-item--danger"
                      onClick={() => { onDelete?.(item); onClose(); }}
                    >
                      <Icon name="trash" size={14} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Duration Pill — only when duration exists or item is a video */}
              {(duration || rawKind === 'video') && (
                <div className="lib-detail-duration-pill">
                  <Icon name="play" size={10} weight="fill" />
                  <span>{duration || 'Video'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Modal Body Content */}
          <div className="lib-detail-body">
            {/* Badges Row */}
            <div className="lib-detail-badges-row">
              <span className="lib-detail-pill">
                <Icon name={kindIconName} size={12} />
                <span>{kindLabel}</span>
              </span>

              {categories.map((cat, i) => (
                <span key={i} className="lib-detail-pill">
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </span>
              ))}

              <span className="lib-detail-date-badge">
                · {fmtDate(item.consumed_on || item.created_at)}
              </span>
            </div>

            {/* Title / Headline */}
            <h2 className="lib-detail-headline">{item.title || 'Untitled Resource'}</h2>

            {/* Author / Publisher & Star Rating Row */}
            <div className="lib-detail-author-row">
              <div className="lib-detail-author-left">
                {favicon ? (
                  <img className="lib-detail-avatar-img" src={favicon} alt="" />
                ) : (
                  <div className="lib-detail-avatar-fallback">
                    {(domain ? domain.charAt(0) : 'A').toUpperCase()}
                  </div>
                )}

                <div className="lib-detail-author-meta">
                  <span className="lib-detail-channel-name">{domain || 'LOCAL'}</span>
                  {item.author && (
                    <>
                      <span className="lib-detail-meta-sep">·</span>
                      <span className="lib-detail-author-name">by {item.author}</span>
                    </>
                  )}
                  {item.word_count ? (
                    <>
                      <span className="lib-detail-meta-sep">·</span>
                      <span className="lib-detail-meta-words">{item.word_count} words</span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* Star Rating Badge — real data only, no fake 4.8 */}
              <div className="lib-detail-rating-container" ref={ratingRef}>
                <button
                  type="button"
                  className="lib-detail-rating-trigger"
                  onClick={() => setShowRatingPicker(!showRatingPicker)}
                  title="Click to rate"
                >
                  <Icon
                    name="star"
                    size={14}
                    weight={(rating || item.rating) ? 'fill' : 'regular'}
                    className={(rating || item.rating) ? 'lib-star-gold' : ''}
                  />
                  <span>
                    {(rating || item.rating)
                      ? Number(rating || item.rating).toFixed(1)
                      : 'Rate'}
                  </span>
                </button>

                {showRatingPicker && (
                  <div className="lib-detail-rating-popover">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`lib-rating-star-btn ${(rating || item.rating || 0) >= s ? 'lib-rating-star-btn--active' : ''}`}
                        onClick={() => handleRating(s)}
                      >
                        ★
                      </button>
                    ))}
                    {(rating || item.rating) ? (
                      <button
                        type="button"
                        className="lib-rating-clear-btn"
                        onClick={() => handleRating(rating || item.rating)}
                      >
                        clear
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Description / AI Summary */}
            <div className="lib-detail-desc-wrap">
              {isProcessing ? (
                <div className="lib-detail-skel-wrap">
                  <div className="lib-card-summarizing-pill" style={{ marginBottom: 12 }}>
                    <span className="lib-card-spinner" />
                    <span>{item.kind === 'video' ? 'Summarizing video…' : 'Generating AI summary…'}</span>
                  </div>
                  <div className="skel" style={{ height: 14, width: '95%', borderRadius: 6, marginBottom: 8 }} />
                  <div className="skel" style={{ height: 14, width: '88%', borderRadius: 6, marginBottom: 8 }} />
                  <div className="skel" style={{ height: 14, width: '65%', borderRadius: 6 }} />
                </div>
              ) : item.summary ? (
                <p className="lib-detail-summary-text">{item.summary}</p>
              ) : (
                <p className="lib-detail-summary-text lib-detail-summary-text--empty">
                  {item.enrichment_note || (item.kind === 'video' ? 'No video transcript available to summarise.' : 'No AI summary available for this item.')}
                </p>
              )}
            </div>

            {/* Tags Flow */}
            <div className="lib-detail-tags-wrap">
              {tags.map((t) => (
                <span key={t} className="lib-tag-pill">
                  #{t}
                  <button
                    type="button"
                    className="lib-tag-pill-del"
                    onClick={() => handleRemoveTag(t)}
                    aria-label={`Remove #${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}

              {isAddingTag ? (
                <form onSubmit={handleAddTag} className="lib-tag-add-form">
                  <input
                    className="lib-tag-add-input"
                    autoFocus
                    placeholder="new tag..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onBlur={() => {
                      if (!tagInput.trim()) setIsAddingTag(false)
                    }}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className="lib-tag-add-trigger"
                  onClick={() => setIsAddingTag(true)}
                >
                  + tag
                </button>
              )}
            </div>

            {/* Connected / Featured Resources Card */}
            {item.resources?.length ? (
              <div className="lib-detail-resources-list">
                {item.resources.map((r, idx) => {
                  const rName = typeof r === 'string' ? r : r.name
                  const rType = typeof r === 'string' ? 'resource' : (r.type || 'resource')
                  const rDetail = typeof r === 'string' ? '' : (r.detail || '')
                  const rUrl = typeof r === 'string' ? '' : (r.url || '')
                  const isVideoResource = rType === 'video' || rType === 'show' || rType === 'movie'
                  const isBookResource = rType === 'book'
                  const isMusicResource = rType === 'music' || rType === 'song'

                  return (
                    <a
                      key={idx}
                      href={rUrl || '#'}
                      target={rUrl ? '_blank' : undefined}
                      rel="noreferrer"
                      className={`lib-featured-resource-card ${!rUrl ? 'lib-featured-resource-card--static' : ''}`}
                      onClick={(e) => {
                        if (!rUrl) e.preventDefault()
                      }}
                    >
                      <div className="lib-featured-resource-thumb">
                        <Icon
                          name={
                            isMusicResource
                              ? 'music'
                              : isVideoResource
                              ? 'video'
                              : isBookResource
                              ? 'book'
                              : 'link'
                          }
                          size={18}
                        />
                      </div>
                      <div className="lib-featured-resource-info">
                        <div className="lib-featured-resource-title-row">
                          <span className="lib-featured-resource-title">{rName}</span>
                          <span className="lib-featured-resource-badge">{rType.toUpperCase()}</span>
                        </div>
                        {rDetail ? (
                          <span className="lib-featured-resource-detail">
                            {rDetail}
                          </span>
                        ) : null}
                      </div>
                      <div className="lib-featured-resource-link">
                        {rUrl ? (
                          <>
                            <span className="mono">{getDomain(rUrl) || 'Visit link'}</span>
                            <span className="lib-featured-resource-arrow">↗</span>
                          </>
                        ) : (
                          <span>Mentioned in {rawKind}</span>
                        )}
                      </div>
                    </a>
                  )
                })}
              </div>
            ) : isProcessing ? (
              <div className="lib-detail-resources-discovering mono">
                <span className="lib-card-spinner" />
                <span>Discovering movie, show & tool links…</span>
              </div>
            ) : null}

            {/* "Your thoughts..." Section */}
            <div className="lib-detail-thoughts-wrap">
              <label className="lib-detail-thoughts-title">Your thoughts...</label>
              <div className="lib-detail-comment-bar">
                <div className="lib-detail-comment-user">
                  <Icon name="user" size={14} />
                </div>
                <input
                  type="text"
                  className="lib-detail-comment-input"
                  placeholder="Add a comment..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleSaveNotes()
                    }
                  }}
                />
                <button
                  type="button"
                  className={`lib-detail-comment-submit ${notes !== (item.notes || '') && notes.trim() ? 'lib-detail-comment-submit--active' : ''}`}
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  aria-label="Send comment"
                >
                  <Icon name="send" size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Actions Footer */}
        <div className="lib-detail-bottom-footer">
          <div className="lib-detail-footer-group">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="lib-footer-action-btn">
                <Icon name="link" size={14} />
                <span>Open</span>
              </a>
            ) : null}

            <button type="button" className="lib-footer-action-btn" onClick={handleShare}>
              <Icon name="share" size={14} />
              <span>Share</span>
            </button>
          </div>

          <button
            type="button"
            className="lib-footer-action-btn lib-footer-action-btn--danger"
            disabled={busyAction === 'delete'}
            onClick={() => {
              onDelete?.(item)
              onClose()
            }}
          >
            <Icon name="trash" size={14} />
            <span>Delete</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
