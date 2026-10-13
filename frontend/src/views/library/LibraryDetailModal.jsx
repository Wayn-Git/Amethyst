import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
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
  items = [],
  onNavigate,
  onClose,
  onUpdate,
  onDelete,
  toast,
}) {
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
  const [copiedLink, setCopiedLink] = useState(false)
  const [enrichError, setEnrichError] = useState(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showVisualContent, setShowVisualContent] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [imageFitMode, setImageFitMode] = useState('contain')
  const carouselTrackRef = useRef(null)

  // Sync state if item changes
  useEffect(() => {
    if (item) {
      setNotes(item.notes || '')
      setTags(item.tags || [])
      setRating(item.rating || null)
      setTagInput('')
      setIsAddingTag(false)
      setHoveredStar(null)
      setSavingNotes(false)
      setBusyAction('')
      setShowLightbox(false)
      setCopiedSummary(false)
      setCopiedLink(false)
      setEnrichError(null)
      setShowTranscript(false)
      setShowVisualContent(false)
      setIsPlaying(false)
      setCurrentSlideIndex(0)
      if (carouselTrackRef.current) {
        carouselTrackRef.current.scrollLeft = 0
      }
    }
  }, [item?.id])

  // Pager index and handlers
  const currentIndex = useMemo(() => {
    if (!items || items.length === 0 || !item) return -1
    return items.findIndex((it) => it.id === item.id)
  }, [items, item?.id])

  const hasPrev = currentIndex > 0
  const hasNext = currentIndex >= 0 && currentIndex < items.length - 1

  const handlePrev = useCallback(() => {
    if (hasPrev && onNavigate) {
      onNavigate(items[currentIndex - 1])
    }
  }, [hasPrev, onNavigate, items, currentIndex])

  const handleNext = useCallback(() => {
    if (hasNext && onNavigate) {
      onNavigate(items[currentIndex + 1])
    }
  }, [hasNext, onNavigate, items, currentIndex])

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

  const domain = getDomain(item?.url, item?.site)
  const duration = formatDuration(item?.duration_seconds)
  const favicon = getFaviconUrl(item?.url)
  const hasThumbnail = Boolean(item?.thumbnail_path || item?.url)
  const app = item?.app || (
    (item?.url || '').includes('instagram.') || (item?.url || '').includes('instagr.am') ? 'instagram' :
    (item?.url || '').includes('threads.net') || (item?.url || '').includes('threads.com') ? 'threads' :
    (item?.url || '').includes('x.com') || (item?.url || '').includes('twitter.') ? 'x' :
    (item?.url || '').includes('pinterest.') || (item?.url || '').includes('pin.it') ? 'pinterest' :
    (item?.url || '').includes('youtube.') || (item?.url || '').includes('youtu.be') ? 'youtube' :
    (item?.url || '').includes('tiktok.') ? 'tiktok' : null
  )
  const isVertical = (
    (item?.url || '').includes('/reel/') ||
    (item?.url || '').includes('/reels/') ||
    (item?.url || '').includes('/shorts/') ||
    app === 'tiktok'
  )

  // YouTube embed detection
  const youtubeEmbedUrl = useMemo(() => {
    if (!item?.url) return null
    const m = item.url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    if (m && m[1]) {
      return `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1`
    }
    return null
  }, [item?.url])

  // Extract carousel slides/images/video if this is a post with media
  const carouselItems = useMemo(() => {
    if (!item) return []
    let res = item.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    const slideRes = (Array.isArray(res) ? res : []).filter(
      (r) => r && typeof r === 'object' && (r.type === 'slide' || r.type === 'image') && (r.url || r.index !== undefined)
    )

    const videoResource = (Array.isArray(res) ? res : []).find(
      (r) => r && typeof r === 'object' && (r.type === 'video' || r.type === 'mp4' || (typeof r.url === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(r.url)))
    )

    const hasLocalVid = Boolean(item.media_path) && (
      item.media_path.endsWith('.mp4') || item.media_path.endsWith('.webm') || item.media_path.endsWith('.mov')
    )
    const urlLower = (item.url || '').toLowerCase()
    const isDirectVideoUrl = /\.(mp4|webm|mov)(\?|$)/i.test(urlLower)
    const isSocialVideo =
      (app === 'instagram' && (urlLower.includes('/reel/') || urlLower.includes('/reels/') || item.kind === 'video' || item.duration_seconds)) ||
      (app === 'tiktok') ||
      (app === 'reddit' && (urlLower.includes('/comments/') || urlLower.includes('v.redd.it') || item.kind === 'video')) ||
      (app === 'x' && (Boolean(videoResource) || item.kind === 'video')) ||
      (item.duration_seconds > 0 && item.kind !== 'podcast' && item.kind !== 'music')

    const isVid = hasLocalVid || Boolean(videoResource) || isDirectVideoUrl || isSocialVideo || (item.kind === 'video' && !youtubeEmbedUrl)
    const videoStreamUrl = api.mediaUrl(item.id)
    const fallbackVideoUrl = videoResource?.url && videoResource.url.startsWith('http') ? videoResource.url : null

    const list = []
    if (youtubeEmbedUrl) {
      list.push({ type: 'youtube', url: youtubeEmbedUrl, name: 'YouTube Video' })
    } else if (isVid) {
      list.push({
        type: 'video',
        url: videoStreamUrl,
        fallbackUrl: fallbackVideoUrl,
        poster: hasThumbnail ? api.thumbnailUrl(item.id) : undefined,
        name: 'Video',
      })
      slideRes.forEach((s, idx) => {
        const slideIdx = s.index !== undefined ? s.index : idx
        const remoteUrl = s.remote_url || (s.url && s.url.startsWith('http') ? s.url : null)
        let sUrl = s.url
        if (!sUrl || (!sUrl.startsWith('http') && !sUrl.startsWith('/api/'))) {
          sUrl = api.slideUrl(item.id, slideIdx)
        }
        list.push({
          type: 'image',
          url: sUrl,
          remoteUrl,
          name: s.name || `Photo ${idx + 1}`,
          index: slideIdx,
        })
      })
    } else if (slideRes.length > 0) {
      slideRes.forEach((s, idx) => {
        const slideIdx = s.index !== undefined ? s.index : idx
        const remoteUrl = s.remote_url || (s.url && s.url.startsWith('http') ? s.url : null)
        let sUrl = s.url
        if (!sUrl || (!sUrl.startsWith('http') && !sUrl.startsWith('/api/'))) {
          sUrl = api.slideUrl(item.id, slideIdx)
        }
        list.push({
          type: 'image',
          url: sUrl,
          remoteUrl,
          name: s.name || `Photo ${idx + 1}`,
          index: slideIdx,
        })
      })
    } else if (hasThumbnail) {
      list.push({
        type: 'image',
        url: api.thumbnailUrl(item.id),
        name: 'Cover image',
        index: 0,
      })
    } else {
      list.push({
        type: 'graphic',
        name: 'Card',
        index: 0,
      })
    }
    return list
  }, [item, app, youtubeEmbedUrl, hasThumbnail])

  const slides = carouselItems

  const currentSlideUrl = useMemo(() => {
    const cur = carouselItems[currentSlideIndex]
    if (!cur) return null
    if (cur.type === 'image') return cur.url
    if (cur.type === 'video' && cur.poster) return cur.poster
    return hasThumbnail ? api.thumbnailUrl(item?.id) : null
  }, [carouselItems, currentSlideIndex, item?.id, hasThumbnail])

  const hasSlides = carouselItems && carouselItems.length > 1
  const isDirectVideo = Boolean(carouselItems.some((c) => c.type === 'video'))
  const isPlayable = Boolean(isDirectVideo || youtubeEmbedUrl)

  const scrollToSlide = useCallback((targetIdx) => {
    if (carouselTrackRef.current) {
      const slides = carouselTrackRef.current.children
      if (slides && slides[targetIdx] && typeof slides[targetIdx].scrollIntoView === 'function') {
        slides[targetIdx].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'start',
        })
      } else {
        const width = carouselTrackRef.current.clientWidth
        carouselTrackRef.current.scrollTo({
          left: targetIdx * width,
          behavior: 'smooth',
        })
      }
    }
    setCurrentSlideIndex(targetIdx)
  }, [])

  const handleCarouselScroll = useCallback((e) => {
    const width = e.target.clientWidth
    if (width > 0) {
      const newIndex = Math.round(e.target.scrollLeft / width)
      if (newIndex >= 0 && newIndex < carouselItems.length && newIndex !== currentSlideIndex) {
        setCurrentSlideIndex(newIndex)
      }
    }
  }, [currentSlideIndex, carouselItems.length])

  // Single clean source attribution
  const sourceInfo = useMemo(() => {
    if (!item) return { platformName: 'Resource', icon: 'link', author: null, showFavicon: false }
    if (item.kind === 'note') {
      return {
        platformName: 'Personal Note',
        icon: 'edit',
        author: item.author || null,
        showFavicon: false,
      }
    }
    const APP_NAMES = {
      instagram: 'Instagram',
      threads: 'Threads',
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
              app === 'threads' ? 'threads' :
              app === 'spotify' ? 'music' :
              app === 'github' ? 'code' :
              app === 'x' ? 'chat' : KIND_ICON[item.kind] || 'link',
        author: item.author ? `@${item.author.replace(/^@/, '')}` : null,
        showFavicon: Boolean(favicon),
      }
    }

    return {
      platformName: cleanDomain || (item.kind || 'resource').toUpperCase(),
      icon: KIND_ICON[item.kind] || 'link',
      author: item.author || null,
      showFavicon: Boolean(favicon),
    }
  }, [item, app, domain, favicon])

  // Filter out redundant platform and generic category tags
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

  // Detect whether capture-time LLM failed or timed out
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

  // Keyboard navigation: left/right to move through slides or items, escape to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (carouselItems.length > 1 && !showLightbox) {
          const prevIdx = currentSlideIndex > 0 ? currentSlideIndex - 1 : carouselItems.length - 1
          scrollToSlide(prevIdx)
        } else if (showLightbox && carouselItems.length > 1) {
          setCurrentSlideIndex((prev) => (prev > 0 ? prev - 1 : carouselItems.length - 1))
        } else {
          handlePrev()
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (carouselItems.length > 1 && !showLightbox) {
          const nextIdx = currentSlideIndex < carouselItems.length - 1 ? currentSlideIndex + 1 : 0
          scrollToSlide(nextIdx)
        } else if (showLightbox && carouselItems.length > 1) {
          setCurrentSlideIndex((prev) => (prev < carouselItems.length - 1 ? prev + 1 : 0))
        } else {
          handleNext()
        }
      } else if (e.key === 'Escape') {
        if (showLightbox) {
          setShowLightbox(false)
        } else {
          onClose?.()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlePrev, handleNext, onClose, carouselItems.length, currentSlideIndex, scrollToSlide, showLightbox])

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
    const textToCopy = item.summary || item.title || item.url || ''
    if (!textToCopy) return
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedSummary(true)
      toast('Copied synthesis to clipboard', 'ok')
      setTimeout(() => setCopiedSummary(false), 2000)
    } catch {
      toast('Failed to copy', 'bad')
    }
  }

  const handleCopyLink = async () => {
    if (!item?.url) return
    try {
      await navigator.clipboard.writeText(item.url)
      setCopiedLink(true)
      toast('Copied link to clipboard', 'ok')
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      toast('Failed to copy link', 'bad')
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

  // Clean slug/short name for fallback visual card
  const cleanCoverSlug = (item.title || 'resource')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)

  return (
    <>
      <motion.div
        className="lib-page-detail"
        role="region"
        aria-label={item.title || 'Library item detail'}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ========================================================
            TOP NAVIGATION BAR
            ======================================================== */}
        <header className="lib-page-header">
          <div className="lib-page-header-left">
            {/* Prominent Back to Library button */}
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              type="button"
              className="lib-page-back-btn"
              onClick={onClose}
              title="Back to Library (Esc)"
            >
              <Icon name="arrow-left" size={15} />
              <span>Library</span>
            </motion.button>

            <span className="lib-page-source-pill">
              {sourceInfo.showFavicon && favicon ? (
                <img
                  src={favicon}
                  alt=""
                  className="lib-page-source-favicon"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <Icon name={sourceInfo.icon} size={12} />
              )}
              <span className="lib-page-source-title">{sourceInfo.platformName}</span>
              {sourceInfo.author && (
                <span className="lib-page-source-author">· {sourceInfo.author}</span>
              )}
            </span>
          </div>

          <div className="lib-page-header-right">
            {items && items.length > 0 && currentIndex !== -1 && (
              <div className="lib-page-pager">
                <motion.button
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.88 }}
                  type="button"
                  className="lib-page-pager-btn"
                  onClick={handlePrev}
                  disabled={!hasPrev}
                  title="Previous item (←)"
                  aria-label="Previous item"
                >
                  <Icon name="chevron-left" size={14} />
                </motion.button>
                <span className="lib-page-pager-text">
                  {currentIndex + 1} of {items.length}
                </span>
                <motion.button
                  whileHover={{ scale: 1.15 }}
                  whileTap={{ scale: 0.88 }}
                  type="button"
                  className="lib-page-pager-btn"
                  onClick={handleNext}
                  disabled={!hasNext}
                  title="Next item (→)"
                  aria-label="Next item"
                >
                  <Icon name="chevron-right" size={14} />
                </motion.button>
              </div>
            )}

            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="lib-page-icon-btn"
                title="Open original website"
              >
                <Icon name="link" size={13} />
              </a>
            )}

            <button
              type="button"
              className="lib-page-icon-btn"
              onClick={handleCopyLink}
              title="Copy URL"
            >
              <Icon name={copiedLink ? 'check' : 'copy'} size={13} />
            </button>

            <button
              type="button"
              className="lib-page-icon-btn lib-page-icon-btn--close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </header>

        {/* ========================================================
            TWO-COLUMN MAIN BODY (Animated on item change)
            ======================================================== */}
        <div className="lib-page-body">
          {/* ----------------- LEFT COLUMN: MEDIA CENTER ----------------- */}
          <motion.div
            key={`media-${item.id}`}
            className="lib-page-media-col"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={`lib-page-media-viewport ${isVertical ? 'lib-page-media-viewport--portrait' : ''}`}>
              <div
                ref={carouselTrackRef}
                className="lib-page-carousel-track"
                onScroll={handleCarouselScroll}
              >
                {carouselItems.map((cItem, idx) => (
                  <div key={`slide-${idx}`} className="lib-page-carousel-slide">
                    {cItem.type === 'video' ? (
                      isPlaying ? (
                        <div className="lib-page-player-box">
                          <video
                            src={cItem.url}
                            controls
                            autoPlay
                            playsInline
                            loop
                            className="lib-page-video-elem"
                            poster={cItem.poster}
                            onError={(e) => {
                              if (cItem.fallbackUrl && e.currentTarget.src !== cItem.fallbackUrl) {
                                e.currentTarget.src = cItem.fallbackUrl
                              }
                            }}
                          />
                        </div>
                      ) : (
                        <div
                          className="lib-page-cover-box"
                          onClick={() => setIsPlaying(true)}
                        >
                          {cItem.poster ? (
                            <>
                              <div
                                className="lib-page-cover-backdrop"
                                style={{ backgroundImage: `url(${cItem.poster})` }}
                              />
                              <img
                                src={cItem.poster}
                                alt={item.title || 'Video cover'}
                                className={`lib-page-cover-img lib-page-cover-img--${imageFitMode}`}
                              />
                            </>
                          ) : (
                            <div className="lib-page-graphic-card">
                              <div className="lib-page-graphic-gradient" />
                              <div className="lib-page-graphic-title">{cleanCoverSlug}</div>
                            </div>
                          )}
                          <motion.button
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 0.94 }}
                            type="button"
                            className="lib-page-play-badge"
                            onClick={(e) => {
                              e.stopPropagation()
                              setIsPlaying(true)
                            }}
                            title="Play video"
                            aria-label="Play video"
                          >
                            <div className="lib-page-play-circle">
                              <Icon name="play" size={26} />
                            </div>
                          </motion.button>
                        </div>
                      )
                    ) : cItem.type === 'youtube' ? (
                      <div className="lib-page-player-box">
                        <iframe
                          src={cItem.url}
                          title={item.title || 'YouTube Video'}
                          className="lib-page-iframe-elem"
                          allowFullScreen
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        />
                      </div>
                    ) : cItem.type === 'image' ? (
                      <div
                        className="lib-page-cover-box"
                        onClick={() => {
                          setCurrentSlideIndex(idx)
                          setShowLightbox(true)
                        }}
                      >
                        <div
                          className="lib-page-cover-backdrop"
                          style={{ backgroundImage: `url(${cItem.url})` }}
                        />
                        <img
                          src={cItem.url}
                          alt={cItem.name || item.title || `Photo ${idx + 1}`}
                          className={`lib-page-cover-img lib-page-cover-img--${imageFitMode}`}
                          onError={(e) => {
                            const currentSrc = e.currentTarget.src
                            const slideApi = api.slideUrl(item.id, cItem.index ?? idx)
                            if (!currentSrc.includes(`/slides/${cItem.index ?? idx}`) && currentSrc !== slideApi) {
                              e.currentTarget.src = slideApi
                              return
                            }
                            if (cItem.remoteUrl && currentSrc !== cItem.remoteUrl) {
                              e.currentTarget.src = cItem.remoteUrl
                              return
                            }
                            if (hasThumbnail && currentSrc !== api.thumbnailUrl(item.id)) {
                              e.currentTarget.src = api.thumbnailUrl(item.id)
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <div className="lib-page-graphic-card">
                        <div className="lib-page-graphic-gradient" />
                        <div className="lib-page-graphic-title">{cleanCoverSlug}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Multi-image Carousel Navigation Arrows & Dots */}
              {carouselItems.length > 1 && (
                <>
                  <motion.button
                    whileHover={{ scale: 1.1, backgroundColor: 'rgba(0,0,0,0.85)' }}
                    whileTap={{ scale: 0.92 }}
                    type="button"
                    className="lib-page-carousel-arrow lib-page-carousel-arrow--prev"
                    onClick={(e) => {
                      e.stopPropagation()
                      const prevIdx = currentSlideIndex > 0 ? currentSlideIndex - 1 : carouselItems.length - 1
                      scrollToSlide(prevIdx)
                    }}
                    title="Previous image"
                    aria-label="Previous image"
                  >
                    <Icon name="chevron-left" size={16} />
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.1, backgroundColor: 'rgba(0,0,0,0.85)' }}
                    whileTap={{ scale: 0.92 }}
                    type="button"
                    className="lib-page-carousel-arrow lib-page-carousel-arrow--next"
                    onClick={(e) => {
                      e.stopPropagation()
                      const nextIdx = currentSlideIndex < carouselItems.length - 1 ? currentSlideIndex + 1 : 0
                      scrollToSlide(nextIdx)
                    }}
                    title="Next image"
                    aria-label="Next image"
                  >
                    <Icon name="chevron-right" size={16} />
                  </motion.button>
                  <div className="lib-page-carousel-dots">
                    {carouselItems.map((_, dotIdx) => (
                      <button
                        key={`dot-${dotIdx}`}
                        type="button"
                        className={`lib-page-carousel-dot ${dotIdx === currentSlideIndex ? 'lib-page-carousel-dot--active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          scrollToSlide(dotIdx)
                        }}
                        aria-label={`Go to slide ${dotIdx + 1}`}
                      />
                    ))}
                    <span className="lib-page-carousel-count">
                      {currentSlideIndex + 1}/{carouselItems.length}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Controls Below Media Frame: Full view + Source */}
            <div className="lib-page-media-actions">
              {isPlayable && !isPlaying && (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  className="lib-page-pill-btn lib-page-pill-btn--primary"
                  onClick={() => setIsPlaying(true)}
                  title="Play video"
                >
                  <Icon name="play" size={12} />
                  <span>Play video</span>
                </motion.button>
              )}

              {isPlayable && isPlaying && (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  className="lib-page-pill-btn"
                  onClick={() => setIsPlaying(false)}
                  title="Switch back to cover view"
                >
                  <Icon name="spark" size={12} />
                  <span>Cover view</span>
                </motion.button>
              )}

              {/* Fit vs Fill aspect ratio toggle pill */}
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                className={`lib-page-pill-btn ${imageFitMode === 'contain' ? 'lib-page-pill-btn--active' : ''}`}
                onClick={() => setImageFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
                title={imageFitMode === 'contain' ? 'Fill frame (crop edges)' : 'Complete original image (uncropped)'}
              >
                <Icon name={imageFitMode === 'contain' ? 'expand' : 'collapse'} size={12} />
                <span>{imageFitMode === 'contain' ? 'Original Fit' : 'Fill'}</span>
              </motion.button>

              {hasThumbnail && (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  className="lib-page-pill-btn"
                  onClick={() => setShowLightbox(true)}
                  title="Open full resolution lightbox"
                >
                  <Icon name="maximize" size={12} />
                  <span>Lightbox</span>
                </motion.button>
              )}

              {item.url && (
                <motion.a
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="lib-page-pill-btn"
                  title="Open original website"
                >
                  <Icon name="external-link" size={12} />
                  <span>{sourceInfo.platformName || 'Source'}</span>
                </motion.a>
              )}
            </div>
          </motion.div>

          {/* ----------------- RIGHT COLUMN: INTELLIGENCE & CURATION ----------------- */}
          <motion.div
            key={`content-${item.id}`}
            className="lib-page-content-col"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="lib-page-content-scroll">
              {/* 1. Main Title */}
              <h1 className="lib-page-heading">{item.title || 'Untitled Resource'}</h1>

              {/* 2. Metadata Strip */}
              <div className="lib-page-meta-strip">
                <div className="lib-page-meta-item">
                  <Icon name="calendar" size={12} />
                  <span>Captured {dateFull || 'Undated'}</span>
                </div>
                {item.author && (
                  <div className="lib-page-meta-item">
                    <Icon name="user" size={12} />
                    <span>By {item.author}</span>
                  </div>
                )}
                {duration && (
                  <div className="lib-page-meta-item">
                    <Icon name="clock" size={12} />
                    <span>{duration}</span>
                  </div>
                )}
                <div className="lib-page-meta-item lib-page-meta-item--vector">
                  <span className="lib-page-vector-dot" />
                  <span>{item.indexed ? 'Vector indexed' : 'Archive'}</span>
                </div>
              </div>

              {/* 3. Significance Star Rating */}
              <div className="lib-page-significance-bar">
                <span className="lib-page-significance-title">Significance</span>
                <div className="lib-page-stars-track">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const isFilled = (hoveredStar ?? rating ?? 0) >= star
                    return (
                      <motion.button
                        key={star}
                        whileHover={{ scale: 1.25 }}
                        whileTap={{ scale: 0.85 }}
                        type="button"
                        className="lib-page-star-btn"
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
                      </motion.button>
                    )
                  })}
                </div>
                <span className="lib-page-significance-tier">
                  {displayedTier ? displayedTier.label : 'Unrated'}
                </span>

                {rating && (
                  <button
                    type="button"
                    className="lib-page-clear-rating-btn"
                    onClick={() => handleRating(rating)}
                    title="Clear rating"
                  >
                    <Icon name="x" size={10} />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              {/* 4. Key Insights & Synthesis Panel */}
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
                      <span className="lib-synthesis-heading">Key insights and synthesis</span>
                      {item.enrichment_model && (
                        <span className="lib-synthesis-model-pill" title={item.enrichment_model}>
                          {formatModelDisplayName(item.enrichment_model)}
                        </span>
                      )}
                    </div>

                    <div className="lib-synthesis-actions">
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        className="lib-synthesis-action-btn"
                        onClick={handleCopySummary}
                        title="Copy synthesis to clipboard"
                      >
                        <Icon name={copiedSummary ? 'check' : 'copy'} size={12} />
                        <span>{copiedSummary ? 'Copied' : 'Copy'}</span>
                      </motion.button>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.92 }}
                        type="button"
                        className="lib-synthesis-action-btn"
                        onClick={handleEnrich}
                        disabled={Boolean(busyAction)}
                        title="Regenerate summary and extract resources with AI"
                      >
                        <Icon name="refresh" size={12} />
                        <span>Regenerate</span>
                      </motion.button>
                    </div>
                  </div>

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
                      <span className="lib-detail-warning-tag">Offline during capture</span>
                    )}
                  </div>

                  <div className="lib-synthesis-pending-content">
                    <p className="lib-synthesis-pending-desc">
                      {isLlmFailure
                        ? 'The AI model was unavailable or timed out when this item arrived. Run synthesis now to transcribe speech and extract all referenced websites, tools, and takeaways.'
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
                        className="lib-btn lib-btn--primary"
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

              {/* 5. Mentioned Resources & Websites */}
              {item.resources?.length > 0 && (
                <div className="lib-page-section">
                  <div className="lib-page-section-header">
                    <span className="lib-page-section-title-wrap">
                      <Icon name="globe" size={13} />
                      <span>Mentioned resources and websites</span>
                    </span>
                    <span className="lib-page-section-count">
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
                                {domain && <span className="lib-resource-domain">{domain}</span>}
                                {res.type && res.type !== 'other' && res.type !== 'link' && !domain && (
                                  <span className="lib-resource-type-pill">{res.type}</span>
                                )}
                              </div>
                              {res.detail && (
                                <span className="lib-resource-detail" title={res.detail}>{res.detail}</span>
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

              {/* 6. Speech Transcript Drawer */}
              {transcript && (
                <div className="lib-page-section">
                  <button
                    type="button"
                    className="lib-transcript-toggle"
                    onClick={() => setShowTranscript((prev) => !prev)}
                    aria-expanded={showTranscript}
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
                          <span>Transcribed verbatim from reel audio via Whisper</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* 7. Slide & Visual On-Screen Content Drawer */}
              {visualContent && (
                <div className="lib-page-section">
                  <button
                    type="button"
                    className="lib-transcript-toggle"
                    onClick={() => setShowVisualContent((prev) => !prev)}
                    aria-expanded={showVisualContent}
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

              {/* 8. Topics & Taxonomy Tags */}
              <div className="lib-page-section">
                <div className="lib-page-section-title">Topics and taxonomy tags</div>
                <div className="lib-page-tags-strip">
                  {filteredTags.map((tag) => (
                    <span key={tag} className="lib-page-tag-pill">
                      <span>#{tag}</span>
                      <button
                        type="button"
                        className="lib-page-tag-remove"
                        onClick={() => handleRemoveTag(tag)}
                        title={`Remove #${tag}`}
                        aria-label={`Remove #${tag}`}
                      >
                        <Icon name="x" size={9} />
                      </button>
                    </span>
                  ))}

                  {isAddingTag ? (
                    <form onSubmit={handleAddTag} className="lib-page-tag-form">
                      <input
                        type="text"
                        autoFocus
                        placeholder="New tag..."
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onBlur={() => {
                          if (!tagInput.trim()) setIsAddingTag(false)
                        }}
                        className="lib-page-tag-input"
                      />
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="lib-page-tag-pill lib-page-tag-pill--add"
                      onClick={() => setIsAddingTag(true)}
                    >
                      <Icon name="plus" size={11} />
                      <span>Add tag</span>
                    </button>
                  )}
                </div>
              </div>

              {/* 9. Personal Notes & Synthesis */}
              <div className="lib-page-section">
                <div className="lib-page-notes-header">
                  <label className="lib-page-section-title" htmlFor="lib-page-notes">
                    Personal notes and synthesis
                  </label>
                  {notes !== (item.notes || '') && (
                    <button
                      type="button"
                      className="lib-btn lib-btn--primary lib-page-save-notes-btn"
                      disabled={savingNotes}
                      onClick={handleSaveNotes}
                    >
                      <Icon name="check" size={12} />
                      <span>{savingNotes ? 'Saving...' : 'Save notes'}</span>
                    </button>
                  )}
                </div>
                <textarea
                  id="lib-page-notes"
                  className="lib-page-notes-input"
                  placeholder="Record your personal notes, key synthesis, or quotes..."
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={handleSaveNotes}
                />
              </div>
            </div>
          </motion.div>
        </div>

        {/* ========================================================
            BOTTOM DOCKED ACTIONS BAR
            ======================================================== */}
        <footer className="lib-page-footer">
          <div className="lib-page-footer-left">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              type="button"
              className="lib-page-dock-btn"
              disabled={Boolean(busyAction)}
              onClick={handleReindex}
              title="Re-run semantic search embeddings indexer"
            >
              <Icon name="refresh" size={13} />
              <span>Re-index</span>
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              type="button"
              className="lib-page-dock-btn"
              disabled={Boolean(busyAction)}
              onClick={handleEnrich}
              title="Re-analyze and regenerate insights with AI"
            >
              <Icon name="spark" size={13} />
              <span>Re-analyze</span>
            </motion.button>
          </div>

          <div className="lib-page-footer-right">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              type="button"
              className="lib-page-dock-btn lib-page-dock-btn--danger"
              onClick={() => {
                if (window.confirm(`Delete "${item.title}" from library?`)) {
                  onDelete?.(item)
                  onClose()
                }
              }}
              title="Delete resource from library"
            >
              <Icon name="trash" size={13} />
              <span>Delete</span>
            </motion.button>
          </div>
        </footer>
      </motion.div>

      {/* High-Resolution Lightbox Modal */}
      <AnimatePresence>
        {showLightbox && (hasThumbnail || currentSlideUrl) && (
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
                src={carouselItems[currentSlideIndex]?.url || currentSlideUrl || api.thumbnailUrl(item.id)}
                alt={item.title || (carouselItems.length > 1 ? `Slide ${currentSlideIndex + 1}` : 'Full resolution image')}
                className="lib-lightbox-img"
                onError={(e) => {
                  const cItem = carouselItems[currentSlideIndex]
                  const currentSrc = e.currentTarget.src
                  const slideApi = api.slideUrl(item.id, cItem?.index ?? currentSlideIndex)
                  if (!currentSrc.includes(`/slides/${cItem?.index ?? currentSlideIndex}`) && currentSrc !== slideApi) {
                    e.currentTarget.src = slideApi
                    return
                  }
                  if (cItem?.remoteUrl && currentSrc !== cItem.remoteUrl) {
                    e.currentTarget.src = cItem.remoteUrl
                    return
                  }
                  if (hasThumbnail && currentSrc !== api.thumbnailUrl(item.id)) {
                    e.currentTarget.src = api.thumbnailUrl(item.id)
                  }
                }}
              />

              {carouselItems.length > 1 && (
                <>
                  <button
                    type="button"
                    className="lib-lightbox-nav lib-lightbox-nav--prev"
                    onClick={(e) => {
                      e.stopPropagation()
                      const prevIdx = currentSlideIndex > 0 ? currentSlideIndex - 1 : carouselItems.length - 1
                      setCurrentSlideIndex(prevIdx)
                      scrollToSlide(prevIdx)
                    }}
                    title="Previous slide"
                    aria-label="Previous slide"
                  >
                    <Icon name="chevron-left" size={20} />
                  </button>
                  <button
                    type="button"
                    className="lib-lightbox-nav lib-lightbox-nav--next"
                    onClick={(e) => {
                      e.stopPropagation()
                      const nextIdx = currentSlideIndex < carouselItems.length - 1 ? currentSlideIndex + 1 : 0
                      setCurrentSlideIndex(nextIdx)
                      scrollToSlide(nextIdx)
                    }}
                    title="Next slide"
                    aria-label="Next slide"
                  >
                    <Icon name="chevron-right" size={20} />
                  </button>
                  <div className="lib-lightbox-slide-pill">
                    {currentSlideIndex + 1} / {carouselItems.length}
                  </div>
                </>
              )}

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
