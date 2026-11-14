import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { BottomSheet } from '../libraryUi.jsx'
import { DEEP_BLUE } from './tokens.js'

const CHIP_BLUE_BG = '#E4EDFC'
const CHIP_BLUE_TX = DEEP_BLUE

const CREATE_TILES = [
  { kind: 'video', label: 'Video', bg: CHIP_BLUE_BG, fg: CHIP_BLUE_TX, icon: 'M3 7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM10 9.5l5 2.5-5 2.5z' },
  { kind: 'article', label: 'Article', bg: '#E4EDFC', fg: '#0A55C4', icon: 'M5 4h14v16H5zM8.5 8.5h7M8.5 12h7M8.5 15.5h4' },
  { kind: 'post', label: 'Post', bg: '#E4F5EA', fg: '#14703A', icon: 'M4 5h16v11H9l-5 4z' },
  { kind: 'movie', label: 'Movie', bg: '#E4EDFC', fg: '#0A55C4', icon: 'M3 9.5a2.5 2.5 0 0 1 2.5-2.5h13A2.5 2.5 0 0 1 21 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 15.5zM3 9l2-5 4 1-2 4M9 5l4 1-2 3M13 6l4 1-2 3' },
  { kind: 'recipe', label: 'Recipe', bg: '#FDEBDD', fg: '#A8480E', icon: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10' },
  { kind: 'game', label: 'Game', bg: '#DDF1F3', fg: '#0B5560', icon: 'M3 12.5a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5 5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM8 10v4M6 12h4M15.5 11h.01M18 13.5h.01' },
  { kind: 'note', label: 'Note', bg: '#E4EDFC', fg: '#0A55C4', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M10 13h4M10 17h4' },
  { kind: 'checklist', label: 'Checklist', bg: '#E4F5EA', fg: '#14703A', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
]

export default function CreateItemSheet({ open, onClose, onSave, showToast }) {
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [mode, setMode] = useState(null) // null | kind
  const [checklist, setChecklist] = useState([])
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setMode(null)
      setUrl('')
      setTitle('')
      setNotes('')
      setChecklist([])
    }
  }, [open])

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setUrl(text.trim())
        inputRef.current?.focus()
      }
    } catch {
      showToast?.('Clipboard unavailable — paste manually')
    }
  }

  const handleSave = async () => {
    if (saving) return
    const trimmedUrl = url.trim()
    if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl) && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}/i.test(trimmedUrl)) {
      showToast?.('That does not look like a link')
      return
    }
    if (!trimmedUrl && !title.trim()) {
      showToast?.('Add a link or a title first')
      return
    }
    setSaving(true)
    try {
      const kind = mode === 'checklist' ? 'note' : mode
      const payload = {
        title: title.trim() || undefined,
        url: trimmedUrl || undefined,
        notes: notes.trim() || undefined,
      }
      if (kind) payload.kind = kind
      if (mode === 'checklist' && checklist.length) {
        payload.checklist = checklist
      }

      await onSave?.(payload)
      onClose()
    } catch (err) {
      showToast?.(err?.message || 'Could not save item')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} label="New save" headTitle="New save">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
        {/* Link input row */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#636366', marginBottom: 6 }}>
            Link
          </div>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{
                width: '100%',
                height: 52,
                borderRadius: 14,
                border: '1px solid #D8D8DE',
                background: '#fff',
                padding: '0 80px 0 16px',
                fontSize: 16,
                color: '#151517',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={pasteFromClipboard}
              style={{
                position: 'absolute',
                right: 6,
                height: 40,
                padding: '0 14px',
                borderRadius: 20,
                border: 0,
                background: '#E4EDFC',
                color: '#0A55C4',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Paste
            </button>
          </div>
        </div>

        {/* Start from scratch tiles */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#636366', marginBottom: 8 }}>
            Or start from scratch
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {CREATE_TILES.map((tile) => (
              <button
                key={tile.kind}
                type="button"
                style={{
                  height: 74,
                  borderRadius: 16,
                  border: mode === tile.kind ? '2px solid #0B5FD9' : '1px solid #D8D8DE',
                  background: '#fff',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  padding: 4,
                  boxSizing: 'border-box',
                }}
                onClick={() => setMode(mode === tile.kind ? null : tile.kind)}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: tile.bg,
                    color: tile.fg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={tile.icon} />
                  </svg>
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#151517' }}>{tile.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Optional manual composer fields */}
        {mode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="text"
              placeholder={`Title for this ${mode}…`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                width: '100%',
                height: 48,
                borderRadius: 12,
                border: '1px solid #D8D8DE',
                background: '#fff',
                padding: '0 14px',
                fontSize: 15,
                color: '#151517',
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
            <textarea
              placeholder="Notes or description…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                borderRadius: 12,
                border: '1px solid #D8D8DE',
                background: '#fff',
                padding: '10px 14px',
                fontSize: 15,
                color: '#151517',
                boxSizing: 'border-box',
                outline: 'none',
                fontFamily: 'inherit',
                resize: 'none',
              }}
            />
          </div>
        )}

        {/* Primary Save Button */}
        <button
          type="button"
          disabled={saving || (!url.trim() && !title.trim())}
          onClick={handleSave}
          style={{
            height: 52,
            borderRadius: 14,
            border: 0,
            background: '#0B5FD9',
            color: '#fff',
            fontSize: 17,
            fontWeight: 700,
            cursor: saving ? 'default' : 'pointer',
            opacity: saving || (!url.trim() && !title.trim()) ? 0.6 : 1,
            marginTop: 4,
          }}
        >
          {saving ? 'Saving…' : 'Save to Library'}
        </button>
      </div>
    </BottomSheet>
  )
}
