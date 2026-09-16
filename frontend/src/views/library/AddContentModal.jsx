import { useEffect, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'

const SUPPORTED_FORMATS = ['PDF', 'EPUB', 'JPG', 'PNG', 'WEBP', 'TXT', 'MD', 'CSV']

export default function AddContentModal({
  open,
  initialMode = 'url',
  onClose,
  onSubmit,
  toast,
}) {
  const panelRef = useRef(null)
  const fileInputRef = useRef(null)
  const urlInputRef = useRef(null)
  useModalDismiss(open, onClose)

  const [mode, setMode] = useState(initialMode) // 'url' | 'file' | 'note' | 'wiki'
  const [urlInput, setUrlInput] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [noteContent, setNoteContent] = useState('')
  const [wikiTopic, setWikiTopic] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setMode(initialMode || 'url')
      setTimeout(() => urlInputRef.current?.focus(), 50)
    }
  }, [open, initialMode])

  // Extract URLs from pasted input
  const extractUrls = (text) => {
    if (!text) return []
    const tokens = text.split(/[\s,;\n\r]+/).map((t) => t.trim().replace(/^[<"'(]+|[>"'),;.]+$/g, '')).filter(Boolean)
    const results = []
    for (let u of tokens) {
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u) && u.includes('.')) {
        u = `https://${u}`
      }
      try {
        const parsed = new URL(u)
        if (parsed.hostname && parsed.hostname.includes('.') && !results.includes(parsed.href)) {
          results.push(parsed.href)
        }
      } catch {
        /* skip invalid */
      }
    }
    return results
  }

  // URL Submission
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

  // Note Submission
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

  // Wikipedia Submission
  const handleWikiSubmit = async (e) => {
    e?.preventDefault()
    const topic = wikiTopic.trim()
    if (!topic) {
      toast?.('Enter a topic name', 'bad')
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

  // File Upload Handlers
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
    if (e.type === 'dragover' || e.type === 'dragenter') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files)
    }
  }

  if (!open) return null

  return (
    <AnimatePresence>
      <div
        className="lib-modal-overlay"
        onMouseDown={(e) => onOverlayMouseDown(e, panelRef, onClose)}
      >
        <motion.div
          ref={panelRef}
          className="lib-modal-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Add content to library"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* Header */}
          <div className="lib-modal-header">
            <h2 className="lib-modal-title">
              <Icon name="plus" size={16} />
              <span>Add Knowledge Resource</span>
            </h2>
            <button
              type="button"
              className="lib-modal-close"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Mode Tabs */}
          <div style={{ padding: '16px 20px 0' }}>
            <div className="lib-modal-tabs">
              <button
                type="button"
                className={`lib-modal-tab ${mode === 'url' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setMode('url')}
              >
                <Icon name="link" size={14} />
                <span>Web Links</span>
              </button>
              <button
                type="button"
                className={`lib-modal-tab ${mode === 'file' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setMode('file')}
              >
                <Icon name="upload" size={14} />
                <span>Upload File</span>
              </button>
              <button
                type="button"
                className={`lib-modal-tab ${mode === 'note' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setMode('note')}
              >
                <Icon name="edit" size={14} />
                <span>Write Note</span>
              </button>
              <button
                type="button"
                className={`lib-modal-tab ${mode === 'wiki' ? 'lib-modal-tab--active' : ''}`}
                onClick={() => setMode('wiki')}
              >
                <Icon name="globe" size={14} />
                <span>Wikipedia</span>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="lib-modal-body">
            {mode === 'url' && (
              <form onSubmit={handleUrlSubmit} className="lib-form-group">
                <label className="lib-form-label" htmlFor="lib-url-input">
                  Paste URLs (Articles, YouTube, X, Spotify, GitHub, Papers...)
                </label>
                <textarea
                  id="lib-url-input"
                  ref={urlInputRef}
                  className="lib-form-textarea"
                  placeholder="https://example.com/article&#10;https://youtube.com/watch?v=...&#10;(Separate multiple URLs by newlines or spaces)"
                  rows={4}
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      handleUrlSubmit(e)
                    }
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  Supports multiple links simultaneously. Content is fetched, transcribed, and indexed for semantic search.
                </span>
              </form>
            )}

            {mode === 'file' && (
              <div
                className={`lib-dropzone ${dragActive ? 'lib-dropzone--active' : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFiles(e.target.files)}
                  accept=".pdf,.epub,.txt,.md,.csv,.jpg,.jpeg,.png,.webp,.mp4"
                />
                <div className="lib-dropzone-icon">
                  <Icon name="upload" size={20} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div className="lib-dropzone-title">Drop files here or click to browse</div>
                  <div className="lib-dropzone-sub" style={{ marginTop: 4 }}>
                    Supports {SUPPORTED_FORMATS.join(', ')} up to 50MB
                  </div>
                </div>
              </div>
            )}

            {mode === 'note' && (
              <form onSubmit={handleNoteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="lib-form-group">
                  <label className="lib-form-label" htmlFor="lib-note-title">Note Title</label>
                  <input
                    id="lib-note-title"
                    type="text"
                    className="lib-form-input"
                    placeholder="E.g., Architecture thoughts on vector memory"
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                  />
                </div>
                <div className="lib-form-group">
                  <label className="lib-form-label" htmlFor="lib-note-content">Note Content (Markdown)</label>
                  <textarea
                    id="lib-note-content"
                    className="lib-form-textarea"
                    placeholder="Write your notes, ideas, or references..."
                    rows={5}
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                  />
                </div>
              </form>
            )}

            {mode === 'wiki' && (
              <form onSubmit={handleWikiSubmit} className="lib-form-group">
                <label className="lib-form-label" htmlFor="lib-wiki-topic">
                  Wikipedia Article or Concept
                </label>
                <input
                  id="lib-wiki-topic"
                  type="text"
                  className="lib-form-input"
                  placeholder="E.g., Transformer (deep learning), Quantum computing"
                  value={wikiTopic}
                  onChange={(e) => setWikiTopic(e.target.value)}
                />
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                  Fetches the clean encyclopedia text and indexes key entities for your personal knowledge graph.
                </span>
              </form>
            )}
          </div>

          {/* Footer */}
          <div className="lib-modal-footer">
            <button
              type="button"
              className="lib-btn"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="lib-btn lib-btn--primary"
              disabled={busy}
              onClick={
                mode === 'url'
                  ? handleUrlSubmit
                  : mode === 'note'
                  ? handleNoteSubmit
                  : mode === 'wiki'
                  ? handleWikiSubmit
                  : () => fileInputRef.current?.click()
              }
            >
              {busy ? (
                <>
                  <span className="lib-card-spinner" style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Icon name="check" size={14} />
                  <span>{mode === 'file' ? 'Select File' : 'Add to Library'}</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
