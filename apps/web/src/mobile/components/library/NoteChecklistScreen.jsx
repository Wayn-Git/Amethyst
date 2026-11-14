import { useState } from 'react'
import { INK, MUTED, BLUE, CARD_SHADOW } from './tokens.js'

export default function NoteChecklistScreen({
  item,
  onUpdate,
  showToast,
}) {
  const [noteText, setNoteText] = useState(item.notes || item.text_content || '')
  const [checklist, setChecklist] = useState(() => {
    if (Array.isArray(item.checklist)) return item.checklist
    if (typeof item.checklist === 'string') {
      try {
        const parsed = JSON.parse(item.checklist)
        if (Array.isArray(parsed)) return parsed
      } catch {}
    }
    return []
  })
  const [newItemText, setNewItemText] = useState('')
  const [saving, setSaving] = useState(false)

  const tags = Array.isArray(item.tags)
    ? item.tags
    : typeof item.tags === 'string'
    ? item.tags.split(',').map((t) => t.trim()).filter(Boolean)
    : []

  const completedCount = checklist.filter((c) => c.done).length

  const handleToggleCheck = async (index) => {
    const next = checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c))
    setChecklist(next)
    try {
      await onUpdate?.(item.id, { checklist: next })
    } catch {
      showToast?.('Could not update checklist')
    }
  }

  const handleAddItem = async () => {
    const text = newItemText.trim()
    if (!text) return
    const next = [...checklist, { text, done: false }]
    setChecklist(next)
    setNewItemText('')
    try {
      await onUpdate?.(item.id, { checklist: next })
      showToast?.('Item added')
    } catch {
      showToast?.('Could not add item')
    }
  }

  const handleSaveNotes = async () => {
    setSaving(true)
    try {
      await onUpdate?.(item.id, { notes: noteText })
      showToast?.('Note saved')
    } catch {
      showToast?.('Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title & Tags */}
      <div>
        <span style={{ fontSize: 13, color: MUTED }}>Edited recently</span>
        <h1 style={{ margin: '4px 0 8px', fontSize: 28, lineHeight: '34px', fontWeight: 800, letterSpacing: '-0.025em', color: INK }}>
          {item.title || 'Untitled Note'}
        </h1>

        {tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tags.map((t) => (
              <span key={t} style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10, background: '#E4EDFC', color: '#0A55C4' }}>
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Note Body */}
      <div style={{ background: '#fff', borderRadius: 22, padding: 16, boxShadow: CARD_SHADOW }}>
        <textarea
          rows={5}
          placeholder="Type your notes here…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          onBlur={handleSaveNotes}
          style={{
            width: '100%',
            border: 0,
            padding: 0,
            fontSize: 16,
            lineHeight: '26px',
            color: '#2C2C2E',
            fontFamily: 'inherit',
            outline: 'none',
            resize: 'none',
            boxSizing: 'border-box',
          }}
        />
        {saving && (
          <div style={{ fontSize: 12, color: MUTED, textAlign: 'right', marginTop: 4 }}>
            Saving…
          </div>
        )}
      </div>

      {/* Checklist Section */}
      <div style={{ background: '#fff', borderRadius: 22, padding: 16, boxShadow: CARD_SHADOW }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
            Checklist
          </span>
          <span style={{ fontSize: 13, fontWeight: 650, color: '#0A55C4' }}>
            {completedCount} of {checklist.length}
          </span>
        </div>

        {/* Progress bar */}
        {checklist.length > 0 && (
          <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#E5E5EA', overflow: 'hidden', marginBottom: 14 }}>
            <div
              style={{
                width: `${(completedCount / checklist.length) * 100}%`,
                height: '100%',
                background: '#0B5FD9',
                transition: 'width 0.25s',
              }}
            />
          </div>
        )}

        {/* Checklist items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {checklist.map((c, i) => (
            <div
              key={i}
              onClick={() => handleToggleCheck(i)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
                padding: '4px 0',
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  border: c.done ? 0 : '2px solid #C7C7CC',
                  background: c.done ? '#0B5FD9' : '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.2s',
                }}
              >
                {c.done && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </div>
              <span
                style={{
                  fontSize: 16,
                  color: c.done ? '#8E8E93' : INK,
                  textDecoration: c.done ? 'line-through' : 'none',
                }}
              >
                {c.text}
              </span>
            </div>
          ))}
        </div>

        {/* Add Item Row */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input
            type="text"
            placeholder="Add item…"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddItem()
            }}
            style={{
              flex: 1,
              height: 42,
              borderRadius: 12,
              border: '1px solid #D8D8DE',
              background: '#F2F2F7',
              padding: '0 12px',
              fontSize: 15,
              color: INK,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            disabled={!newItemText.trim()}
            onClick={handleAddItem}
            style={{
              height: 42,
              padding: '0 16px',
              borderRadius: 12,
              border: 0,
              background: '#0B5FD9',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: newItemText.trim() ? 'pointer' : 'default',
              opacity: newItemText.trim() ? 1 : 0.5,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
