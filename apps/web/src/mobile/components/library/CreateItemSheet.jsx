import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BottomSheet } from '../libraryUi.jsx'
import { api } from '../../../api.js'
import { BLUE, BLUE_PRESSED, BLUE_SOFT, CANVAS, INK, MUTED, KIND_COLORS } from './tokens.js'

export default function CreateItemSheet({ open, onClose, onSave, onSavedOpen, showToast }) {
  const [url, setUrl] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [detectedData, setDetectedData] = useState(null)
  const [selectedKind, setSelectedKind] = useState('video')
  const [selectedCollection, setSelectedCollection] = useState('Default')
  const [viewMode, setViewMode] = useState('main') // 'main' | 'more' | 'manual'
  const [manualType, setManualType] = useState('note')
  const [manualTitle, setManualTitle] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  // Auto-check clipboard when opened
  useEffect(() => {
    if (open) {
      setViewMode('main')
      setDetectedData(null)
      checkClipboard()
    } else {
      setUrl('')
      setDetectedData(null)
      setDetecting(false)
      setManualTitle('')
      setManualContent('')
    }
  }, [open])

  const checkClipboard = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text && (text.startsWith('http://') || text.startsWith('https://') || text.includes('.com') || text.includes('.org') || text.includes('youtu.be'))) {
          const trimmed = text.trim()
          setUrl(trimmed)
          runDetect(trimmed)
        }
      }
    } catch {
      // Non-blocking clipboard error
    }
  }

  const handlePaste = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText()
        if (text) {
          const trimmed = text.trim()
          setUrl(trimmed)
          runDetect(trimmed)
          return
        }
      }
    } catch {
      showToast?.('Paste manually into the field')
    }
  }

  const runDetect = async (targetUrl) => {
    if (!targetUrl || !targetUrl.trim()) return
    setDetecting(true)
    try {
      const res = await api.libraryDetect(targetUrl)
      if (res && res.url) {
        setDetectedData(res)
        setSelectedKind(res.detected_kind || 'article')
        if (res.suggested_collection) {
          setSelectedCollection(res.suggested_collection)
        }
      }
    } catch {
      // Fallback detection
      let kind = 'article'
      if (/youtube\.com|youtu\.be|vimeo\.com/i.test(targetUrl)) kind = 'video'
      else if (/recipe|cooking|food/i.test(targetUrl)) kind = 'recipe'
      else if (/imdb|themoviedb|letterboxd/i.test(targetUrl)) kind = 'movie'
      else if (/steam|ign|gamespot/i.test(targetUrl)) kind = 'game'
      else if (/goodreads|openlibrary/i.test(targetUrl)) kind = 'book'
      else if (/maps\.google|yelp/i.test(targetUrl)) kind = 'place'
      else if (/spotify|podcasts\.apple/i.test(targetUrl)) kind = 'podcast'
      else if (/amazon|etsy|shop/i.test(targetUrl)) kind = 'product'

      setDetectedData({
        url: targetUrl,
        title: targetUrl.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ') || 'Saved Link',
        detected_kind: kind,
        source: new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`).hostname.replace('www.', ''),
      })
      setSelectedKind(kind)
    } finally {
      setDetecting(false)
    }
  }

  const handleSaveDetected = async () => {
    if (saving) return
    setSaving(true)
    try {
      const payload = {
        url: detectedData?.url || url,
        title: detectedData?.title || 'Saved Link',
        kind: selectedKind || detectedData?.detected_kind || 'article',
        collection: selectedCollection,
        notes: '',
        tags: detectedData?.tags || [],
      }
      const saved = await api.createLibraryItem(payload)
      showToast?.(`Saved as ${payload.kind.charAt(0).toUpperCase() + payload.kind.slice(1)}`)
      onSave?.(saved)
      if (onSavedOpen) {
        onSavedOpen(saved)
      }
      onClose()
    } catch (err) {
      showToast?.(err.message || 'Could not save link')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveManual = async () => {
    if (!manualTitle.trim()) {
      showToast?.('Please enter a title')
      return
    }
    setSaving(true)
    try {
      const payload = {
        title: manualTitle.trim(),
        kind: manualType,
        notes: manualContent.trim(),
        tags: [],
      }
      const saved = await api.createLibraryItem(payload)
      showToast?.(`Created ${manualType}`)
      onSave?.(saved)
      if (onSavedOpen) {
        onSavedOpen(saved)
      }
      onClose()
    } catch (err) {
      showToast?.(err.message || 'Could not create item')
    } finally {
      setSaving(false)
    }
  }

  const kindBg = KIND_COLORS[selectedKind] || '#2B3040'

  return (
    <BottomSheet open={open} onClose={onClose} height="auto">
      <div style={{ padding: '4px 16px 28px', color: INK }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em' }}>
            {viewMode === 'more' ? 'More ways to add' : viewMode === 'manual' ? `New ${manualType}` : 'New save'}
          </h1>
          <button
            onClick={() => {
              if (viewMode !== 'main') setViewMode('main')
              else onClose()
            }}
            aria-label="Close"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              border: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.7)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              color: INK,
              cursor: 'pointer',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {viewMode === 'more' ? (
          /* createmore.html */
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '16px 2px 8px' }}>
              Save a link as
            </div>
            <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)' }}>
              {[
                { kind: 'video', label: 'Video', icon: 'M3 7a3 3 0 013-3h12a3 3 0 013 3v10a3 3 0 01-3 3H6a3 3 0 01-3-3zM10 9.5l5 2.5-5 2.5z' },
                { kind: 'article', label: 'Article', icon: 'M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4' },
                { kind: 'post', label: 'Post', icon: 'M4 5h16v11H9l-5 4z' },
                { kind: 'podcast', label: 'Podcast', icon: 'M12 2a4 4 0 00-4 4v5a4 4 0 008 0V6a4 4 0 00-4-4zM6 10v1a6 6 0 0012 0v-1M12 17v4' },
                { kind: 'product', label: 'Product', icon: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0' },
              ].map((item, idx) => (
                <div
                  key={item.kind}
                  onClick={() => {
                    setSelectedKind(item.kind)
                    setViewMode('main')
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    minHeight: 56,
                    padding: '0 16px',
                    borderTop: idx > 0 ? '1px solid #ECECF0' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 36, height: 36, borderRadius: 11, background: BLUE_SOFT, color: '#0A55C4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon} />
                    </svg>
                  </span>
                  <span style={{ flex: 1, fontSize: 16, fontWeight: 600 }}>{item.label}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
              ))}
            </div>

            <div style={{ fontSize: 13, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '24px 2px 8px' }}>
              Capture
            </div>
            <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)' }}>
              {[
                { label: 'Scan text', desc: 'Use camera to grab text', icon: 'M4 7V4h3M20 7V4h-3M4 17v3h3M20 17v3h-3M9 12h6' },
                { label: 'Photo', desc: 'Capture cover, page or note', icon: 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2zM12 17a4 4 0 100-8 4 4 0 000 8z' },
                { label: 'Voice note', desc: 'Record audio thought', icon: 'M12 2a4 4 0 00-4 4v5a4 4 0 008 0V6a4 4 0 00-4-4zM6 10v1a6 6 0 0012 0v-1M12 17v4' },
                { label: 'Import file', desc: 'PDF, EPUB, or document', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6' },
              ].map((item, idx) => (
                <div
                  key={item.label}
                  onClick={() => {
                    showToast?.(`${item.label} capture ready`)
                    onClose()
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    minHeight: 56,
                    padding: '0 16px',
                    borderTop: idx > 0 ? '1px solid #ECECF0' : 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ width: 36, height: 36, borderRadius: 11, background: '#E4F5EA', color: '#14703A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={item.icon} />
                    </svg>
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{item.label}</div>
                    <div style={{ fontSize: 12, color: MUTED }}>{item.desc}</div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
              ))}
            </div>
          </div>
        ) : viewMode === 'manual' ? (
          /* Manual Item Editor */
          <div>
            <div style={{ marginBottom: 14 }}>
              <input
                type="text"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="Title"
                style={{
                  width: '100%',
                  height: 52,
                  padding: '0 16px',
                  borderRadius: 16,
                  border: '1px solid #D8D8DE',
                  fontSize: 16,
                  fontWeight: 600,
                  boxSizing: 'border-box',
                  background: '#fff',
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 18 }}>
              <textarea
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                placeholder={manualType === 'checklist' ? 'List items (one per line)' : 'Notes or content...'}
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 16,
                  border: '1px solid #D8D8DE',
                  fontSize: 15,
                  boxSizing: 'border-box',
                  background: '#fff',
                  outline: 'none',
                  resize: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>
            <button
              onClick={handleSaveManual}
              disabled={saving}
              style={{
                width: '100%',
                height: 56,
                borderRadius: 16,
                border: 0,
                background: BLUE,
                color: '#fff',
                fontSize: 17,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {saving ? 'Saving...' : `Save ${manualType}`}
            </button>
          </div>
        ) : (
          /* create.html & createempty.html */
          <div>
            {/* Input field */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                height: 56,
                padding: '0 8px 0 16px',
                borderRadius: 16,
                background: '#fff',
                boxShadow: url ? '0 0 0 1.5px #0B5FD9' : '0 0 0 1px #D8D8DE',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: MUTED }}>
                <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (e.target.value.trim().length > 7) {
                    runDetect(e.target.value.trim())
                  } else {
                    setDetectedData(null)
                  }
                }}
                placeholder="Paste any link..."
                aria-label="Link"
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 0,
                  outline: 0,
                  background: 'transparent',
                  font: 'inherit',
                  fontSize: 16,
                  color: INK,
                }}
              />
              <button
                onClick={handlePaste}
                style={{
                  height: 40,
                  padding: '0 14px',
                  borderRadius: 10,
                  border: 0,
                  background: BLUE_SOFT,
                  color: '#0A55C4',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Paste
              </button>
            </div>

            {/* Link detected indicator */}
            {url && (
              <div style={{ margin: '12px 4px 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#0A55C4', fontWeight: 600 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                Link found on your clipboard
              </div>
            )}

            {/* Detected preview card (create.html) */}
            {detecting ? (
              <div style={{ marginTop: 18, padding: 14, borderRadius: 20, background: '#fff', display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ width: 88, height: 88, borderRadius: 14, background: '#E3E3E8', animation: 'pulse 1.5s infinite' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: 20, background: '#E3E3E8', borderRadius: 6, marginBottom: 8 }} />
                  <div style={{ height: 14, width: '60%', background: '#E3E3E8', borderRadius: 4 }} />
                </div>
              </div>
            ) : detectedData ? (
              <div>
                <div
                  style={{
                    marginTop: 18,
                    padding: 14,
                    borderRadius: 20,
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,.05),0 4px 14px rgba(0,0,0,.05)',
                    display: 'flex',
                    gap: 14,
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      flex: 'none',
                      width: 88,
                      height: 88,
                      borderRadius: 14,
                      background: kindBg,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {detectedData.thumbnail ? (
                      <img src={detectedData.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>
                        {selectedKind}
                      </span>
                    )}
                    {detectedData.duration && (
                      <span style={{ position: 'absolute', right: 6, bottom: 6, padding: '2px 6px', borderRadius: 7, fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(28,28,30,.78)' }}>
                        {detectedData.duration}
                      </span>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                    <span style={{ alignSelf: 'flex-start', height: 24, padding: '0 10px', borderRadius: 12, background: BLUE_SOFT, color: '#0A55C4', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                      {selectedKind.charAt(0).toUpperCase() + selectedKind.slice(1)} · detected
                    </span>
                    <div style={{ fontSize: 16, lineHeight: '22px', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {detectedData.title || url}
                    </div>
                    <div style={{ fontSize: 13, color: MUTED }}>
                      {detectedData.source || 'Web'}
                    </div>
                  </div>
                </div>

                {/* Suggested collection */}
                <div
                  style={{
                    marginTop: 14,
                    height: 56,
                    borderRadius: 16,
                    background: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '0 16px',
                    boxShadow: '0 1px 2px rgba(0,0,0,.05)',
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3A3A3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                  <span style={{ flex: 1, fontWeight: 600 }}>{selectedCollection}</span>
                  <span style={{ fontSize: 14, color: MUTED }}>Suggested</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 10l5 5 5-5" />
                  </svg>
                </div>

                {/* Save button */}
                <button
                  onClick={handleSaveDetected}
                  disabled={saving}
                  style={{
                    marginTop: 16,
                    width: '100%',
                    height: 56,
                    borderRadius: 16,
                    border: 0,
                    background: BLUE,
                    color: '#fff',
                    fontSize: 17,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {saving ? 'Saving...' : `Save as ${selectedKind.charAt(0).toUpperCase() + selectedKind.slice(1)}`}
                </button>
              </div>
            ) : (
              /* createempty.html helper text */
              <div style={{ margin: '14px 4px 0', fontSize: 14, lineHeight: '20px', color: MUTED }}>
                Paste a link and Amethyst picks the type, title, cover and collection for you. Or use Share from any app.
              </div>
            )}

            {/* "Or create something new" tiles grid */}
            <div style={{ fontSize: 13, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '32px 2px 12px' }}>
              Or create something new
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
              {[
                { type: 'note', label: 'Note', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h4' },
                { type: 'checklist', label: 'Checklist', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12.5l3 3 5-6' },
                { type: 'recipe', label: 'Recipe', icon: 'M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10' },
                { type: 'place', label: 'Place', icon: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z' },
                { type: 'book', label: 'Book', icon: 'M12 6c-2-1.5-5-2-8-2v13c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v13' },
                { type: 'movie', label: 'Movie', icon: 'M3 4h18v16H3zM7 4v16M17 4v16M3 12h18' },
                { type: 'game', label: 'Game', icon: 'M2.5 12.5a5.5 5.5 0 0111 0v1a5.5 5.5 0 01-11 0zM8 10.5v4M6 12.5h4' },
                { type: 'more', label: 'More', isMore: true, icon: 'M5 12h.01M12 12h.01M19 12h.01' },
              ].map((tile) => (
                <button
                  key={tile.label}
                  onClick={() => {
                    if (tile.isMore) {
                      setViewMode('more')
                    } else {
                      setManualType(tile.type)
                      setViewMode('manual')
                    }
                  }}
                  style={{
                    height: 80,
                    borderRadius: 18,
                    border: 0,
                    background: tile.isMore ? 'rgba(118,118,128,.12)' : '#fff',
                    boxShadow: tile.isMore ? 'none' : '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    fontSize: 13,
                    fontWeight: 650,
                    color: INK,
                    cursor: 'pointer',
                  }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={tile.icon} />
                  </svg>
                  {tile.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
