import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'

/**
 * Shared building blocks for the mobile Library revamp (design: F2F2F7 liquid-glass
 * system, see docs/widget-playground design boards). Promoted from MobileLibrary.jsx
 * so MobileLibraryItem.jsx and future screens reuse the same primitives.
 *
 * Kept framework-identical to the original inline components so visuals do not shift.
 */

export const CARD_EASE = [0.16, 1, 0.3, 1]

export function GlassIconButton({ label, onClick, children, width = 46, style, className = 'lb-glass-btn', testId }) {
  return (
    <motion.button
      type="button"
      className={className}
      aria-label={label}
      data-testid={testId}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      style={{ width, height: width, ...style }}
    >
      {children}
    </motion.button>
  )
}

/* Segmented control with sliding pill. */
export function Segmented({ segments, value, onChange }) {
  const index = Math.max(0, segments.findIndex((segment) => segment.value === value))
  return (
    <div className="lb-seg" role="tablist">
      <motion.span
        className="lb-seg-pill"
        layout
        transition={{ type: 'spring', stiffness: 480, damping: 38 }}
        style={{ width: `calc(${100 / segments.length}% - 8px)`, left: `calc(${(index * 100) / segments.length}% + 4px)`, pointerEvents: 'none' }}
      />
      {segments.map((segment) => (
        <button
          key={segment.value}
          type="button"
          role="tab"
          aria-selected={value === segment.value}
          className={`lb-seg-btn ${value === segment.value ? 'on' : ''}`}
          onClick={() => onChange(segment.value)}
        >
          {segment.label}
          {segment.count != null && (
            <span className={`lb-seg-count ${value === segment.value ? 'on' : ''}`}>{segment.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}

export function ChipRow({ options, value, onChange, testIdPrefix = 'chip' }) {
  return (
    <div className="lb-chiprow" role="radiogroup">
      {options.map(([option, label]) => (
        <motion.button
          key={option}
          type="button"
          data-testid={`${testIdPrefix}-${option}`}
          className={`lb-chip ${value === option ? 'on' : ''}`}
          aria-pressed={value === option}
          whileTap={{ scale: 0.94 }}
          onClick={() => onChange(option)}
        >
          {label}
        </motion.button>
      ))}
    </div>
  )
}

export function SectionHead({ title, note, action }) {
  return (
    <div className="lb-section-head">
      <h2>{title}</h2>
      {note != null && <span>{note}</span>}
      {action}
    </div>
  )
}

/* Bottom sheet used by create / filter / item menu / add-to-collection. */
export function BottomSheet({ open, onClose, label, children, headTitle, showClose = true, grabber = true }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="lb-sheet-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
        >
          <motion.div
            className="lb-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 36 }}
          >
            {grabber && <div className="lb-sheet-grab" aria-hidden="true" />}
            {headTitle && (
              <div className="lb-sheet-head">
                <h1 className="lb-sheet-title">{headTitle}</h1>
                {showClose && (
                  <GlassIconButton label="Close" width={44} onClick={onClose}>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </GlassIconButton>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* Add-to-collection sheet (design board 18). Toggling a row applies the change
   immediately via POST/DELETE /api/library/lists/{id}/members; Done just closes. */
export function AddToCollectionSheet({ open, onClose, item, showToast }) {
  const [lists, setLists] = useState([])
  const [memberIds, setMemberIds] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    api.getLibraryLists()
      .then((rows) => {
        if (cancelled) return
        setLists(rows || [])
        const ids = new Set()
        for (const row of rows || []) {
          if (Array.isArray(row.member_item_ids) && row.member_item_ids.includes(item?.id)) ids.add(row.id)
        }
        setMemberIds(ids)
      })
      .catch((err) => { if (!cancelled) showToast?.(`Could not load collections: ${err.message}`) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, item?.id])

  const toggle = async (listId) => {
    if (!item?.id) return
    const wasMember = memberIds.has(listId)
    setMemberIds((prev) => {
      const next = new Set(prev)
      if (wasMember) next.delete(listId)
      else next.add(listId)
      return next
    })
    try {
      if (wasMember) {
        await api.removeLibraryListMember(listId, { item_id: item.id })
      } else {
        await api.addLibraryListMember(listId, { item_id: item.id })
      }
    } catch (err) {
      setMemberIds((prev) => {
        const next = new Set(prev)
        if (wasMember) next.add(listId)
        else next.delete(listId)
        return next
      })
      showToast?.(`Could not update collection: ${err.message}`)
    }
  }

  const createAndAdd = async () => {
    const title = newTitle.trim()
    if (!title || creating) return
    setCreating(true)
    try {
      const created = await api.createLibraryList({ title, description: '', icon: 'bookmark', is_smart: false })
      if (item?.id && created?.id) {
        await api.addLibraryListMember(created.id, { item_id: item.id })
        setMemberIds((prev) => new Set(prev).add(created.id))
      }
      const nextLists = await api.getLibraryLists()
      setLists(nextLists || [])
      setNewTitle('')
      showToast?.(`Added to "${title}"`)
    } catch (err) {
      showToast?.(`Could not create collection: ${err.message}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} label="Add to collection">
      <div className="lb-addcol-head">
        <h1 className="lb-sheet-title" style={{ margin: 0 }}>Add to collection</h1>
      </div>

      {item && (
        <div className="lb-addcol-item">
          <div className="lb-addcol-thumb" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lb-addcol-item-title">{item.title || 'Untitled'}</div>
            <div className="lb-addcol-item-sub">{item.kind ? item.kind.charAt(0).toUpperCase() + item.kind.slice(1) : 'Save'}</div>
          </div>
        </div>
      )}

      <div className="lb-addcol-label">Collections</div>
      <div className="lb-addcol-box">
        {loading && <div className="lb-addcol-empty">Loading…</div>}
        {!loading && lists.length === 0 && <div className="lb-addcol-empty">No collections yet.</div>}
        {lists.map((list) => {
          const on = memberIds.has(list.id)
          return (
            <button
              key={list.id}
              type="button"
              className="lb-addcol-row"
              style={{ borderBottom: list === lists[lists.length - 1] ? 'none' : undefined }}
              onClick={() => toggle(list.id)}
            >
              <span className="lb-addcol-check" style={on ? { background: '#0B5FD9', color: '#fff' } : { border: '2px solid #C7C7CC' }}>
                {on && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                )}
              </span>
              <span className="lb-addcol-row-title">{list.title || list.name}</span>
              <span className="lb-addcol-row-count">{list.item_count ?? 0} saves</span>
            </button>
          )
        })}
        <div className="lb-addcol-newrow">
          <span className="lb-addcol-check" style={{ background: '#E4EDFC', color: '#0A55C4' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <input
            className="lb-addcol-newinput"
            value={newTitle}
            maxLength={80}
            placeholder="New collection"
            aria-label="New collection name"
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); createAndAdd() } }}
          />
          {newTitle.trim() && (
            <button type="button" className="lb-addcol-newadd" onClick={createAndAdd} disabled={creating}>
              {creating ? 'Adding…' : 'Add'}
            </button>
          )}
        </div>
      </div>

      <button type="button" className="lb-save-btn" style={{ marginTop: 16 }} onClick={onClose}>
        Done
      </button>
    </BottomSheet>
  )
}
