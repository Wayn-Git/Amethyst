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
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'ico', 'avif', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv', 'html', 'rtf', 'odt'].includes(ext)) return 'document'
  if (['mp4', 'webm', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'm4v'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'].includes(ext)) return 'audio'
  return 'other'
}

function getUntitledIconType(ext) {
  ext = (ext || '').toLowerCase().replace(/^\./, '')
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'ico', 'avif', 'svg'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'document'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'spreadsheet'
  if (['ppt', 'pptx'].includes(ext)) return 'presentation'
  if (['mp4', 'webm', 'mkv', 'mov', 'avi'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) return 'audio'
  if (['zip', 'tar', 'gz', 'rar'].includes(ext)) return 'archive'
  return 'file'
}

const CATEGORY_TABS = [
  { id: 'all', label: 'All Tools', icon: 'grid' },
  { id: 'image', label: 'Images', icon: 'image' },
  { id: 'pdf', label: 'PDF & Docs', icon: 'file' },
  { id: 'media', label: 'Video & Audio', icon: 'video' },
  { id: 'utilities', label: 'Utilities', icon: 'wrench' },
  { id: 'developer', label: 'Developer', icon: 'code' },
]

const ALL_TOOLS_CATALOG = [
  {
    id: 'files',
    category: 'all',
    title: 'Universal File Converter',
    desc: 'High-speed local file conversion pipeline. Convert images, audio, video, documents, and archives with zero quality degradation.',
    tags: ['PDF', 'DOCX', 'PNG', 'MP4', 'MP3'],
    icon: 'convert',
    isUniversal: true,
    span: 'hero',
    badge: 'Universal Core',
    accent: '#8b5cf6',
  },
  {
    id: 'pdf-tools',
    category: 'pdf',
    title: 'PDF Tools Hub',
    desc: 'Comprehensive local PDF suite: combine multiple PDFs, slice page ranges, compress document weights, and export to Word DOCX.',
    tags: ['MERGE', 'SPLIT', 'COMPRESS', 'WORD'],
    icon: 'file',
    component: 'pdf-tools',
    span: 'wide',
    badge: 'PyMuPDF V2',
    accent: '#ec4899',
  },
  {
    id: 'video-tools',
    category: 'media',
    title: 'Video & Audio Workshop',
    desc: 'Transcode MP4/WebM/MKV, generate frame-accurate animated GIFs, isolate lossless audio stems, and optimize bitrates.',
    tags: ['MP4', 'WEBM', 'GIF', 'COMPRESS'],
    icon: 'video',
    component: 'video-tools',
    span: 'wide',
    badge: 'FFmpeg Hardware',
    accent: '#f59e0b',
  },
  {
    id: 'ocr',
    category: 'utilities',
    title: 'OCR & Document Text Scanner',
    desc: 'Extract machine-readable structured text from scanned imagery, invoices, receipts, spreadsheets, and multi-page PDFs.',
    tags: ['OCR', 'EXTRACT', 'READ', 'TXT'],
    icon: 'type',
    component: 'ocr',
    span: 'wide',
    badge: 'Tesseract Engine',
    accent: '#06b6d4',
  },
  {
    id: 'image-resizer',
    category: 'image',
    title: 'Image Resizer & Compress',
    desc: 'Scale pixel dimensions, lock aspect ratios, apply WebP/AVIF compression, or generate preset asset sizes.',
    tags: ['RESIZE', 'COMPRESS', 'PRESETS'],
    icon: 'expand',
    component: 'image-resizer',
    span: 'normal',
    badge: 'Lanczos3 Interpolation',
    accent: '#10b981',
  },
  {
    id: 'image-converter',
    category: 'image',
    title: 'Image Format Converter',
    desc: 'Transform images between JPG, PNG, WebP, AVIF, GIF, ICO, or PDF with alpha-channel preservation.',
    tags: ['JPG', 'PNG', 'WEBP', 'AVIF'],
    icon: 'image',
    component: 'image-resizer',
    span: 'normal',
    badge: 'Lossless Pipeline',
    accent: '#3b82f6',
  },
  {
    id: 'document-converter',
    category: 'pdf',
    title: 'Document Transcoder',
    desc: 'Convert Word DOCX, PowerPoint PPTX, and Excel spreadsheets directly to PDF and plain text.',
    tags: ['DOCX', 'PPTX', 'XLSX', 'PDF'],
    icon: 'book',
    isUniversal: true,
    span: 'normal',
    badge: 'OpenXML Engine',
    accent: '#6366f1',
  },
  {
    id: 'audio-converter',
    category: 'media',
    title: 'Audio Converter & Extractor',
    desc: 'Isolate audio soundtracks from video or convert between MP3, WAV, AAC, FLAC, and OGG bitrates.',
    tags: ['MP3', 'WAV', 'AAC', 'AUDIO'],
    icon: 'speaker',
    component: 'video-tools',
    span: 'normal',
    badge: '320kbps Hi-Res',
    accent: '#a855f7',
  },
  {
    id: 'qr-code',
    category: 'utilities',
    title: 'QR Code Generator',
    desc: 'Generate crisp vector QR codes for URLs, Wi-Fi credentials, vCards, and plain text with SVG download.',
    tags: ['URL', 'WIFI', 'CONTACT', 'SVG'],
    icon: 'grid',
    component: 'qr-code',
    span: 'normal',
    badge: 'Vector SVG',
    accent: '#14b8a6',
  },
  {
    id: 'unit-converter',
    category: 'utilities',
    title: 'Unit Converter',
    desc: 'Precision conversion across 12 physical domains: length, mass, digital storage, speed, and volume.',
    tags: ['LENGTH', 'WEIGHT', 'VOLUME', 'STORAGE'],
    icon: 'arrows-left-right',
    component: 'unit-converter',
    span: 'normal',
    badge: '12 Dimensions',
    accent: '#f97316',
  },
  {
    id: 'timezone',
    category: 'utilities',
    title: 'Time Zones & World Clock',
    desc: 'Real-time multi-timezone conversion with live world clocks, DST tracking, and meeting planning offsets.',
    tags: ['WORLD CLOCK', 'UTC', 'OFFSETS'],
    icon: 'clock',
    component: 'timezone',
    span: 'normal',
    badge: 'Live UTC Grid',
    accent: '#0ea5e9',
  },
  {
    id: 'color-converter',
    category: 'developer',
    title: 'Color Converter & Contrast',
    desc: 'Two-way HEX, RGB, HSL, and CMYK transforms with WCAG AA/AAA contrast ratios and dynamic shade generator.',
    tags: ['HEX', 'RGB', 'HSL', 'WCAG'],
    icon: 'palette',
    component: 'color-converter',
    span: 'normal',
    badge: 'WCAG AAA Audit',
    accent: '#d946ef',
  },
  {
    id: 'code-formatter',
    category: 'developer',
    title: 'Code Formatter & Minifier',
    desc: 'Beautify, syntax-validate, or minify JSON, HTML, CSS, JavaScript, SQL, and XML with AST parsing.',
    tags: ['JSON', 'HTML', 'CSS', 'SQL', 'JS'],
    icon: 'code',
    component: 'code-formatter',
    span: 'normal',
    badge: 'AST Formatter',
    accent: '#eab308',
  },
  {
    id: 'text-tools',
    category: 'developer',
    title: 'Text Tools & Statistics',
    desc: 'Casing transformers (camel, kebab, snake, pascal), line deduplication, regex replace, and word counts.',
    tags: ['CASE', 'COUNT', 'CLEAN', 'REGEX'],
    icon: 'type',
    component: 'text-tools',
    span: 'normal',
    badge: 'Case & Stats',
    accent: '#84cc16',
  },
]

const SUBNAV_ITEMS = [
  { id: 'all', label: 'All Tools', icon: 'grid' },
  { id: 'files', label: 'File Converter', icon: 'convert' },
  { id: 'image-resizer', label: 'Image Resizer', icon: 'expand' },
  { id: 'pdf-tools', label: 'PDF Tools', icon: 'file' },
  { id: 'video-tools', label: 'Video & Audio', icon: 'video' },
  { id: 'ocr', label: 'OCR Extractor', icon: 'type' },
  { id: 'qr-code', label: 'QR Generator', icon: 'grid' },
  { id: 'unit-converter', label: 'Unit Converter', icon: 'arrows-left-right' },
  { id: 'timezone', label: 'Time Zones', icon: 'clock' },
  { id: 'color-converter', label: 'Color Converter', icon: 'palette' },
  { id: 'code-formatter', label: 'Code Formatter', icon: 'code' },
  { id: 'text-tools', label: 'Text Tools', icon: 'type' },
]

export default function Converter() {
  const { toast } = useApp()
  const fileInputRef = useRef(null)

  // Active View: 'all' | 'files' | 'image-resizer' | 'pdf-tools' | 'video-tools' | 'ocr' | 'qr-code' | 'unit-converter' | 'timezone' | 'color-converter' | 'code-formatter' | 'text-tools'
  const [activeView, setActiveView] = useState('all')

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
        targetFormat = ext === 'png' ? 'jpg' : 'png'
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
    // Switch to files view if files added
    if (activeView === 'all') {
      setActiveView('files')
    }
  }, [activeView])

  // Drag and drop handlers
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
    if (e.dataTransfer?.files?.length) {
      addFilesToQueue(e.dataTransfer.files)
    }
  }, [addFilesToQueue])

  // Process a single item
  const processItem = useCallback(async (itemId) => {
    const item = queue.find((i) => i.id === itemId)
    if (!item) return

    setQueue((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, status: 'uploading', uploadProgress: 0, error: null } : i))
    )

    try {
      let fileId = item.uploadedId
      if (!fileId) {
        const uploadRes = await api.converterUpload([item.file], (pct) => {
          setQueue((prev) =>
            prev.map((i) => (i.id === itemId ? { ...i, uploadProgress: pct } : i))
          )
        })
        fileId = uploadRes?.uploaded?.[0]?.file_id
        if (!fileId) throw new Error('Upload did not return a valid file ID')
      }

      setQueue((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, uploadedId: fileId, status: 'processing', uploadProgress: 100 } : i))
      )

      const res = await api.converterProcess({
        file_id: fileId,
        operation: item.operation,
        target_format: item.targetFormat,
        options: item.options,
      })

      setQueue((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? { ...i, status: 'completed', result: res, error: null }
            : i
        )
      )
      toast(`Successfully converted ${item.name}!`, 'good')
    } catch (err) {
      console.error('Processing error:', err)
      setQueue((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? { ...i, status: 'error', error: err.message || 'Operation failed' }
            : i
        )
      )
      toast(`Error processing ${item.name}: ${err.message}`, 'bad')
    }
  }, [queue, toast])

  const updateItem = useCallback((itemId, patch) => {
    setQueue((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, ...patch } : i))
    )
  }, [])

  const removeItem = useCallback((itemId) => {
    setQueue((prev) => {
      const target = prev.find((i) => i.id === itemId)
      if (target?.localThumb) {
        try { URL.revokeObjectURL(target.localThumb) } catch {}
      }
      return prev.filter((i) => i.id !== itemId)
    })
  }, [])

  const clearQueue = useCallback(() => {
    setQueue((prev) => {
      prev.forEach((i) => {
        if (i.localThumb) {
          try { URL.revokeObjectURL(i.localThumb) } catch {}
        }
      })
      return []
    })
  }, [])

  useEffect(() => {
    return () => {
      queue.forEach((i) => {
        if (i.localThumb) {
          try { URL.revokeObjectURL(i.localThumb) } catch {}
        }
      })
    }
  }, [queue])

  const totalQueueBytes = useMemo(() => queue.reduce((acc, i) => acc + (i.size || 0), 0), [queue])
  const completedCount = useMemo(() => queue.filter((i) => i.status === 'completed').length, [queue])

  const processAll = useCallback(() => {
    const readyItems = queue.filter((i) => i.status === 'ready' || i.status === 'error')
    readyItems.forEach((i) => processItem(i.id))
  }, [queue, processItem])

  const pdfItems = useMemo(() => queue.filter((i) => i.category === 'pdf'), [queue])
  const canMergePdfs = pdfItems.length >= 2

  const handleMergePdfs = useCallback(async () => {
    if (!canMergePdfs) return
    setBatchMerging(true)
    try {
      const uploadedIds = []
      for (const item of pdfItems) {
        if (item.uploadedId) {
          uploadedIds.push(item.uploadedId)
        } else {
          const up = await api.converterUpload([item.file])
          const fid = up.uploaded[0].file_id
          uploadedIds.push(fid)
          updateItem(item.id, { uploadedId: fid })
        }
      }

      const res = await api.converterProcess({
        file_ids: uploadedIds,
        operation: 'pdf_merge',
        options: { output_name: 'merged_documents.pdf' },
      })

      const mergedItem = {
        id: Math.random().toString(36).substring(2, 10),
        name: res.filename,
        size: res.size,
        ext: 'pdf',
        category: 'pdf',
        status: 'completed',
        result: res,
      }
      setQueue((prev) => [mergedItem, ...prev])
      toast('Merged PDF files successfully created!', 'good')
    } catch (err) {
      toast(`Failed to merge PDFs: ${err.message}`, 'bad')
    } finally {
      setBatchMerging(false)
    }
  }, [canMergePdfs, pdfItems, updateItem, toast])

  const getAvailableTargets = (item) => {
    const cat = item.category
    if (cat === 'image') return ['png', 'jpg', 'webp', 'avif', 'gif', 'ico', 'tiff', 'bmp', 'pdf']
    if (cat === 'pdf') return ['png', 'jpg', 'txt', 'docx']
    if (cat === 'document') return ['pdf', 'txt', 'md', 'html']
    if (cat === 'video') return ['mp4', 'webm', 'mkv', 'mov', 'gif', 'mp3', 'wav', 'aac']
    if (cat === 'audio') return ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a']
    return ['pdf', 'txt']
  }

  const getQuickTargets = (category) => {
    if (category === 'image') return ['png', 'jpg', 'webp', 'pdf']
    if (category === 'pdf') return ['png', 'txt', 'docx']
    if (category === 'document') return ['pdf', 'txt', 'md']
    if (category === 'video') return ['mp4', 'webm', 'gif', 'mp3']
    if (category === 'audio') return ['mp3', 'wav', 'aac', 'flac']
    return ['pdf', 'txt']
  }

  const setAllTargets = useCallback((target) => {
    setQueue((prev) =>
      prev.map((item) => {
        const available = getAvailableTargets(item)
        if (available.includes(target)) {
          return { ...item, targetFormat: target, operation: 'convert' }
        }
        return item
      })
    )
    toast(`Set target to .${target} for eligible files`, 'info')
  }, [toast])

  // 60fps GPU compositor spotlight tracking (Zero React state re-renders)
  const handleCardPointerMove = useCallback((e) => {
    const card = e.currentTarget
    const rect = card.getBoundingClientRect()
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }, [])

  const handleDropzonePointerMove = useCallback((e) => {
    const shell = e.currentTarget
    const rect = shell.getBoundingClientRect()
    shell.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`)
    shell.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`)
  }, [])

  // Handle clicking a tool from the directory or subnav
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

  return (
    <div className="fc-page">
      <div className="fc-container">
      {/* 1. Header Section */}
      <div className="fc-header">
        <div className="fc-eyebrow-row">
          <span className="fc-eyebrow-tag">
            <Icon name="wrench" size={12} />
            Universal Studio · Local Processing
          </span>
          <span className="fc-local-badge">
            <span className="fc-local-dot" />
            Zero Cloud Telemetry · 100% Private
          </span>
        </div>

        <h1 className="fc-title">File Converter & Processing Suite</h1>
        <p className="fc-subtitle">
          Instant local format transcoding, compression, and developer utilities with machine-native performance.
        </p>
      </div>

      {/* 2. Top Sub-Navigation Bar with Liquid Sliding Pill */}
      <div className="fc-subnav">
        {SUBNAV_ITEMS.map((item) => {
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              type="button"
              className={`fc-subnav-tab${isActive ? ' is-active' : ''}`}
              onClick={() => setActiveView(item.id)}
            >
              {isActive && (
                <motion.div
                  layoutId="subnavActiveIndicator"
                  className="fc-subnav-pill"
                  transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                />
              )}
              <Icon name={item.icon} size={15} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* 3. Breadcrumb Bar when in a dedicated sub-view */}
      {activeView !== 'all' && (
        <div className="fc-breadcrumb-bar">
          <button
            type="button"
            className="fc-breadcrumb-btn"
            onClick={() => setActiveView('all')}
          >
            <Icon name="arrow-left" size={14} />
            <span>Back to All Tools Directory</span>
          </button>
          <div className="fc-breadcrumb-crumb">
            <span className="text-slate-500 font-mono text-xs">Directory /</span>
            <span className="fc-breadcrumb-current">
              {SUBNAV_ITEMS.find((s) => s.id === activeView)?.label || 'Tool Workspace'}
            </span>
          </div>
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
          {/* Drag & Drop Upload Zone */}
          <div className="fc-upload-section">
            <div
              className={`fc-dropzone-shell${isDragging ? ' is-dragging' : ''}`}
              onPointerMove={handleDropzonePointerMove}
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

                <div className="fc-drop-icon-box">
                  <Icon name="upload" size={22} />
                </div>

                <div className="fc-drop-prompt">
                  <span className="fc-drop-main-text">
                    Drop files here to convert, or <span>choose from device</span>
                  </span>
                  <span className="fc-drop-sub-text">
                    Zero cloud telemetry · Local FFmpeg, PyMuPDF, LibreOffice, and Pillow engines
                  </span>
                </div>

                <div className="fc-format-chips">
                  {['PDF', 'DOCX', 'XLSX', 'PPTX', 'PNG', 'JPG', 'WEBP', 'MP4', 'MP3', 'WAV', 'GIF', 'CSV'].map((fmt) => (
                    <span key={fmt} className="fc-format-chip">
                      .{fmt.toLowerCase()}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Active Queue & Files Workspace */}
          {queue.length > 0 && (
            <div className="fc-queue-section">
              <div className="fc-queue-header">
                <div className="fc-queue-headline">
                  <h2 className="fc-queue-title">Workspace Files</h2>
                  <span className="fc-queue-metrics">
                    {queue.length} {queue.length === 1 ? 'file' : 'files'} · {formatBytes(totalQueueBytes)}
                  </span>
                  {completedCount > 0 && (
                    <span className="fc-queue-metrics text-emerald-400">
                      <Icon name="check" size={12} />
                      {completedCount} converted
                    </span>
                  )}
                </div>

                <div className="fc-batch-bar">
                  <div className="fc-batch-target-group">
                    <span>Batch format:</span>
                    <div className="fc-target-chips">
                      {['pdf', 'webp', 'jpg', 'png', 'mp3'].map((tgt) => (
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
                      title="Combine all PDFs into one"
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
                    <span>Add Files</span>
                  </button>

                  <button
                    type="button"
                    className="fc-btn fc-btn-danger-ghost"
                    onClick={clearQueue}
                    title="Clear all workspace files"
                  >
                    <Icon name="trash" size={14} />
                    <span>Clear</span>
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
                        initial={{ opacity: 0, y: 8, scale: 0.99 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
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
                                <div className={`fc-file-icon-box is-${item.category}`}>
                                  <FileIcon type={getUntitledIconType(item.ext)} theme="dark" size={20} />
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
                                <Icon name="x" size={14} />
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
                                    <optgroup label="Other Formats">
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
                                        <option value="25">25% (Thumb)</option>
                                        <option value="50">50% (Half)</option>
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
                                    ? `Uploading to local workspace… ${item.uploadProgress}%`
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
                                <Icon name="check" size={15} />
                                <span className="fc-result-name">{item.result.filename}</span>
                                <span className="fc-result-delta">
                                  {formatBytes(item.result.size)}
                                  {item.size > 0 && item.result.size !== item.size && (
                                    <span className="ml-1 opacity-80">
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
                                <Icon name="alert" size={15} />
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

          {/* Directory Bento Grid (Only shown when activeView === 'all') */}
          {activeView === 'all' && (
            <div className="fc-tools-section">
              <div className="fc-section-title-row">
                <h2 className="fc-section-title">All Tools & Workflows (JustConvert Suite)</h2>
                <span className="fc-tools-count">{filteredTools.length} tools</span>
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
                    placeholder="Search tools, formats, utilities…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="fc-tools-grid">
                {filteredTools.map((tool) => (
                  <div
                    key={tool.id}
                    className="fc-tool-card"
                    onClick={() => handleOpenTool(tool.id)}
                  >
                    <div className="fc-tool-card-top">
                      <div className="fc-tool-icon-box">
                        <Icon name={tool.icon} size={20} />
                      </div>
                      <div className="fc-tool-top-meta">
                        <span className="fc-tool-badge">{tool.badge}</span>
                        <div className="fc-tool-arrow-circle">
                          <Icon name="arrow-up-right" size={14} className="fc-tool-arrow" />
                        </div>
                      </div>
                    </div>

                    <div className="fc-tool-text-group">
                      <div className="fc-tool-name">{tool.title}</div>
                      <div className="fc-tool-desc">{tool.desc}</div>
                    </div>

                    <div className="fc-tool-tags">
                      {tool.tags.map((tag) => (
                        <span key={tag} className="fc-tool-tag">
                          {tag}
                        </span>
                      ))}
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
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
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
                    <Icon name="speaker" size={48} className="text-[var(--accent)]" />
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
                      <Icon name="file" size={42} className="text-[var(--accent)]" />
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
