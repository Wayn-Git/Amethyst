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
import { formatDisplayDate, formatFullDateTime } from './dateUtils.js'

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

  const footerIdx = text.search(/\n---\n/)
  const clean = footerIdx !== -1 ? text.slice(0, footerIdx) : text

  const headingRegex = /^##\s+([^\n]+)$/gm
  const matches = []
  let m
  while ((m = headingRegex.exec(clean)) !== null) {
    matches.push({ name: m[1].trim(), index: m.index, endIndex: m.index + m[0].length })
  }

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

export function LibraryDetailModal({
  item,
  items,
  currentIndex = -1,
  onClose,
  onPrev,
  onNext,
  onUpdate,
  onDelete,
  toast = () => {},
}) {
  const [detailItem, setDetailItem] = useState(item)
  const [busyAction, setBusyAction] = useState('')
  const [rating, setRating] = useState(item?.rating ?? null)
  const [notes, setNotes] = useState(item?.notes || '')
  const [noteInput, setNoteInput] = useState(item?.notes || '')
  const [tags, setTags] = useState(() => {
    let t = item?.tags
    if (typeof t === 'string') {
      try { t = JSON.parse(t) } catch { t = [] }
    }
    return Array.isArray(t) ? t : []
  })
  const [isAddingTag, setIsAddingTag] = useState(false)
  const [tagInput, setTagInput] = useState('')

  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [imageFitMode, setImageFitMode] = useState('cover')
  const [mediaMode, setMediaMode] = useState('video')
  const [showLightbox, setShowLightbox] = useState(false)
  const [captionExpanded, setCaptionExpanded] = useState(false)

  // Overflow Menu State
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const overflowMenuRef = useRef(null)

  // Transcripts Drawer State
  const [showTranscriptsDrawer, setShowTranscriptsDrawer] = useState(false)
  const [activeDrawerTab, setActiveDrawerTab] = useState('transcript')

  // Copied states
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedDrawerText, setCopiedDrawerText] = useState(false)

  // AI model settings
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [selectedEnrichProvider, setSelectedEnrichProvider] = useState(() => {
    return item?.enrichment_model ? formatModelProvider(item.enrichment_model) : 'groq'
  })
  const [selectedEnrichModel, setSelectedEnrichModel] = useState(() => {
    return item?.enrichment_model ? item.enrichment_model.split(':')[1] || item.enrichment_model : 'llama-3.3-70b-versatile'
  })

  // Playlists
  const [playlists, setPlaylists] = useState([])
  const [showExportPlaylist, setShowExportPlaylist] = useState(false)

  const carouselTrackRef = useRef(null)

  // Load playlists & settings
  useEffect(() => {
    let unmounted = false
    async function loadInitial() {
      try {
        const plList = await api.listPlaylists?.()
        if (!unmounted && Array.isArray(plList)) setPlaylists(plList)
      } catch {}
      try {
        const settings = await api.getLibrarySettings?.()
        if (!unmounted && settings) {
          if (settings.enrich_provider) setSelectedEnrichProvider(settings.enrich_provider)
          if (settings.enrich_model) setSelectedEnrichModel(settings.enrich_model)
        }
      } catch {}
    }
    loadInitial()
    return () => { unmounted = true }
  }, [])

  // Sync state when item changes
  useEffect(() => {
    setDetailItem(item)
    setRating(item?.rating ?? null)
    setNotes(item?.notes || '')
    setNoteInput(item?.notes || '')
    let nextTags = item?.tags
    if (typeof nextTags === 'string') {
      try { nextTags = JSON.parse(nextTags) } catch { nextTags = [] }
    }
    setTags(Array.isArray(nextTags) ? nextTags : [])
    setCurrentSlideIndex(0)
    setMediaMode('video')
    setShowLightbox(false)
    setShowOverflowMenu(false)
    setShowTranscriptsDrawer(false)
  }, [item?.id])

  // Fetch full item content
  useEffect(() => {
    let unmounted = false
    if (!item?.id) return
    async function fetchFull() {
      try {
        const full = await api.getLibraryItem(item.id)
        if (!unmounted && full) {
          setDetailItem(full)
          if (full.notes !== undefined) {
            setNotes(full.notes || '')
            setNoteInput(full.notes || '')
          }
          if (full.rating !== undefined) setRating(full.rating)
          let t = full.tags
          if (typeof t === 'string') {
            try { t = JSON.parse(t) } catch { t = [] }
          }
          if (Array.isArray(t)) setTags(t)
        }
      } catch {}
    }
    fetchFull()
    return () => { unmounted = true }
  }, [item?.id])

  // Close overflow menu on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) {
        setShowOverflowMenu(false)
      }
    }
    if (showOverflowMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showOverflowMenu])

  // Pager helpers
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex !== -1 && items && currentIndex < items.length - 1

  const handlePrev = useCallback(() => {
    if (hasPrev) onPrev?.()
  }, [hasPrev, onPrev])

  const handleNext = useCallback(() => {
    if (hasNext) onNext?.()
  }, [hasNext, onNext])

  // Content parsing
  const { summaryCandidate, transcript, visualContent, caption, textBody } = useMemo(() => {
    return parseMarkdownSections(detailItem?.content, item?.excerpt, item?.text_source)
  }, [detailItem?.content, item?.excerpt, item?.text_source])

  // Extracted entity
  const entity = useMemo(() => {
    return detailItem?.entity || item?.entity || null
  }, [detailItem?.entity, item?.entity])

  // Date & Duration
  const dateFull = useMemo(() => {
    return formatDisplayDate(item?.published_on || item?.consumed_on)
  }, [item?.published_on, item?.consumed_on])

  const duration = useMemo(() => {
    return formatDuration(item?.duration_seconds)
  }, [item?.duration_seconds])

  const domain = useMemo(() => {
    return getDomain(item?.url, item?.site)
  }, [item?.url, item?.site])

  const favicon = useMemo(() => {
    return getFaviconUrl(item?.url)
  }, [item?.url])

  // Author Avatar
  const authorAvatar = useMemo(() => {
    let res = item?.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    if (Array.isArray(res)) {
      const av = res.find((r) => r && r.type === 'avatar')
      if (av?.url) return av.url
    }
    const appLower = (item?.app || '').toLowerCase()
    if (appLower === 'x' && item?.author) {
      const handle = item.author.replace(/.*@([A-Za-z0-9_]+).*/, '$1')
      if (handle && handle !== item.author) return `https://unavatar.io/x/${handle}`
    }
    if (appLower === 'github' && item?.author) {
      return `https://github.com/${item.author.replace(/^@/, '')}.png?size=64`
    }
    return null
  }, [item?.resources, item?.app, item?.author])

  // Platform & Source
  const sourceInfo = useMemo(() => {
    if (!item) return { platformName: 'Resource', icon: 'link', author: null, showFavicon: false }
    const app = (item.app || '').toLowerCase()
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
    if (app && APP_NAMES[app]) {
      return {
        platformName: APP_NAMES[app],
        icon: app === 'youtube' ? 'play' :
              app === 'instagram' ? 'spark' :
              app === 'spotify' ? 'music' :
              app === 'github' ? 'code' :
              app === 'x' ? 'chat' : KIND_ICON[item.kind] || 'link',
        author: item.author ? (item.author.startsWith('@') ? item.author : `@${item.author}`) : null,
        showFavicon: Boolean(favicon),
      }
    }
    return {
      platformName: domain || (item.kind || 'resource').toUpperCase(),
      icon: KIND_ICON[item.kind] || 'link',
      author: item.author || null,
      showFavicon: Boolean(favicon),
    }
  }, [item, domain, favicon])

  // Caption text for left media card
  const captionText = useMemo(() => {
    if (caption && caption.trim()) return caption.trim()
    if (item?.notes && !item.notes.startsWith('http') && !item.notes.startsWith('?')) return item.notes.trim()
    if (item?.excerpt && item.excerpt.trim()) return item.excerpt.trim()
    return null
  }, [caption, item?.notes, item?.excerpt])

  // Media preparation
  const urlLower = (item?.url || '').toLowerCase()
  const isDirectVideoUrl = /\.(mp4|mov|webm)(\?|$)/i.test(urlLower)
  const isReelOrShort = urlLower.includes('/reel/') || urlLower.includes('/reels/') || urlLower.includes('/shorts/')
  const isSocialVideo =
    urlLower.includes('instagram.com') ||
    urlLower.includes('tiktok.com') ||
    urlLower.includes('youtube.com') ||
    urlLower.includes('youtu.be')

  const isVertical = Boolean(
    isReelOrShort ||
    (item?.duration_seconds && item.duration_seconds < 120 && isSocialVideo) ||
    urlLower.includes('tiktok.com')
  )

  const { videoItem, slideItems, isVid } = useMemo(() => {
    if (!item) return { videoItem: null, slideItems: [], isVid: false }
    let res = item.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    const resList = Array.isArray(res) ? res : []
    const slideRes = resList.filter((r) => r && (r.type === 'slide' || r.type === 'image'))
    const videoResource = resList.find(
      (r) => r && (r.type === 'video' || r.type === 'mp4' || (typeof r.url === 'string' && /\.(mp4|mov|webm)(\?|$)/i.test(r.url)))
    )

    let youtubeEmbedUrl = null
    if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
      const match = item.url?.match(/(?:v=|\/embed\/|\/watch\?v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)
      if (match && match[1]) {
        youtubeEmbedUrl = `https://www.youtube.com/embed/${match[1]}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`
      }
    }

    const hasLocalVid = Boolean(item.media_path && /\.(mp4|mov|webm)(\?|$)/i.test(item.media_path))
    const hasVideo = hasLocalVid || Boolean(videoResource) || isDirectVideoUrl || (item.kind === 'video' && !youtubeEmbedUrl)
    const videoStreamUrl = api.mediaUrl(item.id)
    const fallbackVideoUrl =
      (videoResource?.remote_url && videoResource.remote_url.startsWith('http') ? videoResource.remote_url : null) ||
      (videoResource?.url && videoResource.url.startsWith('http') ? videoResource.url : null) ||
      (isDirectVideoUrl ? item.url : null)

    const vItem = (youtubeEmbedUrl || hasVideo) ? {
      type: youtubeEmbedUrl ? 'youtube' : 'video',
      url: youtubeEmbedUrl || videoStreamUrl,
      fallbackUrl: fallbackVideoUrl,
      poster: item.thumbnail_path ? api.thumbnailUrl(item.id) : undefined,
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
      if (item.thumbnail_path) {
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
  }, [item, urlLower, isDirectVideoUrl])

  const isVideoMode = Boolean(videoItem && (mediaMode === 'video' || slideItems.length === 0))
  const carouselItems = isVideoMode ? (videoItem ? [videoItem] : []) : slideItems

  const scrollToSlide = useCallback((targetIdx) => {
    if (carouselTrackRef.current) {
      const width = carouselTrackRef.current.clientWidth
      carouselTrackRef.current.scrollTo({
        left: targetIdx * width,
        behavior: 'smooth',
      })
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

  // Primary Action CTAs
  const primaryActions = useMemo(() => {
    if (entity?.actions && Array.isArray(entity.actions) && entity.actions.length > 0) {
      return entity.actions
    }
    const acts = []
    const cat = (item?.category || '').toLowerCase()
    const isVideo = item?.kind === 'video' || cat === 'movie' || cat === 'cinema' || isVid
    if (isVideo) {
      const q = encodeURIComponent(`${entity?.title || item?.title || ''} trailer`)
      acts.push({
        label: 'Watch trailer',
        url: `https://www.youtube.com/results?search_query=${q}`,
        kind: 'trailer',
      })
    } else if (cat === 'tool' || item?.kind === 'code') {
      if (item?.url) {
        acts.push({ label: 'Visit website', url: item.url, kind: 'website' })
      }
    } else if (cat === 'book') {
      const q = encodeURIComponent(`${entity?.title || item?.title || ''} book`)
      acts.push({ label: 'Open details', url: `https://www.goodreads.com/search?q=${q}`, kind: 'details' })
    }
    if (item?.url && !acts.some((a) => a.url === item.url)) {
      acts.push({ label: 'Open details', url: item.url, kind: 'details' })
    }
    return acts.slice(0, 2)
  }, [entity, item, isVid])

  // Spec Table Rows
  const specRows = useMemo(() => {
    if (entity?.attributes && typeof entity.attributes === 'object') {
      const rows = Object.entries(entity.attributes)
        .filter(([k, v]) => Boolean(k && v))
        .map(([key, value]) => ({ key, value: String(value) }))
      if (rows.length > 0) return rows
    }
    // Fallback spec rows for legacy items
    const rows = []
    if (item?.category) {
      rows.push({ key: 'Genre', value: item.category.charAt(0).toUpperCase() + item.category.slice(1) })
    }
    if (entity?.rating || item?.rating) {
      rows.push({ key: 'Rating', value: entity?.rating || `${item.rating}/5★` })
    }
    if (item?.author) {
      rows.push({ key: 'Creator', value: item.author.startsWith('@') ? item.author : `@${item.author}` })
    }
    if (duration) {
      rows.push({ key: 'Runtime', value: duration })
    }
    if (dateFull) {
      rows.push({ key: 'Released', value: dateFull })
    }
    if (domain) {
      rows.push({ key: 'Source', value: domain })
    }
    return rows
  }, [entity, item, duration, dateFull, domain])

  // Narrative synopsis
  const displaySynopsis = useMemo(() => {
    return entity?.synopsis || detailItem?.summary || item?.summary || summaryCandidate || item?.excerpt || ''
  }, [entity?.synopsis, detailItem?.summary, item?.summary, summaryCandidate, item?.excerpt])

  // Rating and Curation handlers
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
      toast(`Added tag #${clean}`, 'ok')
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
    if (noteInput === notes) return
    setNotes(noteInput)
    try {
      const updated = await api.updateLibraryItem(item.id, { notes: noteInput })
      onUpdate?.(updated)
      toast('Notes saved', 'ok')
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleCopyLink = async () => {
    if (!item?.url) return
    try {
      await navigator.clipboard.writeText(item.url)
      setCopiedLink(true)
      toast('Copied URL to clipboard', 'ok')
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      toast('Failed to copy URL', 'bad')
    }
  }

  const handleCopyDrawerText = async (txt) => {
    if (!txt) return
    try {
      await navigator.clipboard.writeText(txt)
      setCopiedDrawerText(true)
      toast('Copied text to clipboard', 'ok')
      setTimeout(() => setCopiedDrawerText(false), 2000)
    } catch {
      toast('Failed to copy text', 'bad')
    }
  }

  const handleEnrich = async (provOverride, modOverride) => {
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

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${item.title}" from your library?`)) return
    try {
      await api.deleteLibraryItem(item.id)
      onDelete?.(item)
      toast('Item deleted from library', 'ok')
      onClose?.()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const isEnriching = busyAction === 'enrich' || item.status === 'enriching'

  // Clean slug for graphic card fallback
  const cleanCoverSlug = (item.title || 'resource')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)

  return (
    <>
      <motion.div
        className="lib-page-detail lib-page-detail--editorial"
        role="region"
        aria-label={item.title || 'Library item detail'}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ========================================================
            TOP NAVIGATION BAR
            ======================================================== */}
        <header className="lib-page-header">
          <div className="lib-page-header-left">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              className="lib-editorial-back-btn"
              onClick={onClose}
              title="Back to Library (Esc)"
            >
              <Icon name="arrow-left" size={15} />
              <span>Library</span>
            </motion.button>
          </div>

          <div className="lib-page-header-right">
            {items && items.length > 0 && currentIndex !== -1 && (
              <div className="lib-editorial-pager">
                <button
                  type="button"
                  className="lib-editorial-pager-btn"
                  onClick={handlePrev}
                  disabled={!hasPrev}
                  title="Previous item (←)"
                >
                  <Icon name="chevron-left" size={13} />
                </button>
                <span className="lib-editorial-pager-text">
                  {currentIndex + 1} of {items.length}
                </span>
                <button
                  type="button"
                  className="lib-editorial-pager-btn"
                  onClick={handleNext}
                  disabled={!hasNext}
                  title="Next item (→)"
                >
                  <Icon name="chevron-right" size={13} />
                </button>
              </div>
            )}

            {/* Remind me to watch / Saved CTA */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              className={`lib-editorial-remind-btn ${rating ? 'lib-editorial-remind-btn--saved' : ''}`}
              onClick={() => handleRating(rating ? null : 5)}
              title={rating ? 'Curated in Library' : 'Remind me to watch'}
            >
              <Icon name="bell" size={14} />
              <span>{rating ? 'Curated' : 'Remind me to watch'}</span>
            </motion.button>

            {/* More Options (···) Overflow Menu */}
            <div className="lib-overflow-wrap" ref={overflowMenuRef}>
              <motion.button
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                className="lib-editorial-icon-btn"
                onClick={() => setShowOverflowMenu((v) => !v)}
                title="More options"
                aria-label="More options"
              >
                <Icon name="more-horizontal" size={16} />
              </motion.button>

              <AnimatePresence>
                {showOverflowMenu && (
                  <motion.div
                    className="lib-overflow-menu"
                    initial={{ opacity: 0, scale: 0.95, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -4 }}
                    transition={{ duration: 0.12 }}
                  >
                    <button
                      type="button"
                      className="lib-overflow-row"
                      onClick={() => {
                        setShowOverflowMenu(false)
                        handleEnrich()
                      }}
                      disabled={isEnriching}
                    >
                      <Icon name="spark" size={13} />
                      <span>{isEnriching ? 'Synthesizing...' : 'Re-analyze with AI'}</span>
                    </button>

                    <button
                      type="button"
                      className="lib-overflow-row"
                      onClick={() => {
                        setShowOverflowMenu(false)
                        setShowModelMenu(true)
                      }}
                    >
                      <Icon name="sliders" size={13} />
                      <span>Model: {formatModelDisplayName(selectedEnrichModel)}</span>
                    </button>

                    <button
                      type="button"
                      className="lib-overflow-row"
                      onClick={() => {
                        setShowOverflowMenu(false)
                        handleReindex()
                      }}
                    >
                      <Icon name="refresh" size={13} />
                      <span>Re-index Search Embeddings</span>
                    </button>

                    <button
                      type="button"
                      className="lib-overflow-row"
                      onClick={() => {
                        setShowOverflowMenu(false)
                        setShowTranscriptsDrawer(true)
                      }}
                    >
                      <Icon name="file-text" size={13} />
                      <span>Inspect Transcripts & Text</span>
                    </button>

                    {item.url && (
                      <button
                        type="button"
                        className="lib-overflow-row"
                        onClick={() => {
                          setShowOverflowMenu(false)
                          handleCopyLink()
                        }}
                      >
                        <Icon name={copiedLink ? 'check' : 'copy'} size={13} />
                        <span>Copy Original URL</span>
                      </button>
                    )}

                    <div className="lib-overflow-hr" />

                    <button
                      type="button"
                      className="lib-overflow-row lib-overflow-row--danger"
                      onClick={() => {
                        setShowOverflowMenu(false)
                        handleDelete()
                      }}
                    >
                      <Icon name="trash" size={13} />
                      <span>Delete Item</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              type="button"
              className="lib-editorial-icon-btn lib-editorial-icon-btn--close"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close"
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        </header>

        {/* ========================================================
            SPACIOUS EDITORIAL TWO-COLUMN BODY
            ======================================================== */}
        <div className="lib-editorial-container">
          {/* ----------------- LEFT COLUMN: FRAMED MEDIA CARD ----------------- */}
          <div className="lib-editorial-media-column">
            <div className="lib-framed-card">
              {/* Media Viewport */}
              <div className={`lib-framed-canvas ${isVertical ? 'lib-framed-canvas--portrait' : ''}`}>
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
                  <div className="lib-framed-carousel-viewport">
                    <div
                      ref={carouselTrackRef}
                      className="lib-framed-carousel-track"
                      onScroll={handleCarouselScroll}
                    >
                      {slideItems.map((cItem, idx) => (
                        <div key={`slide-${idx}`} className="lib-framed-slide">
                          {cItem.type === 'image' ? (
                            <img
                              src={cItem.url}
                              alt={cItem.name || item.title || `Media ${idx + 1}`}
                              className={`lib-framed-img lib-framed-img--${imageFitMode}`}
                              onClick={() => {
                                setCurrentSlideIndex(idx)
                                setShowLightbox(true)
                              }}
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
                                if (item.thumbnail_path && currentSrc !== api.thumbnailUrl(item.id)) {
                                  e.currentTarget.src = api.thumbnailUrl(item.id)
                                }
                              }}
                            />
                          ) : (
                            <div className="lib-player-graphic-card">
                              <div className="lib-player-graphic-title">{cleanCoverSlug}</div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Counter Pill in Top Right Corner */}
                    {slideItems.length > 1 && (
                      <div className="lib-framed-counter-badge">
                        {currentSlideIndex + 1} / {slideItems.length}
                      </div>
                    )}

                    {/* Left / Right Chevron Arrows on Hover */}
                    {slideItems.length > 1 && (
                      <>
                        <button
                          type="button"
                          className="lib-framed-nav-chevron lib-framed-nav-chevron--prev"
                          onClick={(e) => {
                            e.stopPropagation()
                            const prevIdx = currentSlideIndex > 0 ? currentSlideIndex - 1 : slideItems.length - 1
                            scrollToSlide(prevIdx)
                          }}
                          aria-label="Previous slide"
                        >
                          <Icon name="chevron-left" size={15} />
                        </button>
                        <button
                          type="button"
                          className="lib-framed-nav-chevron lib-framed-nav-chevron--next"
                          onClick={(e) => {
                            e.stopPropagation()
                            const nextIdx = currentSlideIndex < slideItems.length - 1 ? currentSlideIndex + 1 : 0
                            scrollToSlide(nextIdx)
                          }}
                          aria-label="Next slide"
                        >
                          <Icon name="chevron-right" size={15} />
                        </button>
                      </>
                    )}

                    {/* Dot Pagination at Bottom Edge */}
                    {slideItems.length > 1 && (
                      <div className="lib-framed-dots-bar">
                        {slideItems.map((_, idx) => (
                          <button
                            key={`dot-${idx}`}
                            type="button"
                            className={`lib-framed-dot ${idx === currentSlideIndex ? 'lib-framed-dot--active' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              scrollToSlide(idx)
                            }}
                            aria-label={`Slide ${idx + 1}`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Framed Card Bottom Footer */}
              <div className="lib-framed-footer">
                <div className="lib-framed-author-row">
                  <div className="lib-framed-author-info">
                    {authorAvatar ? (
                      <img src={authorAvatar} alt="" className="lib-framed-avatar" />
                    ) : (
                      <div className="lib-framed-avatar-fallback">
                        <Icon name={sourceInfo.icon} size={14} />
                      </div>
                    )}
                    <span className="lib-framed-author-handle">
                      {sourceInfo.author || sourceInfo.platformName}
                    </span>
                  </div>

                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="lib-framed-open-pill"
                      title="Open source website"
                    >
                      <span>Open</span>
                      <Icon name="external-link" size={11} />
                    </a>
                  )}
                </div>

                {captionText && (
                  <div className="lib-framed-caption-wrap">
                    <p className={`lib-framed-caption-text ${captionExpanded ? 'lib-framed-caption-text--expanded' : ''}`}>
                      {captionText}
                    </p>
                    {captionText.length > 80 && (
                      <button
                        type="button"
                        className="lib-framed-caption-toggle"
                        onClick={() => setCaptionExpanded((v) => !v)}
                      >
                        <span>{captionExpanded ? 'Less' : 'More'}</span>
                        <Icon name={captionExpanded ? 'chevron-up' : 'chevron-down'} size={11} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ----------------- RIGHT COLUMN: EDITORIAL SPEC & CURATION ----------------- */}
          <div className="lib-editorial-content-column">
            <div className="lib-editorial-scroll-body">
              {/* 1. Main Title */}
              <h1 className="lib-editorial-main-title">
                {entity?.title || item.title || 'Untitled Resource'}
              </h1>

              {/* 2. Subtitle: Creator/Director · Category */}
              {(entity?.subtitle || item.author || item.category) && (
                <div className="lib-editorial-subtitle-line">
                  {entity?.subtitle || `${item.author ? `@${item.author.replace(/^@/, '')}` : (sourceInfo.platformName || '')} · ${item.category || item.kind}`}
                </div>
              )}

              {/* 3. Rating Pill Badge */}
              {entity?.rating && (
                <div className="lib-editorial-rating-wrap">
                  <span className="lib-editorial-rating-chip">
                    <span className="lib-editorial-rating-tag">R</span>
                    <span>{entity.rating}</span>
                  </span>
                </div>
              )}

              {/* 4. Narrative Synopsis Paragraph */}
              {displaySynopsis && (
                <div className="lib-editorial-synopsis-p">
                  <p>{displaySynopsis}</p>
                </div>
              )}

              {/* 5. Primary Action CTAs */}
              <div className="lib-editorial-actions-bar">
                {primaryActions.map((act, idx) => (
                  <a
                    key={`act-${idx}`}
                    href={act.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`lib-editorial-cta-btn ${idx === 0 ? 'lib-editorial-cta-btn--primary' : 'lib-editorial-cta-btn--secondary'}`}
                  >
                    {act.kind === 'trailer' || act.kind === 'video' ? (
                      <Icon name="play" size={13} />
                    ) : null}
                    <span>{act.label}</span>
                    <Icon name="external-link" size={12} />
                  </a>
                ))}
              </div>

              {/* 6. Clean Two-Column Spec Table */}
              <div className="lib-editorial-spec-table">
                {specRows.map((row, idx) => (
                  <div key={`spec-${idx}`} className="lib-editorial-spec-row">
                    <span className="lib-editorial-spec-key">{row.key}</span>
                    <span className="lib-editorial-spec-val">{row.value}</span>
                  </div>
                ))}
              </div>

              {/* 7. Category Attribution */}
              <div className="lib-editorial-category-row">
                <span className="lib-editorial-cat-label">Category:</span>
                <span className="lib-editorial-cat-val">
                  {entity?.attributes?.Genre || item.category ? (item.category.charAt(0).toUpperCase() + item.category.slice(1)) : 'General'}
                </span>
              </div>

              {/* 8. Unified "Yours" Card */}
              <div className="lib-yours-box">
                <h3 className="lib-yours-title">Yours</h3>

                {/* Lists Row */}
                <div className="lib-yours-field-row">
                  <span className="lib-yours-field-label">Lists</span>
                  <div className="lib-yours-pills-row">
                    {playlists.map((pl) => (
                      <span key={pl.id} className="lib-yours-pill">
                        <Icon name="list" size={11} />
                        <span>{pl.name}</span>
                      </span>
                    ))}
                    {playlists.length === 0 && (
                      <span className="lib-yours-pill">
                        <Icon name="list" size={11} />
                        <span>Random</span>
                      </span>
                    )}
                    <button
                      type="button"
                      className="lib-yours-add-pill"
                      onClick={() => setShowExportPlaylist(true)}
                      title="Add to list"
                    >
                      <Icon name="plus" size={12} />
                    </button>
                  </div>
                </div>

                {/* Tags Row */}
                <div className="lib-yours-field-row">
                  <span className="lib-yours-field-label">Tags</span>
                  <div className="lib-yours-pills-row">
                    {tags.map((t) => (
                      <span key={t} className="lib-yours-pill">
                        <span>{t}</span>
                        <button
                          type="button"
                          className="lib-yours-pill-x"
                          onClick={() => handleRemoveTag(t)}
                          title={`Remove #${t}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {isAddingTag ? (
                      <form onSubmit={handleAddTag} className="inline-flex">
                        <input
                          autoFocus
                          type="text"
                          value={tagInput}
                          onChange={(e) => setTagInput(e.target.value)}
                          onBlur={() => { if (!tagInput) setIsAddingTag(false) }}
                          placeholder="tag..."
                          className="lib-yours-input-pill"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="lib-yours-add-pill"
                        onClick={() => setIsAddingTag(true)}
                        title="Add tag"
                      >
                        <Icon name="plus" size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Notes Input */}
                <div className="lib-yours-notes-block">
                  <span className="lib-yours-field-label">Notes</span>
                  <textarea
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    onBlur={handleSaveNotes}
                    placeholder="Add a note..."
                    rows={2}
                    className="lib-yours-textarea"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ========================================================
          INSPECT TRANSCRIPTS & TEXT DRAWER
          ======================================================== */}
      <AnimatePresence>
        {showTranscriptsDrawer && (
          <div
            className="lib-drawer-backdrop"
            onClick={() => setShowTranscriptsDrawer(false)}
          >
            <motion.div
              className="lib-drawer-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="lib-drawer-header">
                <div className="lib-drawer-title-wrap">
                  <Icon name="file-text" size={15} />
                  <h3>Transcripts & Extracted Content</h3>
                </div>
                <button
                  type="button"
                  className="lib-editorial-icon-btn"
                  onClick={() => setShowTranscriptsDrawer(false)}
                  title="Close drawer"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>

              {/* Drawer Segment Tabs */}
              <div className="lib-drawer-tabs">
                <button
                  type="button"
                  className={`lib-drawer-tab ${activeDrawerTab === 'transcript' ? 'lib-drawer-tab--active' : ''}`}
                  onClick={() => setActiveDrawerTab('transcript')}
                >
                  Transcript {transcript ? '✓' : ''}
                </button>
                <button
                  type="button"
                  className={`lib-drawer-tab ${activeDrawerTab === 'visual' ? 'lib-drawer-tab--active' : ''}`}
                  onClick={() => setActiveDrawerTab('visual')}
                >
                  Visual OCR {visualContent ? '✓' : ''}
                </button>
                <button
                  type="button"
                  className={`lib-drawer-tab ${activeDrawerTab === 'raw' ? 'lib-drawer-tab--active' : ''}`}
                  onClick={() => setActiveDrawerTab('raw')}
                >
                  Raw Markdown
                </button>
              </div>

              <div className="lib-drawer-content">
                {activeDrawerTab === 'transcript' && (
                  <div className="lib-drawer-pane">
                    <div className="lib-drawer-pane-bar">
                      <span className="lib-drawer-count">
                        {transcript ? `${transcript.split(/\s+/).length} words spoken` : 'No transcript recorded'}
                      </span>
                      {transcript && (
                        <button
                          type="button"
                          className="lib-drawer-copy-btn"
                          onClick={() => handleCopyDrawerText(transcript)}
                        >
                          <Icon name={copiedDrawerText ? 'check' : 'copy'} size={12} />
                          <span>{copiedDrawerText ? 'Copied' : 'Copy'}</span>
                        </button>
                      )}
                    </div>
                    <pre className="lib-drawer-text-view">
                      {transcript || 'No speech transcript available for this item.'}
                    </pre>
                  </div>
                )}

                {activeDrawerTab === 'visual' && (
                  <div className="lib-drawer-pane">
                    <div className="lib-drawer-pane-bar">
                      <span className="lib-drawer-count">
                        {visualContent ? `${visualContent.split(/\s+/).length} words OCR` : 'No visual text'}
                      </span>
                      {visualContent && (
                        <button
                          type="button"
                          className="lib-drawer-copy-btn"
                          onClick={() => handleCopyDrawerText(visualContent)}
                        >
                          <Icon name={copiedDrawerText ? 'check' : 'copy'} size={12} />
                          <span>{copiedDrawerText ? 'Copied' : 'Copy'}</span>
                        </button>
                      )}
                    </div>
                    <pre className="lib-drawer-text-view">
                      {visualContent || 'No on-screen text was detected from frames.'}
                    </pre>
                  </div>
                )}

                {activeDrawerTab === 'raw' && (
                  <div className="lib-drawer-pane">
                    <div className="lib-drawer-pane-bar">
                      <span className="lib-drawer-count">Markdown file</span>
                      {detailItem?.content && (
                        <button
                          type="button"
                          className="lib-drawer-copy-btn"
                          onClick={() => handleCopyDrawerText(detailItem.content)}
                        >
                          <Icon name={copiedDrawerText ? 'check' : 'copy'} size={12} />
                          <span>{copiedDrawerText ? 'Copied' : 'Copy'}</span>
                        </button>
                      )}
                    </div>
                    <pre className="lib-drawer-text-view">
                      {detailItem?.content || 'No text content on disk.'}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lightbox Modal */}
      <AnimatePresence>
        {showLightbox && (
          <div
            className="lib-lightbox-overlay"
            onClick={() => setShowLightbox(false)}
          >
            <motion.div
              className="lib-lightbox-content"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={slideItems[currentSlideIndex]?.url || (item.thumbnail_path ? api.thumbnailUrl(item.id) : '')}
                alt={item.title || 'Full image'}
                className="lib-lightbox-img"
              />
              <button
                type="button"
                className="lib-lightbox-close"
                onClick={() => setShowLightbox(false)}
                title="Close"
              >
                <Icon name="x" size={16} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Model Selection Menu */}
      {showModelMenu && (
        <ModelMenu
          isOpen={showModelMenu}
          onClose={() => setShowModelMenu(false)}
          onSelect={handleModelChange}
          currentModel={selectedEnrichModel}
          currentProvider={selectedEnrichProvider}
        />
      )}

      {/* Export Playlist Modal */}
      {showExportPlaylist && (
        <ExportPlaylistModal
          open={showExportPlaylist}
          items={[item]}
          onClose={() => setShowExportPlaylist(false)}
          toast={toast}
        />
      )}
    </>
  )
}

export default LibraryDetailModal
