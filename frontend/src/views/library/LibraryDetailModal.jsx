import { useRef, useState, useEffect, useMemo } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'
import { formatDuration, getDomain, getFaviconUrl, KIND_ICON } from './LibraryCard.jsx'
import { RATING_TIERS, getRatingTier } from './ratingUtils.js'
import { formatDisplayDate, formatFullDateTime, formatRelativeDate } from './dateUtils.js'

export default function LibraryDetailModal({
  item,
  onClose,
  onUpdate,
  onDelete,
  toast,
}) {
  const panelRef = useRef(null)
  useModalDismiss(Boolean(item), onClose)

  const [notes, setNotes] = useState(item?.notes || '')
  const [tagInput, setTagInput] = useState('')
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [tags, setTags] = useState(item?.tags || [])
  const [rating, setRating] = useState(item?.rating || null)
  const [hoveredStar, setHoveredStar] = useState(null)
  const [savingNotes, setSavingNotes] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [showLightbox, setShowLightbox] = useState(false)

  // Sync state if item changes
  useEffect(() => {
    if (item) {
      setNotes(item.notes || '')
      setTags(item.tags || [])
      setRating(item.rating || null)
    }
  }, [item])

  const activeRatingTier = useMemo(() => getRatingTier(rating), [rating])
  const previewRatingTier = useMemo(() => getRatingTier(hoveredStar), [hoveredStar])
  const displayedTier = previewRatingTier || activeRatingTier

  const rawDate = item?.consumed_on || item?.created_at
  const dateFull = useMemo(() => formatDisplayDate(rawDate, true), [rawDate])
  const dateFullWithTime = useMemo(() => formatFullDateTime(rawDate), [rawDate])
  const dateRelative = useMemo(() => formatRelativeDate(rawDate), [rawDate])

  if (!item) return null

  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)
  const favicon = getFaviconUrl(item.url)
  const hasThumbnail = Boolean(item.thumbnail_path)

  const handleRating = async (stars) => {
    const newRating = rating === stars ? null : stars
    setRating(newRating)
    const tier = getRatingTier(newRating)
    try {
      const updated = await api.updateLibraryItem(item.id, { rating: newRating })
      onUpdate?.(updated)
      if (tier) {
        toast(`Curated as ${tier.label} (${tier.stars}★)`, 'ok')
      } else {
        toast('Rating cleared', 'ok')
      }
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
    setSavingNotes(true)
    try {
      const updated = await api.updateLibraryItem(item.id, { notes: notes.trim() || null })
      onUpdate?.(updated)
      toast('Notes saved', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSavingNotes(false)
    }
  }

  const handleEnrich = async () => {
    setBusyAction('enrich')
    try {
      const updated = await api.enrichLibraryItem(item.id)
      onUpdate?.(updated)
      toast('Synthesized with AI', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusyAction('')
    }
  }

  const handleReindex = async () => {
    setBusyAction('reindex')
    try {
      const updated = await api.reindexLibraryItem(item.id)
      onUpdate?.(updated)
      toast('Re-indexed for semantic search', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusyAction('')
    }
  }

  return (
    <>
      <div
        className="lib-modal-overlay"
        onMouseDown={(e) => onOverlayMouseDown(e, panelRef, onClose)}
      >
        <motion.div
          ref={panelRef}
          className="lib-modal-dialog lib-modal-dialog--card"
          role="dialog"
          aria-modal="true"
          aria-label={item.title || 'Resource details'}
          initial={{ opacity: 0, scale: 0.96, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 14 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* ========================================================
              TOP NAVIGATION & UN-HIDEABLE DATE BAR
              ======================================================== */}
          <div className="lib-modal-header">
            <div className="lib-modal-header-meta">
              <span className="lib-card-kind-badge">
                <Icon name={KIND_ICON[item.kind] || 'link'} size={12} />
                <span>{item.app || item.kind || 'resource'}</span>
              </span>

              {favicon && (
                <img
                  src={favicon}
                  alt=""
                  style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0 }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}
              <span className="lib-modal-domain">
                {domain || item.author || (item.kind === 'note' ? 'PERSONAL NOTE' : 'LOCAL')}
              </span>

              {/* Prominent, Un-hideable Date in Modal Header */}
              <div className="lib-modal-date-chip" title={`Captured on ${dateFullWithTime || dateFull}`}>
                <Icon name="calendar" size={12} />
                <span>{dateFull || 'Undated'}</span>
                {dateRelative && <span className="lib-modal-date-rel">({dateRelative})</span>}
                {duration && <span className="opacity-70">· {duration}</span>}
              </div>
            </div>

            <div className="lib-modal-header-actions">
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="lib-dock-btn"
                  title="Open original link"
                >
                  <Icon name="link" size={14} />
                </a>
              )}
              <button
                type="button"
                className="lib-modal-close"
                onClick={onClose}
                aria-label="Close modal"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          </div>

          {/* ========================================================
              SCROLLABLE CARD BODY
              ======================================================== */}
          <div className="lib-modal-body">
            {/* 1. Complete Uncropped Hero Media Showcase */}
            {hasThumbnail && (
              <div className="lib-modal-hero-showcase">
                {/* Ambient Blurred Backdrop matching the artwork colors */}
                <div
                  className="lib-modal-hero-ambient"
                  style={{ backgroundImage: `url(${api.thumbnailUrl(item.id)})` }}
                  aria-hidden="true"
                />

                {/* Foreground Full Uncropped Image */}
                <img
                  src={api.thumbnailUrl(item.id)}
                  alt={item.title || 'Resource media cover'}
                  className="lib-modal-hero-img"
                  onClick={() => setShowLightbox(true)}
                  title="Click to view full resolution"
                />

                {/* Floating Media Controls Pill */}
                <div className="lib-modal-hero-dock">
                  <button
                    type="button"
                    className="lib-modal-hero-btn"
                    onClick={() => setShowLightbox(true)}
                    title="Inspect in full resolution lightbox"
                  >
                    <Icon name="maximize" size={13} />
                    <span>Full View</span>
                  </button>
                  {duration && (
                    <span className="lib-modal-hero-duration">
                      <Icon name="play" size={11} />
                      <span>{duration}</span>
                    </span>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="lib-modal-hero-btn"
                      title="Open original website"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon name="link" size={13} />
                      <span>Source</span>
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* 2. Main Title */}
            <h1 className="lib-modal-heading">
              {item.title || 'Untitled Resource'}
            </h1>

            {/* 3. Secondary Metadata Strip with Explicit Date */}
            <div className="lib-modal-meta-strip">
              <div className="lib-modal-meta-item" title="Exact capture timestamp">
                <Icon name="calendar" size={13} />
                <span>Captured on {dateFullWithTime || dateFull || 'Undated'}</span>
              </div>
              {item.author && (
                <div className="lib-modal-meta-item">
                  <Icon name="user" size={13} />
                  <span>By {item.author}</span>
                </div>
              )}
              {duration && (
                <div className="lib-modal-meta-item">
                  <Icon name="clock" size={13} />
                  <span>{duration} duration</span>
                </div>
              )}
              <div className="lib-modal-meta-item" style={{ marginLeft: 'auto' }}>
                <span className="lib-card-live-dot" />
                <span style={{ color: 'var(--text-faint)' }}>Semantic Vector Indexed</span>
              </div>
            </div>

            {/* 4. Curator Significance Rating Widget */}
            <div className="lib-detail-rating-card">
              <div className="lib-detail-rating-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name="star" size={15} filled={Boolean(rating)} style={{ color: displayedTier?.color || 'var(--text-faint)' }} />
                  <span className="lib-detail-rating-title">Curator Significance</span>
                </div>

                {displayedTier ? (
                  <span
                    className={`lib-detail-rating-pill ${displayedTier.badgeClass}`}
                    style={{ borderColor: displayedTier.color }}
                  >
                    ★ {displayedTier.stars} · {displayedTier.label}
                  </span>
                ) : (
                  <span className="lib-detail-rating-pill lib-detail-rating-pill--unrated">
                    Unrated
                  </span>
                )}
              </div>

              {/* 5-Star interactive button picker */}
              <div className="lib-detail-stars-row">
                {[1, 2, 3, 4, 5].map((star) => {
                  const isFilled = (hoveredStar ?? rating ?? 0) >= star
                  return (
                    <button
                      key={star}
                      type="button"
                      className="lib-detail-star-btn"
                      onMouseEnter={() => setHoveredStar(star)}
                      onMouseLeave={() => setHoveredStar(null)}
                      onClick={() => handleRating(star)}
                      title={`Assign ${star} Star (${RATING_TIERS[star].label}): ${RATING_TIERS[star].description}`}
                    >
                      <Icon
                        name="star"
                        size={22}
                        filled={isFilled}
                        style={{
                          color: isFilled ? (RATING_TIERS[star]?.color || '#eab308') : 'var(--hairline-strong)',
                          transform: hoveredStar === star ? 'scale(1.22)' : 'scale(1)',
                          transition: 'transform 140ms ease, color 140ms ease',
                        }}
                      />
                    </button>
                  )
                })}

                {rating && (
                  <button
                    type="button"
                    className="lib-detail-clear-rating"
                    onClick={() => handleRating(rating)}
                    title="Clear rating"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Semantic tier explanation */}
              <p className="lib-detail-rating-desc">
                {displayedTier
                  ? displayedTier.description
                  : 'Assign significance to boost retrieval priority in AI searches and curate your personal high-impact collection.'}
              </p>
            </div>

            {/* 5. AI Key Insights / Summary */}
            {item.summary ? (
              <div className="lib-detail-summary-card">
                <div className="lib-detail-summary-header">
                  <Icon name="brain" size={15} />
                  <span>AI Synthesis & Key Insights</span>
                </div>
                <p className="lib-detail-summary-text">{item.summary}</p>
              </div>
            ) : (
              <div className="lib-detail-empty-summary">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon name="brain" size={16} className="opacity-60" />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    No AI synthesis yet. Run deep analysis to extract structured concepts.
                  </span>
                </div>
                <button
                  type="button"
                  className="lib-btn lib-btn--primary"
                  style={{ height: 30, fontSize: 12 }}
                  disabled={Boolean(busyAction)}
                  onClick={handleEnrich}
                >
                  <Icon name="spark" size={13} />
                  <span>Summarize with AI</span>
                </button>
              </div>
            )}

            {/* 6. Extracted Entities / Links */}
            {item.resources?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="lib-form-label">Mentioned Resources & Entities</div>
                <div className="lib-detail-resources-grid">
                  {item.resources.map((res, i) => (
                    <div key={i} className="lib-detail-resource-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="lib-card-kind-badge">{res.type || 'link'}</span>
                        <span style={{ fontWeight: 500, color: 'var(--text)', fontSize: 13 }}>{res.name}</span>
                        {res.detail && (
                          <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>— {res.detail}</span>
                        )}
                      </div>
                      {res.url && (
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noreferrer"
                          className="lib-dock-btn"
                          title={res.url}
                        >
                          <Icon name="link" size={12} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 7. Topics & Tags */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="lib-form-label">Topics & Taxonomy Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {tags.map((tag) => (
                  <span key={tag} className="lib-tag-pill" style={{ padding: '5px 10px', fontSize: 12 }}>
                    <span>#{tag}</span>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', marginLeft: 6 }}
                      onClick={() => handleRemoveTag(tag)}
                      title={`Remove #${tag}`}
                    >
                      ×
                    </button>
                  </span>
                ))}

                {isAddingTag ? (
                  <form onSubmit={handleAddTag} style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      autoFocus
                      placeholder="New tag..."
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onBlur={() => {
                        if (!tagInput.trim()) setIsAddingTag(false)
                      }}
                      style={{
                        height: 28,
                        fontSize: 12,
                        padding: '3px 10px',
                        borderRadius: 9999,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--accent)',
                        outline: 'none',
                        color: 'var(--text)',
                      }}
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="lib-tag-pill"
                    onClick={() => setIsAddingTag(true)}
                    style={{ borderStyle: 'dashed' }}
                  >
                    <Icon name="plus" size={11} />
                    <span>Add tag</span>
                  </button>
                )}
              </div>
            </div>

            {/* 8. Personal Notes */}
            <div className="lib-form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="lib-form-label" htmlFor="lib-detail-notes">Personal Notes & Synthesis</label>
                {notes !== (item.notes || '') && (
                  <button
                    type="button"
                    className="lib-btn lib-btn--primary"
                    style={{ height: 28, fontSize: 11, padding: '0 10px' }}
                    disabled={savingNotes}
                    onClick={handleSaveNotes}
                  >
                    {savingNotes ? 'Saving...' : 'Save Notes'}
                  </button>
                )}
              </div>
              <textarea
                id="lib-detail-notes"
                className="lib-form-textarea"
                placeholder="Record your personal notes, key synthesis, or quotes..."
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>

          {/* ========================================================
              FOOTER ACTIONS
              ======================================================== */}
          <div className="lib-modal-footer">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 'auto' }}>
              <button
                type="button"
                className="lib-btn"
                disabled={Boolean(busyAction)}
                onClick={handleReindex}
                title="Re-run vector embeddings indexer"
              >
                <Icon name="refresh" size={13} />
                <span>Re-index</span>
              </button>
              <button
                type="button"
                className="lib-btn"
                disabled={Boolean(busyAction)}
                onClick={handleEnrich}
                title="Re-read with AI"
              >
                <Icon name="brain" size={13} />
                <span>Re-analyze</span>
              </button>
            </div>

            <button
              type="button"
              className="lib-btn"
              style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}" from library?`)) {
                  onDelete?.(item)
                  onClose()
                }
              }}
            >
              <Icon name="trash" size={13} />
              <span>Delete</span>
            </button>
          </div>
        </motion.div>
      </div>

      {/* High-Resolution Lightbox Modal */}
      <AnimatePresence>
        {showLightbox && hasThumbnail && (
          <div
            className="lib-lightbox-overlay"
            onClick={() => setShowLightbox(false)}
          >
            <motion.div
              className="lib-lightbox-content"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={api.thumbnailUrl(item.id)}
                alt={item.title || 'Full resolution thumbnail'}
                className="lib-lightbox-img"
              />
              <button
                type="button"
                className="lib-lightbox-close"
                onClick={() => setShowLightbox(false)}
                title="Close full view (Esc)"
              >
                <Icon name="x" size={16} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
