import { useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion } from 'framer-motion'
import { api, fmtDate } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'
import { formatDuration, getDomain } from './LibraryCard.jsx'

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
  const [tags, setTags] = useState(item?.tags || [])
  const [rating, setRating] = useState(item?.rating || null)
  const [savingField, setSavingField] = useState(false)
  const [busyAction, setBusyAction] = useState('')

  if (!item) return null

  const domain = getDomain(item.url, item.site)
  const duration = formatDuration(item.duration_seconds)

  const handleRating = async (stars) => {
    const newRating = rating === stars ? null : stars
    setRating(newRating)
    try {
      const updated = await api.updateLibraryItem(item.id, { rating: newRating })
      onUpdate?.(updated)
      toast('Rating saved', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleAddTag = async (e) => {
    e?.preventDefault()
    const clean = tagInput.trim().toLowerCase().replace(/^#/, '')
    if (!clean || tags.includes(clean)) return
    const nextTags = [...tags, clean]
    setTags(nextTags)
    setTagInput('')
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
    setSavingField(true)
    try {
      const updated = await api.updateLibraryItem(item.id, { notes: notes.trim() || null })
      onUpdate?.(updated)
      toast('Notes updated', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSavingField(false)
    }
  }

  const runAction = async (name, fn, successNote) => {
    setBusyAction(name)
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

  return (
    <motion.div className="modal-overlay" onMouseDown={onOverlayMouseDown(onClose)}>
      <motion.div
        className="modal lib-detail-modal"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={item.title || 'Resource Details'}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <div className="modal-head">
          <div className="lib-detail-badges">
            <span className="lib-kind-badge mono">{item.kind || 'article'}</span>
            {item.category && (
              <span className="lib-category-badge mono">{item.category}</span>
            )}
            {duration && <span className="lib-duration-badge mono">{duration}</span>}
          </div>
          <button
            type="button"
            className="icon-btn modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="lib-detail-content">
          {/* Title & External Link */}
          <h2 className="lib-detail-title">{item.title || 'Untitled Resource'}</h2>

          <div className="lib-detail-meta mono">
            {domain && <span>{domain}</span>}
            {item.author && <span>by {item.author}</span>}
            <span>Consumed: {fmtDate(item.consumed_on || item.created_at)}</span>
            {item.text_source && item.text_source !== 'none' && (
              <span>Source: {item.text_source}</span>
            )}
          </div>

          {/* Rating */}
          <div className="lib-detail-rating-row">
            <span className="lib-detail-section-label mono">Rating</span>
            <div className="lib-stars" role="group" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  className={`lib-star-btn ${rating >= star ? 'lib-star-btn--filled' : ''}`}
                  onClick={() => handleRating(star)}
                  aria-label={`${star} star${star > 1 ? 's' : ''}`}
                >
                  ★
                </button>
              ))}
              {rating ? (
                <button
                  type="button"
                  className="lib-star-clear mono"
                  onClick={() => handleRating(rating)}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {/* Media preview if available */}
          {item.thumbnail_path && (
            <div className="lib-detail-preview">
              <img
                className="lib-detail-img"
                src={api.thumbnailUrl(item.id)}
                alt=""
                loading="lazy"
              />
            </div>
          )}

          {/* AI Summary */}
          <div className="lib-detail-section">
            <div className="lib-detail-section-head">
              <span className="lib-detail-section-label mono">
                <Icon name="spark" size={13} /> Summary
              </span>
              {item.enrichment_model && (
                <span className="lib-detail-model mono">{item.enrichment_model}</span>
              )}
            </div>
            {item.summary ? (
              <p className="lib-detail-summary">{item.summary}</p>
            ) : (
              <p className="lib-detail-empty-summary">
                {item.enrichment_note || 'No AI summary generated yet for this resource.'}
              </p>
            )}
          </div>

          {/* Tags */}
          <div className="lib-detail-section">
            <span className="lib-detail-section-label mono">Tags</span>
            <div className="lib-detail-tags">
              {tags.map((tag) => (
                <span key={tag} className="lib-detail-tag">
                  #{tag}
                  <button
                    type="button"
                    className="lib-tag-remove"
                    onClick={() => handleRemoveTag(tag)}
                    aria-label={`Remove #${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <form onSubmit={handleAddTag} className="lib-tag-form">
                <input
                  className="lib-tag-input"
                  placeholder="+ Add tag..."
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                />
              </form>
            </div>
          </div>

          {/* Named Entities / Resources */}
          {item.resources?.length ? (
            <div className="lib-detail-section">
              <span className="lib-detail-section-label mono">
                Extracted Entities & References ({item.resources.length})
              </span>
              <ul className="lib-resources">
                {item.resources.map((r, idx) => (
                  <li key={idx} className="lib-detail-resource-item">
                    <span className="lib-resource-kind mono">{r.type}</span>
                    <span className="lib-detail-resource-name">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.name}
                        </a>
                      ) : (
                        r.name
                      )}
                    </span>
                    {r.detail && (
                      <span className="lib-resource-detail"> — {r.detail}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Notes Editor */}
          <div className="lib-detail-section">
            <span className="lib-detail-section-label mono">Personal Notes</span>
            <textarea
              className="lib-input lib-detail-notes-input"
              rows={3}
              placeholder="Add your takeaways, thoughts, quotes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            {notes !== (item.notes || '') && (
              <button
                type="button"
                className="btn btn--small btn--primary"
                style={{ marginTop: 8 }}
                disabled={savingField}
                onClick={handleSaveNotes}
              >
                {savingField ? 'Saving notes...' : 'Save notes'}
              </button>
            )}
          </div>

          {/* Capture Note */}
          {item.capture_note && (
            <div className="lib-detail-note-callout">
              <Icon name="info" size={14} />
              <span>{item.capture_note}</span>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="lib-detail-footer">
          <div className="lib-detail-footer-left">
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="btn btn--ghost btn--small"
              >
                <Icon name="link" size={13} /> Open Source
              </a>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={busyAction === 'enrich'}
              onClick={() =>
                runAction('enrich', () => api.enrichLibraryItem(item.id), 'Summarised with AI')
              }
            >
              <Icon name="spark" size={13} />{' '}
              {busyAction === 'enrich' ? 'Analysing...' : 'Re-summarise'}
            </button>
            {item.indexed && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={busyAction === 'reindex'}
                onClick={() =>
                  runAction('reindex', () => api.reindexLibraryItem(item.id), 'Indexed again')
                }
              >
                <Icon name="refresh" size={13} />{' '}
                {busyAction === 'reindex' ? 'Indexing...' : 'Re-index'}
              </button>
            )}
          </div>

          <div className="lib-detail-footer-right">
            <button
              type="button"
              className="btn btn--ghost btn--small lib-btn-danger"
              disabled={busyAction === 'delete'}
              onClick={() => {
                onDelete?.(item)
                onClose()
              }}
            >
              <Icon name="trash" size={13} /> Delete
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
