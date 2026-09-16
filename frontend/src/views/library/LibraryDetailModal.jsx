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
  useModalDismiss(Boolean(item), onClose)

  const [notes, setNotes] = useState(item?.notes || '')
  const [tagInput, setTagInput] = useState('')
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [tags, setTags] = useState(item?.tags || [])
  const [rating, setRating] = useState(item?.rating || null)
  const [savingNotes, setSavingNotes] = useState(false)
  const [busyAction, setBusyAction] = useState('')

  // Sync state if item changes
  useEffect(() => {
    if (item) {
      setNotes(item.notes || '')
      setTags(item.tags || [])
      setRating(item.rating || null)
    }
  }, [item])

  if (!item) return null

  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)
  const favicon = getFaviconUrl(item.url)
  const hasThumbnail = Boolean(item.thumbnail_path)

  const handleRating = async (stars) => {
    const newRating = rating === stars ? null : stars
    setRating(newRating)
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
    <div
      className="lib-modal-overlay"
      onMouseDown={(e) => onOverlayMouseDown(e, panelRef, onClose)}
    >
      <motion.div
        ref={panelRef}
        className="lib-modal-dialog lib-modal-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={item.title || 'Resource details'}
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Header */}
        <div className="lib-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
            <span className="lib-card-kind-badge">
              <Icon name={KIND_ICON[item.kind] || 'link'} size={12} />
              <span>{item.app || item.kind || 'resource'}</span>
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-faint)' }}>·</span>
            <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
              {domain || item.author || 'LOCAL'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="lib-dock-btn"
                title="Open original website"
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

        {/* Body */}
        <div className="lib-modal-body">
          {/* Main Title & Metadata */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, margin: 0, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              {item.title || 'Untitled Resource'}
            </h1>

            <div className="lib-detail-meta-strip">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {favicon && (
                  <img
                    src={favicon}
                    alt=""
                    style={{ width: 14, height: 14, borderRadius: 3 }}
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  Captured on {fmtDate(item.consumed_on || item.created_at)}
                  {duration ? ` · ${duration}` : ''}
                </span>
              </div>

              {/* Rating Picker */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 14,
                      color: star <= (rating || 0) ? '#eab308' : 'var(--hairline-strong)',
                      padding: '2px',
                    }}
                    onClick={() => handleRating(star)}
                    title={`Rate ${star} star`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Media thumbnail if present */}
          {hasThumbnail && (
            <div style={{ borderRadius: 10, overflow: 'hidden', maxHeight: 280, background: 'var(--surface-2)' }}>
              <img
                src={api.thumbnailUrl(item.id)}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}

          {/* AI Key Insights / Summary */}
          {item.summary ? (
            <div className="lib-detail-summary-card">
              <div className="lib-detail-summary-header">
                <Icon name="spark" size={14} />
                <span>AI Synthesis & Key Takeaways</span>
              </div>
              <p className="lib-detail-summary-text">{item.summary}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                This resource hasn't been synthesized by AI yet.
              </div>
              <button
                type="button"
                className="lib-btn"
                style={{ height: 32, fontSize: 12 }}
                disabled={Boolean(busyAction)}
                onClick={handleEnrich}
              >
                <Icon name="spark" size={13} />
                <span>Summarize with AI</span>
              </button>
            </div>
          )}

          {/* Extracted Entities / Links */}
          {item.resources?.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="lib-form-label">Mentioned Resources & Entities</div>
              <div className="lib-detail-resources-grid">
                {item.resources.map((res, i) => (
                  <div key={i} className="lib-detail-resource-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="lib-card-kind-badge">{res.type || 'link'}</span>
                      <span style={{ fontWeight: 500, color: 'var(--text)' }}>{res.name}</span>
                      {res.detail && (
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>— {res.detail}</span>
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

          {/* Tags */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="lib-form-label">Topics & Tags</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {tags.map((tag) => (
                <span key={tag} className="lib-tag-pill" style={{ padding: '4px 10px' }}>
                  <span>#{tag}</span>
                  <button
                    type="button"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit', marginLeft: 4 }}
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
                      height: 26,
                      fontSize: 11,
                      padding: '2px 8px',
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
                  <Icon name="plus" size={10} />
                  <span>Add tag</span>
                </button>
              )}
            </div>
          </div>

          {/* Personal Notes */}
          <div className="lib-form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label className="lib-form-label" htmlFor="lib-detail-notes">Personal Notes</label>
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
              placeholder="Record your thoughts, highlights, or quotes..."
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="lib-modal-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto' }}>
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
              <Icon name="spark" size={13} />
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
  )
}
