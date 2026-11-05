import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function CreateListModal({
  open,
  onClose,
  onCreated,
  toast,
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isSmart, setIsSmart] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
      setIsSmart(false)
      setBusy(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!open) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const handleSubmit = async (e) => {
    e?.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle || busy) return

    setBusy(true)
    try {
      const res = await api.createLibraryList({
        title: cleanTitle,
        description: description.trim(),
        icon: isSmart ? 'spark' : 'bookmark',
        is_smart: isSmart,
      })
      toast?.(`Created list "${cleanTitle}"`, 'ok')
      onCreated?.(res)
      onClose?.()
    } catch (err) {
      toast?.(err.message || 'Failed to create list', 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="lib-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
          <motion.div
            className="lib-modal-card lib-modal-card--sm"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="lib-modal-header">
              <div className="flex items-center gap-2">
                <span className="lib-modal-header-icon">
                  <Icon name={isSmart ? 'spark' : 'tray'} size={14} />
                </span>
                <h2 className="lib-modal-title">Create New List</h2>
              </div>
              <button
                type="button"
                className="lib-modal-close-btn"
                onClick={onClose}
                aria-label="Close"
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="lib-modal-body">
              <div className="lib-form-group">
                <label className="lib-form-label" htmlFor="lib-list-name-input">
                  List name
                </label>
                <input
                  id="lib-list-name-input"
                  ref={inputRef}
                  type="text"
                  className="lib-form-input"
                  placeholder="e.g. Design Systems, Reading Queue"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                  maxLength={64}
                />
              </div>

              <div className="lib-form-group">
                <label className="lib-form-label" htmlFor="lib-list-desc-input">
                  Description <span className="opacity-50">(optional)</span>
                </label>
                <input
                  id="lib-list-desc-input"
                  type="text"
                  className="lib-form-input"
                  placeholder="What belongs in this collection?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={busy}
                  maxLength={140}
                />
              </div>

              <div className="lib-list-type-row">
                <button
                  type="button"
                  className={`lib-list-type-pill ${!isSmart ? 'is-active' : ''}`}
                  onClick={() => setIsSmart(false)}
                >
                  <Icon name="bookmark" size={12} />
                  <span>Curated list</span>
                </button>
                <button
                  type="button"
                  className={`lib-list-type-pill ${isSmart ? 'is-active' : ''}`}
                  onClick={() => setIsSmart(true)}
                >
                  <Icon name="spark" size={12} className="text-amber-500" />
                  <span>Smart AI list</span>
                </button>
              </div>

              <div className="lib-modal-footer">
                <button
                  type="button"
                  className="lib-btn lib-btn--ghost"
                  onClick={onClose}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="lib-btn lib-btn--primary"
                  disabled={!title.trim() || busy}
                >
                  {busy ? 'Creating...' : 'Create list'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
