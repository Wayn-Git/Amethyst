import { useState, useMemo } from 'react'
import { BottomSheet } from '../libraryUi.jsx'

export default function TagManagerSheet({
  open,
  onClose,
  items = [],
  onUpdateTags,
  showToast,
}) {
  const [query, setQuery] = useState('')
  const [newTag, setNewTag] = useState('')

  // Compute tag frequencies from items
  const tagCounts = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const tags = Array.isArray(item.tags)
        ? item.tags
        : typeof item.tags === 'string'
        ? item.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : []
      for (const t of tags) {
        const norm = t.replace(/^#/, '').toLowerCase()
        if (norm) {
          map.set(norm, (map.get(norm) || 0) + 1)
        }
      }
    }
    return map
  }, [items])

  const sortedTags = useMemo(() => {
    const list = Array.from(tagCounts.entries())
    list.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    if (!query.trim()) return list
    const q = query.toLowerCase()
    return list.filter(([tag]) => tag.includes(q))
  }, [tagCounts, query])

  const handleAddTag = () => {
    const norm = newTag.trim().replace(/^#/, '').toLowerCase()
    if (!norm) return
    showToast?.(`Tag #${norm} ready`)
    setNewTag('')
  }

  return (
    <BottomSheet open={open} onClose={onClose} label="Tag manager" headTitle="Tags">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
        <p style={{ margin: 0, fontSize: 14, color: '#636366' }}>
          {tagCounts.size} {tagCounts.size === 1 ? 'tag' : 'tags'} used across your library
        </p>

        {/* Find a tag input */}
        <div style={{ position: 'relative' }}>
          <input
            type="search"
            placeholder="Find a tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              width: '100%',
              height: 44,
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
        </div>

        {/* Tag list */}
        <div style={{ maxHeight: '45vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {sortedTags.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#8E8E93', fontSize: 14 }}>
              No tags found
            </div>
          ) : (
            sortedTags.map(([tag, count]) => (
              <div
                key={tag}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: 50,
                  borderBottom: '1px solid #ECECF0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#0A55C4' }}>#</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: '#151517' }}>{tag}</span>
                </div>
                <span style={{ fontSize: 14, color: '#8E8E93', fontWeight: 500 }}>
                  {count} {count === 1 ? 'item' : 'items'}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Add new tag row */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <input
            type="text"
            placeholder="New tag name…"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 14,
              border: '1px solid #D8D8DE',
              background: '#fff',
              padding: '0 14px',
              fontSize: 15,
              color: '#151517',
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          <button
            type="button"
            disabled={!newTag.trim()}
            style={{
              height: 48,
              padding: '0 18px',
              borderRadius: 14,
              border: 0,
              background: '#0B5FD9',
              color: '#fff',
              fontSize: 15,
              fontWeight: 700,
              cursor: newTag.trim() ? 'pointer' : 'default',
              opacity: newTag.trim() ? 1 : 0.5,
            }}
            onClick={handleAddTag}
          >
            Add
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
