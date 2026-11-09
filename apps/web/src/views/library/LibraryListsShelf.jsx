import React, { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function LibraryListsShelf({
  lists = [],
  selectedListId = null,
  onSelectList,
  totalItems = 0,
  onRefreshLists,
  toast,
}) {
  const [isClustering, setIsClustering] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [showCreateInput, setShowCreateInput] = useState(false)

  const handleAutoCluster = async () => {
    if (isClustering) return
    setIsClustering(true)
    try {
      const res = await api.autoClusterLibraryLists()
      toast?.(
        res.created_or_updated
          ? `Auto-grouped library into ${res.created_or_updated} smart lists`
          : 'Smart lists are up to date',
        'ok'
      )
      if (onRefreshLists) await onRefreshLists()
    } catch (err) {
      toast?.(err.message || 'Auto-clustering failed', 'bad')
    } finally {
      setIsClustering(false)
    }
  }

  const handleCreateList = async (e) => {
    e?.preventDefault()
    const clean = newTitle.trim()
    if (!clean || isCreating) return
    setIsCreating(true)
    try {
      const res = await api.createLibraryList({ title: clean })
      toast?.(`Created list "${clean}"`, 'ok')
      setNewTitle('')
      setShowCreateInput(false)
      if (onRefreshLists) await onRefreshLists()
      if (res?.id && onSelectList) {
        onSelectList(res.id)
      }
    } catch (err) {
      toast?.(err.message || 'Failed to create list', 'bad')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteList = async (e, list) => {
    e.stopPropagation()
    if (!window.confirm(`Delete list "${list.title}"? (Items in it will not be deleted)`)) {
      return
    }
    try {
      await api.deleteLibraryList(list.id)
      toast?.(`Deleted list "${list.title}"`, 'ok')
      if (selectedListId === list.id && onSelectList) {
        onSelectList(null)
      }
      if (onRefreshLists) await onRefreshLists()
    } catch (err) {
      toast?.(err.message || 'Failed to delete list', 'bad')
    }
  }

  return (
    <div className="lib-lists-shelf" role="toolbar" aria-label="Library Lists">
      <div className="lib-lists-shelf-scroll">
        {/* All items default pill */}
        <button
          type="button"
          className={`lib-list-pill ${selectedListId === null ? 'lib-list-pill--active' : ''}`}
          onClick={() => onSelectList?.(null)}
          aria-pressed={selectedListId === null}
        >
          <Icon name="layers" size={13} className="lib-list-pill-icon" />
          <span className="lib-list-pill-label">All Items</span>
          {typeof totalItems === 'number' && (
            <span className="lib-list-pill-count">{totalItems}</span>
          )}
        </button>

        {/* Dynamic Lists */}
        {lists.map((l) => {
          const isActive = selectedListId === l.id
          const totalCount = (l.item_count || 0) + (l.link_count || 0)
          return (
            <button
              key={l.id}
              type="button"
              className={`lib-list-pill ${isActive ? 'lib-list-pill--active' : ''} ${
                l.is_smart ? 'lib-list-pill--smart' : ''
              }`}
              onClick={() => onSelectList?.(isActive ? null : l.id)}
              aria-pressed={isActive}
              title={l.description || l.title}
            >
              <Icon
                name={l.is_smart ? 'spark' : 'folder'}
                size={13}
                className={`lib-list-pill-icon ${l.is_smart ? 'text-amber-400' : ''}`}
              />
              <span className="lib-list-pill-label">{l.title}</span>
              <span className="lib-list-pill-count">{totalCount}</span>

              {isActive && (
                <span
                  role="button"
                  tabIndex={0}
                  className="lib-list-pill-delete"
                  onClick={(e) => handleDeleteList(e, l)}
                  title="Delete list"
                  aria-label={`Delete list ${l.title}`}
                >
                  <Icon name="trash" size={11} />
                </span>
              )}
            </button>
          )
        })}

        {/* Inline Create Input or Button */}
        {showCreateInput ? (
          <form className="lib-list-create-form" onSubmit={handleCreateList}>
            <input
              type="text"
              className="lib-list-create-input"
              placeholder="List name..."
              value={newTitle}
              autoFocus
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowCreateInput(false)
                  setNewTitle('')
                }
              }}
            />
            <button
              type="submit"
              className="lib-list-create-submit"
              disabled={!newTitle.trim() || isCreating}
            >
              <Icon name="check" size={12} />
            </button>
            <button
              type="button"
              className="lib-list-create-cancel"
              onClick={() => {
                setShowCreateInput(false)
                setNewTitle('')
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="lib-list-pill lib-list-pill--action"
            onClick={() => setShowCreateInput(true)}
            title="Create a new custom list"
          >
            <Icon name="plus" size={12} />
            <span>New List</span>
          </button>
        )}
      </div>

      <div className="lib-lists-shelf-actions">
        <button
          type="button"
          className="lib-list-action-btn"
          onClick={handleAutoCluster}
          disabled={isClustering}
          title="Analyze similarities and auto-group related content & links into smart lists"
        >
          <Icon
            name="spark"
            size={13}
            className={isClustering ? 'animate-spin text-amber-400' : 'text-amber-400'}
          />
          <span>{isClustering ? 'Clustering...' : 'Auto-Group'}</span>
        </button>
      </div>
    </div>
  )
}
