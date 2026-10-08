import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'
import { formatDuration, getDomain, getFaviconUrl, KIND_ICON } from './LibraryCard.jsx'
import { RATING_TIERS, getRatingTier } from './ratingUtils.js'
import { formatDisplayDate, formatFullDateTime, formatRelativeDate } from './dateUtils.js'

export function formatModelDisplayName(modelStr) {
  if (!modelStr) return 'AI Synthesis'
  const clean = String(modelStr).trim()
  if (clean.includes('ministral-8b') || clean.includes('ministral')) return 'Ministral 8B'
  if (clean.includes('mistral-large')) return 'Mistral Large'
  if (clean.includes('mistral-small')) return 'Mistral Small'
  if (clean.includes('mistral')) return 'Mistral'
  if (clean.includes('whisper')) return 'Whisper v3'
  if (clean.includes('llama-3.3') || clean.includes('llama-3-3')) return 'LLaMA 3.3 70B'
  if (clean.includes('llama-3.1') || clean.includes('llama-3-1')) return 'LLaMA 3.1'
  if (clean.includes('llama-3') || clean.includes('llama-3-8b')) return 'LLaMA 3 8B'
  if (clean.includes('gpt-4o-mini')) return 'GPT-4o Mini'
  if (clean.includes('gpt-4o')) return 'GPT-4o'
  if (clean.includes('gpt-4')) return 'GPT-4'
  if (clean.includes('claude-3-5') || clean.includes('claude-3.5')) return 'Claude 3.5'
  if (clean.includes('gemini-2') || clean.includes('gemini-1.5')) return 'Gemini'
  if (clean.startsWith('cloudflare:') || clean.startsWith('@cf/')) {
    const parts = clean.split('/')
    const model = parts[parts.length - 1] || 'Workers AI'
    return `Cloudflare · ${model.replace(/^@cf\//, '')}`
  }
  if (clean.startsWith('groq:')) return `Groq · ${clean.replace('groq:', '')}`
  if (clean.startsWith('ollama:')) return `Ollama · ${clean.replace('ollama:', '')}`
  return clean.split(':')[0] || 'AI Synthesis'
}

export function extractTranscript(content, excerpt, textSource) {
  if (!content && !excerpt) return null
  const src = content || excerpt
  const marker = '## Transcript'
  const idx = src.indexOf(marker)
  if (idx !== -1) {
    let t = src.slice(idx + marker.length)
    const nextHeaderIdx = t.search(/\n## /)
    const footerIdx = t.indexOf('---')
    let cut = t.length
    if (nextHeaderIdx !== -1) cut = Math.min(cut, nextHeaderIdx)
    if (footerIdx !== -1) cut = Math.min(cut, footerIdx)
    return t.slice(0, cut).trim()
  }
  if (textSource && textSource.includes('transcript')) {
    if (content && content.includes('\n\n')) {
      const parts = content.split('\n\n')
      const filtered = parts.filter(p => (
        !p.startsWith('# ') &&
        !p.startsWith('Tags:') &&
        !p.startsWith('## Mentioned') &&
        !p.startsWith('## Slide') &&
        !p.startsWith('## Visual') &&
        !p.startsWith('## Caption') &&
        !p.startsWith('---') &&
        !p.startsWith('- ')
      ))
      if (filtered.length > 1) {
        return filtered.slice(1).join('\n\n').trim()
      }
    }
  }
  return null
}

export function extractVisualContent(content) {
  if (!content) return null
  const markers = ['## Slide Analysis', '## Visual Content']
  for (const marker of markers) {
    const idx = content.indexOf(marker)
    if (idx !== -1) {
      let t = content.slice(idx + marker.length)
      const nextHeaderIdx = t.search(/\n## /)
      const footerIdx = t.indexOf('---')
      let cut = t.length
      if (nextHeaderIdx !== -1) cut = Math.min(cut, nextHeaderIdx)
      if (footerIdx !== -1) cut = Math.min(cut, footerIdx)
      return t.slice(0, cut).trim()
    }
  }
  return null
}

export function getCleanDomain(url) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function getResourceIcon(type, url) {
  const t = (type || '').toLowerCase()
  if (t === 'movie' || t === 'film' || t === 'show' || t === 'video') return 'video'
  if (t === 'code' || t === 'repo' || t === 'tool' || t === 'software' || t === 'library') return 'code'
  if (t === 'person' || t === 'creator' || t === 'author') return 'user'
  if (t === 'book' || t === 'article' || t === 'paper') return 'book'
  if (url) return 'globe'
  return 'link'
}

export function formatFriendlyEnrichmentNote(note) {
  if (!note) return null
  const s = String(note).trim()
  if (s.includes('none of the configured providers answered') || s.includes('could not be reached')) {
    return 'AI provider was unreachable during capture'
  }
  if (s.includes('did not answer within') || s.includes('Timeout')) {
    return 'AI model timed out during capture'
  }
  if (s.includes('there is no text for this one')) {
    return 'No speech or caption was detected for this item'
  }
  if (s.includes('the text is a line or two')) {
    return 'Content was too brief for automatic synthesis'
  }
  return s.length > 90 ? `${s.slice(0, 87)}...` : s
}

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
  const [copiedSummary, setCopiedSummary] = useState(false)
  const [enrichError, setEnrichError] = useState(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showVisualContent, setShowVisualContent] = useState(false)

  // Sync state if item changes
  useEffect(() => {
    if (item) {
      setNotes(item.notes || '')
      setTags(item.tags || [])
      setRating(item.rating || null)
      setEnrichError(null)
      setShowTranscript(false)
      setShowVisualContent(false)
    }
  }, [item])

  const transcript = useMemo(
    () => extractTranscript(item?.content, item?.excerpt || item?.capture_note, item?.text_source),
    [item?.content, item?.excerpt, item?.capture_note, item?.text_source]
  )
  const transcriptWordCount = useMemo(() => {
    if (!transcript) return 0
    return transcript.trim().split(/\s+/).length
  }, [transcript])

  const visualContent = useMemo(
    () => extractVisualContent(item?.content),
    [item?.content]
  )
  const visualWordCount = useMemo(() => {
    if (!visualContent) return 0
    return visualContent.trim().split(/\s+/).length
  }, [visualContent])

  const activeRatingTier = useMemo(() => getRatingTier(rating), [rating])
  const previewRatingTier = useMemo(() => getRatingTier(hoveredStar), [hoveredStar])
  const displayedTier = previewRatingTier || activeRatingTier

  const rawDate = item?.consumed_on || item?.created_at
  const dateFull = useMemo(() => formatDisplayDate(rawDate, true), [rawDate])
  const dateFullWithTime = useMemo(() => formatFullDateTime(rawDate), [rawDate])
  const dateRelative = useMemo(() => formatRelativeDate(rawDate), [rawDate])

  const domain = getDomain(item?.url, item?.site)
  const duration = formatDuration(item?.duration_seconds)
  const favicon = getFaviconUrl(item?.url)
  const hasThumbnail = Boolean(item?.thumbnail_path)
  const app = item?.app || (
    (item?.url || '').includes('instagram.') || (item?.url || '').includes('instagr.am') ? 'instagram' :
    (item?.url || '').includes('pinterest.') || (item?.url || '').includes('pin.it') ? 'pinterest' :
    (item?.url || '').includes('youtube.') || (item?.url || '').includes('youtu.be') ? 'youtube' :
    (item?.url || '').includes('tiktok.') ? 'tiktok' : null
  )
  const isVertical = app === 'instagram' || app === 'tiktok' || app === 'pinterest' || (item?.kind === 'video' && app !== 'youtube')

  // Clean, single source attribution that strictly prevents duplicate platform badges (e.g. "INSTAGRAM INSTAGRAM.COM")
  const sourceInfo = useMemo(() => {
    if (!item) return { platformName: 'Resource', icon: 'link', author: null, showFavicon: false, domain: null }
    if (item.kind === 'note') {
      return {
        platformName: 'Personal Note',
        icon: 'edit',
        author: item.author || null,
        showFavicon: false,
        domain: null,
      }
    }
    const APP_NAMES = {
      instagram: 'Instagram',
      youtube: 'YouTube',
      pinterest: 'Pinterest',
      tiktok: 'TikTok',
      x: 'X',
      twitter: 'X',
      github: 'GitHub',
      reddit: 'Reddit',
      spotify: 'Spotify',
    }
    const cleanDomain = domain || item.site || ''
    const appMatch = app && cleanDomain.toLowerCase().includes(app.toLowerCase())

    if (app && (appMatch || !cleanDomain)) {
      return {
        platformName: APP_NAMES[app] || (app.charAt(0).toUpperCase() + app.slice(1)),
        icon: app === 'pinterest' ? 'pin' :
              app === 'youtube' ? 'play' :
              app === 'instagram' ? 'spark' :
              app === 'spotify' ? 'music' :
              app === 'github' ? 'code' :
              app === 'x' ? 'chat' : KIND_ICON[item.kind] || 'link',
        author: item.author ? `@${item.author.replace(/^@/, '')}` : null,
        showFavicon: Boolean(favicon),
        domain: null,
      }
    }

    return {
      platformName: cleanDomain || (item.kind || 'resource').toUpperCase(),
      icon: KIND_ICON[item.kind] || 'link',
      author: item.author || null,
      showFavicon: Boolean(favicon),
      domain: null,
    }
  }, [item, app, domain, favicon])

  // Filter out redundant platform and generic category tags (prevents duplicate #instagram)
  const filteredTags = useMemo(() => {
    const appLower = (app || '').toLowerCase()
    const catLower = (item?.category || '').toLowerCase()
    return tags.filter((t) => {
      if (!t || typeof t !== 'string') return false
      const clean = t.trim().toLowerCase()
      if (clean === appLower || clean === catLower) return false
      if (clean === 'general' || clean === 'other' || clean === 'post') return false
      return true
    })
  }, [tags, app, item?.category])

  // Detect whether capture-time LLM failed or timed out (e.g. Cloudflare AI down at that specific moment)
  const isLlmFailure = useMemo(() => {
    if (!item || item.summary) return false
    const note = (item.enrichment_note || '').toLowerCase()
    return Boolean(
      note.includes('provider') ||
      note.includes('timeout') ||
      note.includes('not answer') ||
      note.includes('could not be reached') ||
      note.includes('failed') ||
      note.includes('cloudflare') ||
      note.includes('error')
    )
  }, [item])

  if (!item) return null

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

  const handleCopySummary = async () => {
    if (!item?.summary) return
    try {
      await navigator.clipboard.writeText(item.summary)
      setCopiedSummary(true)
      toast('Copied synthesis to clipboard', 'ok')
      setTimeout(() => setCopiedSummary(false), 2000)
    } catch {
      toast('Failed to copy', 'bad')
    }
  }

  const handleEnrich = async () => {
    setEnrichError(null)
    setBusyAction('enrich')
    try {
      const updated = await api.enrichLibraryItem(item.id)
      onUpdate?.(updated)
      toast('Synthesized with AI', 'ok')
    } catch (err) {
      const msg = err.message || 'AI synthesis failed. Check your LLM settings.'
      setEnrichError(msg)
      toast(msg, 'bad')
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

  const isEnriching = busyAction === 'enrich' || item.status === 'enriching'

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
              TOP NAVIGATION (Single unified non-duplicate source pill)
              ======================================================== */}
          <div className="lib-modal-header">
            <div className="lib-modal-header-meta">
              <span className="lib-modal-source-pill">
                {sourceInfo.showFavicon && favicon ? (
                  <img
                    src={favicon}
                    alt=""
                    className="lib-modal-favicon"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                ) : (
                  <Icon name={sourceInfo.icon} size={12} />
                )}
                <span className="lib-modal-source-title">{sourceInfo.platformName}</span>
                {sourceInfo.author && (
                  <span className="lib-modal-source-author">· {sourceInfo.author}</span>
                )}
              </span>
            </div>

            <div className="lib-modal-header-actions">
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

          {/* ========================================================
              SCROLLABLE CARD BODY
              ======================================================== */}
          <div className="lib-modal-body">
            {/* 1. Clean Media Container (Single clean border) */}
            {hasThumbnail && (
              <div className={`lib-modal-media-frame ${isVertical ? 'lib-modal-media-frame--portrait' : 'lib-modal-media-frame--landscape'}`}>
                <img
                  src={api.thumbnailUrl(item.id)}
                  alt={item.title || 'Resource media cover'}
                  className={`lib-modal-media-img ${isVertical ? 'lib-modal-media-img--portrait' : 'lib-modal-media-img--landscape'}`}
                  onClick={() => setShowLightbox(true)}
                  title="Click to view full resolution"
                />

                {/* Floating Media Controls Pill */}
                <div className="lib-modal-media-dock">
                  <button
                    type="button"
                    className="lib-modal-dock-btn"
                    onClick={() => setShowLightbox(true)}
                    title="Inspect in full resolution lightbox"
                  >
                    <Icon name="maximize" size={12} />
                    <span>Full View</span>
                  </button>
                  {duration && (
                    <span className="lib-modal-dock-duration">
                      <Icon name="play" size={10} />
                      <span>{duration}</span>
                    </span>
                  )}
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="lib-modal-dock-btn"
                      title="Open original website"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon name="link" size={12} />
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

            {/* 3. Secondary Metadata Strip */}
            <div className="lib-modal-meta-strip">
              <div className="lib-modal-meta-item" title="Capture date">
                <Icon name="calendar" size={12} />
                <span>Captured {dateFull || 'Undated'}</span>
              </div>
              {item.author && (
                <div className="lib-modal-meta-item">
                  <Icon name="user" size={12} />
                  <span>By {item.author}</span>
                </div>
              )}
              {duration && (
                <div className="lib-modal-meta-item">
                  <Icon name="clock" size={12} />
                  <span>{duration}</span>
                </div>
              )}
              <div className="lib-modal-meta-item" style={{ marginLeft: 'auto' }}>
                <span className="lib-card-live-dot" />
                <span style={{ color: 'var(--text-faint)' }}>{item.indexed ? 'Vector Indexed' : 'Archive'}</span>
              </div>
            </div>

            {/* 4. Compact Inline Curator Significance Bar */}
            <div className="lib-detail-curation-bar">
              <div className="lib-detail-curation-left">
                <span className="lib-detail-curation-label">Significance</span>
                <div className="lib-detail-stars-compact">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const isFilled = (hoveredStar ?? rating ?? 0) >= star
                    return (
                      <button
                        key={star}
                        type="button"
                        className="lib-detail-star-compact-btn"
                        onMouseEnter={() => setHoveredStar(star)}
                        onMouseLeave={() => setHoveredStar(null)}
                        onClick={() => handleRating(star)}
                        title={`Assign ${star} Star (${RATING_TIERS[star]?.label}): ${RATING_TIERS[star]?.description}`}
                      >
                        <Icon
                          name="star"
                          size={15}
                          filled={isFilled}
                          style={{
                            color: isFilled ? (RATING_TIERS[star]?.color || '#f59e0b') : 'var(--hairline-strong)',
                            transition: 'color 120ms ease, transform 120ms ease',
                          }}
                        />
                      </button>
                    )
                  })}
                </div>
                {displayedTier ? (
                  <span
                    className={`lib-detail-tier-tag ${displayedTier.badgeClass}`}
                    style={{ borderColor: displayedTier.color }}
                  >
                    ★ {displayedTier.stars} · {displayedTier.label}
                  </span>
                ) : (
                  <span className="lib-detail-tier-tag lib-detail-tier-tag--unrated">
                    Unrated
                  </span>
                )}
              </div>

              {rating && (
                <button
                  type="button"
                  className="lib-detail-clear-rating-btn"
                  onClick={() => handleRating(rating)}
                  title="Clear rating"
                >
                  Clear
                </button>
              )}
            </div>

            {/* 5. Executive Synthesis & Intelligence Panel */}
            {isEnriching ? (
              <div className="lib-synthesis-card lib-synthesis-card--generating">
                <div className="lib-synthesis-header">
                  <div className="lib-synthesis-title-wrap">
                    <div className="lib-synthesis-icon-badge lib-synthesis-icon-badge--spinning">
                      <span className="lib-card-spinner" />
                    </div>
                    <span className="lib-synthesis-heading">Synthesizing Insights & Extracting Entities</span>
                  </div>
                  <span className="lib-synthesis-model-pill">Processing</span>
                </div>
                <div className="lib-synthesis-generating-skel">
                  <div className="lib-skel" style={{ width: '96%', height: 11, borderRadius: 4 }} />
                  <div className="lib-skel" style={{ width: '84%', height: 11, borderRadius: 4 }} />
                  <div className="lib-skel" style={{ width: '70%', height: 11, borderRadius: 4 }} />
                </div>
                <p className="lib-synthesis-generating-hint">
                  Transcribing speech with Whisper and extracting referenced websites, tools, and taxonomy...
                </p>
              </div>
            ) : item.summary ? (
              <div className="lib-synthesis-card">
                <div className="lib-synthesis-header">
                  <div className="lib-synthesis-title-wrap">
                    <div className="lib-synthesis-icon-badge">
                      <Icon name="spark" size={13} />
                    </div>
                    <span className="lib-synthesis-heading">Key Insights & Synthesis</span>
                    {item.enrichment_model && (
                      <span className="lib-synthesis-model-pill" title={item.enrichment_model}>
                        {formatModelDisplayName(item.enrichment_model)}
                      </span>
                    )}
                  </div>

                  <div className="lib-synthesis-actions">
                    <button
                      type="button"
                      className="lib-synthesis-action-btn"
                      onClick={handleCopySummary}
                      title="Copy synthesis to clipboard"
                    >
                      <Icon name={copiedSummary ? 'check' : 'copy'} size={12} />
                      <span>{copiedSummary ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      className="lib-synthesis-action-btn"
                      onClick={handleEnrich}
                      disabled={Boolean(busyAction)}
                      title="Regenerate summary and extract resources with AI"
                    >
                      <Icon name="refresh" size={12} />
                      <span>Regenerate</span>
                    </button>
                  </div>
                </div>

                {/* Synthesis prose thesis */}
                <p className="lib-synthesis-prose">{item.summary}</p>
              </div>
            ) : (
              <div className="lib-synthesis-card lib-synthesis-card--pending">
                <div className="lib-synthesis-header">
                  <div className="lib-synthesis-title-wrap">
                    <div className="lib-synthesis-icon-badge lib-synthesis-icon-badge--pending">
                      <Icon name="spark" size={13} />
                    </div>
                    <span className="lib-synthesis-heading">AI Synthesis Pending</span>
                  </div>
                  {isLlmFailure && (
                    <span className="lib-detail-warning-tag">
                      Offline during capture
                    </span>
                  )}
                </div>

                <div className="lib-synthesis-pending-content">
                  <p className="lib-synthesis-pending-desc">
                    {isLlmFailure
                      ? 'The AI model was unavailable or timed out when this item arrived via Cloudflare. Run synthesis now to transcribe speech and extract all referenced websites, tools, and takeaways.'
                      : 'Synthesize this resource to automatically transcribe speech, extract key takeaways, and identify referenced websites & links.'}
                  </p>

                  {enrichError && (
                    <div className="lib-detail-error-banner">
                      <Icon name="alert" size={12} />
                      <span>{enrichError}</span>
                    </div>
                  )}

                  <div className="lib-synthesis-pending-actions">
                    <button
                      type="button"
                      className="lib-btn lib-btn--primary lib-btn--glow"
                      disabled={Boolean(busyAction)}
                      onClick={handleEnrich}
                    >
                      <Icon name="spark" size={13} />
                      <span>Synthesize with AI</span>
                    </button>

                    {item.enrichment_note && (
                      <span className="lib-detail-pending-note" title={item.enrichment_note}>
                        {formatFriendlyEnrichmentNote(item.enrichment_note)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 6. Extracted Entities & Referenced Websites (First-Class Clean Section) */}
            {item.resources?.length > 0 && (
              <div className="lib-detail-section">
                <div className="lib-form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="globe" size={12} />
                    <span>Mentioned Resources & Websites</span>
                  </span>
                  <span className="lib-synthesis-resources-count">
                    {item.resources.length} {item.resources.length === 1 ? 'item' : 'items'}
                  </span>
                </div>

                <div className="lib-synthesis-resources-grid">
                  {item.resources.map((res, i) => {
                    const domain = getCleanDomain(res.url)
                    const iconName = getResourceIcon(res.type, res.url)
                    const isClickable = Boolean(res.url)

                    const content = (
                      <>
                        <div className="lib-resource-card-left">
                          <div className="lib-resource-icon">
                            <Icon name={iconName} size={13} />
                          </div>
                          <div className="lib-resource-info">
                            <div className="lib-resource-name-row">
                              <span className="lib-resource-name" title={res.name}>{res.name}</span>
                              {domain && (
                                <span className="lib-resource-domain">{domain}</span>
                              )}
                              {res.type && res.type !== 'other' && res.type !== 'link' && !domain && (
                                <span className="lib-resource-type-pill">{res.type}</span>
                              )}
                            </div>
                            {res.detail && (
                              <span className="lib-resource-detail" title={res.detail}>
                                {res.detail}
                              </span>
                            )}
                          </div>
                        </div>

                        {isClickable && (
                          <div className="lib-resource-launch" title={`Open ${res.url}`}>
                            <Icon name="arrow-up-right" size={13} />
                          </div>
                        )}
                      </>
                    )

                    return isClickable ? (
                      <a
                        key={i}
                        href={res.url}
                        target="_blank"
                        rel="noreferrer"
                        className="lib-resource-card"
                        title={`Open ${res.name} (${res.url})`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {content}
                      </a>
                    ) : (
                      <div key={i} className="lib-resource-card lib-resource-card--static">
                        {content}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 7. Source Audio Speech Transcript (First-Class Clean Drawer) */}
            {transcript && (
              <div className="lib-detail-section">
                <button
                  type="button"
                  className="lib-transcript-toggle"
                  onClick={() => setShowTranscript((prev) => !prev)}
                  aria-expanded={showTranscript}
                  title={showTranscript ? 'Hide transcript' : 'Show verbatim speech transcript'}
                >
                  <div className="lib-transcript-toggle-left">
                    <Icon name="quotes" size={12} />
                    <span>Source Speech Transcript</span>
                    {transcriptWordCount > 0 && (
                      <span className="lib-transcript-count-pill">{transcriptWordCount} words</span>
                    )}
                  </div>
                  <div className={`lib-transcript-toggle-chevron ${showTranscript ? 'lib-transcript-toggle-chevron--open' : ''}`}>
                    <Icon name="chevron-down" size={12} />
                  </div>
                </button>

                <AnimatePresence>
                  {showTranscript && (
                    <motion.div
                      className="lib-transcript-box"
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <p className="lib-transcript-text">{transcript}</p>
                      <div className="lib-transcript-badge">
                        <Icon name="spark" size={10} />
                        <span>Transcribed verbatim from reel audio via Groq Whisper Large v3</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* 8. Slide & Visual On-Screen Content Analysis Drawer */}
            {visualContent && (
              <div className="lib-detail-section">
                <button
                  type="button"
                  className="lib-transcript-toggle"
                  onClick={() => setShowVisualContent((prev) => !prev)}
                  aria-expanded={showVisualContent}
                  title={showVisualContent ? 'Hide visual content' : 'Show extracted visual text & slide analysis'}
                >
                  <div className="lib-transcript-toggle-left">
                    <Icon name="spark" size={12} />
                    <span>Slide & Visual On-Screen Content</span>
                    {visualWordCount > 0 && (
                      <span className="lib-transcript-count-pill">{visualWordCount} words</span>
                    )}
                  </div>
                  <div className={`lib-transcript-toggle-chevron ${showVisualContent ? 'lib-transcript-toggle-chevron--open' : ''}`}>
                    <Icon name="chevron-down" size={12} />
                  </div>
                </button>

                <AnimatePresence>
                  {showVisualContent && (
                    <motion.div
                      className="lib-transcript-box"
                      initial={{ opacity: 0, height: 0, marginTop: 0 }}
                      animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <p className="lib-transcript-text" style={{ whiteSpace: 'pre-wrap' }}>{visualContent}</p>
                      <div className="lib-transcript-badge">
                        <Icon name="brain" size={10} />
                        <span>Extracted from video frames and carousel slides via Vision AI</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Source Content Preview (helpful fallback when LLM has not summarized and no transcript is parsed) */}
            {(item.excerpt || item.capture_note) && !item.summary && !transcript && (
              <div className="lib-detail-section">
                <div className="lib-form-label">
                  {item.text_source ? `${item.text_source.charAt(0).toUpperCase() + item.text_source.slice(1)} Preview` : 'Source Content Preview'}
                </div>
                <div className="lib-detail-excerpt-box">
                  <p>{item.excerpt || item.capture_note}</p>
                </div>
              </div>
            )}

            {/* 7. Topics & Tags (Deduplicated, no redundant #instagram) */}
            <div className="lib-detail-section">
              <div className="lib-form-label">Topics & Taxonomy Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {filteredTags.map((tag) => (
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
            <div className="lib-form-group lib-detail-section">
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
