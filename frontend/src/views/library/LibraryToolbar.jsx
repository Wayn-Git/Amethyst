import { Button as HouseButton, Input as HouseInput, Select as HouseSelect } from '../../components/ui/bento/index.jsx'
import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { IS_MAC } from '../../keys.js'
import { KIND_ICON } from './LibraryCard.jsx'
import LibraryFilterDesk from './LibraryFilterDesk.jsx'

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
  counts,
  categoryCounts,
  tagCounts,
  appCounts,
  ratingCounts,
  selectedKinds = [],
  selectedCategories = [],
  selectedTags = [],
  selectedRatings = [],
  onSelectKinds,
  onSelectCategories,
  onSelectTags,
  onSelectRatings,
  onClearFilters,
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const mac = IS_MAC || (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || ''))
  const rawValue = quickCaptureText || query
  const capturing = isUrl(rawValue)
  const activeCount = selectedKinds.length + selectedCategories.length + selectedTags.length + selectedRatings.length

  const primaryFormats = useMemo(
    () =>
      Object.entries(counts || {})
        .filter(([id, count]) => id !== 'total' && count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4),
    [counts]
  )

  const sortLabel = order === 'asc' ? 'Oldest' : order === 'rating' ? 'Top rated' : 'Newest'

  useEffect(() => {
    const keydown = (event) => {
      if (
        event.key.toLowerCase() === 'f' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      ) {
        event.preventDefault()
        setFilterOpen(true)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

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
      onSelectKinds?.([...selectedKinds, kind])
    }
  }

  return (
    <>
      {/* Authentic Amethyst Section Header */}
      <header className="vheader" data-enter>
        <div>
          <div className="vheader-eyebrow">Knowledge Base</div>
          <h1>Library</h1>
          <div className="vheader-sub">
            {total} saved {total === 1 ? 'item' : 'items'}
            {isProcessingCount > 0 ? ` · syncing ${isProcessingCount}` : ''}
            {' — articles, videos, bookmarks, and notes.'}
          </div>
        </div>

        <div className="vheader-actions">
          {hasMusic && (
            <HouseButton
              type="button"
              className="btn btn--ghost btn--small"
              onClick={onOpenExport}
              title="Export audio & playlists"
            >
              <Icon name="music" size={14} />
              <span>Export playlist</span>
            </HouseButton>
          )}

          <HouseButton
            type="button"
            className={`btn btn--ghost btn--small ${showShare ? 'is-active' : ''}`}
            onClick={onToggleShare}
            aria-pressed={showShare}
            title="Knowledge connections & graph"
          >
            <Icon name="link" size={14} />
            <span>Connections</span>
          </HouseButton>

          <HouseButton
            type="button"
            className="btn btn--primary btn--small"
            onClick={() => onOpenAddModal?.('url')}
            title={`Add resource (${mac ? '⌘K' : 'Ctrl+K'})`}
          >
            <Icon name="plus" size={14} />
            <span>Add resource</span>
            <kbd className="lib-kbd lib-kbd--primary">{mac ? '⌘K' : 'Ctrl+K'}</kbd>
          </HouseButton>
        </div>
      </header>

      {/* Sub-Navigation & Filter Toolbar (Left-aligned tabs + right-aligned tools) */}
      <div className="lib-subnav" data-enter>
        {/* Left: Format Tabs (All, Video, Article, Post...) Left-aligned like Tasks / Automations */}
        <div className="lib-tabs-track" role="tablist" aria-label="Format filters">
          <HouseButton
            type="button"
            role="tab"
            aria-selected={selectedKinds.length === 0}
            className={`lib-tab-btn ${selectedKinds.length === 0 ? 'is-active' : ''}`}
            onClick={() => onSelectKinds?.([])}
          >
            <span>All</span>
            <span className="lib-tab-count">{total}</span>
          </HouseButton>
          {primaryFormats.map(([kind, count]) => {
            const isActive = selectedKinds.includes(kind)
            return (
              <HouseButton
                key={kind}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`lib-tab-btn ${isActive ? 'is-active' : ''}`}
                onClick={() => toggleFormat(kind)}
              >
                <Icon name={KIND_ICON[kind] || 'file'} size={14} />
                <span className="capitalize">{kind}</span>
                <span className="lib-tab-count">{count}</span>
              </HouseButton>
            )
          })}
        </div>

        {/* Right: Search, Filter Desk Trigger, Sort Dropdown, and View Switcher */}
        <div className="lib-subnav-tools">
          <form
            className={`lib-search-wrap ${capturing ? 'lib-search-wrap--capturing' : ''}`}
            onSubmit={(event) => {
              event.preventDefault()
              if (capturing) onQuickCaptureSubmit?.(event)
            }}
            role="search"
            aria-label="Library search"
          >
            <Icon name={capturing ? 'link' : 'search'} size={14} className="lib-search-icon" />
            <HouseInput
              ref={(node) => {
                if (searchRef) searchRef.current = node
                if (captureRef) captureRef.current = node
              }}
              className="lib-search-input"
              value={rawValue}
              onChange={changeInput}
              placeholder={capturing ? 'Press Enter to save link…' : 'Search library…'}
              aria-label="Search library or paste URL"
            />
            {capturing ? (
              <HouseButton type="submit" className="lib-search-save-btn">
                <span>Save</span>
                <kbd className="lib-kbd-inline">↵</kbd>
              </HouseButton>
            ) : (
              <>
                {!rawValue && <kbd className="lib-search-hotkey">{mac ? '⌘/' : 'Ctrl/'}</kbd>}
                {rawValue && (
                  <HouseButton
                    type="button"
                    className="lib-search-clear"
                    onClick={() => {
                      onQueryChange?.('')
                      onQuickCaptureChange?.('')
                    }}
                    aria-label="Clear search"
                  >
                    <Icon name="x" size={12} />
                  </HouseButton>
                )}
              </>
            )}
          </form>

          {/* Filter Desk Trigger */}
          <HouseButton
            type="button"
            className={`btn btn--ghost btn--small lib-subnav-btn ${activeCount > 0 ? 'is-active' : ''}`}
            onClick={() => setFilterOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            aria-pressed={activeCount > 0}
            title={`Filters (${mac ? 'F' : 'F'})`}
          >
            <Icon name="sliders" size={13} />
            <span>Filters</span>
            {activeCount > 0 ? (
              <span className="lib-filter-count-badge">{activeCount}</span>
            ) : (
              <kbd className="lib-hotkey-hint">F</kbd>
            )}
          </HouseButton>

          {/* Sort Dropdown */}
          <label className="lib-sort-select-wrap" title="Change sort order">
            <Icon name="down" size={11} className="lib-sort-chevron" />
            <span className="lib-sort-current">{sortLabel}</span>
            <HouseSelect
              value={order}
              onChange={(event) => onOrderChange?.(event.target.value)}
              aria-label="Sort order"
            >
              <option value="desc">Newest</option>
              <option value="asc">Oldest</option>
              <option value="rating">Top rated</option>
            </HouseSelect>
          </label>

          {/* Segmented Grid / List Switcher */}
          <div className="lib-layout-switch" role="group" aria-label="View display">
            <HouseButton
              type="button"
              className={`lib-layout-switch-btn ${layout === 'grid' ? 'is-active' : ''}`}
              onClick={() => onLayoutChange?.('grid')}
              aria-label="Grid view"
              aria-pressed={layout === 'grid'}
              title="Grid view"
            >
              <Icon name="grid" size={14} />
            </HouseButton>
            <HouseButton
              type="button"
              className={`lib-layout-switch-btn ${layout === 'list' ? 'is-active' : ''}`}
              onClick={() => onLayoutChange?.('list')}
              aria-label="List view"
              aria-pressed={layout === 'list'}
              title="List view"
            >
              <Icon name="list" size={14} />
            </HouseButton>
          </div>
        </div>
      </div>

      <LibraryFilterDesk
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        total={total}
        showing={showing}
        counts={counts}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
        appCounts={appCounts}
        ratingCounts={ratingCounts}
        selectedKinds={selectedKinds}
        selectedCategories={selectedCategories}
        selectedTags={selectedTags}
        selectedRatings={selectedRatings}
        onSelectKinds={onSelectKinds}
        onSelectCategories={onSelectCategories}
        onSelectTags={onSelectTags}
        onSelectRatings={onSelectRatings}
        onClear={onClearFilters}
      />
    </>
  )
}
