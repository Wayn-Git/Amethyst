import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { AnimatePresence, motion } from 'framer-motion'
import { FileIcon } from '@untitledui/file-icons'

// Import all dedicated sub-tools
import ImageResizerTool from './converter/ImageResizerTool.jsx'
import PdfToolsTool from './converter/PdfToolsTool.jsx'
import VideoToolsTool from './converter/VideoToolsTool.jsx'
import OcrTool from './converter/OcrTool.jsx'
import QrGeneratorTool from './converter/QrGeneratorTool.jsx'
import UnitConverterTool from './converter/UnitConverterTool.jsx'
import TimeZoneTool from './converter/TimeZoneTool.jsx'
import ColorConverterTool from './converter/ColorConverterTool.jsx'
import CodeFormatterTool from './converter/CodeFormatterTool.jsx'
import TextToolsTool from './converter/TextToolsTool.jsx'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileCategory(ext) {
  ext = (ext || '').toLowerCase().replace(/^\./, '')
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'ico', 'avif', 'svg', 'heic'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv', 'html', 'rtf', 'odt'].includes(ext)) return 'document'
  if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'].includes(ext)) return 'audio'
  return 'other'
}

function getUntitledIconType(ext) {
  ext = (ext || '').toLowerCase().replace(/^\./, '')
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'avif', 'svg', 'heic'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'document'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'spreadsheet'
  if (['ppt', 'pptx'].includes(ext)) return 'presentation'
  if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio'
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return 'archive'
  return 'file'
}

const CATEGORY_TABS = [
  { id: 'all', label: 'All Studios', icon: 'grid' },
  { id: 'image', label: 'Images', icon: 'image' },
  { id: 'pdf', label: 'PDF & Docs', icon: 'file' },
  { id: 'media', label: 'Media & Audio', icon: 'video' },
  { id: 'developer', label: 'Developer', icon: 'code' },
  { id: 'utilities', label: 'Utilities', icon: 'wrench' },
]

const ALL_TOOLS_CATALOG = [
  {
    id: 'files',
    category: 'all',
    categoryLabel: 'Universal Studio',
    title: 'Universal File Converter',
    desc: 'Multi-format on-device transcode pipeline. Losslessly convert images, audio, video, documents, and archives with hardware acceleration.',
    inputs: ['PDF', 'DOCX', 'XLSX', 'PPTX', 'PNG', 'JPG', 'WEBP', 'MP4', 'MP3', 'WAV', 'CSV'],
    outputs: ['PDF', 'DOCX', 'PNG', 'JPG', 'WEBP', 'MP4', 'MP3', 'WAV', 'TXT'],
    highlights: ['100% Local Engine', 'Multi-File Batch', 'Zero Cloud'],
    actionText: 'Open Workbench',
    tags: ['PDF', 'DOCX', 'PNG', 'MP4', 'MP3', 'WEBP'],
    icon: 'convert',
    isUniversal: true,
    accent: '#7132f5',
  },
  {
    id: 'pdf-tools',
    category: 'pdf',
    categoryLabel: 'PDF Suite',
    title: 'PDF Tools Hub',
    desc: 'Local document suite: merge multi-page PDFs, extract custom page slices, compress document weights, and convert to Word DOCX.',
    inputs: ['PDF', 'DOCX', 'PNG', 'JPG', 'WebP'],
    outputs: ['PDF', 'DOCX', 'PNG', 'JPG'],
    highlights: ['Merge & Split', 'Lossless Compress', 'Word Transcode'],
    actionText: 'Launch PDF Hub',
    tags: ['MERGE', 'SPLIT', 'COMPRESS', 'WORD', 'PAGES'],
    icon: 'file',
    component: 'pdf-tools',
    accent: '#ec4899',
  },
  {
    id: 'image-resizer',
    category: 'image',
    categoryLabel: 'Image Studio',
    title: 'Image Resizer & Compress',
    desc: 'Pixel-perfect dimension scaling, aspect locking, WebP/AVIF quality tuning, and preset social media format export.',
    inputs: ['JPG', 'PNG', 'WebP', 'AVIF', 'GIF', 'TIFF', 'BMP'],
    outputs: ['PNG', 'JPG', 'WebP', 'AVIF', 'ICO', 'PDF'],
    highlights: ['Aspect Ratio Lock', 'Preset Dimensions', 'Quality Tuning'],
    actionText: 'Launch Resizer',
    tags: ['RESIZE', 'COMPRESS', 'PRESETS', 'WEBP'],
    icon: 'expand',
    component: 'image-resizer',
    accent: '#10b981',
  },
  {
    id: 'video-tools',
    category: 'media',
    categoryLabel: 'Media Workshop',
    title: 'Video & Audio Workshop',
    desc: 'FFmpeg transcode engine for MP4/WebM/MKV, frame-accurate animated GIF generation, and lossless audio extraction.',
    inputs: ['MP4', 'WebM', 'MKV', 'MOV', 'AVI', 'MP3', 'WAV'],
    outputs: ['MP4', 'WebM', 'GIF', 'MP3', 'WAV', 'AAC'],
    highlights: ['Hardware FFmpeg', 'Frame-Accurate GIF', 'Stem Extraction'],
    actionText: 'Launch Media Workshop',
    tags: ['MP4', 'WEBM', 'GIF', 'AUDIO', 'FFMPEG'],
    icon: 'video',
    component: 'video-tools',
    accent: '#f59e0b',
  },
  {
    id: 'ocr',
    category: 'utilities',
    categoryLabel: 'OCR Scanner',
    title: 'OCR & Document Text Scanner',
    desc: 'Extract machine-readable structured text from scanned imagery, invoices, receipts, and multi-page documents.',
    inputs: ['PNG', 'JPG', 'WebP', 'PDF', 'DOCX', 'TIFF'],
    outputs: ['Plain Text', 'Live Clipboard', 'TXT File'],
    highlights: ['Multi-Language', 'Table Recognition', 'Instant Copy'],
    actionText: 'Launch OCR',
    tags: ['OCR', 'TEXT', 'SCAN', 'DOCUMENTS'],
    icon: 'type',
    component: 'ocr',
    accent: '#06b6d4',
  },
  {
    id: 'qr-code',
    category: 'utilities',
    categoryLabel: 'QR Generator',
    title: 'QR Code Generator',
    desc: 'Generate crisp, vector-scalable QR codes for URLs, Wi-Fi network credentials, vCards, and plain text with SVG download.',
    inputs: ['URL', 'Wi-Fi Network', 'Email', 'vCard', 'Text'],
    outputs: ['PNG Raster', 'SVG Vector'],
    highlights: ['Lossless Vector SVG', 'Error Correction', 'Instant Save'],
    actionText: 'Launch QR Generator',
    tags: ['QR', 'WIFI', 'VCARD', 'VECTOR', 'SVG'],
    icon: 'grid',
    component: 'qr-code',
    accent: '#14b8a6',
  },
  {
    id: 'color-converter',
    category: 'developer',
    categoryLabel: 'Developer Lab',
    title: 'Color Converter & Contrast',
    desc: 'Two-way HEX, RGB, HSL, and CMYK transforms with WCAG AA/AAA contrast verification and dynamic harmonic palettes.',
    inputs: ['HEX', 'RGB', 'HSL', 'CMYK', 'Color Picker'],
    outputs: ['Harmonized Palettes', 'WCAG AA/AAA Ratio'],
    highlights: ['Two-Way Transforms', 'WCAG AA/AAA Check', 'Tonal Steps'],
    actionText: 'Launch Color Lab',
    tags: ['HEX', 'RGB', 'HSL', 'WCAG', 'CONTRAST'],
    icon: 'palette',
    component: 'color-converter',
    accent: '#d946ef',
  },
  {
    id: 'code-formatter',
    category: 'developer',
    categoryLabel: 'Developer Lab',
    title: 'Code Formatter & Minifier',
    desc: 'AST beautifier and minifier for JSON, HTML, CSS, JavaScript, SQL, and XML with syntax validation and indent controls.',
    inputs: ['JSON', 'HTML', 'CSS', 'JavaScript', 'SQL', 'XML'],
    outputs: ['Beautified Code', 'Minified Payload'],
    highlights: ['Multi-Language AST', 'Configurable Indent', 'Instant Copy'],
    actionText: 'Launch Formatter',
    tags: ['JSON', 'HTML', 'CSS', 'SQL', 'JS', 'AST'],
    icon: 'code',
    component: 'code-formatter',
    accent: '#eab308',
  },
  {
    id: 'text-tools',
    category: 'developer',
    categoryLabel: 'Developer Lab',
    title: 'Text & String Utilities',
    desc: 'Casing transformers (camel, kebab, snake, pascal), line deduplication, regex pattern match, and real-time text telemetry.',
    inputs: ['Plain Text', 'Raw Strings', 'Log Snippets'],
    outputs: ['Transformed Casing', 'Deduplicated Lines', 'Statistics'],
    highlights: ['Case Transforms', 'Line Deduplication', 'Character Stats'],
    actionText: 'Launch Text Tools',
    tags: ['CASE', 'DEDUPE', 'STATISTICS', 'REGEX'],
    icon: 'type',
    component: 'text-tools',
    accent: '#84cc16',
  },
  {
    id: 'unit-converter',
    category: 'utilities',
    categoryLabel: 'Physical Units',
    title: 'Unit Precision Converter',
    desc: 'High-precision conversion across length, digital storage, mass, temperature, speed, volume, and pressure.',
    inputs: ['Length', 'Weight', 'Storage', 'Speed', 'Volume', 'Temp'],
    outputs: ['Live Equivalents Grid', '12 Dimensions'],
    highlights: ['64-bit Precision', 'Real-time Matrix', 'One-Click Copy'],
    actionText: 'Launch Unit Converter',
    tags: ['LENGTH', 'STORAGE', 'WEIGHT', 'VOLUME'],
    icon: 'arrows-left-right',
    component: 'unit-converter',
    accent: '#f97316',
  },
  {
    id: 'timezone',
    category: 'utilities',
    categoryLabel: 'World Clock',
    title: 'Time Zones & World Clock',
    desc: 'Live multi-city timezone matrix with real-time UTC offsets, DST computation, and international meeting schedule planning.',
    inputs: ['Global Cities', 'Custom UTC Offsets'],
    outputs: ['Live Clock Matrix', 'Day/Night Indicator'],
    highlights: ['Real-time UTC', 'DST Calculation', 'Meeting Grid'],
    actionText: 'Launch World Clock',
    tags: ['WORLD CLOCK', 'UTC', 'OFFSETS', 'TIME'],
    icon: 'clock',
    component: 'timezone',
    accent: '#0ea5e9',
  },
]

const PRIMARY_NAV_ITEMS = [
  { id: 'files', label: 'File Converter', icon: 'convert' },
  { id: 'all', label: 'All Studios Directory', icon: 'grid' },
  { id: 'pdf-tools', label: 'PDF Suite', icon: 'file' },
  { id: 'image-resizer', label: 'Image Studio', icon: 'expand' },
  { id: 'video-tools', label: 'Media Workshop', icon: 'video' },
  { id: 'ocr', label: 'OCR Scanner', icon: 'type' },
  { id: 'qr-code', label: 'QR Generator', icon: 'grid' },
  { id: 'color-converter', label: 'Color Lab', icon: 'palette' },
  { id: 'code-formatter', label: 'Code Formatter', icon: 'code' },
]

export default function Converter() {
  const { toast } = useApp()
  const fileInputRef = useRef(null)

  // Active View
  const [activeView, setActiveView] = useState('files')

  // Capabilities
  const [capabilities, setCapabilities] = useState(null)
  const [loadingCaps, setLoadingCaps] = useState(true)

  // Filters & Search for Directory
  const [activeCategory, setActiveCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Drag and Drop
  const [isDragging, setIsDragging] = useState(false)

  // Queue of active and processed files
  const [queue, setQueue] = useState([])

  // Modal Preview
  const [previewItem, setPreviewItem] = useState(null)
  const [batchMerging, setBatchMerging] = useState(false)

  // Load capabilities on mount
  useEffect(() => {
    api.converterCapabilities()
      .then((data) => {
        setCapabilities(data)
        setLoadingCaps(false)
      })
      .catch((err) => {
        console.warn('Converter capabilities error:', err)
        setLoadingCaps(false)
      })
  }, [])


  // Filter tools based on category tab & search query
  const filteredTools = useMemo(() => {
    return ALL_TOOLS_CATALOG.filter((t) => {
      const matchCat = activeCategory === 'all' || t.category === activeCategory
      const matchQuery = !searchQuery.trim() ||
        t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.desc.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      return matchCat && matchQuery
    })
  }, [activeCategory, searchQuery])

  // Handle incoming native files
  const addFilesToQueue = useCallback((fileList, presetOp = null) => {
    if (!fileList || fileList.length === 0) return

    const newItems = Array.from(fileList).map((file) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      const cat = getFileCategory(ext)

      let op = presetOp || 'convert'
      let targetFormat = 'pdf'

      if (cat === 'image') {
        op = presetOp || 'convert'
        targetFormat = ext === 'png' ? 'webp' : 'png'
      } else if (cat === 'pdf') {
        op = presetOp === 'extract_text' ? 'extract_text' : (presetOp || 'pdf_to_images')
        targetFormat = 'png'
      } else if (cat === 'document') {
        op = presetOp === 'extract_text' ? 'extract_text' : (presetOp || 'convert')
        targetFormat = 'pdf'
      } else if (cat === 'video') {
        op = presetOp || 'convert'
        targetFormat = ext === 'mp4' ? 'webm' : 'mp4'
      } else if (cat === 'audio') {
        op = presetOp || 'convert'
        targetFormat = ext === 'mp3' ? 'wav' : 'mp3'
      }

      let localThumb = null
      if (file.type?.startsWith('image/')) {
        try {
          localThumb = URL.createObjectURL(file)
        } catch {}
      }

      return {
        id: Math.random().toString(36).substring(2, 10),
        file,
        name: file.name,
        size: file.size,
        ext,
        category: cat,
        localThumb,
        status: 'ready',
        uploadProgress: 0,
        operation: op,
        targetFormat,
        showOptions: false,
        options: {
          quality: 85,
          width: '',
          height: '',
          percentage: 50,
          angle: 90,
          pages: '1',
          format: 'png',
          fps: 15,
        },
        uploadedId: null,
        result: null,
        error: null,
      }
    })

    setQueue((prev) => [...prev, ...newItems])
    // Switch to files workbench when files added
    if (activeView === 'all') {
      setActiveView('files')
    }
  }, [activeView])

  // Clipboard Paste Listener (Ctrl+V anywhere to drop file)
  useEffect(() => {
    const handlePaste = (e) => {
      if (['TEXTAREA', 'INPUT'].includes(e.target?.tagName)) return
      if (e.clipboardData?.files?.length) {
        addFilesToQueue(e.clipboardData.files)
        toast(`Pasted ${e.clipboardData.files.length} file(s) into converter`, 'good')
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addFilesToQueue, toast])

  const removeItem = useCallback((id) => {
    setQueue((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const updateItem = useCallback((id, patch) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    )
  }, [])

  const clearQueue = useCallback(() => {
    setQueue([])
  }, [])

  // Drag & drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files?.length) {
      addFilesToQueue(e.dataTransfer.files)
    }
  }, [addFilesToQueue])

  // Conversion process single item
  const processItem = useCallback(async (id) => {
    const item = queue.find((i) => i.id === id)
    if (!item) return

    updateItem(id, { status: 'uploading', uploadProgress: 15, error: null })

    try {
      let uploadedId = item.uploadedId
      if (!uploadedId) {
        const uploadRes = await api.converterUpload([item.file], (prog) => {
          updateItem(id, { uploadProgress: Math.min(prog, 90) })
        })
        if (!uploadRes.uploaded?.length) {
          throw new Error('Local upload failed')
        }
        uploadedId = uploadRes.uploaded[0].file_id
        updateItem(id, { uploadedId, uploadProgress: 95 })
      }

      updateItem(id, { status: 'processing', uploadProgress: 100 })

      let payload = {
        file_id: uploadedId,
        operation: item.operation,
      }

      if (item.operation === 'convert') {
        payload.target_format = item.targetFormat
      } else if (item.operation === 'resize') {
        payload.options = {
          width: item.options.width ? Number(item.options.width) : undefined,
          height: item.options.height ? Number(item.options.height) : undefined,
          percentage: Number(item.options.percentage) || 50,
          quality: Number(item.options.quality) || 85,
        }
      } else if (item.operation === 'compress') {
        payload.options = { quality: Number(item.options.quality) || 75 }
      } else if (item.operation === 'rotate') {
        payload.options = { angle: Number(item.options.angle) || 90 }
      } else if (item.operation === 'pdf_to_images') {
        payload.options = { format: item.options.format || 'png' }
      } else if (item.operation === 'pdf_extract_pages') {
        payload.options = { pages: item.options.pages || '1' }
      }

      const res = await api.converterProcess(payload)
      updateItem(id, { status: 'completed', result: res })
      toast(`Converted ${item.name} → ${res.filename}`, 'good')
    } catch (err) {
      console.error(err)
      updateItem(id, { status: 'error', error: err.message || 'Operation failed' })
      toast(`Failed: ${err.message}`, 'bad')
    }
  }, [queue, updateItem, toast])

  // Convert all items in queue
  const processAll = useCallback(async () => {
    const readyItems = queue.filter((i) => i.status === 'ready' || i.status === 'error')
    for (const item of readyItems) {
      await processItem(item.id)
    }
  }, [queue, processItem])

  // Merge all PDFs in queue
  const handleMergePdfs = useCallback(async () => {
    const pdfItems = queue.filter((i) => i.category === 'pdf')
    if (pdfItems.length < 2) {
      toast('Please add at least 2 PDF files to merge', 'bad')
      return
    }

    setBatchMerging(true)
    try {
      const uploadRes = await api.converterUpload(pdfItems.map((i) => i.file))
      const fileIds = uploadRes.uploaded.map((u) => u.file_id)

      const res = await api.converterProcess({
        file_ids: fileIds,
        operation: 'pdf_merge',
        options: { output_name: 'merged_document.pdf' },
      })

      setPreviewItem(res)
      toast('Merged PDFs successfully!', 'good')
    } catch (err) {
      console.error(err)
      toast(`Merge failed: ${err.message}`, 'bad')
    } finally {
      setBatchMerging(false)
    }
  }, [queue, toast])

  // Quick target format options based on category
  const getQuickTargets = (cat) => {
    switch (cat) {
      case 'image':
        return ['webp', 'png', 'jpg', 'avif', 'ico', 'pdf']
      case 'document':
      case 'pdf':
        return ['pdf', 'docx', 'png', 'txt']
      case 'video':
        return ['mp4', 'webm', 'gif', 'mp3']
      case 'audio':
        return ['mp3', 'wav', 'aac', 'flac']
      default:
        return ['pdf', 'txt']
    }
  }

  // Full available targets for dropdown
  const getAvailableTargets = (item) => {
    const all = {
      image: ['png', 'jpg', 'webp', 'avif', 'gif', 'ico', 'tiff', 'bmp', 'pdf'],
      document: ['pdf', 'docx', 'txt', 'html'],
      pdf: ['docx', 'png', 'jpg', 'webp', 'txt'],
      video: ['mp4', 'webm', 'gif', 'mp3', 'wav'],
      audio: ['mp3', 'wav', 'aac', 'ogg', 'flac'],
      other: ['txt', 'pdf'],
    }
    return (all[item.category] || ['pdf', 'txt']).filter((t) => t !== item.ext)
  }

  // Set all items target format
  const setAllTargets = useCallback((target) => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.status === 'ready') {
          return { ...item, targetFormat: target, operation: 'convert' }
        }
        return item
      })
    )
    toast(`Set batch format to .${target} for eligible files`, 'info')
  }, [toast])

  // 60fps GPU compositor spotlight tracking
  const handleCardPointerMove = useCallback((e) => {
    const card = e.currentTarget
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }, [])

  const handleOpenTool = (toolId) => {
    const tool = ALL_TOOLS_CATALOG.find((t) => t.id === toolId)
    if (tool?.component) {
      setActiveView(tool.component)
    } else if (tool?.isUniversal) {
      setActiveView('files')
    } else {
      setActiveView(toolId)
    }
  }

  const pdfItems = queue.filter((i) => i.category === 'pdf')
  const canMergePdfs = pdfItems.length >= 2
  const totalQueueBytes = queue.reduce((acc, i) => acc + (i.size || 0), 0)
  const completedCount = queue.filter((i) => i.status === 'completed').length
  const isWorkingCount = queue.filter((i) => i.status === 'uploading' || i.status === 'processing').length

  return (
    <div className="fc-page">
      <div className="fc-container">
        {/* 1. Header Section */}
        <div className="fc-header">
          <div className="fc-eyebrow-row">
            <div className="fc-badge-pill">
              <span className="fc-live-pulse-dot" />
              <span>100% On-Device · Hardware Accelerated</span>
            </div>
            <div className="fc-engine-stats">
              <span className="fc-engine-chip">
                <Icon name="check" size={12} className="text-emerald-400" />
                FFmpeg & Sharp Native
              </span>
              <span className="fc-engine-chip">Zero Cloud Telemetry</span>
            </div>
          </div>
          <h1 className="fc-title">File Studio & Universal Converter</h1>
          <p className="fc-subtitle">
            Local workstation pipeline for images, documents, audio, and video. Process files instantly with full offline privacy and zero quality loss.
          </p>
        </div>

        {/* 2. Top Segmented Navigation Dock */}
        <div className="fc-nav-container">
          <div className="fc-subnav-dock">
            {PRIMARY_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`fc-subnav-btn${isActive ? ' is-active' : ''}`}
                  onClick={() => setActiveView(item.id)}
                >
                  {isActive && (
                    <motion.div
                      layoutId="converterNavIndicator"
                      className="fc-subnav-pill"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <Icon name={item.icon} size={15} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 3. Breadcrumb Bar when in a dedicated sub-view */}
        {activeView !== 'all' && activeView !== 'files' && (
          <div className="fc-breadcrumb-bar">
            <div className="fc-breadcrumb-left">
              <button
                type="button"
                className="fc-back-btn"
                onClick={() => setActiveView('all')}
              >
                <Icon name="arrow-left" size={14} />
                <span>All Studios</span>
              </button>
              <div className="fc-breadcrumb-trail">
                <span className="fc-crumb-dim">Studios /</span>
                <span className="fc-crumb-active">
                  {ALL_TOOLS_CATALOG.find((s) => s.component === activeView || s.id === activeView)?.title || 'Dedicated Studio'}
                </span>
              </div>
            </div>

            <select
              className="fc-studio-quick-select"
              value={activeView}
              onChange={(e) => setActiveView(e.target.value)}
            >
              <option value="files">Universal Converter</option>
              <option value="all">All Studios Directory</option>
              <optgroup label="Dedicated Studios">
                <option value="pdf-tools">PDF Tools Hub</option>
                <option value="image-resizer">Image Resizer & Studio</option>
                <option value="video-tools">Video & Audio Workshop</option>
                <option value="ocr">OCR Document Scanner</option>
                <option value="qr-code">QR Vector Generator</option>
                <option value="unit-converter">Unit Converter</option>
                <option value="timezone">Time Zones & World Clock</option>
                <option value="color-converter">Color & Contrast Lab</option>
                <option value="code-formatter">Code Formatter</option>
                <option value="text-tools">Text & String Tools</option>
              </optgroup>
            </select>
          </div>
        )}

        {/* 4. Dedicated Tool Workspaces */}
        {activeView === 'image-resizer' && <ImageResizerTool />}
        {activeView === 'pdf-tools' && <PdfToolsTool />}
        {activeView === 'video-tools' && <VideoToolsTool />}
        {activeView === 'ocr' && <OcrTool />}
        {activeView === 'qr-code' && <QrGeneratorTool />}
        {activeView === 'unit-converter' && <UnitConverterTool />}
        {activeView === 'timezone' && <TimeZoneTool />}
        {activeView === 'color-converter' && <ColorConverterTool />}
        {activeView === 'code-formatter' && <CodeFormatterTool />}
        {activeView === 'text-tools' && <TextToolsTool />}

        {/* 5. Universal File Converter & Dropzone (when 'all' or 'files') */}
        {(activeView === 'all' || activeView === 'files') && (
          <>
            {/* Precision Dropzone */}
            <div className="fc-upload-section">
              <div
                className={`fc-dropzone-shell${isDragging ? ' is-dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="fc-dropzone-core">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="sr-only"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files?.length) {
                        addFilesToQueue(e.target.files)
                        e.target.value = ''
                      }
                    }}
                  />

                  <div className="fc-drop-featured-icon">
                    <Icon name="upload" size={26} />
                  </div>

                  <div className="fc-drop-prompt-group">
                    <h2 className="fc-drop-heading">
                      {isDragging ? 'Release files to stage in converter' : 'Drop files here or click to browse'}
                    </h2>
                    <p className="fc-drop-subtext">
                      Instant on-device conversion. Multi-file batch processing supported with zero file size limits.
                    </p>
                  </div>

                  <div className="fc-drop-format-tags">
                    <span className="fc-format-tag-pill">Images: JPG, PNG, WebP, AVIF, SVG, GIF</span>
                    <span className="fc-format-tag-pill">Documents: PDF, Word DOCX, Excel XLSX</span>
                    <span className="fc-format-tag-pill">Media: MP4, WebM, MKV, MP3, WAV</span>
                  </div>

                  <div className="fc-drop-action-row">
                    <button
                      type="button"
                      className="fc-btn fc-btn-primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        fileInputRef.current?.click()
                      }}
                    >
                      <Icon name="folder-plus" size={15} />
                      <span>Select Files</span>
                    </button>
                    <span className="fc-drop-paste-hint">or press Ctrl+V to paste from clipboard</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Active Queue Workbench */}
            {queue.length > 0 && (
              <div className="fc-queue-section">
                <div className="fc-workbench-toolbar">
                  <div className="fc-workbench-meta">
                    <h2 className="fc-workbench-title">Workspace Queue</h2>
                    <span className="fc-meta-pill">
                      {queue.length} {queue.length === 1 ? 'file' : 'files'} · {formatBytes(totalQueueBytes)}
                    </span>
                    {completedCount > 0 && (
                      <span className="fc-meta-pill is-done">
                        <Icon name="check" size={12} />
                        {completedCount} converted
                      </span>
                    )}
                    {isWorkingCount > 0 && (
                      <span className="fc-meta-pill text-amber-400">
                        <Icon name="loader" size={12} className="animate-spin" />
                        {isWorkingCount} processing
                      </span>
                    )}
                  </div>

                  <div className="fc-workbench-actions">
                    <div className="fc-batch-target-picker">
                      <span>Batch target:</span>
                      <div className="fc-target-chips">
                        {['pdf', 'webp', 'jpg', 'png', 'mp3', 'docx'].map((tgt) => (
                          <button
                            key={tgt}
                            type="button"
                            className="fc-target-chip uppercase"
                            onClick={() => setAllTargets(tgt)}
                            title={`Set all eligible files to .${tgt}`}
                          >
                            .{tgt}
                          </button>
                        ))}
                      </div>
                    </div>

                    {canMergePdfs && (
                      <button
                        type="button"
                        className="fc-btn fc-btn-secondary"
                        disabled={batchMerging}
                        onClick={handleMergePdfs}
                        title="Combine all staged PDFs into a single unified document"
                      >
                        <Icon name="layers" size={14} />
                        <span>{batchMerging ? 'Merging…' : `Merge ${pdfItems.length} PDFs`}</span>
                      </button>
                    )}

                    {queue.some((i) => i.status === 'ready' || i.status === 'error') && (
                      <button
                        type="button"
                        className="fc-btn fc-btn-primary"
                        onClick={processAll}
                      >
                        <Icon name="convert" size={14} />
                        <span>Convert All ({queue.filter((i) => i.status === 'ready' || i.status === 'error').length})</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="fc-btn fc-btn-secondary"
                      onClick={() => fileInputRef.current?.click()}
                      title="Add more files to queue"
                    >
                      <Icon name="plus" size={14} />
                      <span>Add More</span>
                    </button>

                    <button
                      type="button"
                      className="fc-btn fc-btn-danger-ghost"
                      onClick={clearQueue}
                      title="Clear all workspace files"
                    >
                      <Icon name="trash" size={14} />
                      <span>Clear All</span>
                    </button>
                  </div>
                </div>

                <div className="fc-queue-list">
                  <AnimatePresence>
                    {queue.map((item) => {
                      const isWorking = item.status === 'uploading' || item.status === 'processing'
                      const isDone = item.status === 'completed'
                      const hasError = item.status === 'error'
                      const quickTargets = getQuickTargets(item.category)

                      return (
                        <motion.div
                          key={item.id}
                          layout="position"
                          initial={{ opacity: 0, y: 8, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
                          className={`fc-file-item${isDone ? ' is-success' : ''}${hasError ? ' is-error' : ''}`}
                        >
                          <div className="fc-file-core">
                            <div className="fc-file-top-row">
                              <div className="fc-file-identity">
                                {item.localThumb ? (
                                  <img
                                    src={item.localThumb}
                                    alt={item.name}
                                    className="fc-file-thumb"
                                  />
                                ) : (
                                  <div className="fc-file-icon-box">
                                    <FileIcon type={getUntitledIconType(item.ext)} theme="dark" size={22} />
                                  </div>
                                )}

                                <div className="fc-file-meta">
                                  <span className="fc-file-name" title={item.name}>
                                    {item.name}
                                  </span>
                                  <div className="fc-file-specs">
                                    <span>{formatBytes(item.size)}</span>
                                    <span>·</span>
                                    <span className="fc-file-format-badge">.{item.ext || 'FILE'}</span>
                                    <span>·</span>
                                    <span className="capitalize">{item.category}</span>
                                  </div>
                                </div>
                              </div>

                              <div className="fc-file-controls">
                                {!isDone && (
                                  <button
                                    type="button"
                                    className="fc-btn fc-btn-primary"
                                    disabled={isWorking}
                                    onClick={() => processItem(item.id)}
                                  >
                                    <Icon name="convert" size={14} />
                                    <span>{isWorking ? (item.status === 'uploading' ? 'Uploading…' : 'Converting…') : 'Convert'}</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="fc-btn fc-btn-danger-ghost"
                                  onClick={() => removeItem(item.id)}
                                  title="Remove from queue"
                                >
                                  <Icon name="x" size={15} />
                                </button>
                              </div>
                            </div>

                            {!isDone && (
                              <>
                                <div className="fc-pipeline-strip">
                                  <div className="fc-pipeline-flow">
                                    <span className="fc-pipeline-source">.{item.ext?.toUpperCase() || 'FILE'}</span>
                                    <span className="fc-pipeline-arrow">
                                      <Icon name="arrow-right" size={13} />
                                    </span>

                                    <div className="fc-target-chips">
                                      {quickTargets.map((fmt) => (
                                        <button
                                          key={fmt}
                                          type="button"
                                          className={`fc-target-chip uppercase${item.targetFormat === fmt && item.operation === 'convert' ? ' is-active' : ''}`}
                                          onClick={() => updateItem(item.id, { targetFormat: fmt, operation: 'convert' })}
                                        >
                                          .{fmt}
                                        </button>
                                      ))}
                                    </div>

                                    <select
                                      className="fc-select uppercase font-mono"
                                      value={item.operation === 'convert' ? item.targetFormat : item.operation}
                                      onChange={(e) => {
                                        const val = e.target.value
                                        if (['resize', 'compress', 'rotate', 'grayscale', 'pdf_to_images', 'extract_text', 'pdf_extract_pages', 'pdf_compress', 'video_to_audio', 'video_to_gif', 'video_compress'].includes(val)) {
                                          updateItem(item.id, { operation: val })
                                        } else {
                                          updateItem(item.id, { operation: 'convert', targetFormat: val })
                                        }
                                      }}
                                    >
                                      <optgroup label="All Formats">
                                        {getAvailableTargets(item).map((fmt) => (
                                          <option key={fmt} value={fmt}>
                                            .{fmt}
                                          </option>
                                        ))}
                                      </optgroup>
                                      {item.category === 'image' && (
                                        <optgroup label="Operations">
                                          <option value="resize">Resize Dimensions</option>
                                          <option value="compress">Compress / Optimize</option>
                                          <option value="rotate">Rotate Angle</option>
                                          <option value="grayscale">Grayscale</option>
                                        </optgroup>
                                      )}
                                      {item.category === 'pdf' && (
                                        <optgroup label="PDF Tools">
                                          <option value="pdf_to_images">Render Images</option>
                                          <option value="extract_text">Extract Text</option>
                                          <option value="pdf_compress">Compress PDF</option>
                                        </optgroup>
                                      )}
                                    </select>
                                  </div>

                                  {['image', 'video', 'pdf'].includes(item.category) && (
                                    <button
                                      type="button"
                                      className="fc-pipeline-options-btn"
                                      onClick={() => updateItem(item.id, { showOptions: !item.showOptions })}
                                    >
                                      <Icon name="sliders" size={13} />
                                      <span>Options {item.showOptions ? '▴' : '▾'}</span>
                                    </button>
                                  )}
                                </div>

                                {item.showOptions && (
                                  <div className="fc-options-drawer">
                                    {item.operation === 'resize' && (
                                      <div className="fc-option-item">
                                        <span>Resize scale:</span>
                                        <select
                                          className="fc-select font-mono"
                                          value={item.options.percentage || 50}
                                          onChange={(e) =>
                                            updateItem(item.id, {
                                              options: { ...item.options, percentage: Number(e.target.value) },
                                            })
                                          }
                                        >
                                          <option value="25">25% (Thumbnail)</option>
                                          <option value="50">50% (Half Size)</option>
                                          <option value="75">75% (Three-Quarter)</option>
                                          <option value="150">150% (Enlarge)</option>
                                          <option value="200">200% (Double)</option>
                                        </select>
                                      </div>
                                    )}

                                    <div className="fc-option-item">
                                      <span>Quality:</span>
                                      <input
                                        type="range"
                                        min="10"
                                        max="100"
                                        className="fc-range-slider"
                                        value={item.options.quality || 85}
                                        onChange={(e) =>
                                          updateItem(item.id, {
                                            options: { ...item.options, quality: Number(e.target.value) },
                                          })
                                        }
                                      />
                                      <span className="font-mono text-xs">{item.options.quality || 85}%</span>
                                    </div>

                                    {item.category === 'image' && (
                                      <div className="fc-option-item">
                                        <span>Rotate:</span>
                                        <select
                                          className="fc-select"
                                          value={item.options.angle || 0}
                                          onChange={(e) =>
                                            updateItem(item.id, {
                                              options: { ...item.options, angle: Number(e.target.value) },
                                            })
                                          }
                                        >
                                          <option value="0">None</option>
                                          <option value="90">90° CW</option>
                                          <option value="180">180° Flip</option>
                                          <option value="270">270° CCW</option>
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}

                            {isWorking && (
                              <div className="fc-progress-wrap">
                                <div className="fc-progress-meta">
                                  <span>
                                    {item.status === 'uploading'
                                      ? `Staging to local memory… ${item.uploadProgress}%`
                                      : 'Processing via local engine…'}
                                  </span>
                                  <span>{item.uploadProgress || 10}%</span>
                                </div>
                                <div className="fc-progress-bar-wrap">
                                  <div
                                    className="fc-progress-bar-fill"
                                    style={{ width: `${item.uploadProgress || 20}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            {isDone && item.result && (
                              <div className="fc-result-banner">
                                <div className="fc-result-info">
                                  <Icon name="check" size={16} />
                                  <span className="fc-result-name">{item.result.filename}</span>
                                  <span className="fc-result-delta">
                                    {formatBytes(item.result.size)}
                                    {item.size > 0 && item.result.size !== item.size && (
                                      <span className="ml-1 opacity-90">
                                        ({Math.round(((item.result.size - item.size) / item.size) * 100)}%)
                                      </span>
                                    )}
                                  </span>
                                  <span className="fc-result-speed">
                                    in {(item.result.elapsed_ms / 1000).toFixed(2)}s
                                  </span>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="fc-btn fc-btn-secondary"
                                    onClick={() => setPreviewItem(item.result)}
                                  >
                                    <Icon name="eye" size={14} />
                                    <span>Preview</span>
                                  </button>

                                  <a
                                    href={api.converterDownloadUrl(item.result.job_id)}
                                    download={item.result.filename}
                                    className="fc-btn fc-btn-primary"
                                  >
                                    <Icon name="download" size={14} />
                                    <span>Download</span>
                                  </a>
                                </div>
                              </div>
                            )}

                            {hasError && (
                              <div className="fc-error-banner">
                                <div className="flex items-center gap-2">
                                  <Icon name="alert" size={16} />
                                  <span>{item.error}</span>
                                </div>
                                <button
                                  type="button"
                                  className="fc-btn fc-btn-secondary text-xs"
                                  onClick={() => processItem(item.id)}
                                >
                                  Retry
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Gapless Bento Tool Directory (Shown in 'all' view or as catalogue) */}
            {activeView === 'all' && (
              <div className="fc-tools-section">
                <div className="fc-section-title-row">
                  <h2 className="fc-section-title">Specialized Tool Studios</h2>
                  <span className="fc-tools-count">{filteredTools.length} studios</span>
                </div>

                <div className="fc-toolbar">
                  <div className="fc-cat-tabs">
                    {CATEGORY_TABS.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className={`fc-cat-tab${activeCategory === tab.id ? ' is-active' : ''}`}
                        onClick={() => setActiveCategory(tab.id)}
                      >
                        <Icon name={tab.icon} size={15} />
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="fc-search-wrap">
                    <Icon name="search" size={15} className="fc-search-icon" />
                    <input
                      type="text"
                      className="fc-search-input"
                      placeholder="Search studios, formats, tags…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className="fc-search-clear-btn"
                        onClick={() => setSearchQuery('')}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="fc-tools-grid">
                  {filteredTools.map((tool) => (
                    <div
                      key={tool.id}
                      className="fc-tool-card"
                      onPointerMove={handleCardPointerMove}
                      onClick={() => handleOpenTool(tool.id)}
                    >
                      <div className="fc-tool-card-top">
                        <div className="fc-tool-icon-box" style={{ color: tool.accent }}>
                          <Icon name={tool.icon} size={20} />
                        </div>
                        <div className="fc-tool-top-meta">
                          <span className="fc-tool-cat-tag">{tool.categoryLabel || tool.category}</span>
                          <div className="fc-tool-arrow-circle">
                            <Icon name="arrow-up-right" size={13} />
                          </div>
                        </div>
                      </div>

                      <div className="fc-tool-text-group">
                        <div className="fc-tool-name">{tool.title}</div>
                        <div className="fc-tool-desc">{tool.desc}</div>
                      </div>

                      <div className="fc-tool-tags-row">
                        {tool.tags?.map((t) => (
                          <span key={t} className="fc-tool-tag-pill">
                            {t}
                          </span>
                        ))}
                      </div>

                      <div className="fc-tool-card-footer">
                        <div className="fc-tool-highlights">
                          {tool.highlights?.slice(0, 2).map((h) => (
                            <span key={h} className="fc-tool-highlight-item">
                              <Icon name="check" size={11} />
                              {h}
                            </span>
                          ))}
                        </div>
                        <span className="fc-tool-action-link">
                          {tool.actionText || 'Open Studio'} →
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* 6. Preview Modal */}
        <AnimatePresence>
          {previewItem && (
            <div className="fc-modal-backdrop" onClick={() => setPreviewItem(null)}>
              <motion.div
                className="fc-modal-card"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="fc-modal-header">
                  <span className="fc-modal-title">{previewItem.filename}</span>
                  <div className="flex items-center gap-2">
                    <a
                      href={api.converterDownloadUrl(previewItem.job_id)}
                      download={previewItem.filename}
                      className="fc-btn fc-btn-primary"
                    >
                      <Icon name="download" size={14} />
                      <span>Download</span>
                    </a>
                    <button
                      type="button"
                      className="fc-btn fc-btn-danger-ghost"
                      onClick={() => setPreviewItem(null)}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                </div>

                <div className="fc-modal-body">
                  {['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(previewItem.ext) && (
                    <img
                      src={api.converterPreviewUrl(previewItem.job_id)}
                      alt={previewItem.filename}
                      className="max-h-[60vh] max-w-full rounded-lg object-contain shadow-md"
                    />
                  )}

                  {['mp4', 'webm', 'mov'].includes(previewItem.ext) && (
                    <video
                      controls
                      src={api.converterPreviewUrl(previewItem.job_id)}
                      className="max-h-[60vh] max-w-full rounded-lg"
                    />
                  )}

                  {['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'].includes(previewItem.ext) && (
                    <div className="flex flex-col items-center gap-4 py-8">
                      <Icon name="speaker" size={48} className="text-[var(--fc-accent)]" />
                      <audio controls src={api.converterPreviewUrl(previewItem.job_id)} className="w-80" />
                    </div>
                  )}

                  {previewItem.preview_text && (
                    <div className="w-full flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Extracted Content ({previewItem.preview_text.length} characters)</span>
                        <button
                          type="button"
                          className="fc-btn fc-btn-secondary text-xs py-1 h-7"
                          onClick={() => {
                            navigator.clipboard.writeText(previewItem.preview_text)
                            toast('Copied text to clipboard!', 'good')
                          }}
                        >
                          <Icon name="copy" size={13} />
                          <span>Copy Text</span>
                        </button>
                      </div>
                      <pre className="fc-modal-text-content">{previewItem.preview_text}</pre>
                    </div>
                  )}

                  {!['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'].includes(previewItem.ext) &&
                    !previewItem.preview_text && (
                      <div className="flex flex-col items-center gap-3 py-10 text-center">
                        <Icon name="file" size={42} className="text-[var(--fc-accent)]" />
                        <p className="text-sm text-slate-300">
                          Preview not available inline for .{previewItem.ext} files.
                        </p>
                        <a
                          href={api.converterDownloadUrl(previewItem.job_id)}
                          download={previewItem.filename}
                          className="fc-btn fc-btn-primary"
                        >
                          <Icon name="download" size={14} />
                          <span>Download File ({formatBytes(previewItem.size)})</span>
                        </a>
                      </div>
                    )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
