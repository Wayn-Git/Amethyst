import { Button as HouseButton } from '../../components/ui/bento/index.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { IS_MAC } from '../../keys.js'

const BARE_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/.*)?$/i
const isUrl = (value) => /^https?:\/\//i.test(value.trim()) || BARE_DOMAIN_RE.test(value.trim())

export default function LibraryToolbar({
  total = 0,
  showing = 0,
  isProcessingCount = 0,
  query = '',
  onQueryChange,
  searchRef,
  quickCaptureText = '',
  onQuickCaptureChange,
  onQuickCaptureSubmit,
  captureRef,
  order = 'desc',
  onOrderChange,
  layout = 'grid',
  onLayoutChange,
  showShare,
  onToggleShare,
  hasMusic,
  onOpenExport,
  onOpenAddModal,
  onOpenMergeModal,
  counts = {},
  selectedKinds = [],
  onSelectKinds,
  lists = [],
  selectedListId = null,
  onSelectList,
  onOpenCreateList,
  onOpenManageLists,
  onAutoCluster,
  isClustering = false,
  quickFilters = { addedThisWeek: false, unreadOnly: false, hasNotes: false },
  onQuickFiltersChange,
  isSelectMode = false,
  onToggleSelectMode,
  onSync,
  isSyncing = false,
}) {
  const mac = IS_MAC || (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || ''))
  const rawValue = quickCaptureText || query
  const capturing = isUrl(rawValue)

  // Dropdown states
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [organizeMenuOpen, setOrganizeMenuOpen] = useState(false)

  // Click-outside refs
  const moreRef = useRef(null)
  const filterRef = useRef(null)
  const sortRef = useRef(null)
  const organizeRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) setMoreMenuOpen(false)
      if (filterRef.current && !filterRef.current.contains(e.target)) setFilterMenuOpen(false)
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortMenuOpen(false)
      if (organizeRef.current && !organizeRef.current.contains(e.target)) setOrganizeMenuOpen(false)
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMoreMenuOpen(false)
        setFilterMenuOpen(false)
        setSortMenuOpen(false)
        setOrganizeMenuOpen(false)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (searchRef?.current) {
          searchRef.current.focus()
          searchRef.current.select?.()
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        onToggleShare?.()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onToggleShare, searchRef])

  const changeInput = (event) => {
    const value = event.target.value
    if (isUrl(value)) {
      onQuickCaptureChange?.(value)
      onQueryChange?.('')
    } else {
      onQuickCaptureChange?.('')
      onQueryChange?.(value)
    }
  }

  const toggleFormat = (kind) => {
    if (selectedKinds.includes(kind)) {
      onSelectKinds?.(selectedKinds.filter((item) => item !== kind))
    } else {
      onSelectKinds?.([kind])
    }
  }

  const primaryFormats = useMemo(() => {
    const defaultKeys = ['video', 'article', 'post', 'note', 'book', 'music']
    const extraKeys = Object.keys(counts).filter(
      (k) => (counts[k] || 0) > 0 && !defaultKeys.includes(k)
    )
    const all = [...defaultKeys, ...extraKeys]
    return all
      .filter((k) => (counts[k] || 0) > 0 || ['video', 'article', 'post', 'note'].includes(k))
      .map((k) => ({
        kind: k,
        label: k.charAt(0).toUpperCase() + k.slice(1),
        count: counts[k] || 0,
      }))
  }, [counts])

  const activeFilterCount =
    (quickFilters.addedThisWeek ? 1 : 0) +
    (quickFilters.unreadOnly ? 1 : 0) +
    (quickFilters.hasNotes ? 1 : 0)

  const sortLabel = order === 'asc' ? 'Oldest' : order === 'rating' ? 'Top rated' : 'Newest'

  return (
    <div className="lib-deck w-full flex flex-col gap-3" data-enter>
      {/* 1. Header Row */}
      <header className="lib-header">
        <div className="lib-header-info">
          <div className="lib-eyebrow">KNOWLEDGE BASE</div>
          <h1 className="lib-title">Library</h1>
          <div className="lib-subtitle">
            {total} saved items · articles, videos, bookmarks and notes
          </div>
        </div>

        <div className="lib-header-actions">
          <HouseButton
            type="button"
            className="lib-add-btn"
            onClick={() => onOpenAddModal?.('anything')}
            title="Add resource"
          >
            <Icon name="plus" size={13} />
            <span>Add resource</span>
          </HouseButton>

          {/* More actions menu (Screenshot 3) */}
          <div className="lib-popover-wrap" ref={moreRef}>
            <button
              type="button"
              className={`lib-icon-btn ${moreMenuOpen ? 'is-active' : ''}`}
              onClick={() => setMoreMenuOpen((v) => !v)}
              aria-label="More options"
              title="More options"
            >
              <Icon name="dots" size={16} />
            </button>

            {moreMenuOpen && (
              <div className="lib-menu-dropdown lib-menu-dropdown--right" role="menu">
                <button
                  type="button"
                  className="lib-menu-item"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    onToggleShare?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="link" size={13} />
                    <span>Connections</span>
                  </div>
                  <kbd className="lib-menu-kbd">{mac ? '⌘J' : 'Ctrl+J'}</kbd>
                </button>

                <button
                  type="button"
                  className="lib-menu-item"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    onOpenExport?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="download" size={13} />
                    <span>Export library</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="lib-menu-item"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    onOpenMergeModal?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="copy" size={13} />
                    <span>Merge lists</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="lib-menu-item"
                  onClick={() => {
                    setMoreMenuOpen(false)
                    onToggleSelectMode?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="check-square" size={13} />
                    <span>{isSelectMode ? 'Exit select mode' : 'Select items'}</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* 2. Primary Filter & Search Bar (Screenshot 0) */}
      <div className="lib-primary-row">
        {/* Format tabs segmented control: [ All 333 | Video 194 | Article 112 | Post 20 | Note 5 ] */}
        <div className="lib-format-track" role="tablist" aria-label="Format filter tabs">
          <button
            type="button"
            role="tab"
            aria-selected={selectedKinds.length === 0}
            className={`lib-format-pill ${selectedKinds.length === 0 ? 'is-active' : ''}`}
            onClick={() => onSelectKinds?.([])}
          >
            <span className="lib-format-label">All</span>
            <span className="lib-format-count">{total}</span>
          </button>
          {primaryFormats.map(({ kind, label, count }) => {
            const isActive = selectedKinds.includes(kind)
            return (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`lib-format-pill ${isActive ? 'is-active' : ''}`}
                onClick={() => toggleFormat(kind)}
              >
                <span className="lib-format-label">{label}</span>
                <span className="lib-format-count">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Right Tools: Search input, Filter button, Sort button, View switcher */}
        <div className="lib-tools-group">
          {/* Robust Search box with perfectly centered icon and ⌘K badge */}
          <form
            className={`lib-search-wrap ${capturing ? 'lib-search-wrap--capturing' : ''}`}
            onSubmit={(e) => {
              e.preventDefault()
              if (capturing) onQuickCaptureSubmit?.(e)
            }}
            role="search"
          >
            <Icon name={capturing ? 'link' : 'search'} size={13} className="lib-search-icon" />
            <input
              ref={(node) => {
                if (searchRef) searchRef.current = node
                if (captureRef) captureRef.current = node
              }}
              type="text"
              className="lib-search-input"
              value={rawValue}
              onChange={changeInput}
              placeholder={capturing ? 'Press Enter to save link…' : 'Search library...'}
              aria-label="Search library or paste URL"
            />
            {capturing ? (
              <button type="submit" className="lib-search-save-btn">
                <span>Save</span>
                <kbd className="lib-kbd-inline">↵</kbd>
              </button>
            ) : (
              <kbd className="lib-search-badge">{mac ? '⌘K' : 'Ctrl+K'}</kbd>
            )}
          </form>

          {/* Filter button + dropdown (Screenshot 2) */}
          <div className="lib-popover-wrap" ref={filterRef}>
            <button
              type="button"
              className={`lib-tool-btn ${filterMenuOpen || activeFilterCount > 0 ? 'is-active' : ''}`}
              onClick={() => setFilterMenuOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={filterMenuOpen}
            >
              <Icon name="sliders" size={13} />
              <span>Filter</span>
              {activeFilterCount > 0 && <span className="lib-filter-dot" />}
            </button>

            {filterMenuOpen && (
              <div className="lib-menu-dropdown lib-menu-dropdown--filter" role="dialog">
                <div className="lib-menu-header">FILTER LIBRARY</div>
                <label className="lib-checkbox-row">
                  <input
                    type="checkbox"
                    className="lib-checkbox"
                    checked={Boolean(quickFilters.addedThisWeek)}
                    onChange={(e) =>
                      onQuickFiltersChange?.({ ...quickFilters, addedThisWeek: e.target.checked })
                    }
                  />
                  <span>Added this week</span>
                </label>

                <label className="lib-checkbox-row">
                  <input
                    type="checkbox"
                    className="lib-checkbox"
                    checked={Boolean(quickFilters.unreadOnly)}
                    onChange={(e) =>
                      onQuickFiltersChange?.({ ...quickFilters, unreadOnly: e.target.checked })
                    }
                  />
                  <span>Unread only</span>
                </label>

                <label className="lib-checkbox-row">
                  <input
                    type="checkbox"
                    className="lib-checkbox"
                    checked={Boolean(quickFilters.hasNotes)}
                    onChange={(e) =>
                      onQuickFiltersChange?.({ ...quickFilters, hasNotes: e.target.checked })
                    }
                  />
                  <span>Has notes</span>
                </label>
              </div>
            )}
          </div>

          {/* Sort button + dropdown */}
          <div className="lib-popover-wrap" ref={sortRef}>
            <button
              type="button"
              className={`lib-tool-btn ${sortMenuOpen ? 'is-active' : ''}`}
              onClick={() => setSortMenuOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={sortMenuOpen}
            >
              <Icon name="down" size={12} />
              <span>{sortLabel}</span>
            </button>

            {sortMenuOpen && (
              <div className="lib-menu-dropdown lib-menu-dropdown--sort" role="menu">
                <button
                  type="button"
                  className={`lib-menu-item ${order === 'desc' ? 'is-active' : ''}`}
                  onClick={() => {
                    onOrderChange?.('desc')
                    setSortMenuOpen(false)
                  }}
                >
                  <span>Newest</span>
                </button>
                <button
                  type="button"
                  className={`lib-menu-item ${order === 'asc' ? 'is-active' : ''}`}
                  onClick={() => {
                    onOrderChange?.('asc')
                    setSortMenuOpen(false)
                  }}
                >
                  <span>Oldest</span>
                </button>
                <button
                  type="button"
                  className={`lib-menu-item ${order === 'rating' ? 'is-active' : ''}`}
                  onClick={() => {
                    onOrderChange?.('rating')
                    setSortMenuOpen(false)
                  }}
                >
                  <span>Top rated</span>
                </button>
              </div>
            )}
          </div>

          {/* View switcher (Grid button) */}
          <button
            type="button"
            className={`lib-icon-btn ${layout === 'grid' ? 'is-active' : ''}`}
            onClick={() => onLayoutChange?.(layout === 'grid' ? 'list' : 'grid')}
            title="Toggle view"
            aria-label="Toggle view"
          >
            <Icon name="grid" size={14} />
          </button>

          {/* Cloud Sync button */}
          {onSync && (
            <button
              type="button"
              className={`lib-icon-btn ${isSyncing ? 'is-active' : ''}`}
              onClick={onSync}
              disabled={isSyncing}
              title={isSyncing ? 'Syncing with Google Drive…' : 'Sync with Google Drive'}
              aria-label="Sync with Google Drive"
            >
              <Icon name="refresh" size={14} className={isSyncing ? 'animate-spin text-accent' : ''} />
            </button>
          )}

          {/* Organize Menu */}
          <div className="lib-popover-wrap" ref={organizeRef}>
            <button
              type="button"
              className={`lib-tool-btn lib-organize-btn ${organizeMenuOpen ? 'is-active' : ''} ${isClustering ? 'opacity-80' : ''}`}
              onClick={() => setOrganizeMenuOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={organizeMenuOpen}
              disabled={isClustering}
            >
              <Icon
                name={isClustering ? 'refresh' : 'spark'}
                size={12}
                className={isClustering ? 'animate-spin' : 'text-amber-500'}
              />
              <span>{isClustering ? 'Analyzing...' : 'Organize'}</span>
              <Icon name="caret-down" size={10} className="lib-chevron" />
            </button>

            {organizeMenuOpen && (
              <div className="lib-menu-dropdown lib-menu-dropdown--organize lib-menu-dropdown--right" role="menu">
                <div className="lib-menu-header">ORGANIZE LIBRARY</div>

                <button
                  type="button"
                  className="lib-menu-item"
                  disabled={isClustering}
                  onClick={() => {
                    setOrganizeMenuOpen(false)
                    onAutoCluster?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="spark" size={12} className="text-amber-500" />
                    <span>Auto-group library</span>
                  </div>
                  <span className="lib-ai-badge">AI</span>
                </button>

                <button
                  type="button"
                  className="lib-menu-item"
                  onClick={() => {
                    setOrganizeMenuOpen(false)
                    onOpenCreateList?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="plus" size={12} />
                    <span>Create new list</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="lib-menu-item"
                  onClick={() => {
                    setOrganizeMenuOpen(false)
                    onOpenMergeModal?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="copy" size={12} />
                    <span>Merge lists</span>
                  </div>
                </button>

                <button
                  type="button"
                  className="lib-menu-item"
                  onClick={() => {
                    setOrganizeMenuOpen(false)
                    onOpenManageLists?.()
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Icon name="tray" size={12} />
                    <span>Manage lists...</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
