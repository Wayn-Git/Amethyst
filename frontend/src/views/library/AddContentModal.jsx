import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'

const SUPPORTED_FORMATS = ['PDF', 'JPG', 'PNG', 'WEBP', 'HEIC', 'TXT', 'MD', 'CSV']

const EXAMPLES = [
  { label: 'YouTube video', icon: 'image', sample: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { label: 'Spotify track', icon: 'music', sample: 'https://open.spotify.com/track/sample' },
  { label: 'Spotify podcast', icon: 'spark', sample: 'https://open.spotify.com/episode/sample' },
  { label: 'Apple Podcast', icon: 'spark', sample: 'https://podcasts.apple.com/podcast/sample' },
  { label: 'News article', icon: 'book', sample: 'https://algoarena.net/blog' },
  { label: 'PDF document', icon: 'edit', sample: '' },
  { label: 'RSS feed', icon: 'link', sample: '' },
]

export default function AddContentModal({
  open,
  initialMode = 'url',
  onClose,
  onSubmit,
  toast,
}) {
  const panelRef = useRef(null)
  const fileInputRef = useRef(null)
  useModalDismiss(open, onClose)

  const [mode, setMode] = useState(initialMode) // 'url' | 'note' | 'wiki'
  const [urlInput, setUrlInput] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [wikiTopic, setWikiTopic] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setMode(initialMode || 'url')
    }
  }, [open, initialMode])



  // Normalize candidate URL string (strips trailing punctuation, guarantees scheme)
  const normalizeCandidate = (raw) => {
    let u = (raw || '').trim().replace(/^[<"'(]+|[>"'),;.]+$/g, '')
    if (!u) return null
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) {
      u = `https://${u}`
    }
    try {
      const parsed = new URL(u)
      if (!parsed.hostname || !parsed.hostname.includes('.')) return null
      return parsed.href
    } catch {
      return null
    }
  }

  // Extract all valid HTTP/HTTPS URLs from pasted text (handles newlines, commas, bare domains like pin.it, dust.tt)
  const extractUrls = (text) => {
    if (!text) return []
    const results = []
    const addIfValid = (candidate) => {
      const norm = normalizeCandidate(candidate)
      if (norm && !results.includes(norm)) {
        results.push(norm)
      }
    }

    // Split on whitespace, commas, or newlines
    const tokens = text.split(/[\s,;\n\r]+/).map((t) => t.trim()).filter(Boolean)
    for (const token of tokens) {
      addIfValid(token)
    }

    // Also regex match any URLs embedded in prose
    const matches = text.match(/https?:\/\/[^\s<>"'()]+|\b[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"'()]*)?/gi) || []
    for (const m of matches) {
      addIfValid(m)
    }

    return results
  }

  // Handle URL submission
  const handleUrlSubmit = async (e) => {
    e?.preventDefault()
    const urls = extractUrls(urlInput)

    if (!urls.length) {
      toast?.('Please enter at least one valid web link', 'bad')
      return
    }

    setBusy(true)
    try {
      if (urls.length === 1) {
        await onSubmit?.({ url: urls[0] })
      } else {
        toast?.(`Adding ${urls.length} links to library...`, 'ok')
        for (const u of urls.slice(0, 10)) {
          await onSubmit?.({ url: u })
        }
      }
      setUrlInput('')
      onClose()
    } catch (err) {
      toast?.(err.message || 'Could not capture URL', 'bad')
    } finally {
      setBusy(false)
    }
  }

  // Handle Note submission
  const handleNoteSubmit = async (e) => {
    e?.preventDefault()
    if (!noteTitle.trim() && !noteContent.trim()) {
      toast?.('Note title or content is required', 'bad')
      return
    }

    setBusy(true)
    try {
      await onSubmit?.({
        title: noteTitle.trim() || 'Quick Note',
        kind: 'note',
        category: 'general',
        notes: noteContent.trim(),
        text: noteContent.trim(),
      })
      setNoteTitle('')
      setNoteContent('')
      onClose()
    } catch (err) {
      toast?.(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  // Handle Wikipedia submission
  const handleWikiSubmit = async (e) => {
    e?.preventDefault()
    const topic = wikiTopic.trim()
    if (!topic) {
      toast?.('Enter a Wikipedia topic or article title', 'bad')
      return
    }

    let targetUrl = topic
    if (!/^https?:\/\//i.test(topic)) {
      const slug = encodeURIComponent(topic.replace(/\s+/g, '_'))
      targetUrl = `https://en.wikipedia.org/wiki/${slug}`
    }

    setBusy(true)
    try {
      await onSubmit?.({
        url: targetUrl,
        title: topic.replace(/^https?:\/\/[^/]+\/wiki\//i, '').replace(/_/g, ' '),
        kind: 'article',
        category: 'general',
      })
      setWikiTopic('')
      onClose()
    } catch (err) {
      toast?.(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  // Handle File Upload (Drag & Drop or Browse)
  const handleFiles = async (files) => {
    if (!files || !files.length) return
    const file = files[0]
    setBusy(true)
    try {
      toast?.(`Uploading ${file.name}...`, 'ok')
      const uploaded = await api.upload(file)

      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      let kind = 'article'
      if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)) kind = 'image'
      else if (['mp4', 'mov', 'webm'].includes(ext)) kind = 'video'
      else if (['pdf', 'epub'].includes(ext)) kind = 'book'
      else if (['txt', 'md'].includes(ext)) kind = 'note'

      await onSubmit?.({
        title: file.name.replace(/\.[^/.]+$/, ''),
        kind,
        category: 'general',
        notes: `Uploaded file: ${file.name} (${Math.round((file.size || 0) / 1024)} KB)`,
        text: uploaded?.name || file.name,
      })

      toast?.(`Added ${file.name} to library`, 'ok')
      onClose()
    } catch (err) {
      toast?.(err.message || 'File upload failed', 'bad')
    } finally {
      setBusy(false)
    }
  }

  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragover' || e.type === 'dragenter') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  const canCreate =
    mode === 'url'
      ? Boolean(urlInput.trim())
      : mode === 'note'
      ? Boolean(noteTitle.trim() || noteContent.trim())
      : Boolean(wikiTopic.trim())

  const handlePrimarySubmit = (e) => {
    if (mode === 'url') handleUrlSubmit(e)
    else if (mode === 'note') handleNoteSubmit(e)
    else if (mode === 'wiki') handleWikiSubmit(e)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="modal-overlay"
          onMouseDown={onOverlayMouseDown(onClose)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="modal add-content-modal"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Add Content"
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Modal Header */}
        <div className="add-content-head">
          <h2 className="add-content-title">Add Content</h2>
          <div className="add-content-head-right">
            <span className="add-content-esc mono">ESC</span>
            <button
              type="button"
              className="icon-btn modal-close"
              onClick={onClose}
              aria-label="Close modal"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="add-content-body">
          {/* Mode 1: URL / Links Mode */}
          {mode === 'url' && (
            <div className="add-content-url-pane">
              {/* Top Textarea with Coral Highlight border */}
              <div className="add-content-input-wrap">
                <Icon name="link" size={16} className="add-content-link-icon" />
                <textarea
                  className="add-content-textarea"
                  placeholder="Paste up to 10 links: YouTube videos, articles, or podcasts"
                  rows={2}
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleUrlSubmit()
                    }
                  }}
                  autoFocus
                />
              </div>

              {/* Examples row */}
              <div className="add-content-examples-section">
                <div className="add-content-examples-head">
                  <span className="add-content-label mono">EXAMPLES</span>
                  <span className="add-content-link-hint">
                    See all supported content ↗
                  </span>
                </div>
                <div className="add-content-pills">
                  {EXAMPLES.map((ex) => (
                    <button
                      type="button"
                      key={ex.label}
                      className="add-content-pill"
                      onClick={() => ex.sample && setUrlInput(ex.sample)}
                      title={ex.sample ? `Insert sample: ${ex.sample}` : ex.label}
                    >
                      <Icon name={ex.icon} size={12} />
                      <span>{ex.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Drag & Drop File Upload Zone */}
              <div
                className={`add-content-dropzone ${dragActive ? 'add-content-dropzone--active' : ''}`}
                onDragOver={handleDrag}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    fileInputRef.current?.click()
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFiles(e.target.files)}
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.txt,.md,.csv,.epub"
                />
                <div className="add-content-cloud-icon">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
                    <path d="M12 12v9" />
                    <path d="m16 16-4-4-4 4" />
                  </svg>
                </div>

                <div className="add-content-drop-label">
                  Drop a file here, or <span className="add-content-browse">browse</span>
                </div>

                <div className="add-content-formats mono">
                  {SUPPORTED_FORMATS.map((fmt) => (
                    <span key={fmt} className="add-content-format-pill">
                      {fmt}
                    </span>
                  ))}
                </div>

                <div className="add-content-bulk-tag mono">
                  <span>Bulk upload</span>
                  <span className="add-content-plus-badge">Plus</span>
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Quick Note Mode */}
          {mode === 'note' && (
            <div className="add-content-note-pane">
              <div className="add-content-note-head">
                <input
                  className="lib-input add-content-title-input"
                  placeholder="Note title (e.g. System Design Thoughts)"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  autoFocus
                />
              </div>
              <textarea
                className="lib-input add-content-note-textarea"
                placeholder="Write your markdown note, thoughts, or ideas here..."
                rows={6}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
              />
            </div>
          )}

          {/* Mode 3: Wikipedia Mode */}
          {mode === 'wiki' && (
            <div className="add-content-wiki-pane">
              <div className="add-content-wiki-intro">
                <span className="mono add-content-wiki-badge">Wikipedia Instant Capture</span>
                <p className="add-content-wiki-desc">
                  Enter any topic, concept, or Wikipedia page title to import and index it automatically.
                </p>
              </div>
              <div className="add-content-input-wrap">
                <Icon name="globe" size={16} className="add-content-link-icon" />
                <input
                  className="lib-input add-content-wiki-input"
                  placeholder="e.g. A* search algorithm, Quantum computing, Isaac Newton"
                  value={wikiTopic}
                  onChange={(e) => setWikiTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleWikiSubmit(e)
                  }}
                  autoFocus
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Action Footer */}
        <div className="add-content-footer">
          <div className="add-content-footer-left">
            <button
              type="button"
              className={`add-content-mode-btn ${mode === 'note' ? 'add-content-mode-btn--active' : ''}`}
              onClick={() => setMode(mode === 'note' ? 'url' : 'note')}
            >
              <Icon name="edit" size={14} />
              <span>Note</span>
            </button>
            <button
              type="button"
              className={`add-content-mode-btn ${mode === 'wiki' ? 'add-content-mode-btn--active' : ''}`}
              onClick={() => setMode(mode === 'wiki' ? 'url' : 'wiki')}
            >
              <Icon name="globe" size={14} />
              <span>Wiki</span>
            </button>
            <button
              type="button"
              className={`add-content-mode-btn ${mode === 'url' ? 'add-content-mode-btn--active' : ''}`}
              onClick={() => setMode('url')}
            >
              <Icon name="link" size={14} />
              <span>Links / Upload</span>
            </button>
          </div>

          <div className="add-content-footer-right">
            <button
              type="button"
              className="btn add-content-create-btn"
              disabled={!canCreate || busy}
              onClick={handlePrimarySubmit}
            >
              {busy ? 'Creating...' : 'Create'}
            </button>
          </div>
                </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  )
}
