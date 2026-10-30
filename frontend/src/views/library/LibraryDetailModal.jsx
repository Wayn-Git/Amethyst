import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import ExportPlaylistModal from './ExportPlaylistModal.jsx'
import LibraryVideoPlayer from './LibraryVideoPlayer.jsx'
import Markdown from '../../components/markdown/Markdown.jsx'
import { formatDuration, getDomain, getFaviconUrl, KIND_ICON } from './LibraryCard.jsx'
import { formatDisplayDate, formatFullDateTime, formatRelativeDate } from './dateUtils.js'
import { CloseButton } from '../../components/base/buttons/close-button'
import { isTyping } from '../../keys.js'

import LibrarySummaryCard from './LibrarySummaryCard.jsx'
import LibraryDetectedSection from './LibraryDetectedSection.jsx'
import LibraryRightRail from './LibraryRightRail.jsx'
import LibraryQueuePopover from './LibraryQueuePopover.jsx'
import LibraryShortcutsModal from './LibraryShortcutsModal.jsx'
import AppButton from '../../components/ui/AppButton.jsx'
import ProgressSegmentedControl from './ProgressSegmentedControl.jsx'
import LibraryReminderBanner from './LibraryReminderBanner.jsx'
import './library-detail.css'

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

  // Extract explicit sections
  let transcript = null
  let visualContent = null
  let caption = null
  let textBody = null

  matches.forEach((match, i) => {
    const nextStart = matches[i + 1] ? matches[i + 1].index : clean.length
    const sectionBody = clean.slice(match.endIndex, nextStart).trim()
    const nameLower = match.name.toLowerCase()

    if (nameLower.includes('transcript') || nameLower.includes('speech')) {
      transcript = sectionBody
    } else if (
      nameLower.includes('slide analysis') ||
      nameLower.includes('visual') ||
      nameLower.includes('slides') ||
      nameLower.includes('screen')
    ) {
      visualContent = sectionBody
    } else if (nameLower.includes('caption') || nameLower.includes('post text')) {
      caption = sectionBody
    } else if (nameLower.includes('content') || nameLower.includes('article') || nameLower.includes('body')) {
      textBody = sectionBody
    }
  })

  // Fallback for speech transcript
  if (!transcript && (textSource === 'whisper' || textSource === 'speech')) {
    transcript = clean
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

export function cleanTitleText(rawTitle) {
  if (!rawTitle) return 'Untitled Resource'
  let t = String(rawTitle).trim()
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
  t = t.replace(/^https?:\/\/\S+/i, '').replace(/https?:\/\/\S+$/i, '')
  t = t.replace(/[\[\]]/g, '')
  t = t.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t || 'Untitled Resource'
}

export function cleanCaptionText(rawText) {
  if (!rawText) return ''
  let text = String(rawText)
  text = text.replace(/!?\[!?\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, '')
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '')
  text = text.replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+(?:cdn|fbcdn|instagram|scontent)[^\s)]*\)/gi, '')
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/!?\[(?:Image|Photo|Video)\s*\d*:[^\]]*\]/gi, '')
  text = text.replace(/https?:\/\/[^\s)]+(?:cdn|scontent|fbcdn)[^\s)]*/gi, '')
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

export function cleanDocumentText(rawText) {
  if (!rawText) return ''
  let text = String(rawText)
  text = text.replace(/!\[\[([^\]]+)\]\(([^)]+)\)\s*\)/g, '![$1]($2)')
  text = text.replace(/(!\[[^\]]*\]\(https?:\/\/[^?)\s]+)\?[^)\s]+/g, '$1')
  return text.trim()
}

export function getResourceIcon(type, url, name = '') {
  const t = (type || '').toLowerCase()
  const n = (name || '').toLowerCase()
  const u = (url || '').toLowerCase()

  if (n.includes('notion') || u.includes('notion.so')) return 'book'
  if (n.includes('github') || u.includes('github.com')) return 'github'
  if (n.includes('google docs') || u.includes('docs.google.com')) return 'file'
  if (n.includes('chatgpt') || n.includes('openai') || u.includes('openai.com') || u.includes('chatgpt.com')) return 'spark'
  if (n.includes('threads') || u.includes('threads.net')) return 'threads'
  if (n.includes('instagram') || u.includes('instagram.com')) return 'instagram'
  if (n === 'x' || n.includes('twitter') || u.includes('x.com') || u.includes('twitter.com')) return 'x'
  if (n.includes('youtube') || u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  if (n.includes('spotify') || u.includes('spotify.com')) return 'music'

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

export function formatTranscriptToParagraphs(rawText) {
  if (!rawText) return []
  const clean = String(rawText).trim()
  if (!clean) return []
  const rawParagraphs = clean.split(/\n\s*\n/)
  if (rawParagraphs.length > 1) {
    return rawParagraphs.map((p) => p.trim()).filter(Boolean)
  }
  const sentences = clean.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [clean]
  const paragraphs = []
  let current = []
  let wordCount = 0

  for (const s of sentences) {
    const trimmed = s.trim()
    if (!trimmed) continue
    current.push(trimmed)
    const words = trimmed.split(/\s+/).length
    wordCount += words
    if (wordCount >= 35 || current.length >= 3) {
      paragraphs.push(current.join(' '))
      current = []
      wordCount = 0
    }
  }
  if (current.length > 0) {
    paragraphs.push(current.join(' '))
  }
  return paragraphs.length > 0 ? paragraphs : [clean]
}

/** Converts all-caps screaming titles to clean sentence-case */
function formatSentenceCase(str) {
  if (!str) return ''
  const letters = str.replace(/[^a-zA-Z]/g, '')
  if (letters.length > 5 && letters === letters.toUpperCase()) {
    return str.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase())
  }
  return str
}

/** Parses transcript into lines with optional timestamps */
function parseTranscriptLines(rawText) {
  if (!rawText) return []
  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
  const timestampRegex = /^(?:\[?(\d{1,2}:(?:\d{2}))\]?|\((\d{1,2}:(?:\d{2}))\))\s*(.+)$/
  return lines.map((line) => {
    const m = line.match(timestampRegex)
    if (m) {
      const timeStr = m[1] || m[2]
      const parts = timeStr.split(':').map(Number)
      const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : 0
      return { timeStr, seconds, text: m[3].trim() }
    }
    return { timeStr: null, seconds: null, text: line }
  })
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

  // Core metadata state
  const [notes, setNotes] = useState(item?.notes || '')
  const [tags, setTags] = useState(item?.tags || [])
  const [rating, setRating] = useState(item?.rating || null)
  const [savingNotes, setSavingNotes] = useState(false)
  const [notesSavedIndicator, setNotesSavedIndicator] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedSummary, setCopiedSummary] = useState(false)
  const [enrichError, setEnrichError] = useState(null)
  const [isEnriching, setIsEnriching] = useState(false)
  const [showLightbox, setShowLightbox] = useState(false)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

  // Title inline editing state
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(item?.title || '')

  // Navigation queue popover & shortcuts modal
  const [showQueuePopover, setShowQueuePopover] = useState(false)
  const [showShortcutsModal, setShowShortcutsModal] = useState(false)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef(null)

  // Media view modes & layout
  const [mediaMode, setMediaMode] = useState(() => {
    const hasLocal = Boolean(initialItem?.media_path) && /\.(mp4|webm|mov)(\?|$)/i.test(initialItem.media_path)
    const hasYt = Boolean(initialItem?.url && /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)/i.test(initialItem.url))
    return (hasLocal || hasYt) ? 'video' : 'slides'
  })
  const [activeTab, setActiveTab] = useState('overview')
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false)
  const [isTheater, setIsTheater] = useState(false)

  // Splitter resizer
  const [mediaWidthPercent, setMediaWidthPercent] = useState(() => {
    try {
      const saved = localStorage.getItem('amethyst_lib_media_width')
      if (saved) {
        const parsed = Number(saved)
        if (parsed >= 28 && parsed <= 65) return parsed
      }
    } catch {}
    return 42
  })
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false)

  // Video seeking & time sync
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState(0)
  const [seekTargetTime, setSeekTargetTime] = useState(null)

  // Configured enrichment models
  const [configuredProvider, setConfiguredProvider] = useState('google')
  const [configuredModel, setConfiguredModel] = useState('gemini-2.5-flash')
  const [availableModels, setAvailableModels] = useState([])

  // Internal export playlist modal
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportModalTracks, setExportModalTracks] = useState([])
  const [savedSongs, setSavedSongs] = useState(() => new Set())
  const [savingSong, setSavingSong] = useState(null)

  const bodyRef = useRef(null)
  const notesTextareaRef = useRef(null)
  const titleInputRef = useRef(null)

  // Sync state on item change
  useEffect(() => {
    setDetailItem(initialItem)
    if (initialItem) {
      setNotes(initialItem.notes || '')
      setTags(initialItem.tags || [])
      setRating(initialItem.rating || null)
      setTitleDraft(initialItem.title || '')
      setIsEditingTitle(false)
      setEnrichError(null)
      setIsEnriching(false)
      setActiveTab('overview')
      setCurrentSlideIndex(0)
      setIsCaptionExpanded(false)
      setShowActionsMenu(false)
      setShowQueuePopover(false)
    }

    // Reset container scroll position
    const mainEl = document.querySelector('main.view-swap, .main.view-swap')
    if (mainEl) mainEl.scrollTop = 0
    const viewEl = document.querySelector('.lib-view')
    if (viewEl) viewEl.scrollTop = 0
    const bodyEl = document.querySelector('.lib-page-body')
    if (bodyEl) bodyEl.scrollTop = 0
    const centerEl = document.querySelector('.lib-page-center-col')
    if (centerEl) centerEl.scrollTop = 0
    window.scrollTo(0, 0)

    if (initialItem?.id) {
      let isCurrent = true
      const fetchItem = api.libraryItem ? api.libraryItem(initialItem.id) : null
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

  // Automatically select video or slides based on media presence
  useEffect(() => {
    if (item) {
      const hasLocalVid = Boolean(item.media_path) && /\.(mp4|webm|mov)(\?|$)/i.test(item.media_path)
      const hasYt = Boolean(item.url && /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)/i.test(item.url))
      const hasInstagramVid = item.kind === 'video'
      setMediaMode((hasLocalVid || hasYt || hasInstagramVid) ? 'video' : 'slides')
    }
  }, [item?.id, item?.media_path, item?.url, item?.kind])

  // Load configured enrichment models from backend health/settings
  useEffect(() => {
    api.librarySettings?.()
      .then((settings) => {
        if (settings?.enrich_provider) setConfiguredProvider(settings.enrich_provider)
        if (settings?.enrich_model) setConfiguredModel(settings.enrich_model)
      })
      .catch(() => {})

    api.health?.()
      .then((h) => {
        if (h?.providers) {
          const list = []
          for (const p of h.providers) {
            const defModel = h.provider_defaults?.[p] || (p === 'google' ? 'gemini-2.5-flash' : p === 'groq' ? 'llama-3.3-70b-versatile' : 'default')
            list.push({ provider: p, model: defModel, label: formatModelDisplayName(defModel) })
          }
          if (list.length > 0) setAvailableModels(list)
        }
      })
      .catch(() => {})
  }, [])

  // Dismiss actions menu on click outside
  useEffect(() => {
    if (!showActionsMenu) return
    const handleClick = (e) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) {
        setShowActionsMenu(false)
      }
    }
    window.addEventListener('mousedown', handleClick, true)
    return () => window.removeEventListener('mousedown', handleClick, true)
  }, [showActionsMenu])

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

  // Parsed sections
  const { summaryCandidate, transcript, visualContent } = useMemo(
    () => parseMarkdownSections(item.content, item.excerpt, item.text_source),
    [item.content, item.excerpt, item.text_source]
  )

  const summaryText = item.summary || summaryCandidate || ''

  // Extracted clean caption from content or excerpt
  const cleanCaption = useMemo(() => {
    const raw = item.caption || item.excerpt || item.capture_note || ''
    return cleanCaptionText(raw)
  }, [item.caption, item.excerpt, item.capture_note])

  // Slides / image items
  const slideItems = useMemo(() => {
    const list = []
    if (item.resources && Array.isArray(item.resources)) {
      item.resources.forEach((res, i) => {
        if (res.type === 'slide' || res.type === 'image' || res.url?.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) {
          list.push({
            type: 'image',
            url: res.url,
            remoteUrl: res.remote_url,
            name: res.name || `Slide ${i + 1}`,
            index: res.index ?? i,
          })
        }
      })
    }
    return list
  }, [item.resources])

  // Video resource setup
  const videoItem = useMemo(() => {
    if (!item) return null
    const hasLocalVid = Boolean(item.media_path) && /\.(mp4|webm|mov)(\?|$)/i.test(item.media_path)
    if (hasLocalVid) {
      return {
        url: api.mediaUrl ? api.mediaUrl(item.id) : item.media_path,
        poster: api.thumbnailUrl ? api.thumbnailUrl(item.id) : null,
        isYouTube: false,
      }
    }
    const isYouTube = Boolean(item.url && /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/i.test(item.url))
    if (isYouTube) {
      return {
        url: item.url,
        poster: api.thumbnailUrl ? api.thumbnailUrl(item.id) : null,
        isYouTube: true,
      }
    }
    const videoResource = (Array.isArray(item.resources) ? item.resources : []).find(
      (r) => r && (r.type === 'video' || r.type === 'mp4' || (typeof r.url === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(r.url)))
    )
    if (videoResource) {
      return {
        url: api.mediaUrl ? api.mediaUrl(item.id) : videoResource.url,
        fallbackUrl: videoResource.url,
        poster: api.thumbnailUrl ? api.thumbnailUrl(item.id) : null,
        isYouTube: false,
      }
    }
    return null
  }, [item?.id, item?.media_path, item?.url, item?.resources])

  const hasMultipleMediaModes = Boolean(videoItem && slideItems.length > 0)
  const isVideoMode = mediaMode === 'video' && Boolean(videoItem)

  // Aspect ratio detection: 9:16 for reels/tiktok/shorts
  const isVertical = useMemo(() => {
    if (item.is_reel) return true
    const u = (item.url || '').toLowerCase()
    return u.includes('/reel/') || u.includes('/reels/') || u.includes('/shorts/') || u.includes('tiktok.com')
  }, [item.is_reel, item.url])

  // Display title without forced sentence-case lowercasing
  const displayTitle = useMemo(() => {
    const raw = item.title || 'Untitled Resource'
    return cleanTitleText(raw)
  }, [item.title])

  // Platform source info
  const sourceInfo = useMemo(() => {
    const url = item.url || ''
    const domain = getCleanDomain(url)
    const author = item.author ? `@${item.author.replace(/^@/, '')}` : null

    if (url.includes('instagram.com')) {
      return {
        platformName: 'Instagram',
        icon: 'instagram',
        author,
        url,
      }
    }
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return {
        platformName: 'YouTube',
        icon: 'youtube',
        author,
        url,
      }
    }
    if (url.includes('twitter.com') || url.includes('x.com')) {
      return {
        platformName: 'X (Twitter)',
        icon: 'x',
        author,
        url,
      }
    }
    if (url.includes('github.com')) {
      return {
        platformName: 'GitHub',
        icon: 'github',
        author,
        url,
      }
    }
    return {
      platformName: domain || item.app || 'Web',
      icon: 'globe',
      author,
      url,
    }
  }, [item.url, item.author, item.app])

  // Handlers
  const handleCopyLink = useCallback(async () => {
    const textToCopy = item.url || window.location.href
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {}
  }, [item.url])

  const handleCopySummary = useCallback(async () => {
    if (!summaryText) return
    try {
      await navigator.clipboard.writeText(summaryText)
      setCopiedSummary(true)
      setTimeout(() => setCopiedSummary(false), 2000)
    } catch {}
  }, [summaryText])

  const handleEnrich = useCallback(async (modelSelection = null) => {
    if (!item?.id) return
    setIsEnriching(true)
    setEnrichError(null)

    const provider = modelSelection?.provider || configuredProvider
    const model = modelSelection?.model || configuredModel

    try {
      const res = await api.enrichLibraryItem(item.id, { provider, model })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch (err) {
      setEnrichError(err.message || String(err))
    } finally {
      setIsEnriching(false)
    }
  }, [item?.id, configuredProvider, configuredModel, onUpdate])

  const handleSaveTitle = async () => {
    const clean = titleDraft.trim()
    if (!clean || clean === item.title) {
      setIsEditingTitle(false)
      return
    }
    setIsEditingTitle(false)
    try {
      const res = await api.updateLibraryItem(item.id, { title: clean })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveTitle()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setTitleDraft(item.title || '')
      setIsEditingTitle(false)
    }
  }

  const handleSaveNotes = async () => {
    if (notes === (item.notes || '')) return
    setSavingNotes(true)
    try {
      const res = await api.updateLibraryItem(item.id, { notes })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
        setNotesSavedIndicator(true)
        setTimeout(() => setNotesSavedIndicator(false), 2000)
      }
    } catch {} finally {
      setSavingNotes(false)
    }
  }

  const handleToggleFavorite = async () => {
    const isFav = Boolean(rating && rating >= 4)
    const newRating = isFav ? null : 5
    setRating(newRating)
    try {
      const res = await api.updateLibraryItem(item.id, { rating: newRating })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  }

  const handleTogglePin = async () => {
    const nextPinned = !item.is_pinned
    setDetailItem((prev) => ({ ...prev, is_pinned: nextPinned }))
    onUpdate?.({ ...item, is_pinned: nextPinned })
    try {
      const res = await api.updateLibraryItem(item.id, { is_pinned: nextPinned })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  }

  const handleProgressChange = async (nextProgress) => {
    setDetailItem((prev) => ({ ...prev, progress: nextProgress }))
    onUpdate?.({ ...item, progress: nextProgress })
    try {
      const res = await api.updateLibraryItem(item.id, { progress: nextProgress })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  }

  const handleSaveReminder = async ({ remind_at, remind_action }) => {
    setDetailItem((prev) => ({ ...prev, remind_at, remind_action }))
    onUpdate?.({ ...item, remind_at, remind_action })
    try {
      const res = await api.updateLibraryItem(item.id, { remind_at, remind_action })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  }

  const handleClearReminder = async () => {
    setDetailItem((prev) => ({ ...prev, remind_at: null, reminded_at: null }))
    onUpdate?.({ ...item, remind_at: null, reminded_at: null })
    try {
      const res = await api.updateLibraryItem(item.id, { remind_at: null, reminded_at: null })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  }

  const handleAddTag = async (newTag) => {
    const clean = newTag.trim().toLowerCase()
    if (!clean || tags.includes(clean)) return
    const nextTags = [...tags, clean]
    setTags(nextTags)
    try {
      const res = await api.updateLibraryItem(item.id, { tags: nextTags })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  }

  const handleRemoveTag = async (tagToRemove) => {
    const nextTags = tags.filter((t) => t !== tagToRemove)
    setTags(nextTags)
    try {
      const res = await api.updateLibraryItem(item.id, { tags: nextTags })
      if (res) {
        setDetailItem(res)
        onUpdate?.(res)
      }
    } catch {}
  }

  const handleSaveSong = async (track) => {
    const trackTitle = track.name || track.title || 'Unknown Track'
    setSavingSong(trackTitle)
    try {
      setSavedSongs((prev) => new Set([...prev, trackTitle]))
      // If backend songs endpoint exists
      if (api.addSong) {
        await api.addSong(track)
      }
    } catch {} finally {
      setSavingSong(null)
    }
  }

  const handleExportPlaylistTrigger = (tracks) => {
    setExportModalTracks(tracks)
    if (onExportPlaylist) {
      onExportPlaylist(tracks)
    } else {
      setShowExportModal(true)
    }
  }

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Guard: do NOT fire shortcuts while user is typing in an input or textarea
      if (isTyping(e.target)) return

      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowRight') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        setIsEditingTitle(true)
        setTimeout(() => titleInputRef.current?.focus(), 50)
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        // Focus tag input in right rail
        document.querySelector('.lib-rail-tag-input')?.focus()
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setActiveTab('notes')
        setTimeout(() => notesTextareaRef.current?.focus(), 50)
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        handleCopyLink()
      } else if (e.key === '?') {
        e.preventDefault()
        setShowShortcutsModal(true)
      } else if (e.key === 'Escape') {
        if (showShortcutsModal) {
          setShowShortcutsModal(false)
        } else if (showQueuePopover) {
          setShowQueuePopover(false)
        } else if (isEditingTitle) {
          setIsEditingTitle(false)
          setTitleDraft(item.title || '')
        } else {
          onClose?.()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNext, handlePrev, handleCopyLink, onClose, showShortcutsModal, showQueuePopover, isEditingTitle, item.title])

  // Splitter drag resize logic
  const handleSplitterMouseDown = (e) => {
    e.preventDefault()
    setIsDraggingSplitter(true)

    const handleMouseMove = (moveEvent) => {
      if (!bodyRef.current) return
      const rect = bodyRef.current.getBoundingClientRect()
      const newPercent = ((moveEvent.clientX - rect.left) / rect.width) * 100
      if (newPercent >= 28 && newPercent <= 65) {
        setMediaWidthPercent(newPercent)
        try {
          localStorage.setItem('amethyst_lib_media_width', String(Math.round(newPercent)))
        } catch {}
      }
    }

    const handleMouseUp = () => {
      setIsDraggingSplitter(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // Parsed timestamped transcript lines
  const transcriptLines = useMemo(() => parseTranscriptLines(transcript), [transcript])
  const hasTimestamps = transcriptLines.some((l) => l.timeStr !== null)

  const dateRelative = item.created_at || item.consumed_on ? formatRelativeDate(item.created_at || item.consumed_on) : null
  const dateAbsolute = item.created_at || item.consumed_on ? formatFullDateTime(item.created_at || item.consumed_on) : null
  const durationText = item.duration_seconds ? formatDuration(item.duration_seconds) : null

  return (
    <div className="lib-detail-overlay" role="dialog" aria-modal="true" aria-label={displayTitle}>
      <div className={`lib-page-detail ${isTheater ? 'lib-page-detail--theater' : ''}`}>
        {/* ========================================================
            TOP BAR
            ======================================================== */}
        <header className="lib-page-header">
          <div className="lib-page-header-left">
            {/* Back to Library */}
            <AppButton
              variant="secondary"
              size="medium"
              className="lib-page-back-btn"
              onClick={onClose}
              title="Back to Library (Esc)"
              aria-label="Back to Library"
              icon={<Icon name="arrow-left" size={14} />}
            >
              Library
            </AppButton>
          </div>

          <div className="lib-page-header-right">
            {/* Prev / Next with "1 of 285" queue trigger */}
            {items && items.length > 0 && currentIndex !== -1 && (
              <div className="lib-page-pager">
                <button
                  type="button"
                  className="lib-page-pager-btn"
                  onClick={handlePrev}
                  disabled={!hasPrev}
                  title="Previous item (J or ←)"
                  aria-label="Previous item"
                >
                  <Icon name="chevron-left" size={14} />
                </button>

                <button
                  type="button"
                  className="lib-page-pager-queue-trigger"
                  onClick={() => setShowQueuePopover((v) => !v)}
                  title="View queue filmstrip"
                  aria-haspopup="true"
                  aria-expanded={showQueuePopover}
                >
                  <span>
                    {currentIndex + 1} of {items.length}
                  </span>
                  <Icon name="chevron-down" size={12} />
                </button>

                <button
                  type="button"
                  className="lib-page-pager-btn"
                  onClick={handleNext}
                  disabled={!hasNext}
                  title="Next item (K or →)"
                  aria-label="Next item"
                >
                  <Icon name="chevron-right" size={14} />
                </button>

                {showQueuePopover && (
                  <LibraryQueuePopover
                    items={items}
                    currentIndex={currentIndex}
                    onNavigate={(targetItem) => {
                      onNavigate?.(targetItem)
                      setShowQueuePopover(false)
                    }}
                    onClose={() => setShowQueuePopover(false)}
                  />
                )}
              </div>
            )}

            {/* Copy Link Button */}
            {item.url && (
              <AppButton
                variant="secondary"
                size="icon"
                className="lib-page-icon-btn"
                onClick={handleCopyLink}
                title="Copy original link (C)"
                aria-label="Copy link"
                icon={<Icon name={copiedLink ? 'check' : 'copy'} size={14} />}
              />
            )}

            {/* Keyboard Shortcuts Guide Trigger */}
            <AppButton
              variant="secondary"
              size="icon"
              className="lib-page-icon-btn"
              onClick={() => setShowShortcutsModal(true)}
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              icon={<Icon name="keyboard" size={14} />}
            />

            {/* The ONLY Theater Mode toggle in the entire view (icon-only like others) */}
            <AppButton
              variant="secondary"
              size="icon"
              className={`lib-header-theater-btn ${isTheater ? 'lib-header-theater-btn--active' : ''}`}
              onClick={() => setIsTheater((prev) => !prev)}
              title={isTheater ? 'Exit Theater Mode' : 'Focus media in Theater Mode'}
              aria-label={isTheater ? 'Exit theater mode' : 'Enter theater mode'}
              aria-pressed={isTheater}
              icon={<Icon name={isTheater ? 'collapse' : 'desktop'} size={14} />}
            />

            {/* Close Button */}
            <CloseButton size="sm" onClick={onClose} slot={null} aria-label="Close detail view" />
          </div>
        </header>

        {/* ========================================================
            3-REGION MAIN BODY: Left (sticky) | Center | Right Rail
            ======================================================== */}
        <div
          ref={bodyRef}
          className={`lib-page-body ${isTheater ? 'lib-page-body--theater' : ''} ${isDraggingSplitter ? 'lib-page-body--resizing' : ''}`}
        >
          {/* ----------------- REGION 1: LEFT STICKY MEDIA ----------------- */}
          <div
            className="lib-page-media-col"
            style={
              isTheater
                ? { flex: '1 1 100%', width: '100%', maxWidth: '100%' }
                : { flex: `0 0 ${mediaWidthPercent}%`, width: `${mediaWidthPercent}%`, maxWidth: `${mediaWidthPercent}%` }
            }
          >
            {/* Segmented control: only shown when diagrams/slides exist */}
            {hasMultipleMediaModes && (
              <div className="lib-media-segment" role="tablist" aria-label="Media mode">
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
                  onClick={() => setMediaMode('slides')}
                >
                  <Icon name="image" size={12} />
                  <span>Diagrams & Slides ({slideItems.length})</span>
                </button>
              </div>
            )}

            {/* Sized to video's actual aspect ratio without letterbox in landscape */}
            <div className={`lib-media-frame-wrap ${isVertical ? 'lib-media-frame-wrap--vertical' : 'lib-media-frame-wrap--landscape'}`}>
              {isVideoMode && videoItem ? (
                <LibraryVideoPlayer
                  src={videoItem.url}
                  isYouTube={videoItem.isYouTube}
                  poster={videoItem.poster}
                  title={item.title}
                  fallbackUrl={videoItem.fallbackUrl}
                  embedUrl={videoItem.embedUrl}
                  isVertical={isVertical}
                  cleanCoverSlug="video"
                  isTheater={isTheater}
                  subtitles={transcript || cleanCaption}
                  onTimeUpdate={setCurrentPlaybackTime}
                  seekToTime={seekTargetTime}
                />
              ) : (
                <div className="lib-page-media-viewport">
                  {slideItems.length > 0 ? (
                    <div className="lib-page-cover-box" onClick={() => setShowLightbox(true)}>
                      <img
                        src={slideItems[currentSlideIndex]?.url || api.thumbnailUrl(item.id)}
                        alt={item.title}
                        className="lib-page-cover-img"
                      />
                      {slideItems.length > 1 && (
                        <div className="lib-slide-nav-bar" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="lib-slide-nav-btn"
                            onClick={() => setCurrentSlideIndex((prev) => (prev > 0 ? prev - 1 : slideItems.length - 1))}
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
                            onClick={() => setCurrentSlideIndex((prev) => (prev < slideItems.length - 1 ? prev + 1 : 0))}
                            aria-label="Next slide"
                          >
                            <Icon name="chevron-right" size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="lib-player-graphic-card">
                      <Icon name="file-text" size={32} />
                      <span className="lib-player-graphic-title">{item.kind || 'Resource'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quiet Source Row under player: Platform icon, @account, "Open on <Platform>" */}
            <div className="lib-media-source-row">
              <div className="lib-media-source-account">
                <Icon name={sourceInfo.icon} size={14} className="lib-media-source-icon" />
                {sourceInfo.author ? (
                  <span className="lib-media-source-handle">{sourceInfo.author}</span>
                ) : (
                  <span className="lib-media-source-platform">{sourceInfo.platformName}</span>
                )}
              </div>

              {sourceInfo.url && (
                <a
                  href={sourceInfo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="lib-media-source-open-link"
                  title={`Open on ${sourceInfo.platformName}`}
                >
                  <span>Open on {sourceInfo.platformName}</span>
                  <Icon name="arrow-up-right" size={12} />
                </a>
              )}
            </div>

            {/* Caption: Collapsed to 2 lines by default with "Show more" */}
            {cleanCaption && (
              <div className="lib-media-caption-box">
                <p className={`lib-media-caption-text ${!isCaptionExpanded ? 'lib-media-caption-text--collapsed' : ''}`}>
                  {cleanCaption}
                </p>
                {cleanCaption.length > 120 && (
                  <button
                    type="button"
                    className="lib-media-caption-toggle"
                    onClick={() => setIsCaptionExpanded((v) => !v)}
                  >
                    <span>{isCaptionExpanded ? 'Show less' : 'Show more'}</span>
                    <Icon name={isCaptionExpanded ? 'chevron-up' : 'chevron-down'} size={12} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Resizable Divider Handle (Left / Center) */}
          {!isTheater && (
            <div
              className={`lib-page-splitter ${isDraggingSplitter ? 'lib-page-splitter--dragging' : ''}`}
              onMouseDown={handleSplitterMouseDown}
              onDoubleClick={() => setMediaWidthPercent(38)}
              title="Drag to resize columns (Double-click to reset)"
              role="separator"
              aria-orientation="vertical"
            >
              <div className="lib-page-splitter-handle" />
            </div>
          )}

          {/* ----------------- REGION 2: CENTER WORKBENCH & REGION 3: RAIL ----------------- */}
          {!isTheater && (
            <>
              <div className="lib-page-center-col">
              <div className="lib-center-scroll-pane">
                {/* 1. Title & Meta */}
                <div className="lib-center-hero">
                  {/* Inline Editable Title */}
                  <div className="lib-title-container">
                    {isEditingTitle ? (
                      <div className="lib-title-edit-wrap">
                        <input
                          ref={titleInputRef}
                          type="text"
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onKeyDown={handleTitleKeyDown}
                          onBlur={handleSaveTitle}
                          className="lib-title-inline-input"
                          autoFocus
                        />
                        <div className="lib-title-edit-hint">
                          <span>Press Enter to save, Esc to cancel</span>
                        </div>
                      </div>
                    ) : (
                      <h1
                        className="lib-page-heading"
                        onClick={() => {
                          setIsEditingTitle(true)
                          setTimeout(() => titleInputRef.current?.focus(), 50)
                        }}
                        title="Click or press E to edit title"
                        tabIndex={0}
                        role="button"
                      >
                        {displayTitle}
                        <Icon name="edit" size={14} className="lib-title-edit-pencil" />
                      </h1>
                    )}

                    {/* Original caption secondary subtitle */}
                    {cleanCaption && !isEditingTitle && (
                      <p className="lib-title-secondary-caption" title={cleanCaption}>
                        {cleanCaption}
                      </p>
                    )}
                  </div>

                  {/* Meta Row: Author, Content-type chip, Captured date, Duration, Index indicator */}
                  <div className="lib-center-meta-row">
                    {item.author && (
                      <div className="lib-meta-item">
                        <Icon name="user" size={12} />
                        <span>{item.author}</span>
                      </div>
                    )}

                    <span className="lib-meta-chip capitalize">
                      {item.kind || 'Resource'}
                    </span>

                    {dateRelative && (
                      <div className="lib-meta-item" title={dateAbsolute || dateRelative}>
                        <Icon name="calendar" size={12} />
                        <span>Captured {dateRelative}</span>
                      </div>
                    )}

                    {durationText && (
                      <div className="lib-meta-item">
                        <Icon name="clock" size={12} />
                        <span className="mono">{durationText}</span>
                      </div>
                    )}

                    {/* Indexing indicator: ONLY shown when pending or failed */}
                    {item.status === 'indexing' && (
                      <div className="lib-meta-indexing-tag lib-meta-indexing-tag--pending">
                        <span className="lib-dash-indicator animate-pulse" />
                        <span>Indexing...</span>
                      </div>
                    )}
                    {item.status === 'index_failed' && (
                      <div className="lib-meta-indexing-tag lib-meta-indexing-tag--failed">
                        <Icon name="alert" size={12} />
                        <span>Index failed</span>
                      </div>
                    )}
                  </div>

                  {/* SaveToList Feature 1: Progress Tracking Segmented Control */}
                  <div className="lib-detail-progress-section">
                    <span className="lib-detail-progress-label">Progress</span>
                    <ProgressSegmentedControl
                      progress={item.progress}
                      kind={item.kind}
                      variant="full"
                      onChange={handleProgressChange}
                    />
                  </div>

                  {/* SaveToList Feature 2: Reminder Banner Callout */}
                  <div className="lib-detail-reminder-section">
                    <LibraryReminderBanner
                      item={item}
                      variant="detail"
                      onSaveReminder={handleSaveReminder}
                      onClearReminder={handleClearReminder}
                    />
                  </div>

                  {/* Actions Row using clean secondary AppButton styling */}
                  <div className="lib-page-cta-row">
                    <AppButton
                      variant="secondary"
                      size="medium"
                      className={`lib-page-cta-pill ${item.is_pinned ? 'lib-page-cta-pill--pinned' : ''}`}
                      onClick={handleTogglePin}
                      title={item.is_pinned ? 'Unpin from top' : 'Pin to top'}
                      icon={<Icon name="pin" size={14} className={item.is_pinned ? 'text-amber-500 fill-amber-500' : ''} />}
                    >
                      {item.is_pinned ? 'Pinned' : 'Pin to top'}
                    </AppButton>
                    <AppButton
                      variant="secondary"
                      size="medium"
                      className="lib-page-cta-pill lib-page-cta-pill--secondary"
                      onClick={() => {
                        const colName = window.prompt('Collection name:')
                        if (colName && colName.trim()) {
                          handleAddTag(`collection:${colName.trim()}`)
                        }
                      }}
                      title="Add item to a collection"
                      icon={<Icon name="folder-plus" size={14} />}
                    >
                      Add to collection
                    </AppButton>

                    {item.url && (
                      <AppButton
                        variant="secondary"
                        size="medium"
                        className="lib-page-cta-pill lib-page-cta-pill--secondary"
                        onClick={handleCopyLink}
                        title="Copy link to clipboard"
                        icon={<Icon name={copiedLink ? 'check' : 'copy'} size={14} />}
                      >
                        {copiedLink ? 'Copied' : 'Copy link'}
                      </AppButton>
                    )}

                    {/* "..." Overflow Menu (Re-analyze, Delete, Export) */}
                    <div className="lib-cta-overflow-menu-wrap" ref={actionsMenuRef}>
                      <AppButton
                        variant="secondary"
                        size="medium"
                        className="lib-page-cta-pill lib-page-cta-pill--secondary"
                        onClick={() => setShowActionsMenu((v) => !v)}
                        title="More actions"
                        aria-label="More actions"
                        aria-haspopup="true"
                        aria-expanded={showActionsMenu}
                        icon={<Icon name="dots" size={14} />}
                      />

                      {showActionsMenu && (
                        <div className="lib-overflow-menu" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="lib-overflow-menu-item"
                            onClick={() => {
                              setShowActionsMenu(false)
                              handleEnrich()
                            }}
                          >
                            <Icon name="spark" size={14} />
                            <span>Re-analyze</span>
                          </button>

                          {item.resources?.some((r) => r.type === 'music') && (
                            <button
                              type="button"
                              role="menuitem"
                              className="lib-overflow-menu-item"
                              onClick={() => {
                                setShowActionsMenu(false)
                                handleExportPlaylistTrigger(item.resources.filter((r) => r.type === 'music'))
                              }}
                            >
                              <Icon name="list-plus" size={14} />
                              <span>Export Playlist</span>
                            </button>
                          )}

                          <button
                            type="button"
                            role="menuitem"
                            className="lib-overflow-menu-item lib-overflow-menu-item--danger"
                            onClick={() => {
                              setShowActionsMenu(false)
                              if (window.confirm(`Delete "${item.title}" from library?`)) {
                                onDelete?.(item)
                                onClose?.()
                              }
                            }}
                          >
                            <Icon name="trash" size={14} />
                            <span>Delete item</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* 2. Underline-Style Tabs */}
                <div className="lib-underline-tabs" role="tablist" aria-label="Detail Sections">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'overview'}
                    className={`lib-underline-tab ${activeTab === 'overview' ? 'lib-underline-tab--active' : ''}`}
                    onClick={() => setActiveTab('overview')}
                  >
                    <span>Overview</span>
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'content'}
                    className={`lib-underline-tab ${activeTab === 'content' ? 'lib-underline-tab--active' : ''}`}
                    onClick={() => setActiveTab('content')}
                  >
                    <span>Content & Transcripts</span>
                    {transcript && <span className="lib-tab-count">1</span>}
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'notes'}
                    className={`lib-underline-tab ${activeTab === 'notes' ? 'lib-underline-tab--active' : ''}`}
                    onClick={() => setActiveTab('notes')}
                  >
                    <Icon name="lock" size={12} className="inline mr-1 opacity-70" />
                    <span>Private Notes</span>
                    {notes && <span className="lib-tab-count">1</span>}
                  </button>
                </div>

                {/* 3. Tab Contents */}
                <div className="lib-tab-content-container">
                  {/* TAB 1: OVERVIEW */}
                  {activeTab === 'overview' && (
                    <div className="lib-tab-pane">
                      {/* Summary Card */}
                      <LibrarySummaryCard
                        summaryText={summaryText}
                        isEnriching={isEnriching}
                        enrichError={enrichError}
                        enrichmentModel={item.enrichment_model}
                        enrichedAt={item.enriched_at || item.updated_at}
                        configuredModel={configuredModel}
                        configuredProvider={configuredProvider}
                        availableModels={availableModels}
                        onRegenerate={handleEnrich}
                        onCopySummary={handleCopySummary}
                        copiedSummary={copiedSummary}
                        onOpenModelSettings={() => {
                          window.location.hash = '#/settings'
                        }}
                      />

                      {/* Detected Entities Section */}
                      <LibraryDetectedSection
                        resources={item.resources || []}
                        savedSongs={savedSongs}
                        savingSong={savingSong}
                        onSaveSong={handleSaveSong}
                        onExportPlaylist={handleExportPlaylistTrigger}
                      />
                    </div>
                  )}

                  {/* TAB 2: CONTENT & TRANSCRIPTS */}
                  {activeTab === 'content' && (
                    <div className="lib-tab-pane">
                      {transcript ? (
                        <div className="lib-transcript-container">
                          <div className="lib-transcript-header">
                            <span className="lib-section-label">Transcript</span>
                            {!hasTimestamps && (
                              <span className="lib-transcript-gap-badge" title="Timestamps are a backend gap; currently plain text only">
                                Plain Text
                              </span>
                            )}
                          </div>

                          <div className="lib-transcript-lines">
                            {transcriptLines.map((line, idx) => {
                              const isActive =
                                line.seconds !== null &&
                                Math.abs(currentPlaybackTime - line.seconds) < 3

                              return (
                                <div
                                  key={idx}
                                  className={`lib-transcript-line ${isActive ? 'lib-transcript-line--active' : ''}`}
                                  onClick={() => {
                                    if (line.seconds !== null) {
                                      setSeekTargetTime(line.seconds)
                                    }
                                  }}
                                  role={line.seconds !== null ? 'button' : undefined}
                                  tabIndex={line.seconds !== null ? 0 : undefined}
                                >
                                  {line.timeStr && (
                                    <span className="lib-transcript-timestamp mono">
                                      {line.timeStr}
                                    </span>
                                  )}
                                  <span className="lib-transcript-line-text">{line.text}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="lib-tab-empty-state">
                          <Icon name="file-text" size={24} className="lib-empty-icon" />
                          <p>No transcript available for this item.</p>
                        </div>
                      )}

                      {/* Visual Content (Slides analysis) */}
                      {visualContent && (
                        <div className="lib-visuals-container">
                          <div className="lib-section-label">Visual Breakdown</div>
                          <div className="lib-prose-wrap">
                            <Markdown text={visualContent} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: PRIVATE NOTES */}
                  {activeTab === 'notes' && (
                    <div className="lib-tab-pane">
                      <div className="lib-notes-container">
                        <div className="lib-notes-header">
                          <div className="lib-private-notes-header-left">
                            <Icon name="lock" size={13} className="text-amber-500" />
                            <label htmlFor="lib-notes-editor" className="lib-section-label">
                              Private Notes
                            </label>
                            <span className="lib-private-badge">Only you can see them</span>
                          </div>
                          <div className="lib-notes-status">
                            {savingNotes && (
                              <span className="lib-notes-status-text">
                                <span className="lib-dash-indicator animate-pulse" />
                                <span>Saving...</span>
                              </span>
                            )}
                            {notesSavedIndicator && (
                              <span className="lib-notes-status-text lib-notes-status-text--saved">
                                <Icon name="check" size={12} />
                                <span>Saved</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="lib-private-notes-disclaimer">
                          <Icon name="shield-check" size={13} className="text-emerald-500 flex-shrink-0" />
                          <span>Confidential to this device. Excluded from public summaries and exports.</span>
                        </div>

                        <textarea
                          id="lib-notes-editor"
                          ref={notesTextareaRef}
                          className="lib-notes-editor"
                          placeholder="Write private thoughts, takeaways, quotes, or personal reminders..."
                          rows={10}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          onBlur={handleSaveNotes}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ----------------- REGION 3: RIGHT RAIL (PEER COLUMN) ----------------- */}
            <LibraryRightRail
              item={item}
              tags={tags}
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
              rating={rating}
              onToggleFavorite={handleToggleFavorite}
              notes={notes}
              onOpenNotesTab={() => {
                setActiveTab('notes')
                setTimeout(() => notesTextareaRef.current?.focus(), 50)
              }}
              onNavigateItem={(target) => onNavigate?.(target)}
            />
          </>
        )}
      </div>
      </div>

      {/* Lightbox Modal */}
      <AnimatePresence>
        {showLightbox && (
          <div className="lib-lightbox-overlay" onClick={() => setShowLightbox(false)}>
            <div className="lib-lightbox-content" onClick={(e) => e.stopPropagation()}>
              <img
                src={slideItems[currentSlideIndex]?.url || api.thumbnailUrl(item.id)}
                alt={item.title}
                className="lib-lightbox-image"
              />
              <button
                type="button"
                className="lib-lightbox-close"
                onClick={() => setShowLightbox(false)}
                aria-label="Close Lightbox"
              >
                <Icon name="x" size={18} />
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Keyboard Shortcuts Dialog */}
      {showShortcutsModal && (
        <LibraryShortcutsModal onClose={() => setShowShortcutsModal(false)} />
      )}

      {/* Export Playlist Dialog */}
      <ExportPlaylistModal
        open={showExportModal}
        items={exportModalTracks}
        onClose={() => setShowExportModal(false)}
        toast={toast}
      />
    </div>
  )
}
