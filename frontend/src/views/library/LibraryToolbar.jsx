import { useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { IS_MAC } from '../../keys.js'
import { Button } from '../../components/ui/button.tsx'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../../components/ui/tooltip.tsx'
import { motion, AnimatePresence } from 'framer-motion'
import { useDismiss } from '../../hooks/useDismiss.js'
import { KIND_ICON } from './LibraryCard.jsx'

const BARE_DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/.*)?$/i

function checkIsUrl(str) {
  if (!str) return false
  const trimmed = str.trim()
  return /^https?:\/\//i.test(trimmed) || BARE_DOMAIN_RE.test(trimmed)
}

const PLATFORMS_META = [
  { id: 'youtube', label: 'YouTube', icon: 'play' },
  { id: 'instagram', label: 'Instagram', icon: 'spark' },
  { id: 'spotify', label: 'Spotify', icon: 'music' },
  { id: 'threads', label: 'Threads', icon: 'threads' },
  { id: 'pinterest', label: 'Pinterest', icon: 'pin' },
  { id: 'github', label: 'GitHub', icon: 'code' },
  { id: 'x', label: 'X (Twitter)', icon: 'chat' },
  { id: 'reddit', label: 'Reddit', icon: 'chat' },
]

export default function LibraryToolbar({
  total = 0,
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
  showShare = false,
  onToggleShare,
  hasMusic = false,
  onOpenExport,
  onOpenAddModal,
  counts = {},
  categoryCounts = {},
  tagCounts = {},
  appCounts = {},
  ratingCounts = {},
  selectedKind = '',
  selectedCategory = '',
  selectedTag = '',
  selectedRating = '',
  onSelectKind,
  onSelectCategory,
  onSelectTag,
  onSelectRating,
  onClearFilters,
}) {
  const isMac =
    IS_MAC ||
    (typeof navigator !== 'undefined' &&
      /Mac|iPod|iPhone|iPad/.test(navigator.platform || ''))

  const rawVal = quickCaptureText !== '' ? quickCaptureText : query
  const trimmed = rawVal.trim()

  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const [tagQuery, setTagQuery] = useState('')
  const filterRef = useRef(null)

  useDismiss(filterRef, filterMenuOpen, {
    onAway: () => setFilterMenuOpen(false),
    onEscape: () => setFilterMenuOpen(false),
  })

  // Detect if current input text is a URL
  const isUrl = useMemo(() => checkIsUrl(trimmed), [trimmed])

  // Format kinds list (filter out zero counts, sorted by frequency)
  const activeKinds = useMemo(() => {
    return Object.entries(counts)
      .filter(([kind, count]) => count > 0 && kind !== 'total')
      .sort((a, b) => b[1] - a[1])
  }, [counts])

  // Primary kinds for horizontal tabs
  const primaryKinds = useMemo(() => activeKinds.slice(0, 4), [activeKinds])
  const extraKinds = useMemo(() => activeKinds.slice(4), [activeKinds])

  // Active platforms list
  const activeApps = useMemo(() => {
    const list = []
    for (const app of PLATFORMS_META) {
      const count = appCounts[app.id] || tagCounts[app.id] || 0
      if (count > 0) {
        list.push({ ...app, count })
      }
    }
    return list
  }, [appCounts, tagCounts])

  // Categories list
  const categoriesList = useMemo(() => {
    return Object.entries(categoryCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
  }, [categoryCounts])

  // Filtered tags for popover
  const allTagEntries = useMemo(() => {
    return Object.entries(tagCounts)
      .filter(([tag]) => !PLATFORMS_META.some((p) => p.id === tag))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [tagCounts])

  const filteredTags = useMemo(() => {
    if (!tagQuery.trim()) return allTagEntries.slice(0, 24)
    const q = tagQuery.toLowerCase().trim()
    return allTagEntries.filter(([tag]) => tag.toLowerCase().includes(q)).slice(0, 24)
  }, [allTagEntries, tagQuery])

  // Count active secondary filters inside Filter popover
  const activeSecondaryCount = useMemo(() => {
    let count = 0
    if (selectedRating) count += 1
    if (selectedCategory) count += 1
    if (selectedTag) count += 1
    if (selectedKind && !primaryKinds.some(([k]) => k === selectedKind)) count += 1
    return count
  }, [selectedRating, selectedCategory, selectedTag, selectedKind, primaryKinds])

  const hasFilter = Boolean(
    selectedKind || selectedCategory || selectedTag || selectedRating || query
  )

  const handleInputChange = (e) => {
    const val = e.target.value
    const looksUrl = checkIsUrl(val)

    if (looksUrl) {
      onQuickCaptureChange?.(val)
      onQueryChange?.('')
    } else {
      onQuickCaptureChange?.('')
      onQueryChange?.(val)
    }
  }

  const handleClear = () => {
    onQuickCaptureChange?.('')
    onQueryChange?.('')
    if (searchRef?.current) searchRef.current.value = ''
    if (captureRef?.current) captureRef.current.value = ''
  }

  const handleSubmit = (e) => {
    e?.preventDefault()
    if (!trimmed) return

    if (isUrl) {
      onQuickCaptureSubmit?.(e)
    } else {
      searchRef?.current?.blur()
    }
  }

  return (
    <TooltipProvider delay={200}>
      <header className="lib-command-deck lib-command-deck--unified" data-enter>
        {/* Left: Brand / Title & Live Status */}
        <div className="lib-deck-brand">
          <h1 className="lib-deck-title">Library</h1>
          <div className="lib-deck-status" role="status" aria-live="polite">
            {isProcessingCount > 0 ? (
              <>
                <span className="lib-header-live-dot" />
                <span>Syncing {isProcessingCount}</span>
              </>
            ) : (
              <span>{total} items</span>
            )}
          </div>
        </div>

        {/* Center: Search / Omnibar Quick Capture + Embedded Format Tabs */}
        <div className="lib-deck-center">
          {/* Omnibar Form */}
          <form
            className={`lib-command-bar lib-capture ${isUrl ? 'lib-command-bar--capturing' : ''}`}
            onSubmit={handleSubmit}
            role="search"
          >
            <div className="lib-capture-row">
              <div className="lib-command-icon" aria-hidden="true">
                {isUrl ? (
                  <Icon name="link" size={14} className="lib-icon-accent" />
                ) : (
                  <Icon name="search" size={14} />
                )}
              </div>

              <input
                ref={(node) => {
                  if (searchRef) searchRef.current = node
                  if (captureRef) captureRef.current = node
                }}
                type="text"
                className="lib-capture-input lib-command-input"
                placeholder={
                  isUrl
                    ? 'Press Enter to save to library...'
                    : `Search or paste URL (${isMac ? '⌘/' : 'Ctrl+/'})`
                }
                value={rawVal}
                onChange={handleInputChange}
                aria-label="Search knowledge or paste URL to capture"
              />

              <div className="lib-command-actions">
                {isUrl && (
                  <Button
                    type="submit"
                    size="sm"
                    className="lib-capture-pill-btn"
                    title="Save directly to library (Enter)"
                  >
                    <Icon name="plus" size={12} />
                    <span>Save</span>
                    <kbd className="lib-kbd-inline">↵</kbd>
                  </Button>
                )}

                {rawVal && !isUrl && (
                  <button
                    type="button"
                    className="lib-command-clear"
                    onClick={handleClear}
                    title="Clear input"
                    aria-label="Clear input"
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}

                {!rawVal && (
                  <kbd className="lib-kbd" title="Search shortcut">
                    {isMac ? '⌘/' : 'Ctrl+/'}
                  </kbd>
                )}
              </div>
            </div>
          </form>

          {/* Embedded Format Tabs */}
          <div className="lib-segmented-tabs" role="tablist" aria-label="Media format filters">
            <button
              type="button"
              className={`lib-tab-btn ${!selectedKind ? 'lib-tab-btn--active' : ''}`}
              onClick={() => onSelectKind?.('')}
              role="tab"
              aria-selected={!selectedKind}
            >
              {!selectedKind && (
                <motion.div
                  layoutId="libUnifiedFormatTab"
                  className="lib-tab-indicator"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="lib-tab-content-wrap">
                <Icon name="grid" size={13} />
                <span>All</span>
                <span className="lib-tab-count">{total}</span>
              </span>
            </button>

            {primaryKinds.map(([kind, count]) => {
              const isActive = selectedKind === kind
              return (
                <button
                  key={kind}
                  type="button"
                  className={`lib-tab-btn ${isActive ? 'lib-tab-btn--active' : ''}`}
                  onClick={() => onSelectKind?.(isActive ? '' : kind)}
                  role="tab"
                  aria-selected={isActive}
                >
                  {isActive && (
                    <motion.div
                      layoutId="libUnifiedFormatTab"
                      className="lib-tab-indicator"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="lib-tab-content-wrap">
                    <Icon name={KIND_ICON[kind] || 'file-text'} size={13} />
                    <span className="capitalize">{kind}s</span>
                    <span className="lib-tab-count">{count}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: Filter Popover + Sort + Layout Switcher + Actions */}
        <div className="lib-deck-actions">
          {/* Filter Popover Button */}
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              className={`lib-filter-menu-btn ${activeSecondaryCount > 0 ? 'lib-filter-menu-btn--active' : ''}`}
              onClick={() => setFilterMenuOpen((prev) => !prev)}
              aria-expanded={filterMenuOpen}
              aria-label="Filter library"
            >
              <Icon name="sliders" size={13} />
              <span>Filters</span>
              {activeSecondaryCount > 0 && (
                <span className="lib-pill-count">{activeSecondaryCount}</span>
              )}
              <Icon name="down" size={11} className="opacity-60" />
            </button>

            {/* Structured Popover */}
            <AnimatePresence>
              {filterMenuOpen && (
                <motion.div
                  className="lib-dropdown-menu lib-dropdown-menu--filter-popover"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="lib-dropdown-header">
                    <span>Filter Library</span>
                    {hasFilter && (
                      <button
                        type="button"
                        className="lib-dropdown-clear"
                        onClick={() => {
                          onClearFilters?.()
                          setFilterMenuOpen(false)
                        }}
                      >
                        Reset all
                      </button>
                    )}
                  </div>

                  <div className="lib-filter-popover-body">
                    {/* Significance / Ratings */}
                    {(ratingCounts['5'] > 0 || ratingCounts['4+'] > 0) && (
                      <div className="lib-filter-section">
                        <span className="lib-filter-section-title">Significance</span>
                        <div className="lib-filter-chip-group">
                          {ratingCounts['5'] > 0 && (
                            <button
                              type="button"
                              className={`lib-filter-chip ${selectedRating === '5' ? 'is-active' : ''}`}
                              onClick={() => onSelectRating?.(selectedRating === '5' ? '' : '5')}
                            >
                              <Icon name="star" size={11} filled className="text-amber-400" />
                              <span>5★ Essential</span>
                              <span className="lib-pill-count">{ratingCounts['5']}</span>
                            </button>
                          )}
                          {ratingCounts['4+'] > 0 && (
                            <button
                              type="button"
                              className={`lib-filter-chip ${selectedRating === '4+' ? 'is-active' : ''}`}
                              onClick={() => onSelectRating?.(selectedRating === '4+' ? '' : '4+')}
                            >
                              <Icon name="star" size={11} filled className="text-amber-400" />
                              <span>4★+ High Impact</span>
                              <span className="lib-pill-count">{ratingCounts['4+']}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Platforms / Sources */}
                    {activeApps.length > 0 && (
                      <div className="lib-filter-section">
                        <span className="lib-filter-section-title">Source Platform</span>
                        <div className="lib-filter-chip-group">
                          {activeApps.map((app) => (
                            <button
                              key={app.id}
                              type="button"
                              className={`lib-filter-chip ${selectedTag === app.id ? 'is-active' : ''}`}
                              onClick={() => onSelectTag?.(selectedTag === app.id ? '' : app.id)}
                            >
                              <Icon name={app.icon} size={11} />
                              <span>{app.label}</span>
                              <span className="lib-pill-count">{app.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Categories */}
                    {categoriesList.length > 0 && (
                      <div className="lib-filter-section">
                        <span className="lib-filter-section-title">Categories</span>
                        <div className="lib-filter-chip-group">
                          {categoriesList.map(([cat, count]) => (
                            <button
                              key={cat}
                              type="button"
                              className={`lib-filter-chip ${selectedCategory === cat ? 'is-active' : ''}`}
                              onClick={() => onSelectCategory?.(selectedCategory === cat ? '' : cat)}
                            >
                              <span className="capitalize">{cat}</span>
                              <span className="lib-pill-count">{count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Other Formats */}
                    {extraKinds.length > 0 && (
                      <div className="lib-filter-section">
                        <span className="lib-filter-section-title">Other Formats</span>
                        <div className="lib-filter-chip-group">
                          {extraKinds.map(([k, count]) => (
                            <button
                              key={k}
                              type="button"
                              className={`lib-filter-chip ${selectedKind === k ? 'is-active' : ''}`}
                              onClick={() => onSelectKind?.(selectedKind === k ? '' : k)}
                            >
                              <span className="capitalize">{k}</span>
                              <span className="lib-pill-count">{count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tags Search */}
                    {allTagEntries.length > 0 && (
                      <div className="lib-filter-section">
                        <div className="lib-filter-tag-header">
                          <span className="lib-filter-section-title">Tags</span>
                          <span className="lib-filter-tag-count">{allTagEntries.length} total</span>
                        </div>

                        <div className="lib-tag-search-box">
                          <Icon name="search" size={11} className="opacity-50" />
                          <input
                            type="text"
                            placeholder="Find tag..."
                            value={tagQuery}
                            onChange={(e) => setTagQuery(e.target.value)}
                            className="lib-tag-search-input"
                          />
                          {tagQuery && (
                            <button
                              type="button"
                              onClick={() => setTagQuery('')}
                              className="lib-tag-clear-btn"
                            >
                              <Icon name="x" size={10} />
                            </button>
                          )}
                        </div>

                        <div className="lib-filter-chip-group lib-filter-chip-group--tags">
                          {filteredTags.map(([tag, count]) => (
                            <button
                              key={tag}
                              type="button"
                              className={`lib-filter-chip ${selectedTag === tag ? 'is-active' : ''}`}
                              onClick={() => onSelectTag?.(selectedTag === tag ? '' : tag)}
                            >
                              <span>#{tag}</span>
                              <span className="lib-pill-count">{count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Standalone Sort Dropdown */}
          {onOrderChange && (
            <div className="lib-deck-sort-pill" title="Change sort order">
              <Icon name="down" size={11} className="lib-deck-sort-chevron" />
              <span>{order === 'asc' ? 'Oldest' : order === 'rating' ? 'Top Rated' : 'Newest'}</span>
              <select
                value={order}
                onChange={(e) => onOrderChange?.(e.target.value)}
                aria-label="Sort order"
              >
                <option value="desc">Newest</option>
                <option value="asc">Oldest</option>
                <option value="rating">Top Rated</option>
              </select>
            </div>
          )}

          {/* Segmented Layout Toggle: Grid vs List */}
          {onLayoutChange && (
            <div className="lib-segmented-control" role="group" aria-label="View display">
              <button
                type="button"
                className={`lib-segmented-btn ${layout === 'grid' ? 'lib-segmented-btn--active' : ''}`}
                onClick={() => onLayoutChange('grid')}
                title="Bento Grid view"
                aria-label="Bento Grid view"
                aria-pressed={layout === 'grid'}
              >
                <Icon name="grid" size={14} />
              </button>
              <button
                type="button"
                className={`lib-segmented-btn ${layout === 'list' ? 'lib-segmented-btn--active' : ''}`}
                onClick={() => onLayoutChange('list')}
                title="Dense Stream view"
                aria-label="Dense Stream view"
                aria-pressed={layout === 'list'}
              >
                <Icon name="list" size={14} />
              </button>
            </div>
          )}

          {/* Export to Spotify Playlist */}
          {hasMusic && onOpenExport && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="lib-header-action-btn"
                  onClick={onOpenExport}
                  aria-label="Export discovered audio to Spotify playlist"
                >
                  <Icon name="music" size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Export audio to Spotify</TooltipContent>
            </Tooltip>
          )}

          {/* External Capture & Integrations */}
          {onToggleShare && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={`lib-header-action-btn ${showShare ? 'lib-header-action-btn--active' : ''}`}
                  onClick={onToggleShare}
                  aria-label="External capture & integrations (browser, phone, relay)"
                  aria-expanded={showShare}
                >
                  <Icon name="link" size={14} />
                </button>
              </TooltipTrigger>
              <TooltipContent>Capture & Integrations</TooltipContent>
            </Tooltip>
          )}

          {/* Primary Add Resource */}
          <button
            type="button"
            className="lib-btn lib-btn--primary lib-deck-add-btn"
            onClick={() => onOpenAddModal?.('url')}
            title={`Add resource (${isMac ? '⌘K' : 'Ctrl+K'})`}
          >
            <Icon name="plus" size={14} />
            <span>Add</span>
            <kbd className="lib-kbd lib-kbd--primary">
              {isMac ? '⌘K' : 'Ctrl+K'}
            </kbd>
          </button>
        </div>
      </header>
    </TooltipProvider>
  )
}
