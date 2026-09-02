import { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import Icon from '../../components/Icon.jsx'
import ModelMenu from '../../components/ModelMenu.jsx'
import AiProviderIcon from '../../components/AiProviderIcon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import ExportPlaylistModal from './ExportPlaylistModal.jsx'
import LibraryVideoPlayer from './LibraryVideoPlayer.jsx'
import { formatDuration, getDomain, getFaviconUrl, KIND_ICON } from './LibraryCard.jsx'
import { RATING_TIERS, getRatingTier } from './ratingUtils.js'
import { formatDisplayDate, formatFullDateTime, formatRelativeDate } from './dateUtils.js'

export function formatModelDisplayName(modelStr) {
  if (!modelStr) return 'AI Synthesis'
  const clean = String(modelStr).trim()
  if (clean.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro'
  if (clean.includes('gemini-2.5-flash')) return 'Gemini 2.5 Flash'
  if (clean.includes('gemini-2') || clean.includes('gemini-flash')) return 'Gemini Flash'
  if (clean.includes('gemini-1.5')) return 'Gemini 1.5'
  if (clean.includes('claude-3-7')) return 'Claude 3.7 Sonnet'
  if (clean.includes('claude-3-5-sonnet') || clean.includes('claude-3.5-sonnet')) return 'Claude 3.5 Sonnet'
  if (clean.includes('claude-3-5') || clean.includes('claude-3.5')) return 'Claude 3.5'
  if (clean.includes('gpt-4o-mini')) return 'GPT-4o Mini'
  if (clean.includes('gpt-4o')) return 'GPT-4o'
  if (clean.includes('llama-3.3') || clean.includes('llama-3-3')) return 'LLaMA 3.3 70B'
  if (clean.includes('llama-3.1') || clean.includes('llama-3-1')) return 'LLaMA 3.1'
  if (clean.includes('llama-3') || clean.includes('llama-3-8b')) return 'LLaMA 3 8B'
  if (clean.includes('mimo')) return 'MiMo Flash'
  if (clean.includes('nemotron')) return 'Nemotron 120B'
  if (clean.includes('kilo')) return 'Kilo Free'
  if (clean.includes('ministral-8b') || clean.includes('ministral')) return 'Ministral 8B'
  if (clean.includes('mistral-large')) return 'Mistral Large'
  if (clean.includes('mistral-small')) return 'Mistral Small'
  if (clean.includes('mistral')) return 'Mistral'
  if (clean.includes('whisper')) return 'Whisper v3'
  if (clean.startsWith('cloudflare:') || clean.startsWith('@cf/')) {
    const parts = clean.split('/')
    const model = parts[parts.length - 1] || 'Workers AI'
    return `Cloudflare · ${model.replace(/^@cf\//, '')}`
  }
  if (clean.startsWith('groq:')) return `Groq · ${clean.replace('groq:', '')}`
  if (clean.startsWith('ollama:')) return `Ollama · ${clean.replace('ollama:', '')}`
  return clean.split(':')[0] || 'AI Synthesis'
}

export function formatModelProvider(modelStr) {
  if (!modelStr) return 'google'
  const clean = String(modelStr).toLowerCase().trim()
  if (clean.startsWith('google') || clean.includes('gemini')) return 'google'
  if (clean.startsWith('groq') || clean.includes('llama')) return 'groq'
  if (clean.startsWith('anthropic') || clean.includes('claude')) return 'anthropic'
  if (clean.startsWith('openai') || clean.includes('gpt') || clean.startsWith('o1') || clean.startsWith('o3')) return 'openai'
  if (clean.startsWith('mistral') || clean.includes('ministral')) return 'mistral'
  if (clean.startsWith('deepseek')) return 'deepseek'
  if (clean.startsWith('cloudflare') || clean.startsWith('@cf/')) return 'cloudflare'
  if (clean.startsWith('ollama')) return 'ollama'
  if (clean.includes(':')) return clean.split(':')[0]
  return 'google'
}

export function parseMarkdownSections(markdown, excerpt, textSource) {
  const text = markdown || excerpt || ''
  if (!text) {
    return {
      summaryCandidate: null,
      transcript: null,
      visualContent: null,
      caption: null,
      textBody: null,
    }
  }

  // Separate body from provenance footer rule
  const footerIdx = text.search(/\n---\n/)
  const clean = footerIdx !== -1 ? text.slice(0, footerIdx) : text

  // Match all markdown H2 headings
  const headingRegex = /^##\s+([^\n]+)$/gm
  const matches = []
  let m
  while ((m = headingRegex.exec(clean)) !== null) {
    matches.push({ name: m[1].trim(), index: m.index, endIndex: m.index + m[0].length })
  }

  // Preamble between # Title and first ## Heading is the AI summary / synopsis
  let preamble = matches.length > 0 ? clean.slice(0, matches[0].index) : clean
  const preambleLines = preamble.split('\n').filter((line) => {
    const trimmed = line.trim()
    return (
      !trimmed.startsWith('# ') &&
      !trimmed.startsWith('Tags:') &&
      !trimmed.startsWith('Category:') &&
      !trimmed.startsWith('http://') &&
      !trimmed.startsWith('https://')
    )
  })
  const summaryCandidate = preambleLines.join('\n').trim()

  const sections = {}
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i]
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : clean.length
    sections[cur.name.toLowerCase()] = clean.slice(cur.endIndex, nextStart).trim()
  }

  let visualContent = sections['visual content'] || sections['slide analysis'] || null
  let transcript = sections['transcript'] || null
  let caption = sections['caption'] || null
  let textBody =
    sections['text'] ||
    sections['post'] ||
    sections['description'] ||
    sections['notes'] ||
    sections['document'] ||
    null

  if (sections['caption and transcript']) {
    const ct = sections['caption and transcript']
    const paragraphs = ct.split(/\n\s*\n/)
    if (paragraphs.length >= 2) {
      caption = caption || paragraphs.slice(0, Math.min(2, paragraphs.length - 1)).join('\n\n').trim()
      transcript = transcript || paragraphs.slice(Math.min(2, paragraphs.length - 1)).join('\n\n').trim()
    } else {
      transcript = transcript || ct
    }
  }

  // Fallback for speech transcript if textSource explicitly mentions transcript
  if (!transcript && textSource && textSource.includes('transcript')) {
    if (textBody) {
      transcript = textBody
      textBody = null
    }
  }

  return {
    summaryCandidate: summaryCandidate || null,
    transcript,
    visualContent,
    caption,
    textBody,
  }
}

export function extractTranscript(content, excerpt, textSource) {
  return parseMarkdownSections(content, excerpt, textSource).transcript
}

export function extractVisualContent(content) {
  return parseMarkdownSections(content).visualContent
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
  if (s.includes('there is no text for this one') || s.includes('there was no readable text') || s.includes('no readable text')) {
    return 'No speech, caption, or page text was detected for this item'
  }
  if (s.includes('the text is a line or two')) {
    return 'Content was too brief for automatic synthesis'
  }
  return s.length > 90 ? `${s.slice(0, 87)}...` : s
}

export default function LibraryDetailModal({
  item: initialItem,
  items = [],
  onNavigate,
  onClose,
  onUpdate,
  onDelete,
  toast,
  onExportPlaylist,
}) {
  const [detailItem, setDetailItem] = useState(initialItem)
  const item = detailItem || initialItem

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
  const [showCaption, setShowCaption] = useState(false)
  const [showTextBody, setShowTextBody] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [imageFitMode, setImageFitMode] = useState('contain')
  const [savedSongs, setSavedSongs] = useState(() => new Set())
  const [savingSong, setSavingSong] = useState(null)
  const [showInternalExportModal, setShowInternalExportModal] = useState(false)
  const [internalExportItems, setInternalExportItems] = useState([])
  const [selectedEnrichProvider, setSelectedEnrichProvider] = useState('groq')
  const [selectedEnrichModel, setSelectedEnrichModel] = useState('llama-3.3-70b-versatile')
  const [showModelMenu, setShowModelMenu] = useState(false)
  const modelPickerRef = useRef(null)
  const [mediaMode, setMediaMode] = useState('video')
  const [activeTab, setActiveTab] = useState('overview')
  const [copiedTranscript, setCopiedTranscript] = useState(false)
  const [copiedVisuals, setCopiedVisuals] = useState(false)
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false)
  const carouselTrackRef = useRef(null)

  // Load configured enrichment model from library settings
  useEffect(() => {
    api.librarySettings?.()
      .then((settings) => {
        if (settings?.enrich_provider) setSelectedEnrichProvider(settings.enrich_provider)
        if (settings?.enrich_model) setSelectedEnrichModel(settings.enrich_model)
      })
      .catch(() => {})
  }, [])

  // Dismiss model picker on click outside
  useEffect(() => {
    if (!showModelMenu) return
    const handleClickOutside = (e) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target)) {
        setShowModelMenu(false)
      }
    }
    window.addEventListener('mousedown', handleClickOutside, true)
    return () => window.removeEventListener('mousedown', handleClickOutside, true)
  }, [showModelMenu])

  // Sync state if item changes, and fetch fresh item data from backend
  useEffect(() => {
    setDetailItem(initialItem)
    if (initialItem) {
      setNotes(initialItem.notes || '')
      setTags(initialItem.tags || [])
      setRating(initialItem.rating || null)
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
      setShowCaption(false)
      setShowTextBody(false)
      setIsPlaying(false)
      setShowEmbed(false)
      setCurrentSlideIndex(0)
      setActiveTab('overview')
      setCopiedTranscript(false)
      setCopiedVisuals(false)
      if (carouselTrackRef.current) {
        carouselTrackRef.current.scrollLeft = 0
      }
    }
    if (initialItem?.id) {
      let isCurrent = true
      const fetchItem = api.libraryItem ? api.libraryItem(initialItem.id) : (api.get ? api.get(`/library/${initialItem.id}`) : null)
      if (fetchItem && typeof fetchItem.then === 'function') {
        fetchItem
          .then((fresh) => {
            if (isCurrent && fresh && fresh.id === initialItem.id) {
              setDetailItem(fresh)
              if (fresh.notes !== undefined) setNotes(fresh.notes || '')
              if (fresh.tags) setTags(fresh.tags)
              if (fresh.rating !== undefined) setRating(fresh.rating)
              onUpdate?.(fresh)
            }
          })
          .catch(() => {})
      }
      return () => {
        isCurrent = false
      }
    }
  }, [initialItem?.id])

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

  // Parse all markdown sections (Transcript, Visual Content, Caption, Text Body, Preamble)
  const parsedSections = useMemo(
    () => parseMarkdownSections(item?.content, item?.excerpt || item?.capture_note, item?.text_source),
    [item?.content, item?.excerpt, item?.capture_note, item?.text_source]
  )

  const summaryText = item?.summary || parsedSections.summaryCandidate || null

  const transcript = parsedSections.transcript
  const transcriptWordCount = useMemo(() => {
    if (!transcript) return 0
    return transcript.trim().split(/\s+/).length
  }, [transcript])

  const visualContent = parsedSections.visualContent
  const visualWordCount = useMemo(() => {
    if (!visualContent) return 0
    return visualContent.trim().split(/\s+/).length
  }, [visualContent])

  const caption = parsedSections.caption
  const captionWordCount = useMemo(() => {
    if (!caption) return 0
    return caption.trim().split(/\s+/).length
  }, [caption])

  const textBody = parsedSections.textBody
  const textBodyWordCount = useMemo(() => {
    if (!textBody) return 0
    return textBody.trim().split(/\s+/).length
  }, [textBody])

  const contentCount = useMemo(() => {
    return (transcript ? 1 : 0) + (visualContent ? 1 : 0) + (caption ? 1 : 0) + (textBody ? 1 : 0)
  }, [transcript, visualContent, caption, textBody])

  const notesCount = useMemo(() => {
    return (notes && notes.trim() ? 1 : 0) + (tags && tags.length > 0 ? 1 : 0)
  }, [notes, tags])

  // Detected audio tracks
  const musicResources = useMemo(() => {
    let res = item?.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    if (!Array.isArray(res)) return []
    return res.filter(
      (r) => r && typeof r === 'object' && (r.type === 'music' || r.type === 'song') && (r.name || r.title)
    )
  }, [item?.resources])

  // Non-audio mentioned resources and websites
  const mentionedResources = useMemo(() => {
    let res = item?.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    if (!Array.isArray(res)) return []
    return res.filter(
      (r) => r && typeof r === 'object' && r.type !== 'music' && r.type !== 'song' && r.type !== 'slide' && r.type !== 'avatar'
    )
  }, [item?.resources])

  // Save detected song to library Song List
  const handleSaveSong = async (track) => {
    const title = track.name || track.title || 'Unknown Track'
    const author = track.detail || track.author || track.artist || ''
    setSavingSong(title)
    try {
      await api.addLibraryItem({
        title,
        author,
        kind: 'music',
        category: 'music',
        url: track.url || null,
        notes: `Detected audio from: ${item.title || 'video'}`,
      })
      setSavedSongs((prev) => new Set(prev).add(title))
      toast?.(`Added "${title}" to Song List`, 'ok')
    } catch (err) {
      toast?.(err?.message || 'Failed to save song', 'bad')
    } finally {
      setSavingSong(null)
    }
  }

  // Export detected song to playlist
  const handleExportSongToPlaylist = (track) => {
    const trackItem = {
      id: item.id,
      title: track.name || track.title || 'Unknown Track',
      author: track.detail || track.author || track.artist || '',
      kind: 'music',
    }
    if (onExportPlaylist) {
      onExportPlaylist([trackItem])
    } else {
      setInternalExportItems([trackItem])
      setShowInternalExportModal(true)
    }
  }

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

  // Instagram embed detection
  const instagramEmbedUrl = useMemo(() => {
    if (!item?.url) return null
    const m = item.url.match(/instagram\.com\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/i)
    return m && m[1] ? `https://www.instagram.com/reel/${m[1]}/embed/` : null
  }, [item?.url])

  // Extract carousel slides/images/video if this is a post with media
  const { videoItem, slideItems, isVid } = useMemo(() => {
    if (!item) return { videoItem: null, slideItems: [], isVid: false }
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

    const hasVideo = hasLocalVid || Boolean(videoResource) || isDirectVideoUrl || isSocialVideo || (item.kind === 'video' && !youtubeEmbedUrl)
    const videoStreamUrl = api.mediaUrl(item.id)
    const fallbackVideoUrl =
      (videoResource?.remote_url && videoResource.remote_url.startsWith('http') ? videoResource.remote_url : null) ||
      (videoResource?.url && videoResource.url.startsWith('http') ? videoResource.url : null) ||
      (isDirectVideoUrl ? item.url : null)

    const vItem = (youtubeEmbedUrl || hasVideo || instagramEmbedUrl) ? {
      type: youtubeEmbedUrl ? 'youtube' : (hasVideo ? 'video' : 'embed'),
      url: youtubeEmbedUrl ? youtubeEmbedUrl : (hasVideo ? videoStreamUrl : instagramEmbedUrl),
      fallbackUrl: fallbackVideoUrl,
      embedUrl: instagramEmbedUrl,
      poster: hasThumbnail ? api.thumbnailUrl(item.id) : undefined,
      name: 'Video',
    } : null

    const sItems = slideRes.map((s, idx) => {
      const slideIdx = s.index !== undefined ? s.index : idx
      const remoteUrl = s.remote_url || (s.url && s.url.startsWith('http') ? s.url : null)
      let sUrl = s.url
      if (!sUrl || (!sUrl.startsWith('http') && !sUrl.startsWith('/api/'))) {
        sUrl = api.slideUrl(item.id, slideIdx)
      }
      return {
        type: 'image',
        url: sUrl,
        remoteUrl,
        name: s.name || `Slide ${idx + 1}`,
        index: slideIdx,
      }
    })

    if (!vItem && sItems.length === 0) {
      if (hasThumbnail) {
        sItems.push({
          type: 'image',
          url: api.thumbnailUrl(item.id),
          name: 'Cover image',
          index: 0,
        })
      } else {
        sItems.push({
          type: 'graphic',
          name: 'Card',
          index: 0,
        })
      }
    }

    return { videoItem: vItem, slideItems: sItems, isVid: hasVideo }
  }, [item, app, youtubeEmbedUrl, instagramEmbedUrl, hasThumbnail])

  const hasMultipleMediaModes = Boolean(videoItem && slideItems.length > 0)
  const isVideoMode = Boolean(videoItem && (mediaMode === 'video' || slideItems.length === 0))
  const carouselItems = isVideoMode ? (videoItem ? [videoItem] : []) : slideItems
  const slides = carouselItems

  const currentSlideUrl = useMemo(() => {
    if (isVideoMode && videoItem) {
      return videoItem.poster || (hasThumbnail ? api.thumbnailUrl(item?.id) : null)
    }
    const cur = slideItems[currentSlideIndex]
    if (cur) return cur.url
    return hasThumbnail ? api.thumbnailUrl(item?.id) : null
  }, [isVideoMode, videoItem, slideItems, currentSlideIndex, item?.id, hasThumbnail])

  const hasSlides = carouselItems && carouselItems.length > 1
  const isDirectVideo = Boolean(carouselItems.some((c) => c.type === 'video'))
  const isPlayable = Boolean(isDirectVideo || youtubeEmbedUrl || instagramEmbedUrl)

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

    const rawAuthor = (item.author || '').trim()
    const cleanAuthor = rawAuthor.replace(/^@/, '').trim()
    const isSingleHandle = /^[a-zA-Z0-9_.-]+$/.test(cleanAuthor) && !cleanAuthor.includes(' ') && !cleanAuthor.includes('|')
    const formattedAuthor = cleanAuthor ? (isSingleHandle ? `@${cleanAuthor}` : cleanAuthor) : null

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
        author: formattedAuthor,
        showFavicon: Boolean(favicon),
      }
    }

    return {
      platformName: cleanDomain || (item.kind || 'resource').toUpperCase(),
      icon: KIND_ICON[item.kind] || 'link',
      author: formattedAuthor,
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

  // Parsed entity metadata (if enriched)
  const entity = useMemo(() => {
    let ent = item?.entity
    if (typeof ent === 'string') {
      try { ent = JSON.parse(ent) } catch { ent = null }
    }
    return (ent && typeof ent === 'object') ? ent : null
  }, [item?.entity])

  const cleanAuthor = useMemo(() => (item?.author || '').replace(/^@/, '').trim(), [item?.author])
  const displayTitle = entity?.title || item?.title || 'Untitled Resource'
  const displaySubtitle = entity?.subtitle || (cleanAuthor ? `By ${cleanAuthor}` : (domain || sourceInfo.platformName))
  const displayRating = entity?.rating || null

  // Author avatar if available from resources
  const authorAvatarUrl = useMemo(() => {
    let res = item?.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    const avatarRes = (Array.isArray(res) ? res : []).find(
      (r) => r && typeof r === 'object' && (r.type === 'avatar' || r.name === 'avatar')
    )
    return avatarRes?.url || avatarRes?.remote_url || null
  }, [item?.resources])

  // Context-adaptive action buttons
  const adaptiveActions = useMemo(() => {
    if (entity?.actions && Array.isArray(entity.actions) && entity.actions.length > 0) {
      return entity.actions
    }
    const actions = []
    if (item?.url) {
      let primaryLabel = 'Open Link'
      let primaryIcon = 'external-link'
      const kind = (item?.kind || '').toLowerCase()
      const cat = (item?.category || '').toLowerCase()
      const host = (domain || '').toLowerCase()

      if (kind === 'video' || cat === 'movie' || cat === 'video' || host.includes('youtube') || host.includes('tiktok') || host.includes('vimeo')) {
        primaryLabel = host.includes('youtube') ? 'Watch on YouTube' : 'Watch Video'
        primaryIcon = 'play'
      } else if (kind === 'code' || cat === 'tool' || host.includes('github') || host.includes('gitlab')) {
        primaryLabel = 'View Repository'
        primaryIcon = 'code'
      } else if (cat === 'paper' || host.includes('arxiv')) {
        primaryLabel = 'Read Paper'
        primaryIcon = 'file'
      } else if (kind === 'music' || cat === 'music' || host.includes('spotify') || host.includes('soundcloud') || host.includes('bandcamp')) {
        primaryLabel = 'Listen on Spotify'
        primaryIcon = 'music'
      } else if (kind === 'article' || cat === 'article' || host.includes('substack') || host.includes('medium')) {
        primaryLabel = 'Read Article'
        primaryIcon = 'book'
      } else if (host.includes('twitter') || host.includes('x.com') || host.includes('threads') || host.includes('reddit')) {
        primaryLabel = 'View Post'
        primaryIcon = 'chat'
      } else {
        primaryLabel = `Visit ${sourceInfo.platformName || 'Source'}`
        primaryIcon = 'external-link'
      }

      actions.push({
        label: primaryLabel,
        url: item.url,
        icon: primaryIcon,
        primary: true,
      })
    }
    return actions
  }, [entity?.actions, item?.url, item?.kind, item?.category, domain, sourceInfo.platformName])

  // Context-adaptive attributes table
  const adaptiveAttributes = useMemo(() => {
    if (entity?.attributes && typeof entity.attributes === 'object' && Object.keys(entity.attributes).length > 0) {
      return Object.entries(entity.attributes).map(([k, v]) => ({ key: k, value: String(v) }))
    }
    const attrs = []
    const kind = (item?.kind || '').toLowerCase()
    const cat = (item?.category || '').toLowerCase()
    const isSocialMedia = (sourceInfo.platformName || '').toLowerCase().includes('instagram') ||
                          (sourceInfo.platformName || '').toLowerCase().includes('tiktok') ||
                          (sourceInfo.platformName || '').toLowerCase().includes('threads')

    if (item?.author) {
      attrs.push({ key: 'Author / Creator', value: cleanAuthor || item.author })
    }
    if (sourceInfo.platformName && sourceInfo.platformName !== 'Resource') {
      attrs.push({ key: 'Platform', value: sourceInfo.platformName })
    }
    if (duration) {
      attrs.push({ key: 'Duration', value: duration })
    }
    const categoryLabel = cat && cat !== 'general'
      ? (cat === 'movie' && (item?.is_reel || isSocialMedia)
          ? 'Film Clip'
          : (cat.charAt(0).toUpperCase() + cat.slice(1)))
      : (kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : null)

    if (categoryLabel) {
      attrs.push({ key: 'Content Type', value: categoryLabel })
    }
    if (dateFull) {
      attrs.push({ key: 'Captured', value: dateFull })
    }
    attrs.push({ key: 'Knowledge Index', value: item?.indexed ? 'Vector indexed (Semantic search)' : 'Archive storage' })
    return attrs
  }, [entity?.attributes, item?.author, cleanAuthor, sourceInfo.platformName, duration, item?.category, item?.kind, dateFull, item?.indexed, item?.is_reel])

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

  const handleCopyTranscript = useCallback(async () => {
    if (!transcript) return
    try {
      await navigator.clipboard.writeText(transcript)
      setCopiedTranscript(true)
      toast('Copied transcript to clipboard', 'ok')
      setTimeout(() => setCopiedTranscript(false), 2000)
    } catch {
      toast('Failed to copy transcript', 'bad')
    }
  }, [transcript, toast])

  const handleCopyVisuals = useCallback(async () => {
    if (!visualContent) return
    try {
      await navigator.clipboard.writeText(visualContent)
      setCopiedVisuals(true)
      toast('Copied visual content to clipboard', 'ok')
      setTimeout(() => setCopiedVisuals(false), 2000)
    } catch {
      toast('Failed to copy visual content', 'bad')
    }
  }, [visualContent, toast])

  const handleEnrich = async (provOverride, modOverride) => {
    setEnrichError(null)
    setBusyAction('enrich')
    try {
      const p = (typeof provOverride === 'string' && provOverride) || selectedEnrichProvider
      const m = (typeof modOverride === 'string' && modOverride) || selectedEnrichModel
      const payload = (p && m) ? { provider: p, model: m } : undefined
      const updated = await api.enrichLibraryItem(item.id, payload)
      setDetailItem(updated)
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

  const handleModelChange = async ({ provider, model }) => {
    setSelectedEnrichProvider(provider)
    setSelectedEnrichModel(model)
    setShowModelMenu(false)
    try {
      await api.updateLibrarySettings?.({ enrich_provider: provider, enrich_model: model })
    } catch {}
    handleEnrich(provider, model)
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            {hasMultipleMediaModes && (
              <div className="lib-media-segment" role="tablist" aria-label="Media view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isVideoMode}
                  className={`lib-media-segment-btn ${isVideoMode ? 'lib-media-segment-btn--active' : ''}`}
                  onClick={() => setMediaMode('video')}
                >
                  <Icon name="play" size={12} />
                  <span>Video</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isVideoMode}
                  className={`lib-media-segment-btn ${!isVideoMode ? 'lib-media-segment-btn--active' : ''}`}
                  onClick={() => {
                    setMediaMode('slides')
                    setIsPlaying(false)
                  }}
                >
                  <Icon name="image" size={12} />
                  <span>Diagrams & Slides ({slideItems.length})</span>
                </button>
              </div>
            )}

            {isVideoMode && videoItem ? (
              <LibraryVideoPlayer
                src={videoItem.url}
                poster={videoItem.poster}
                title={item.title}
                fallbackUrl={videoItem.fallbackUrl}
                embedUrl={videoItem.embedUrl}
                isVertical={isVertical}
                imageFitMode={imageFitMode}
                onToggleFit={() => setImageFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
                cleanCoverSlug={cleanCoverSlug}
              />
            ) : (
              <div className={`lib-page-media-viewport ${isVertical ? 'lib-page-media-viewport--portrait' : ''}`}>
                <div
                  ref={carouselTrackRef}
                  className="lib-page-carousel-track"
                  onScroll={handleCarouselScroll}
                >
                  {slideItems.map((cItem, idx) => (
                    <div key={`slide-${idx}`} className="lib-page-carousel-slide">
                      {cItem.type === 'image' ? (
                        <div
                          className="lib-page-cover-box"
                          onClick={() => {
                            setCurrentSlideIndex(idx)
                            setShowLightbox(true)
                          }}
                        >
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
                        <div className="lib-player-graphic-card">
                          <div className="lib-player-graphic-title">{cleanCoverSlug}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Minimal bottom-docked slide navigation bar */}
                {slideItems.length > 1 && (
                  <div className="lib-slide-nav-bar">
                    <button
                      type="button"
                      className="lib-slide-nav-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        const prevIdx = currentSlideIndex > 0 ? currentSlideIndex - 1 : slideItems.length - 1
                        scrollToSlide(prevIdx)
                      }}
                      title="Previous slide"
                      aria-label="Previous slide"
                    >
                      <Icon name="chevron-left" size={14} />
                    </button>
                    <span className="lib-slide-nav-counter">
                      {currentSlideIndex + 1} / {slideItems.length}
                    </span>
                    <button
                      type="button"
                      className="lib-slide-nav-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        const nextIdx = currentSlideIndex < slideItems.length - 1 ? currentSlideIndex + 1 : 0
                        scrollToSlide(nextIdx)
                      }}
                      title="Next slide"
                      aria-label="Next slide"
                    >
                      <Icon name="chevron-right" size={14} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Controls Below Media Frame: Only displayed for non-video mode (e.g. diagrams/slides) */}
            {!isVideoMode && (
              <div className="lib-page-media-actions">
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  type="button"
                  className={`lib-page-pill-btn ${imageFitMode === 'contain' ? 'lib-page-pill-btn--active' : ''}`}
                  onClick={() => setImageFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
                  title={imageFitMode === 'contain' ? 'Fill frame' : 'Original uncropped fit'}
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
            )}

            {/* Unified Creator & Caption Context Card */}
            {(item.url || item.author || sourceInfo.author || authorAvatarUrl || caption || item.excerpt) && item.kind !== 'note' && (
              <div className="lib-creator-card">
                <div className="lib-creator-card-header">
                  <div className="lib-creator-card-left">
                    <div className="lib-creator-avatar">
                      {authorAvatarUrl ? (
                        <img src={authorAvatarUrl} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                      ) : favicon ? (
                        <img src={favicon} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                      ) : (
                        <span>{(cleanAuthor || sourceInfo.platformName || 'A').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="lib-creator-info">
                      <span className="lib-creator-name" title={sourceInfo.author || cleanAuthor || 'Creator'}>
                        {sourceInfo.author || cleanAuthor || 'Creator'}
                      </span>
                      <span className="lib-creator-platform">
                        {sourceInfo.platformName}
                      </span>
                    </div>
                  </div>

                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="lib-creator-open-btn"
                      title={`Open on ${sourceInfo.platformName}`}
                    >
                      <span>Open</span>
                      <Icon name="arrow-up-right" size={12} />
                    </a>
                  )}
                </div>

                {(caption || item.excerpt) && (
                  <>
                    <div className="lib-creator-divider" />
                    <div className="lib-creator-caption-box">
                      <p className={`lib-creator-caption-text ${!isCaptionExpanded ? 'lib-creator-caption-text--clamped' : ''}`}>
                        {caption || item.excerpt}
                      </p>
                      {(caption || item.excerpt).length > 90 && (
                        <button
                          type="button"
                          className="lib-creator-caption-toggle"
                          onClick={() => setIsCaptionExpanded((v) => !v)}
                        >
                          <span>{isCaptionExpanded ? 'Show less ⌃' : 'Show more ⌄'}</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
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
              {/* 1. Main Title & Type-Adaptive Subtitle */}
              <div className="lib-detail-hero">
                <div className="lib-detail-title-row">
                  <h1 className="lib-page-heading">{displayTitle}</h1>
                  {displayRating && (
                    <span className="lib-rating-badge-pill" title="Subject Rating">
                      <Icon name="star" size={12} filled style={{ color: '#f59e0b' }} />
                      <span>{displayRating}</span>
                    </span>
                  )}
                </div>

                {displaySubtitle && (
                  <div className="lib-detail-subtitle">
                    <span>{displaySubtitle}</span>
                    {item?.category && item.category !== 'general' && (
                      <span className="lib-detail-category-badge">
                        {item.category === 'movie' && (item?.is_reel || (sourceInfo.platformName || '').toLowerCase().includes('instagram') || (sourceInfo.platformName || '').toLowerCase().includes('tiktok'))
                          ? 'Film Clip'
                          : item.category}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* 2. Metadata Strip */}
              <div className="lib-page-meta-strip">
                <div className="lib-page-meta-item">
                  <Icon name="calendar" size={12} />
                  <span>Captured {dateFull || 'Undated'}</span>
                </div>
                {cleanAuthor && !displaySubtitle?.includes(cleanAuthor) && (
                  <div className="lib-page-meta-item">
                    <Icon name="user" size={12} />
                    <span>By {cleanAuthor}</span>
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

              {/* 3. Action Pill Buttons */}
              <div className="lib-page-cta-row">
                {adaptiveActions.map((act, i) => (
                  <a
                    key={i}
                    href={act.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`lib-page-cta-pill ${act.primary || i === 0 ? 'lib-page-cta-pill--primary' : 'lib-page-cta-pill--secondary'}`}
                  >
                    <Icon name={act.icon || 'external-link'} size={14} />
                    <span>{act.label} ↗</span>
                  </a>
                ))}

                {item.url && (
                  <button
                    type="button"
                    className="lib-page-cta-pill lib-page-cta-pill--secondary"
                    onClick={handleCopyLink}
                    title="Copy URL"
                  >
                    <Icon name={copiedLink ? 'check' : 'copy'} size={13} />
                    <span>{copiedLink ? 'Copied' : 'Copy link'}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="lib-page-cta-pill lib-page-cta-pill--secondary"
                  onClick={() => handleEnrich()}
                  disabled={Boolean(busyAction) || item.status === 'enriching'}
                  title="Synthesize / Re-analyze with AI"
                >
                  <Icon
                    name={isEnriching ? 'loader' : 'spark'}
                    size={13}
                    className={isEnriching ? 'animate-spin' : ''}
                  />
                  <span>{isEnriching ? 'Synthesizing...' : (summaryText ? 'Re-analyze' : 'Synthesize')}</span>
                </button>
              </div>

              {/* Studio Segmented Navigation Tabs */}
              <div className="lib-studio-tabs" role="tablist" aria-label="Studio sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'overview'}
                  className={`lib-studio-tab-btn ${activeTab === 'overview' ? 'lib-studio-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                >
                  <Icon name="spark" size={13} />
                  <span>Overview & AI</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'content'}
                  className={`lib-studio-tab-btn ${activeTab === 'content' ? 'lib-studio-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('content')}
                >
                  <Icon name="file" size={13} />
                  <span>Content & Transcripts</span>
                  {contentCount > 0 && (
                    <span className="lib-studio-tab-badge">{contentCount}</span>
                  )}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'notes'}
                  className={`lib-studio-tab-btn ${activeTab === 'notes' ? 'lib-studio-tab-btn--active' : ''}`}
                  onClick={() => setActiveTab('notes')}
                >
                  <Icon name="edit" size={13} />
                  <span>Notes & Curation</span>
                  {notesCount > 0 && (
                    <span className="lib-studio-tab-badge">{notesCount}</span>
                  )}
                </button>
              </div>

              {/* TAB 1: OVERVIEW & AI SYNTHESIS */}
              {activeTab === 'overview' && (
                <div className="lib-tab-pane" data-enter>
                  {/* Significance Star Rating */}
                  <div className="lib-page-significance-bar">
                    <span className="lib-page-significance-title">Significance</span>
                    <div className="lib-page-stars-track">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const effectiveRating = hoveredStar ?? rating ?? 0
                        const isFilled = effectiveRating >= star
                        const activeStarColor = effectiveRating > 0 ? (RATING_TIERS[effectiveRating]?.color || '#f59e0b') : '#f59e0b'
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
                                color: isFilled ? activeStarColor : 'var(--hairline-strong)',
                                transition: 'color 120ms ease, transform 120ms ease',
                              }}
                            />
                          </motion.button>
                        )
                      })}
                    </div>
                    {displayedTier ? (
                      <span
                        className="lib-page-significance-tier"
                        style={{
                          color: (hoveredStar ?? rating) ? (RATING_TIERS[hoveredStar ?? rating]?.color || '#f59e0b') : 'var(--text-faint)',
                          background: (hoveredStar ?? rating) ? `${RATING_TIERS[hoveredStar ?? rating]?.color || '#f59e0b'}18` : 'transparent',
                          border: `1px solid ${(hoveredStar ?? rating) ? `${RATING_TIERS[hoveredStar ?? rating]?.color || '#f59e0b'}33` : 'transparent'}`,
                        }}
                      >
                        {displayedTier.label}
                      </span>
                    ) : (
                      <span className="lib-page-significance-tier lib-page-significance-tier--unrated">
                        Unrated
                      </span>
                    )}

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

                  {/* Key Insights & Synthesis Panel */}
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
                  ) : summaryText ? (
                    <div className="lib-synthesis-card">
                      <div className="lib-synthesis-header">
                        <div className="lib-synthesis-title-wrap">
                          <div className="lib-synthesis-icon-badge">
                            <Icon name="spark" size={13} />
                          </div>
                          <span className="lib-synthesis-heading">Key insights and synthesis</span>
                        </div>

                        <div className="lib-synthesis-actions">
                          <div className="lib-synthesis-model-picker" ref={modelPickerRef}>
                            <button
                              type="button"
                              className="lib-model-select-btn"
                              onClick={() => setShowModelMenu((v) => !v)}
                              title={`Synthesis Model: ${formatModelDisplayName(selectedEnrichModel || 'llama-3.3-70b-versatile')}${item.enrichment_model && item.enrichment_model !== selectedEnrichModel ? ` (originally generated with ${formatModelDisplayName(item.enrichment_model)})` : ''}`}
                            >
                              <AiProviderIcon
                                provider={selectedEnrichProvider || 'groq'}
                                model={selectedEnrichModel || 'llama-3.3-70b-versatile'}
                                size={12}
                              />
                              <span>
                                {formatModelDisplayName(selectedEnrichModel || 'llama-3.3-70b-versatile')}
                              </span>
                              <Icon name="chevron-down" size={10} />
                            </button>

                            {showModelMenu && (
                              <div className="lib-model-menu-popover">
                                <ModelMenu
                                  provider={selectedEnrichProvider || 'groq'}
                                  model={selectedEnrichModel || 'llama-3.3-70b-versatile'}
                                  onChange={handleModelChange}
                                  onClose={() => setShowModelMenu(false)}
                                  placement="down"
                                />
                              </div>
                            )}
                          </div>

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
                            onClick={() => handleEnrich()}
                            disabled={Boolean(busyAction)}
                            title="Regenerate summary and extract resources with AI"
                          >
                            <Icon name="refresh" size={12} />
                            <span>Regenerate</span>
                          </motion.button>
                        </div>
                      </div>

                      <p className="lib-synthesis-prose">{summaryText}</p>
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

                        <div className="lib-synthesis-actions">
                          <div className="lib-synthesis-model-picker" ref={modelPickerRef}>
                            <button
                              type="button"
                              className="lib-model-select-btn"
                              onClick={() => setShowModelMenu((v) => !v)}
                              title={`Configure synthesis model (current default: ${formatModelDisplayName(selectedEnrichModel || 'llama-3.3-70b-versatile')})`}
                            >
                              <AiProviderIcon
                                provider={selectedEnrichProvider || 'groq'}
                                model={selectedEnrichModel || 'llama-3.3-70b-versatile'}
                                size={12}
                              />
                              <span>
                                {formatModelDisplayName(selectedEnrichModel || 'llama-3.3-70b-versatile')}
                              </span>
                              <Icon name="chevron-down" size={10} />
                            </button>

                            {showModelMenu && (
                              <div className="lib-model-menu-popover">
                                <ModelMenu
                                  provider={selectedEnrichProvider || 'groq'}
                                  model={selectedEnrichModel || 'llama-3.3-70b-versatile'}
                                  onChange={handleModelChange}
                                  onClose={() => setShowModelMenu(false)}
                                  placement="down"
                                />
                              </div>
                            )}
                          </div>

                          {isLlmFailure && (
                            <span className="lib-detail-warning-tag">Offline during capture</span>
                          )}
                        </div>
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
                            disabled={Boolean(busyAction) || item.status === 'enriching'}
                            onClick={() => handleEnrich()}
                          >
                            <Icon
                              name={isEnriching ? 'loader' : 'spark'}
                              size={13}
                              className={isEnriching ? 'animate-spin' : ''}
                            />
                            <span>{isEnriching ? 'Synthesizing...' : 'Synthesize with AI'}</span>
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

                  {/* Type-Adaptive Specifications & Attributes */}
                  {adaptiveAttributes.length > 0 && (
                    <div className="lib-page-section">
                      <div className="lib-page-section-header">
                        <span className="lib-page-section-title-wrap">
                          <Icon name="info" size={13} />
                          <span>Specifications & Attributes</span>
                        </span>
                      </div>
                      <div className="lib-page-spec-table">
                        {adaptiveAttributes.map((attr, idx) => (
                          <div key={idx} className="lib-page-spec-item">
                            <span className="lib-page-spec-key">{attr.key}</span>
                            <span className="lib-page-spec-val">{attr.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Detected Audio & Songs Section */}
                  {musicResources.length > 0 && (
                    <div className="lib-page-section">
                      <div className="lib-page-section-header">
                        <span className="lib-page-section-title-wrap">
                          <Icon name="music" size={13} />
                          <span>Detected Audio & Songs</span>
                        </span>
                        <span className="lib-page-section-count">
                          {musicResources.length} {musicResources.length === 1 ? 'track' : 'tracks'}
                        </span>
                      </div>

                      <div className="lib-songs-list">
                        {musicResources.map((track, i) => {
                          const trackTitle = track.name || track.title || 'Unknown Track'
                          const trackArtist = track.detail || track.author || track.artist || ''
                          const isSaved = savedSongs.has(trackTitle)
                          const isSaving = savingSong === trackTitle

                          return (
                            <div key={i} className="lib-song-card">
                              <div className="lib-song-card-left">
                                <div className="lib-song-icon-badge">
                                  <Icon name="music" size={16} />
                                </div>
                                <div className="lib-song-details">
                                  <div className="lib-song-title-row">
                                    <span className="lib-song-title" title={trackTitle}>
                                      {trackTitle}
                                    </span>
                                  </div>
                                  {trackArtist && (
                                    <span className="lib-song-artist" title={trackArtist}>
                                      {trackArtist}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="lib-song-actions">
                                {track.url && (
                                  <a
                                    href={track.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="lib-song-btn"
                                    title={`Open on ${track.url.includes('shazam') ? 'Shazam' : 'platform'}`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Icon name="external-link" size={11} />
                                    <span>Platform</span>
                                  </a>
                                )}

                                <button
                                  type="button"
                                  className={`lib-song-btn ${isSaved ? 'lib-song-btn--saved' : 'lib-song-btn--primary'}`}
                                  disabled={isSaved || isSaving}
                                  onClick={() => handleSaveSong(track)}
                                  title={isSaved ? 'Saved to Song List' : 'Add to Song List'}
                                >
                                  <Icon
                                    name={isSaved ? 'check' : isSaving ? 'loader' : 'plus'}
                                    size={11}
                                    className={isSaving ? 'animate-spin' : ''}
                                  />
                                  <span>
                                    {isSaved
                                      ? 'Saved to Song List'
                                      : isSaving
                                      ? 'Saving...'
                                      : 'Add to Song List'}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  className="lib-song-btn"
                                  onClick={() => handleExportSongToPlaylist(track)}
                                  title="Create or export to Spotify playlist"
                                >
                                  <Icon name="list-plus" size={11} />
                                  <span>Export Playlist</span>
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Mentioned Resources & Websites */}
                  {mentionedResources.length > 0 && (
                    <div className="lib-page-section">
                      <div className="lib-page-section-header">
                        <span className="lib-page-section-title-wrap">
                          <Icon name="globe" size={13} />
                          <span>Mentioned resources and websites</span>
                        </span>
                        <span className="lib-page-section-count">
                          {mentionedResources.length} {mentionedResources.length === 1 ? 'item' : 'items'}
                        </span>
                      </div>

                      <div className="lib-synthesis-resources-grid">
                        {mentionedResources.map((res, i) => {
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
                </div>
              )}

              {/* TAB 2: CONTENT & TRANSCRIPTS */}
              {activeTab === 'content' && (
                <div className="lib-tab-pane" data-enter>
                  {contentCount === 0 ? (
                    <div className="lib-content-empty-card">
                      <div className="lib-content-empty-icon">
                        <Icon name="file-text" size={24} />
                      </div>
                      <h3 className="lib-content-empty-title">No raw transcripts or slides extracted yet</h3>
                      <p className="lib-content-empty-desc">
                        Synthesize this item with AI to automatically run Whisper speech-to-text on the audio track and Vision AI OCR frame analysis.
                      </p>
                      <button
                        type="button"
                        className="lib-btn lib-btn--primary"
                        disabled={Boolean(busyAction) || item.status === 'enriching'}
                        onClick={() => handleEnrich()}
                      >
                        <Icon name="spark" size={13} />
                        <span>Extract Transcripts & Visual Content</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Speech Transcript */}
                      {transcript && (
                        <div className="lib-page-section lib-transcript-panel">
                          <div className="lib-page-section-header">
                            <span className="lib-page-section-title-wrap">
                              <Icon name="quotes" size={13} />
                              <span>Source Speech Transcript</span>
                              {transcriptWordCount > 0 && (
                                <span className="lib-transcript-count-pill">{transcriptWordCount} words</span>
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.92 }}
                                type="button"
                                className="lib-synthesis-action-btn"
                                onClick={handleCopyTranscript}
                                title="Copy full transcript"
                              >
                                <Icon name={copiedTranscript ? 'check' : 'copy'} size={12} />
                                <span>{copiedTranscript ? 'Copied' : 'Copy'}</span>
                              </motion.button>
                            </div>
                          </div>

                          <div className="lib-transcript-box lib-transcript-box--open">
                            <p className="lib-transcript-text" style={{ whiteSpace: 'pre-wrap' }}>{transcript}</p>
                            <div className="lib-transcript-badge">
                              <Icon name="spark" size={10} />
                              <span>Transcribed verbatim from reel audio via Whisper</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Visual Content & OCR Frames */}
                      {visualContent && (
                        <div className="lib-page-section lib-transcript-panel">
                          <div className="lib-page-section-header">
                            <span className="lib-page-section-title-wrap">
                              <Icon name="brain" size={13} />
                              <span>Slide & Visual On-Screen Content</span>
                              {visualWordCount > 0 && (
                                <span className="lib-transcript-count-pill">{visualWordCount} words</span>
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.92 }}
                                type="button"
                                className="lib-synthesis-action-btn"
                                onClick={handleCopyVisuals}
                                title="Copy visual text content"
                              >
                                <Icon name={copiedVisuals ? 'check' : 'copy'} size={12} />
                                <span>{copiedVisuals ? 'Copied' : 'Copy'}</span>
                              </motion.button>
                            </div>
                          </div>

                          <div className="lib-transcript-box lib-transcript-box--open">
                            <p className="lib-transcript-text" style={{ whiteSpace: 'pre-wrap' }}>{visualContent}</p>
                            <div className="lib-transcript-badge">
                              <Icon name="image" size={10} />
                              <span>Extracted from video frames & slides via Vision AI OCR</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Creator Caption */}
                      {caption && (
                        <div className="lib-page-section lib-transcript-panel">
                          <div className="lib-page-section-header">
                            <span className="lib-page-section-title-wrap">
                              <Icon name="user" size={13} />
                              <span>Creator Caption & Post Description</span>
                              {captionWordCount > 0 && (
                                <span className="lib-transcript-count-pill">{captionWordCount} words</span>
                              )}
                            </span>
                          </div>

                          <div className="lib-transcript-box lib-transcript-box--open">
                            <p className="lib-transcript-text" style={{ whiteSpace: 'pre-wrap' }}>{caption}</p>
                            <div className="lib-transcript-badge">
                              <Icon name="user" size={10} />
                              <span>Original post caption from author</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Full-Text Document */}
                      {textBody && (
                        <div className="lib-page-section lib-transcript-panel">
                          <div className="lib-page-section-header">
                            <span className="lib-page-section-title-wrap">
                              <Icon name="file-text" size={13} />
                              <span>Captured Full Document Text</span>
                              {textBodyWordCount > 0 && (
                                <span className="lib-transcript-count-pill">{textBodyWordCount} words</span>
                              )}
                            </span>
                          </div>

                          <div className="lib-transcript-box lib-transcript-box--open">
                            <p className="lib-transcript-text" style={{ whiteSpace: 'pre-wrap' }}>{textBody}</p>
                            <div className="lib-transcript-badge">
                              <Icon name="file" size={10} />
                              <span>Full document markdown / text body</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* TAB 3: NOTES & METADATA */}
              {activeTab === 'notes' && (
                <div className="lib-tab-pane" data-enter>
                  {/* Personal Notes & Synthesis */}
                  <div className="lib-page-section">
                    <div className="lib-page-notes-header">
                      <label className="lib-page-section-title-wrap" htmlFor="lib-page-notes">
                        <Icon name="edit" size={13} />
                        <span>Personal notes and synthesis</span>
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
                      placeholder="Record your personal notes, takeaways, code snippets, or key quotes..."
                      rows={6}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      onBlur={handleSaveNotes}
                    />
                  </div>

                  {/* Topics & Taxonomy Tags */}
                  <div className="lib-page-section">
                    <div className="lib-page-section-title-wrap">
                      <Icon name="tag" size={13} />
                      <span>Topics and taxonomy tags</span>
                    </div>
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

                  {/* Technical Provenance & System Specs */}
                  <div className="lib-page-section">
                    <div className="lib-page-section-title-wrap">
                      <Icon name="info" size={13} />
                      <span>Technical Provenance</span>
                    </div>
                    <div className="lib-provenance-card">
                      <div className="lib-provenance-row">
                        <span className="lib-provenance-label">Resource ID</span>
                        <span className="lib-provenance-val mono">{item.id}</span>
                      </div>
                      <div className="lib-provenance-row">
                        <span className="lib-provenance-label">Format / Kind</span>
                        <span className="lib-provenance-val capitalize">{item.kind || 'link'} · {sourceInfo.platformName}</span>
                      </div>
                      {item.url && (
                        <div className="lib-provenance-row">
                          <span className="lib-provenance-label">Original URL</span>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="lib-provenance-link"
                            title={item.url}
                          >
                            {item.url}
                          </a>
                        </div>
                      )}
                      {item.media_path && (
                        <div className="lib-provenance-row">
                          <span className="lib-provenance-label">Media Path</span>
                          <span className="lib-provenance-val mono" title={item.media_path}>{item.media_path}</span>
                        </div>
                      )}
                      <div className="lib-provenance-row">
                        <span className="lib-provenance-label">Semantic Index</span>
                        <span className="lib-provenance-val">
                          {item.indexed ? 'Indexed in Chroma Vector Space' : 'Archived (unindexed)'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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

      {/* Standalone Export Playlist Modal for detected tracks */}
      {showInternalExportModal && (
        <ExportPlaylistModal
          open={showInternalExportModal}
          items={internalExportItems}
          onClose={() => setShowInternalExportModal(false)}
          toast={toast}
        />
      )}
    </>
  )
}
