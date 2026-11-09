import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function ManageListsModal({
  open,
  onClose,
  lists = [],
  selectedListId = null,
  onSelectList,
  onRefreshLists,
  onOpenCreateModal,
  toast,
}) {
  const [filterQuery, setFilterQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [isClustering, setIsClustering] = useState(false)
  const [busyDeleteId, setBusyDeleteId] = useState(null)

  useEffect(() => {
    if (open) {
      setFilterQuery('')
      setEditingId(null)
      setEditingTitle('')
    }
  }, [open])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!open) return
      if (e.key === 'Escape') {
        if (editingId) {
          setEditingId(null)
        } else {
          onClose?.()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, editingId, onClose])

  const filteredLists = useMemo(() => {
    if (!filterQuery.trim()) return lists
    const q = filterQuery.toLowerCase()
    return lists.filter(
      (l) =>
        (l.title || '').toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q)
    )
  }, [lists, filterQuery])

  const smartLists = useMemo(() => filteredLists.filter((l) => Boolean(l.is_smart)), [filteredLists])
  const customLists = useMemo(() => filteredLists.filter((l) => !l.is_smart), [filteredLists])

  const handleStartRename = (list) => {
    setEditingId(list.id)
    setEditingTitle(list.title)
  }

  const handleSaveRename = async (listId) => {
    const clean = editingTitle.trim()
    if (!clean) {
      setEditingId(null)
      return
    }
    try {
      await api.updateLibraryList(listId, { title: clean })
      toast?.(`Renamed to "${clean}"`, 'ok')
      setEditingId(null)
      await onRefreshLists?.()
    } catch (err) {
      toast?.(err.message || 'Failed to rename list', 'bad')
    }
  }

  const handleDelete = async (list) => {
    if (!window.confirm(`Delete list "${list.title}"? Saved resources inside it will remain in your library.`)) {
      return
    }
    setBusyDeleteId(list.id)
    try {
      await api.deleteLibraryList(list.id)
      toast?.(`Deleted "${list.title}"`, 'ok')
      if (selectedListId === list.id) {
        onSelectList?.(null)
      }
      await onRefreshLists?.()
    } catch (err) {
      toast?.(err.message || 'Failed to delete list', 'bad')
    } finally {
      setBusyDeleteId(null)
    }
  }

  const handleRunAutoCluster = async () => {
    if (isClustering) return
    setIsClustering(true)
    try {
      const res = await api.autoClusterLibraryLists()
      const count = res.clusters_created !== undefined ? res.clusters_created : res.created_or_updated || 0
      toast?.(
        count > 0
          ? `Auto-grouped library into ${count} smart collections`
          : 'Smart lists are already up to date',
        'ok'
      )
      await onRefreshLists?.()
    } catch (err) {
      toast?.(err.message || 'Auto-grouping failed', 'bad')
    } finally {
      setIsClustering(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="lib-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
          <motion.div
            className="lib-modal-card lib-modal-card--md"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="lib-modal-header">
              <div className="flex items-center gap-2">
                <span className="lib-modal-header-icon">
                  <Icon name="tray" size={15} />
                </span>
                <div>
                  <h2 className="lib-modal-title">Manage Library Lists</h2>
                  <div className="lib-modal-sub">
                    {lists.length} total · {smartLists.length} smart, {customLists.length} curated
                  </div>
                </div>
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

            {/* Actions Bar: Search + AI Auto-group + Add */}
            <div className="lib-manage-action-bar">
              <div className="lib-manage-search-wrap">
                <Icon name="search" size={12} className="lib-manage-search-icon" />
                <input
                  type="text"
                  className="lib-manage-search-input"
                  placeholder="Search lists..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                />
                {filterQuery && (
                  <button
                    type="button"
                    className="lib-manage-search-clear"
                    onClick={() => setFilterQuery('')}
                  >
                    <Icon name="x" size={11} />
                  </button>
                )}
              </div>

              <button
                type="button"
                className={`lib-btn lib-btn--secondary lib-manage-btn ${isClustering ? 'opacity-70 cursor-not-allowed' : ''}`}
                onClick={handleRunAutoCluster}
                disabled={isClustering}
                title="Automatically group related items into smart collections"
              >
                <Icon
                  name={isClustering ? 'refresh' : 'spark'}
                  size={12}
                  className={isClustering ? 'animate-spin' : 'text-amber-500'}
                />
                <span>{isClustering ? 'Analyzing...' : 'Auto-group (AI)'}</span>
              </button>

              <button
                type="button"
                className="lib-btn lib-btn--primary lib-manage-btn"
                onClick={() => {
                  onOpenCreateModal?.()
                }}
              >
                <Icon name="plus" size={12} />
                <span>New list</span>
              </button>
            </div>

            {/* Lists Scroll Area */}
            <div className="lib-manage-list-scroll">
              {/* Curated Lists Section */}
              {customLists.length > 0 && (
                <div className="lib-manage-section">
                  <div className="lib-manage-section-title">
                    <span>Curated Lists ({customLists.length})</span>
                  </div>
                  <div className="lib-manage-list-group">
                    {customLists.map((l) => {
                      const isSelected = selectedListId === l.id
                      const isEditing = editingId === l.id
                      return (
                        <div
                          key={l.id}
                          className={`lib-manage-row ${isSelected ? 'is-selected' : ''}`}
                        >
                          <div className="lib-manage-row-left">
                            <Icon name="bookmark" size={13} className="lib-manage-row-icon" />
                            {isEditing ? (
                              <input
                                type="text"
                                className="lib-manage-edit-input"
                                value={editingTitle}
                                autoFocus
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(l.id)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                onBlur={() => handleSaveRename(l.id)}
                              />
                            ) : (
                              <span
                                className="lib-manage-row-title"
                                onClick={() => {
                                  onSelectList?.(l.id)
                                  onClose?.()
                                }}
                              >
                                {l.title}
                              </span>
                            )}
                            <span className="lib-manage-row-count">
                              {(l.item_count || 0) + (l.link_count || 0)} items
                            </span>
                          </div>

                          <div className="lib-manage-row-right">
                            <button
                              type="button"
                              className="lib-manage-icon-btn"
                              title="Rename list"
                              onClick={() => handleStartRename(l)}
                            >
                              <Icon name="edit" size={12} />
                            </button>
                            <button
                              type="button"
                              className="lib-manage-icon-btn lib-manage-icon-btn--danger"
                              title="Delete list"
                              disabled={busyDeleteId === l.id}
                              onClick={() => handleDelete(l)}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Smart Collections Section */}
              {smartLists.length > 0 && (
                <div className="lib-manage-section">
                  <div className="lib-manage-section-title">
                    <span className="flex items-center gap-1.5">
                      <Icon name="spark" size={11} className="text-amber-500" />
                      <span>Smart Collections ({smartLists.length})</span>
                    </span>
                  </div>
                  <div className="lib-manage-list-group">
                    {smartLists.map((l) => {
                      const isSelected = selectedListId === l.id
                      const isEditing = editingId === l.id
                      return (
                        <div
                          key={l.id}
                          className={`lib-manage-row ${isSelected ? 'is-selected' : ''}`}
                        >
                          <div className="lib-manage-row-left">
                            <Icon name="spark" size={13} className="text-amber-500" />
                            {isEditing ? (
                              <input
                                type="text"
                                className="lib-manage-edit-input"
                                value={editingTitle}
                                autoFocus
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveRename(l.id)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                onBlur={() => handleSaveRename(l.id)}
                              />
                            ) : (
                              <span
                                className="lib-manage-row-title"
                                onClick={() => {
                                  onSelectList?.(l.id)
                                  onClose?.()
                                }}
                              >
                                {l.title}
                              </span>
                            )}
                            <span className="lib-manage-smart-badge">AI</span>
                            <span className="lib-manage-row-count">
                              {(l.item_count || 0) + (l.link_count || 0)} items
                            </span>
                          </div>

                          <div className="lib-manage-row-right">
                            <button
                              type="button"
                              className="lib-manage-icon-btn"
                              title="Rename list"
                              onClick={() => handleStartRename(l)}
                            >
                              <Icon name="edit" size={12} />
                            </button>
                            <button
                              type="button"
                              className="lib-manage-icon-btn lib-manage-icon-btn--danger"
                              title="Delete list"
                              disabled={busyDeleteId === l.id}
                              onClick={() => handleDelete(l)}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {filteredLists.length === 0 && (
                <div className="lib-manage-empty">
                  {filterQuery ? 'No lists match your search.' : 'No lists in library yet.'}
                </div>
              )}
            </div>

            <div className="lib-modal-footer">
              <button
                type="button"
                className="lib-btn lib-btn--primary"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
