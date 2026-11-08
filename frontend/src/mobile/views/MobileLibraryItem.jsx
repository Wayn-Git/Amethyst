import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, appendAuthToken, getBase, copyText } from '../../api.js'
import { safeStorage } from '../../lib/storage.js'
import { storedIdentity } from '../../lib/credentials.js'
import { getTransportManager } from '../../lib/sync/transportManager.js'
import Icon from '../../components/Icon.jsx'

function getResolvedBase() {
  const tm = getTransportManager?.()
  const tmHost = tm?.getState?.()?.hostUrl
  if (tmHost && !tmHost.includes('localhost') && !tmHost.includes('127.0.0.1')) {
    return tmHost.replace(/\/+$/, '')
  }
  const id = storedIdentity()
  if (id?.hostUrl && !id.hostUrl.includes('localhost') && !id.hostUrl.includes('127.0.0.1')) {
    return id.hostUrl.replace(/\/+$/, '')
  }
  const base = getBase().replace(/\/api$/, '')
  if (base && !base.includes('localhost') && !base.includes('127.0.0.1')) return base
  try {
    const pcHost = safeStorage.getItem('amethyst.pc_host')
    if (pcHost && !pcHost.includes('localhost')) {
      return pcHost.replace(/\/+$/, '')
    }
  } catch {}
  return base || ''
}

function getItemDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function getAppFromItem(item) {
  if (item?.app) return item.app
  const url = (item?.url || '').toLowerCase()
  if (url.includes('pinterest.') || url.includes('pin.it')) return 'pinterest'
  if (url.includes('youtube.') || url.includes('youtu.be')) return 'youtube'
  if (url.includes('instagram.') || url.includes('instagr.am')) return 'instagram'
  if (url.includes('threads.net') || url.includes('threads.com')) return 'threads'
  if (url.includes('tiktok.')) return 'tiktok'
  if (url.includes('x.com') || url.includes('twitter.')) return 'x'
  if (url.includes('github.')) return 'github'
  if (url.includes('reddit.')) return 'reddit'
  if (url.includes('spotify.')) return 'spotify'
  return null
}

/**
 * Lightweight, zero-dependency Markdown renderer for mobile.
 * Guarantees high-contrast readable text (#1D1D1F / #111113) without circular module dependencies.
 */
function MobileMarkdown({ text }) {
  if (!text) return null

  const lines = String(text).split('\n')
  const elements = []

  let inList = false
  let listItems = []

  const flushList = (key) => {
    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`ul-${key}`} style={{ margin: '8px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {listItems.map((it, idx) => (
            <li key={idx} style={{ fontSize: 14.5, lineHeight: 1.6, color: '#1D1D1F' }}>
              {renderInline(it)}
            </li>
          ))}
        </ul>
      )
      listItems = []
      inList = false
    }
  }

  const renderInline = (str) => {
    if (!str) return null
    // Simple inline parser for bold **text**, italic *text*, code `code`, and links [text](url)
    const tokens = []
    let remaining = str
    let keyIdx = 0

    while (remaining.length > 0) {
      // Bold
      const boldMatch = remaining.match(/^(\*\*|__)(.*?)\1/)
      if (boldMatch) {
        tokens.push(
          <strong key={keyIdx++} style={{ fontWeight: 650, color: '#111113' }}>
            {boldMatch[2]}
          </strong>
        )
        remaining = remaining.slice(boldMatch[0].length)
        continue
      }

      // Inline code
      const codeMatch = remaining.match(/^`([^`]+)`/)
      if (codeMatch) {
        tokens.push(
          <code
            key={keyIdx++}
            style={{
              background: '#F2F2F7',
              color: '#0071E3',
              padding: '2px 6px',
              borderRadius: 6,
              fontSize: '0.9em',
              fontFamily: 'monospace',
            }}
          >
            {codeMatch[1]}
          </code>
        )
        remaining = remaining.slice(codeMatch[0].length)
        continue
      }

      // Link
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        tokens.push(
          <a
            key={keyIdx++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0071E3', textDecoration: 'none', fontWeight: 500 }}
          >
            {linkMatch[1]}
          </a>
        )
        remaining = remaining.slice(linkMatch[0].length)
        continue
      }

      // Plain text up to next special char
      const nextSpecial = remaining.search(/(\*\*|__|`|\[)/)
      if (nextSpecial === -1) {
        tokens.push(remaining)
        break
      } else if (nextSpecial === 0) {
        tokens.push(remaining[0])
        remaining = remaining.slice(1)
      } else {
        tokens.push(remaining.slice(0, nextSpecial))
        remaining = remaining.slice(nextSpecial)
      }
    }

    return tokens
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim()

    // Bullet list item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
      inList = true
      listItems.push(trimmed.slice(2).trim())
      return
    }

    flushList(idx)

    if (!trimmed) {
      return
    }

    // Heading
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4 key={idx} style={{ fontSize: 16, fontWeight: 700, margin: '14px 0 6px', color: '#111113' }}>
          {renderInline(trimmed.slice(4))}
        </h4>
      )
      return
    }
    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      elements.push(
        <h3 key={idx} style={{ fontSize: 18, fontWeight: 700, margin: '16px 0 8px', color: '#111113' }}>
          {renderInline(trimmed.replace(/^#+\s*/, ''))}
        </h3>
      )
      return
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      elements.push(
        <blockquote
          key={idx}
          style={{
            margin: '8px 0',
            padding: '8px 14px',
            borderLeft: '3px solid #0071E3',
            background: 'rgba(0, 113, 227, 0.04)',
            borderRadius: '0 10px 10px 0',
            fontSize: 14,
            color: '#1D1D1F',
            fontStyle: 'italic',
          }}
        >
          {renderInline(trimmed.slice(2))}
        </blockquote>
      )
      return
    }

    // Paragraph
    elements.push(
      <p key={idx} style={{ margin: '6px 0', fontSize: 14.5, lineHeight: 1.6, color: '#1D1D1F' }}>
        {renderInline(trimmed)}
      </p>
    )
  })

  flushList(lines.length)
  return <div>{elements}</div>
}

/**
 * Extracts clean structured TL;DR and labeled highlights from raw AI summary.
 */
function parseSummaryStructure(rawSummary) {
  if (!rawSummary) return { tldr: '', points: [] }

  let clean = String(rawSummary).trim()
  // Strip metadata lines like **Source:** ... **Processed:** ...
  clean = clean.replace(/\*\*Source:\*\*[^\n]+\*\*Processed:\*\*[^\n]+/gi, '').trim()

  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean)
  let tldr = ''
  const points = []

  for (const line of lines) {
    if (line.startsWith('#')) continue

    // Matches labeled lines like "**Setup:** The video explains..." or "- **Key point:** ..."
    const match = line.match(/^[-*•]?\s*\*\*([^*:]+:?)\*\*\s*(.*)$/) ||
                  line.match(/^[-*•]?\s*([A-Za-z0-9\s_-]+:)\s+(.*)$/)

    if (match) {
      let label = match[1].trim()
      if (!label.endsWith(':')) label += ':'
      const content = match[2].replace(/\*\*/g, '').trim()
      if (content || label) {
        points.push({ label, text: content })
      }
    } else if (!tldr) {
      const lineText = line.replace(/^[#*-\s]+/, '').replace(/\*\*/g, '').trim()
      if (lineText) {
        tldr = lineText
      }
    } else {
      const lineText = line.replace(/^[#*-\s]+/, '').replace(/\*\*/g, '').trim()
      if (lineText) {
        points.push({ label: null, text: lineText })
      }
    }
  }

  if (!tldr && points.length > 0) {
    const first = points.shift()
    tldr = first.label ? `${first.label} ${first.text}` : first.text
  }

  return { tldr, points }
}

export default function MobileLibraryItem({ item, onBack, onAskAgent, onDeleteItem }) {
  const [detailItem, setDetailItem] = useState(item)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [tab, setTab] = useState('overview') // 'overview' | 'links' | 'notes'
  const [isPlaying, setIsPlaying] = useState(false)
  const [blobVideoUrl, setBlobVideoUrl] = useState('')
  const [useEmbedFallback, setUseEmbedFallback] = useState(false)
  const [isFavorited, setIsFavorited] = useState(Boolean(item?.favorited || item?.starred || item?.is_pinned))
  const [enriching, setEnriching] = useState(false)
  const [thumbFailed, setThumbFailed] = useState(false)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [toastNotice, setToastNotice] = useState('')
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)

  const [tags, setTags] = useState(() => {
    if (Array.isArray(item?.tags) && item.tags.length > 0) return item.tags
    if (typeof item?.tags === 'string') {
      try {
        const parsed = JSON.parse(item.tags)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      } catch {}
    }
    return ['ai', 'tools', 'references']
  })
  const [privateNote, setPrivateNote] = useState(item?.private_notes || '')
  const [savingNote, setSavingNote] = useState(false)
  const [polishingNote, setPolishingNote] = useState(false)

  const showToast = (msg) => {
    setToastNotice(msg)
    setTimeout(() => setToastNotice(''), 3000)
  }

  useEffect(() => {
    let unmounted = false
    async function fetchDetail() {
      if (!item?.id && !item?.uuid) return
      setLoadingDetail(true)
      try {
        const full = await api.libraryItem(item.id || item.uuid)
        if (!unmounted && full) {
          setDetailItem(full)
          if (Array.isArray(full.tags)) setTags(full.tags)
          if (full.private_notes) setPrivateNote(full.private_notes)
          if (full.is_pinned !== undefined || full.favorited !== undefined) {
            setIsFavorited(Boolean(full.is_pinned || full.favorited))
          }
        }
      } catch (err) {
        console.warn('[MobileLibraryItem] Fetch failed:', err.message)
      } finally {
        if (!unmounted) setLoadingDetail(false)
      }
    }
    fetchDetail()
    return () => {
      unmounted = true
    }
  }, [item?.id, item?.uuid])

  const activeItem = detailItem || item
  const title = activeItem?.title || 'Untitled Item'
  const app = getAppFromItem(activeItem)
  const authorName = activeItem?.author || activeItem?.channel || getItemDomain(activeItem?.url) || 'Amethyst'
  const kind = activeItem?.kind ? activeItem.kind.charAt(0).toUpperCase() + activeItem.kind.slice(1) : 'Resource'
  const duration = activeItem?.duration || activeItem?.reading_time || (activeItem?.duration_seconds ? `${Math.round(activeItem.duration_seconds)}s` : '')

  // Auto-poll when item is actively enriching or processing in the background
  useEffect(() => {
    const isPending = activeItem?.status === 'enriching' || activeItem?.status === 'processing' || enriching
    if (!isPending || !activeItem?.id) return

    let cancelled = false
    const interval = setInterval(async () => {
      try {
        const updated = await api.libraryItem(activeItem.id)
        if (!cancelled && updated) {
          if (updated.status !== activeItem.status || updated.summary !== activeItem.summary) {
            setDetailItem(updated)
          }
        }
      } catch {}
    }, 2500)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeItem?.id, activeItem?.status, enriching])

  const parsedResources = useMemo(() => {
    let res = activeItem?.resources
    if (typeof res === 'string') {
      try { res = JSON.parse(res) } catch { res = [] }
    }
    return Array.isArray(res) ? res : []
  }, [activeItem?.resources])

  // Extract author avatar
  const authorAvatar = useMemo(() => {
    const avatarRes = parsedResources.find((r) => r && r.type === 'avatar')
    if (avatarRes?.url) return avatarRes.url
    if (app === 'x' && activeItem?.author) {
      const handle = activeItem.author.replace(/.*@([A-Za-z0-9_]+).*/, '$1')
      if (handle && handle !== activeItem.author) return `https://unavatar.io/x/${handle}`
    }
    if (app === 'github' && activeItem?.author) {
      return `https://github.com/${activeItem.author.replace(/^@/, '')}.png?size=64`
    }
    return null
  }, [parsedResources, app, activeItem?.author])

  // Multi-image slides / photos
  const slides = useMemo(() => {
    const hostBase = getResolvedBase()
    return parsedResources
      .filter((r) => r && typeof r === 'object' && (r.type === 'slide' || r.type === 'image'))
      .map((s, idx) => {
        const slideIdx = s.index !== undefined ? s.index : idx
        let sUrl = s.remote_url || s.url
        if (!sUrl || (!sUrl.startsWith('http') && !sUrl.startsWith('/api/'))) {
          sUrl = hostBase ? appendAuthToken(`${hostBase}/api/library/${activeItem?.id}/slides/${slideIdx}`) : (api.slideUrl ? api.slideUrl(activeItem?.id, slideIdx) : '')
        } else if (sUrl.startsWith('/api/')) {
          sUrl = hostBase ? appendAuthToken(`${hostBase}${sUrl}`) : (s.remote_url || sUrl)
        }
        return {
          url: sUrl,
          remoteUrl: s.remote_url || (s.url && s.url.startsWith('http') ? s.url : null),
          index: slideIdx,
        }
      })
  }, [activeItem?.id, parsedResources])

  // Accurate video and embed detection
  const videoInfo = useMemo(() => {
    const it = activeItem
    if (!it) return null

    // 1. Direct playable MP4 video stream in resources or activeItem
    const directRes = parsedResources.find(
      (r) => r && (r.type === 'video' || r.type === 'mp4' || (typeof r.url === 'string' && /\.(mp4|webm|mov)(\?|$)/i.test(r.url)))
    )
    const directVideoUrl = directRes?.remote_url || directRes?.url || it.direct_video_url
    if (directVideoUrl && typeof directVideoUrl === 'string' && !directVideoUrl.includes('twimg.com')) {
      const hostBase = getResolvedBase() || ''
      let vUrl = directVideoUrl
      if (vUrl.startsWith('/api/')) {
        vUrl = hostBase ? appendAuthToken(`${hostBase}${vUrl}`) : vUrl
      }
      return {
        type: 'direct',
        url: vUrl,
        embedUrl: directRes?.embed_url || null,
        isVertical: Boolean(it.is_reel || it.url?.includes('/reel/') || it.url?.includes('/shorts/')),
      }
    }

    // 2. YouTube embed detection
    if (it.url && /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/)|youtu\.be\/)/i.test(it.url)) {
      const match = it.url.match(/(?:watch\?v=|shorts\/|embed\/|live\/|youtu\.be\/)([\w-]{11})/)
      if (match) {
        return {
          type: 'youtube',
          url: it.url,
          embedUrl: `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0`,
          isVertical: Boolean(it.url.includes('/shorts/')),
        }
      }
    }

    // 3. TikTok embed
    if (it.url && /tiktok\.com\/.*\/video\/(\d+)/i.test(it.url)) {
      const match = it.url.match(/tiktok\.com\/.*\/video\/(\d+)/i)
      if (match) {
        return {
          type: 'tiktok',
          url: it.url,
          embedUrl: `https://www.tiktok.com/embed/v2/${match[1]}`,
          isVertical: true,
        }
      }
    }

    // 4. Direct local media stream from server
    const hasLocalMedia = Boolean(it.media_path && /\.(mp4|webm|mov)(\?|$)/i.test(it.media_path))
    if (hasLocalMedia && it.id) {
      const hostBase = getResolvedBase() || ''
      return {
        type: 'direct',
        url: appendAuthToken(`${hostBase}/api/library/${it.id}/media`),
        isVertical: Boolean(it.is_reel || it.url?.includes('/reel/') || it.url?.includes('/shorts/')),
      }
    }

    // 5. Instagram Reel embed fallback
    if (it.url && /instagram\.com\/(?:reel|p)\/([\w-]+)/i.test(it.url)) {
      const match = it.url.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/i)
      if (match) {
        return {
          type: 'instagram',
          url: it.url,
          embedUrl: `https://www.instagram.com/reel/${match[1]}/embed/`,
          isVertical: true,
        }
      }
    }

    // 6. Generic direct video URL
    if (it.kind === 'video' && it.url && /\.(mp4|webm|mov)(\?|$)/i.test(it.url) && !it.url.includes('twimg.com')) {
      return {
        type: 'direct',
        url: it.url,
        isVertical: Boolean(it.is_reel || it.url?.includes('/reel/') || it.url?.includes('/shorts/')),
      }
    }

    return null
  }, [activeItem, parsedResources])

  const isVertical = useMemo(() => {
    if (activeItem?.is_reel || videoInfo?.isVertical) return true
    const u = (activeItem?.url || '').toLowerCase()
    return u.includes('/reel/') || u.includes('/reels/') || u.includes('/shorts/') || u.includes('tiktok.com')
  }, [activeItem, videoInfo])

  // Resolve thumbnail: Prioritize embedded data URI, external URL, or YouTube
  const thumbnailUrl = useMemo(() => {
    const it = activeItem
    if (!it) return ''

    // 1. Base64 Data URL (instant, offline, zero-network)
    if (it.thumbnail_url && it.thumbnail_url.startsWith('data:')) {
      return it.thumbnail_url
    }

    // 2. Direct external HTTP thumbnail
    if (it.thumbnail_url && it.thumbnail_url.startsWith('http')) {
      return it.thumbnail_url
    }

    // 3. YouTube direct thumbnail
    if (it.url) {
      const ytMatch = it.url.match(/(?:watch\?v=|shorts\/|embed\/|live\/|youtu\.be\/)([\w-]{11})/)
      if (ytMatch) {
        return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`
      }
    }

    // 4. Remote slide or image in resources
    if (Array.isArray(parsedResources)) {
      for (const r of parsedResources) {
        if (r && typeof r === 'object') {
          const u = r.remote_url || r.url
          if (u && typeof u === 'string' && u.startsWith('http') && !u.includes('.mp4') && (r.type === 'slide' || r.type === 'image' || r.type === 'avatar')) {
            return u
          }
        }
      }
    }

    // 5. Amethyst local LAN thumbnail endpoint
    const hostBase = getResolvedBase() || ''
    if (it.thumbnail_path || it.has_thumbnail || it.id) {
      if (it.thumbnail_url?.startsWith('/api')) {
        return appendAuthToken(`${hostBase}${it.thumbnail_url}`)
      }
      return appendAuthToken(`${hostBase}/api/library/${it.id}/thumbnail`)
    }
    return ''
  }, [activeItem, parsedResources])

  // Media determination: Only display hero media container if item is actually a video or has images/slides!
  const hasPlayableVideo = Boolean(videoInfo)
  const hasSlides = slides.length > 0
  const isVideoKind = activeItem?.kind === 'video' ||
                      activeItem?.kind === 'reel' ||
                      Boolean(activeItem?.is_reel) ||
                      Boolean(activeItem?.url && /(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com\/(?:reel|p)\/|vimeo\.com)/i.test(activeItem.url))
  const showHeroMedia = hasPlayableVideo || hasSlides || isVideoKind || Boolean(thumbnailUrl)

  // Text content of post / note / article
  const postBody = useMemo(() => {
    if (activeItem?.caption && activeItem.caption.trim()) return activeItem.caption.trim()
    if (activeItem?.notes && !activeItem.notes.startsWith('http') && activeItem.notes.trim()) {
      return activeItem.notes.trim()
    }
    if (activeItem?.content && activeItem.content.trim()) return activeItem.content.trim()
    if (activeItem?.excerpt && activeItem.excerpt.trim()) return activeItem.excerpt.trim()
    return ''
  }, [activeItem])

  // Clean structured AI summary
  const summaryStructure = useMemo(() => {
    return parseSummaryStructure(activeItem?.summary)
  }, [activeItem?.summary])

  // Extracted outbound resources & links (with clean domains, tracking queries stripped, media excluded)
  const links = useMemo(() => {
    const rawList = Array.isArray(parsedResources) && parsedResources.length > 0
      ? parsedResources
      : Array.isArray(activeItem?.metadata?.links) && activeItem.metadata.links.length > 0
        ? activeItem.metadata.links
        : activeItem?.url
          ? [{ title: activeItem.title || 'Original Source', url: activeItem.url, type: 'source' }]
          : []

    const seen = new Set()
    const cleanList = []

    for (const r of rawList) {
      if (!r) continue
      // Exclude video files, mp4 streams, and avatar images
      if (r.type === 'video' || r.type === 'mp4' || r.type === 'avatar') continue
      const rawUrl = r.resolved_url || r.url || r.link || ''
      if (!rawUrl || !rawUrl.startsWith('http')) continue
      if (/\.(mp4|mov|webm)(\?|$)/i.test(rawUrl)) continue

      // Strip common tracking queries
      const cleanUrl = rawUrl.replace(/([?&])(utm_[^&]+|fbclid=[^&]+|igsh=[^&]+|srtk=[^&]+)/gi, '').replace(/\?$/, '')
      if (seen.has(cleanUrl)) continue
      seen.add(cleanUrl)

      const rawDomain = getItemDomain(cleanUrl) || 'web'
      const isTool = r.type === 'tool' || cleanUrl.includes('github.com')
      cleanList.push({
        title: r.name || r.title || r.detail || rawDomain,
        detail: r.detail && r.detail !== r.name ? r.detail : '',
        url: cleanUrl,
        domain: rawDomain,
        type: r.type || (isTool ? 'tool' : 'link'),
      })
    }
    return cleanList
  }, [parsedResources, activeItem])

  const handleEnrich = async () => {
    if (!activeItem?.id && !activeItem?.uuid) return
    setEnriching(true)
    showToast('Enriching with AI…')
    try {
      await api.enrichLibraryItem(activeItem.id || activeItem.uuid)
      const updated = await api.libraryItem(activeItem.id || activeItem.uuid)
      if (updated) {
        setDetailItem(updated)
        showToast('Enrichment complete!')
      }
    } catch (err) {
      showToast(`Enrich error: ${err.message}`)
    } finally {
      setEnriching(false)
    }
  }

  const handlePlayToggle = () => {
    if (videoInfo) {
      setIsPlaying((prev) => !prev)
    } else if (activeItem?.url) {
      window.open(activeItem.url, '_blank')
    }
  }

  const handleSavePrivateNote = async () => {
    if (!activeItem?.id) return
    setSavingNote(true)
    try {
      await api.updateLibraryItem(activeItem.id, { private_notes: privateNote })
      showToast('Note saved!')
    } catch (err) {
      showToast(`Save failed: ${err.message}`)
    } finally {
      setSavingNote(false)
    }
  }

  const handlePolishNote = async (actionType) => {
    const rawNote = postBody || activeItem?.notes || activeItem?.content || activeItem?.title || ''
    if (!rawNote.trim()) {
      showToast('No note text to process')
      return
    }

    setPolishingNote(true)
    showToast(
      actionType === 'fix_grammar'
        ? 'Fixing grammar…'
        : actionType === 'research'
        ? 'Researching links…'
        : 'Wording note better…'
    )

    try {
      let transformed = ''
      if (actionType === 'fix_grammar') {
        const res = await api.aiTransform(rawNote, 'fix_grammar')
        transformed = res.result || res.transformed || rawNote
      } else if (actionType === 'improve') {
        const res = await api.aiTransform(rawNote, 'improve')
        transformed = res.result || res.transformed || rawNote
      } else if (actionType === 'research') {
        const res = await api.aiTransform(
          rawNote,
          'expand',
          'Search for and append 2 to 4 authoritative reference markdown links relevant to the topics discussed in this note, formatted as: \n\n### Referenced Links\n- [Name](url): description'
        )
        transformed = res.result || res.transformed || rawNote
      }

      if (transformed && transformed !== rawNote) {
        if (activeItem?.id) {
          await api.updateLibraryItem(activeItem.id, { notes: transformed })
          const updated = await api.libraryItem(activeItem.id)
          if (updated) {
            setDetailItem(updated)
          } else {
            setDetailItem((prev) => ({ ...prev, notes: transformed, caption: transformed }))
          }
        } else {
          setDetailItem((prev) => ({ ...prev, notes: transformed, caption: transformed }))
        }
        showToast('Note updated!')
      } else {
        showToast('No changes needed')
      }
    } catch (err) {
      showToast(`Error: ${err.message}`)
    } finally {
      setPolishingNote(false)
    }
  }

  const handleCopyLink = async () => {
    if (!activeItem?.url) return
    try {
      await copyText(activeItem.url)
      showToast('Link copied to clipboard!')
    } catch {
      showToast('Could not copy link')
    }
    setActionSheetOpen(false)
  }

  const handleCopySummary = async () => {
    const textToCopy = summaryStructure.tldr
      ? `${summaryStructure.tldr}\n\n${summaryStructure.points.map((p) => (p.label ? `${p.label} ${p.text}` : p.text)).join('\n')}`
      : activeItem?.summary || ''
    if (!textToCopy) return
    try {
      await copyText(textToCopy)
      showToast('Summary copied!')
    } catch {
      showToast('Could not copy summary')
    }
    setActionSheetOpen(false)
  }

  const handleShare = async () => {
    setActionSheetOpen(false)
    if (navigator.share && activeItem?.url) {
      try {
        await navigator.share({
          title,
          url: activeItem.url,
          text: summaryStructure.tldr || postBody || title,
        })
      } catch {}
    } else {
      handleCopyLink()
    }
  }

  const handleToggleFavorite = async () => {
    const next = !isFavorited
    setIsFavorited(next)
    if (activeItem?.id) {
      try {
        await api.updateLibraryItem(activeItem.id, { is_pinned: next ? 1 : 0 })
        showToast(next ? 'Saved to Favorites' : 'Removed from Favorites')
      } catch {}
    }
  }

  const handleDeleteItem = async () => {
    if (!activeItem?.id) return
    try {
      await api.deleteLibraryItem(activeItem.id)
      setConfirmDeleteOpen(false)
      setActionSheetOpen(false)
      if (onDeleteItem) onDeleteItem(activeItem.id)
      else onBack()
    } catch (err) {
      showToast(`Delete failed: ${err.message}`)
    }
  }

  const activeMediaUrl = slides.length > 0 && currentSlideIndex > 0
    ? (slides[currentSlideIndex].remoteUrl || slides[currentSlideIndex].url)
    : (thumbnailUrl || (slides.length > 0 ? (slides[0].remoteUrl || slides[0].url) : ''))

  return (
    <motion.div
      className="b m-item-view"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        padding: '12px 16px max(140px, calc(env(safe-area-inset-bottom, 24px) + 120px))',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <style>{`
        @keyframes mobileShimmerPulse {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes mobilePulse {
          0%, 100% { transform: scale(0.9); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        .m-shimmer-bar {
          background: linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0.04) 75%);
          background-size: 200% 100%;
          animation: mobileShimmerPulse 1.6s infinite linear;
        }
      `}</style>

      {/* Toast Notification */}
      <AnimatePresence>
        {toastNotice && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            style={{
              position: 'fixed',
              top: 16,
              left: 20,
              right: 20,
              zIndex: 300,
              background: '#111113',
              color: '#FFFFFF',
              borderRadius: 999,
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
              boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
            }}
          >
            {toastNotice}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Header Bar: Pixel-perfect aligned navigation bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 40,
          width: '100%',
          boxSizing: 'border-box',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          style={{
            height: 36,
            padding: '0 14px',
            fontSize: 13,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            border: 'none',
            cursor: 'pointer',
            borderRadius: 999,
            background: 'var(--m-card, #FFFFFF)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            color: 'var(--m-text, #1D1D1F)',
            boxSizing: 'border-box',
            lineHeight: 1,
          }}
          onClick={onBack}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          <span>Library</span>
        </button>

        <div
          style={{
            height: 36,
            padding: '0 16px',
            fontSize: 13,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 999,
            background: 'var(--m-card, #FFFFFF)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            color: 'var(--m-text, #1D1D1F)',
            boxSizing: 'border-box',
            lineHeight: 1,
          }}
        >
          Saved
        </div>

        <button
          type="button"
          aria-label="More options"
          style={{
            width: 36,
            height: 36,
            padding: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            cursor: 'pointer',
            borderRadius: 999,
            background: 'var(--m-card, #FFFFFF)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            color: 'var(--m-text, #1D1D1F)',
            boxSizing: 'border-box',
            lineHeight: 1,
          }}
          onClick={() => setActionSheetOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="19" cy="12" r="1.5" />
            <circle cx="5" cy="12" r="1.5" />
          </svg>
        </button>
      </div>

      {/* Hero Media Player: ONLY rendered when item actually has video or photo slides, and ONLY in Overview/Links tabs! */}
      {showHeroMedia && tab !== 'notes' && (
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: isVertical ? '9 / 16' : '16 / 9',
            maxHeight: isVertical ? '420px' : '220px',
            maxWidth: isVertical ? '300px' : undefined,
            margin: isVertical ? '0 auto' : '0',
            borderRadius: 22,
            background: 'linear-gradient(135deg, #1C1C1E 0%, #101012 100%)',
            overflow: 'hidden',
            color: '#fff',
            boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isPlaying && videoInfo ? (
            videoInfo.type === 'direct' && !useEmbedFallback ? (
              <video
                src={blobVideoUrl || videoInfo.url}
                controls
                playsInline
                autoPlay
                poster={activeMediaUrl}
                style={{ width: '100%', height: '100%', objectFit: isVertical ? 'cover' : 'contain', background: '#000', zIndex: 5 }}
                onError={() => {
                  if (videoInfo.embedUrl) setUseEmbedFallback(true)
                }}
              />
            ) : (
              <iframe
                src={videoInfo.embedUrl || videoInfo.url}
                title={title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 0, zIndex: 5 }}
              />
            )
          ) : (
            <>
              {activeMediaUrl && !thumbFailed ? (
                <img
                  src={activeMediaUrl}
                  alt={title}
                  loading="lazy"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }}
                  onError={() => setThumbFailed(true)}
                />
              ) : (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'linear-gradient(135deg, #1C1C1E 0%, #101012 100%)',
                    color: 'rgba(255,255,255,0.7)',
                    gap: 8,
                    zIndex: 1,
                  }}
                >
                  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.6)' }}>{authorName || 'Video'}</span>
                </div>
              )}

              {/* Play Button Disc */}
              {hasPlayableVideo && (
                <motion.button
                  type="button"
                  aria-label="Play video"
                  whileTap={{ scale: 0.92 }}
                  style={{
                    position: 'absolute',
                    width: 58,
                    height: 58,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.65)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    border: '1.5px solid rgba(255,255,255,0.35)',
                    color: '#fff',
                    zIndex: 4,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
                  }}
                  onClick={handlePlayToggle}
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 3 }}>
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                </motion.button>
              )}

              {/* Slide Navigation if multi-image carousel */}
              {slides.length > 1 && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 12,
                    left: 14,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    zIndex: 3,
                    background: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: 999,
                    padding: '4px 10px',
                    fontSize: 11.5,
                    fontWeight: 600,
                  }}
                >
                  <button
                    type="button"
                    style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0 }}
                    onClick={() => setCurrentSlideIndex((p) => (p > 0 ? p - 1 : slides.length - 1))}
                  >
                    ◀
                  </button>
                  <span>{currentSlideIndex + 1} / {slides.length}</span>
                  <button
                    type="button"
                    style={{ background: 'none', border: 0, color: '#fff', cursor: 'pointer', padding: 0 }}
                    onClick={() => setCurrentSlideIndex((p) => (p < slides.length - 1 ? p + 1 : 0))}
                  >
                    ▶
                  </button>
                </div>
              )}

              {/* Bottom info badge */}
              <div
                style={{
                  position: 'absolute',
                  right: 10,
                  bottom: 10,
                  borderRadius: 999,
                  padding: '5px 12px',
                  background: 'rgba(0,0,0,0.6)',
                  backdropFilter: 'blur(10px)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  zIndex: 3,
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                <span>{hasPlayableVideo ? 'Tap to play' : duration || kind}</span>
                {activeItem?.url && (
                  <span
                    style={{ color: '#0071E3', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => window.open(activeItem.url, '_blank')}
                  >
                    Source ↗
                  </span>
                )}
              </div>
            </>
          )}

          {isPlaying && (
            <button
              type="button"
              style={{
                position: 'absolute',
                right: 12,
                top: 12,
                padding: '6px 12px',
                fontSize: 11.5,
                fontWeight: 600,
                zIndex: 10,
                border: 0,
                borderRadius: 999,
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => {
                setIsPlaying(false)
                setUseEmbedFallback(false)
              }}
            >
              ✕ Close
            </button>
          )}
        </div>
      )}

      {/* Title & Metadata Header */}
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.25, color: '#111113', margin: 0 }}>
          {title}
        </h1>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 13, color: '#8E8E93' }}>
          <span style={{ fontWeight: 600, color: '#1D1D1F' }}>{authorName}</span>
          <span>·</span>
          <span>{kind}</span>
          {duration ? <span>· {duration}</span> : null}
        </div>
      </div>

      {/* Segmented Tabs: Overview, Links, Notes */}
      <div className="tabs">
        <span
          className={tab === 'overview' ? 'on' : ''}
          onClick={() => setTab('overview')}
        >
          Overview
        </span>
        <span
          className={tab === 'links' ? 'on' : ''}
          onClick={() => setTab('links')}
        >
          Links <span className="cnt">{links.length}</span>
        </span>
        <span
          className={tab === 'notes' ? 'on' : ''}
          onClick={() => setTab('notes')}
        >
          Notes <span className="cnt">{privateNote ? 1 : 0}</span>
        </span>
      </div>

      {/* Tab 1: Overview */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Top Processing / Polishing Banner */}
          {(activeItem?.status === 'processing' || enriching || polishingNote) && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 14,
                background: 'rgba(0, 113, 227, 0.08)',
                color: '#0071E3',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <span className="spn" style={{ width: 12, height: 12 }} />
              <span>{polishingNote ? 'AI is polishing note…' : 'AI is processing & enriching this item…'}</span>
            </div>
          )}

          {/* Post Card: For social media posts, threads, tweets, and notes */}
          {(Boolean(postBody) || !showHeroMedia) && (
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: 20,
                padding: '16px 18px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    background: '#1C1C1E',
                    color: '#FFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 14,
                    overflow: 'hidden',
                    flexShrink: 0,
                  }}
                >
                  {authorAvatar ? (
                    <img
                      src={authorAvatar}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    (authorName || 'A').charAt(0).toUpperCase()
                  )}
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.2, color: '#1D1D1F' }}>
                    {authorName}
                  </div>
                  <div style={{ fontSize: 12, color: '#8E8E93', marginTop: 2 }}>
                    {app ? app.toUpperCase() : getItemDomain(activeItem?.url) || 'Post'}
                    {activeItem?.consumed_on ? ` · ${activeItem.consumed_on}` : ''}
                  </div>
                </div>

                {activeItem?.url && (
                  <a
                    href={activeItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ch"
                    style={{
                      fontSize: 11.5,
                      padding: '4px 10px',
                      textDecoration: 'none',
                      background: '#F2F2F7',
                      color: '#0071E3',
                      fontWeight: 600,
                      borderRadius: 999,
                    }}
                  >
                    Open ↗
                  </a>
                )}
              </div>

              {postBody && (
                <div style={{ fontSize: 15, lineHeight: 1.6, color: '#1D1D1F' }}>
                  <MobileMarkdown text={postBody} />
                </div>
              )}
            </div>
          )}

          {/* If Note: AI Note Assistant (Fix Grammar, Word Better, Research). If Article/Video: Structured AI Summary Card */}
          {activeItem?.kind === 'note' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#111113' }}>
                  AI Note Assistant
                </span>
                {polishingNote && (
                  <span style={{ fontSize: 12, color: '#0071E3', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <span className="spn" style={{ width: 10, height: 10 }} />
                    Working…
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <button
                  type="button"
                  style={{
                    height: 42,
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    border: '1px solid rgba(0,0,0,0.06)',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    color: '#0071E3',
                    boxSizing: 'border-box',
                  }}
                  disabled={polishingNote}
                  onClick={() => handlePolishNote('fix_grammar')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                    <path d="M5 3v4" />
                    <path d="M19 17v4" />
                  </svg>
                  <span>Fix Grammar</span>
                </button>

                <button
                  type="button"
                  style={{
                    height: 42,
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    border: '1px solid rgba(0,0,0,0.06)',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    color: '#111113',
                    boxSizing: 'border-box',
                  }}
                  disabled={polishingNote}
                  onClick={() => handlePolishNote('improve')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
                    <path d="m15 5 4 4" />
                  </svg>
                  <span>Word Better</span>
                </button>

                <button
                  type="button"
                  style={{
                    height: 42,
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    border: '1px solid rgba(0,0,0,0.06)',
                    background: '#FFFFFF',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    color: '#111113',
                    boxSizing: 'border-box',
                  }}
                  disabled={polishingNote}
                  onClick={() => handlePolishNote('research')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <span>Research</span>
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#111113' }}>
                  Summary
                </span>
                <button
                  type="button"
                  className="ch glass"
                  style={{ fontSize: 11.5, padding: '5px 12px', border: 0, cursor: 'pointer', borderRadius: 999 }}
                  disabled={enriching}
                  onClick={handleEnrich}
                >
                  {enriching ? 'Enriching…' : 'Re-enrich'}
                </button>
              </div>

              <div
                style={{
                  background: '#FFFFFF',
                  borderRadius: 20,
                  padding: '16px 18px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                {enriching || activeItem?.status === 'enriching' || activeItem?.status === 'processing' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#0071E3',
                          boxShadow: '0 0 8px rgba(0,113,227,0.6)',
                          animation: 'mobilePulse 1.5s infinite ease-in-out',
                        }}
                      />
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#0071E3' }}>
                        AI generating summary & insights…
                      </span>
                    </div>

                    {/* TLDR skeleton banner */}
                    <div
                      className="m-shimmer-bar"
                      style={{
                        height: 52,
                        borderRadius: 14,
                        width: '100%',
                      }}
                    />

                    {/* Key points skeleton highlights */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 2 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="m-shimmer-bar" style={{ width: 75, height: 12, borderRadius: 6 }} />
                        <div className="m-shimmer-bar" style={{ width: '95%', height: 14, borderRadius: 6 }} />
                        <div className="m-shimmer-bar" style={{ width: '72%', height: 14, borderRadius: 6 }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="m-shimmer-bar" style={{ width: 90, height: 12, borderRadius: 6 }} />
                        <div className="m-shimmer-bar" style={{ width: '88%', height: 14, borderRadius: 6 }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div className="m-shimmer-bar" style={{ width: 65, height: 12, borderRadius: 6 }} />
                        <div className="m-shimmer-bar" style={{ width: '92%', height: 14, borderRadius: 6 }} />
                        <div className="m-shimmer-bar" style={{ width: '60%', height: 14, borderRadius: 6 }} />
                      </div>
                    </div>
                  </div>
                ) : summaryStructure.tldr || summaryStructure.points.length > 0 ? (
                  <>
                    {/* Highlighted TL;DR Banner */}
                    {summaryStructure.tldr && (
                      <div
                        style={{
                          background: 'rgba(0, 113, 227, 0.05)',
                          border: '1px solid rgba(0, 113, 227, 0.12)',
                          borderRadius: 14,
                          padding: '12px 14px',
                          fontSize: 14.5,
                          fontWeight: 600,
                          lineHeight: 1.55,
                          color: '#111113',
                        }}
                      >
                        {summaryStructure.tldr}
                      </div>
                    )}

                    {/* Labeled Key Points / Highlights */}
                    {summaryStructure.points.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {summaryStructure.points.map((pt, idx) => (
                          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {pt.label && (
                              <span
                                style={{
                                  fontSize: 12.5,
                                  fontWeight: 700,
                                  color: '#0071E3',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                {pt.label}
                              </span>
                            )}
                            <div style={{ fontSize: 14, lineHeight: 1.55, color: '#1D1D1F' }}>
                              <MobileMarkdown text={pt.text} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '16px 0', color: '#8E8E93' }}>
                    <div style={{ fontSize: 14 }}>No summary generated yet.</div>
                    <button
                      type="button"
                      className="ch"
                      style={{
                        marginTop: 10,
                        background: '#0071E3',
                        color: '#fff',
                        padding: '8px 18px',
                        border: 0,
                        borderRadius: 999,
                        fontWeight: 600,
                        fontSize: 13,
                      }}
                      onClick={handleEnrich}
                    >
                      Generate AI Summary
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

            {activeItem?.storage_provider === 'google_drive' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(52,199,89,0.08)', borderRadius: 12, color: '#248A3D', fontSize: 12.5, fontWeight: 500 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span>Stored & synced on Google Drive</span>
              </div>
            )}
          </div>
        )}

      {/* Tab 2: Outbound Links & Resources */}
      {tab === 'links' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111113' }}>
            Referenced Resources ({links.length})
          </div>

          {links.length > 0 ? (
            links.map((link, idx) => (
              <a
                key={idx}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  textDecoration: 'none',
                  color: 'inherit',
                  padding: '12px 14px',
                  gap: 12,
                  background: '#FFFFFF',
                  borderRadius: 18,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                {/* Authentic Platform Favicon */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: '#F2F1F6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${link.domain}&sz=64`}
                    alt=""
                    style={{ width: 20, height: 20, borderRadius: 4 }}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1D1D1F' }}>
                    {link.title}
                  </div>
                  {link.detail ? (
                    <div style={{ marginTop: 2, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#8E8E93' }}>
                      {link.detail}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 2, fontSize: 11.5, color: '#0071E3', fontWeight: 500 }}>
                    {link.domain} {link.type ? `· ${link.type}` : ''}
                  </div>
                </div>

                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#8E8E93" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 7h10v10" />
                  <path d="M7 17 17 7" />
                </svg>
              </a>
            ))
          ) : (
            <div style={{ textAlign: 'center', padding: 24, background: '#FFFFFF', borderRadius: 18, color: '#8E8E93' }}>
              No referenced links extracted from this item.
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Notes & Personal Tags (Dedicated screen without media push-down) */}
      {tab === 'notes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#111113' }}>
            Tags
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {tags.map((t, idx) => (
              <span key={idx} className="ch on" style={{ fontSize: 12, borderRadius: 999 }}>
                #{t}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#111113' }}>
              Private Notes
            </span>
            <button
              type="button"
              className="ch"
              style={{
                fontSize: 12,
                background: '#0071E3',
                color: '#fff',
                padding: '6px 14px',
                border: 0,
                borderRadius: 999,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              disabled={savingNote}
              onClick={handleSavePrivateNote}
            >
              {savingNote ? 'Saving…' : 'Save Note'}
            </button>
          </div>

          <div style={{ minHeight: 140, background: '#FFFFFF', borderRadius: 18, padding: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            <textarea
              value={privateNote}
              onChange={(e) => setPrivateNote(e.target.value)}
              placeholder="Add your personal thoughts or private notes here…"
              style={{
                width: '100%',
                border: 0,
                outline: 0,
                background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 14.5,
                lineHeight: 1.55,
                resize: 'none',
                minHeight: 120,
                color: '#1D1D1F',
              }}
            />
          </div>
        </div>
      )}

      {/* Three Dots (•••) Action Sheet with Useful Operations */}
      <AnimatePresence>
        {actionSheetOpen && (
          <motion.div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              background: 'rgba(0, 0, 0, 0.45)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              maxWidth: 480,
              margin: '0 auto',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setActionSheetOpen(false)}
          >
            <motion.div
              style={{
                background: '#FFFFFF',
                borderRadius: '28px 28px 0 0',
                padding: '20px 16px max(24px, env(safe-area-inset-bottom, 24px))',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                boxShadow: '0 -10px 40px rgba(0,0,0,0.18)',
              }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 350 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ textAlign: 'center', marginBottom: 6 }}>
                <div style={{ width: 36, height: 4, background: '#D1D1D6', borderRadius: 999, margin: '0 auto 12px' }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: '#1D1D1F' }}>Item Actions</div>
              </div>

              {activeItem?.url && (
                <button
                  type="button"
                  className="bt"
                  style={{
                    width: '100%',
                    height: 50,
                    borderRadius: 16,
                    background: '#F2F2F7',
                    color: '#1D1D1F',
                    justifyContent: 'flex-start',
                    padding: '0 16px',
                    fontSize: 15,
                    gap: 12,
                  }}
                  onClick={handleShare}
                >
                  <Icon name="arrow-square-out" size={18} />
                  <span>Share Item</span>
                </button>
              )}

              {activeItem?.url && (
                <button
                  type="button"
                  className="bt"
                  style={{
                    width: '100%',
                    height: 50,
                    borderRadius: 16,
                    background: '#F2F2F7',
                    color: '#1D1D1F',
                    justifyContent: 'flex-start',
                    padding: '0 16px',
                    fontSize: 15,
                    gap: 12,
                  }}
                  onClick={handleCopyLink}
                >
                  <Icon name="copy" size={18} />
                  <span>Copy Link</span>
                </button>
              )}

              {activeItem?.summary && (
                <button
                  type="button"
                  className="bt"
                  style={{
                    width: '100%',
                    height: 50,
                    borderRadius: 16,
                    background: '#F2F2F7',
                    color: '#1D1D1F',
                    justifyContent: 'flex-start',
                    padding: '0 16px',
                    fontSize: 15,
                    gap: 12,
                  }}
                  onClick={handleCopySummary}
                >
                  <Icon name="file-text" size={18} />
                  <span>Copy Summary</span>
                </button>
              )}

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 50,
                  borderRadius: 16,
                  background: '#F2F2F7',
                  color: '#1D1D1F',
                  justifyContent: 'flex-start',
                  padding: '0 16px',
                  fontSize: 15,
                  gap: 12,
                }}
                onClick={() => {
                  setActionSheetOpen(false)
                  handleEnrich()
                }}
              >
                <Icon name="sparkle" size={18} />
                <span>Re-enrich with AI</span>
              </button>

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 50,
                  borderRadius: 16,
                  background: '#F2F2F7',
                  color: '#1D1D1F',
                  justifyContent: 'flex-start',
                  padding: '0 16px',
                  fontSize: 15,
                  gap: 12,
                }}
                onClick={() => {
                  setActionSheetOpen(false)
                  handleToggleFavorite()
                }}
              >
                <Icon name="star" size={18} />
                <span>{isFavorited ? 'Remove from Favorites' : 'Add to Favorites'}</span>
              </button>

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 50,
                  borderRadius: 16,
                  background: '#FFF0F0',
                  color: '#FF3B30',
                  justifyContent: 'flex-start',
                  padding: '0 16px',
                  fontSize: 15,
                  gap: 12,
                }}
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Icon name="trash" size={18} />
                <span>Delete from Library</span>
              </button>

              <button
                type="button"
                className="bt"
                style={{
                  width: '100%',
                  height: 48,
                  borderRadius: 16,
                  background: '#FFFFFF',
                  color: '#8E8E93',
                  justifyContent: 'center',
                  fontSize: 15,
                  fontWeight: 600,
                  marginTop: 4,
                  border: '1px solid #E5E5EA',
                }}
                onClick={() => setActionSheetOpen(false)}
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {confirmDeleteOpen && (
          <motion.div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 300,
              background: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              style={{
                background: '#FFFFFF',
                borderRadius: 24,
                padding: '24px 20px',
                width: '100%',
                maxWidth: 340,
                textAlign: 'center',
                boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
              }}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
            >
              <div style={{ fontWeight: 700, fontSize: 18, color: '#1D1D1F' }}>Delete Item?</div>
              <div style={{ fontSize: 14, color: '#8E8E93', marginTop: 8, lineHeight: 1.4 }}>
                Are you sure you want to remove &ldquo;{title}&rdquo; from your library?
              </div>
              <div className="r" style={{ gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="bt"
                  style={{ flex: 1, height: 44, borderRadius: 14, background: '#F2F2F7', color: '#1D1D1F' }}
                  onClick={() => setConfirmDeleteOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bt"
                  style={{ flex: 1, height: 44, borderRadius: 14, background: '#FF3B30', color: '#FFF' }}
                  onClick={handleDeleteItem}
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Bottom Action Dock: Discuss with Agent */}
      <div
        className="glass hi r"
        style={{
          position: 'fixed',
          left: 16,
          right: 16,
          bottom: 'max(20px, env(safe-area-inset-bottom, 20px))',
          height: 60,
          borderRadius: 999,
          padding: 6,
          gap: 8,
          zIndex: 100,
          maxWidth: 448,
          margin: '0 auto',
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
        }}
      >
        <button
          type="button"
          className="ib"
          aria-label="Favorite"
          style={{
            background: isFavorited ? '#111113' : '#FFFFFF',
            color: isFavorited ? '#FFD60A' : '#1D1D1F',
            width: 48,
            height: 48,
          }}
          onClick={handleToggleFavorite}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill={isFavorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>

        <button
          type="button"
          className="bt"
          style={{ flex: 1, borderRadius: 999, height: 48, gap: 8 }}
          onClick={() => {
            if (onAskAgent) {
              onAskAgent({
                title: `Discuss: ${title}`,
                initialMessage: `I want to discuss "${title}":\n${summaryStructure.tldr || postBody || ''}`,
              })
            }
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
            <path d="M20 3v4" />
            <path d="M22 5h-4" />
          </svg>
          Discuss with Agent
        </button>
      </div>
    </motion.div>
  )
}
