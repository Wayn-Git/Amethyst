import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../../api.js'
import { HeaderCircleButton, SectionLabel, BottomSheet } from '../libraryUi.jsx'
import { INK, MUTED, BLUE, BLUE_SOFT, DEEP_BLUE, CARD_SHADOW, LINE, GLASS_STYLE } from './tokens.js'

export default function TagManagerSheet({
  open,
  onClose,
  showToast,
}) {
  const [tags, setTags] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [editingTag, setEditingTag] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [newTagInput, setNewTagInput] = useState('')
  const [showNewTagModal, setShowNewTagModal] = useState(false)

  const loadTags = () => {
    setLoading(true)
    api
      .libraryTags()
      .then((res) => {
        setTags(res?.tags || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (open) loadTags()
  }, [open])

  const filteredTags = useMemo(() => {
    if (!search.trim()) return tags
    const q = search.toLowerCase()
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, search])

  const handleRename = async () => {
    if (!editingTag || !renameValue.trim()) return
    try {
      await api.libraryRenameTag(editingTag.name, renameValue.trim())
      showToast?.(`Renamed #${editingTag.name} to #${renameValue.trim()}`)
      setEditingTag(null)
      loadTags()
    } catch (err) {
      showToast?.(`Rename failed: ${err.message}`)
    }
  }

  const handleDelete = async (tag) => {
    try {
      await api.libraryDeleteTag(tag.name)
      showToast?.(`Removed #${tag.name} from all saves`)
      loadTags()
    } catch (err) {
      showToast?.(`Delete failed: ${err.message}`)
    }
  }

  const handleCreateTag = async () => {
    const name = newTagInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!name) return
    setTags((prev) => [{ name, count: 0 }, ...prev])
    setNewTagInput('')
    setShowNewTagModal(false)
    showToast?.(`Tag #${name} created`)
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#F2F2F7',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Bar with Back & Merge button */}
      <div
        style={{
          padding: 'max(52px, env(safe-area-inset-top, 0px)) 16px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <HeaderCircleButton label="Back" size={44} onClick={onClose}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </HeaderCircleButton>

        <button
          type="button"
          onClick={() => showToast?.('Tags merged')}
          style={{
            height: 40,
            padding: '0 16px',
            borderRadius: 20,
            border: 0,
            background: 'rgba(255,255,255,.55)',
            color: INK,
            fontSize: 15,
            fontWeight: 650,
            cursor: 'pointer',
            ...GLASS_STYLE,
          }}
        >
          Merge
        </button>
      </div>

      {/* Title & Count */}
      <div style={{ padding: '0 16px 12px' }}>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: '-0.03em', color: INK }}>
          Tags
        </h1>
        <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>
          {tags.length} {tags.length === 1 ? 'tag' : 'tags'} used across your library
        </div>

        {/* Find a tag search field */}
        <div
          style={{
            marginTop: 16,
            height: 48,
            borderRadius: 14,
            background: '#FFFFFF',
            boxShadow: '0 0 0 1px #E3E3E8',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: 8,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a tag"
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              background: 'transparent',
              fontSize: 16,
              color: INK,
            }}
          />
        </div>
      </div>

      {/* Suggested Merge Card (Page 32) */}
      {tags.length >= 2 && (
        <div style={{ padding: '0 16px 12px' }}>
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 20,
              background: '#FFFFFF',
              boxShadow: CARD_SHADOW,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: MUTED }}>Suggested</div>
              <div style={{ fontSize: 15, fontWeight: 650, color: INK, marginTop: 2 }}>
                Merge #{tags[0].name} and #{tags[1].name}?
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await api.libraryMergeTags([tags[1].name], tags[0].name)
                showToast?.(`Merged #${tags[1].name} into #${tags[0].name}`)
                loadTags()
              }}
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 18,
                background: BLUE_SOFT,
                color: DEEP_BLUE,
                border: 0,
                fontSize: 14,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Merge
            </button>
          </div>
        </div>
      )}

      {/* Scrollable list of tags */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '0 16px 80px',
        }}
      >
        <SectionLabel text="All tags" style={{ margin: '14px 4px 10px' }} />
        <div style={{ borderRadius: 22, background: '#FFFFFF', boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          {filteredTags.map((tag, i) => (
            <div
              key={tag.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                minHeight: 56,
                padding: '0 16px',
                borderBottom: i === filteredTags.length - 1 ? 'none' : `1px solid ${LINE}`,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: BLUE_SOFT,
                  color: DEEP_BLUE,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                  flex: 'none',
                }}
              >
                #
              </span>
              <span style={{ flex: 1, fontSize: 16, fontWeight: 600, color: INK }}>{tag.name}</span>
              <span style={{ fontSize: 14, color: MUTED }}>{tag.count} items</span>
              <button
                type="button"
                onClick={() => {
                  setEditingTag(tag)
                  setRenameValue(tag.name)
                }}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 8,
                  color: '#8E8E93',
                  cursor: 'pointer',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Floating Glass "New tag" button */}
      <div
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
          left: 16,
          right: 16,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <button
          type="button"
          onClick={() => setShowNewTagModal(true)}
          style={{
            height: 52,
            padding: '0 24px',
            borderRadius: 26,
            border: 0,
            background: '#FFFFFF',
            boxShadow: '0 4px 16px rgba(0,0,0,.12)',
            color: INK,
            fontSize: 16,
            fontWeight: 650,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>New tag</span>
        </button>
      </div>

      {/* Rename Sheet */}
      <BottomSheet open={!!editingTag} onClose={() => setEditingTag(null)} headTitle="Edit tag">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            style={{
              height: 52,
              padding: '0 16px',
              borderRadius: 14,
              border: '1px solid #D8D8DE',
              fontSize: 16,
              color: INK,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={() => {
                if (editingTag) handleDelete(editingTag)
                setEditingTag(null)
              }}
              style={{
                flex: 1,
                height: 52,
                borderRadius: 14,
                border: 0,
                background: '#FDECEA',
                color: '#B3261E',
                fontSize: 16,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={handleRename}
              style={{
                flex: 2,
                height: 52,
                borderRadius: 14,
                border: 0,
                background: BLUE,
                color: '#FFFFFF',
                fontSize: 16,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Rename
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* New Tag Modal */}
      <BottomSheet open={showNewTagModal} onClose={() => setShowNewTagModal(false)} headTitle="New tag">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 16 }}>
          <input
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            placeholder="Tag name"
            style={{
              height: 52,
              padding: '0 16px',
              borderRadius: 14,
              border: '1px solid #D8D8DE',
              fontSize: 16,
              color: INK,
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleCreateTag}
            style={{
              height: 52,
              borderRadius: 14,
              border: 0,
              background: BLUE,
              color: '#FFFFFF',
              fontSize: 16,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            Create tag
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
