import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { IS_MAC } from '../../keys.js'
import { KIND_ICON } from './LibraryCard.jsx'
import LibraryFilterDesk from './LibraryFilterDesk.jsx'

const BARE_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/.*)?$/i
const isUrl = (value) => /^https?:\/\//i.test(value.trim()) || BARE_DOMAIN_RE.test(value.trim())

export default function LibraryToolbar({
  total = 0, showing = 0, isProcessingCount = 0, query = '', onQueryChange, searchRef, quickCaptureText = '', onQuickCaptureChange, onQuickCaptureSubmit, captureRef,
  order = 'desc', onOrderChange, layout = 'grid', onLayoutChange, showShare, onToggleShare, hasMusic, onOpenExport, onOpenAddModal,
  counts, categoryCounts, tagCounts, appCounts, ratingCounts,
  selectedKinds = [], selectedCategories = [], selectedTags = [], selectedRatings = [],
  onSelectKinds, onSelectCategories, onSelectTags, onSelectRatings, onClearFilters,
}) {
  const [filterOpen, setFilterOpen] = useState(false)
  const mac = IS_MAC || (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || ''))
  const rawValue = quickCaptureText || query
  const capturing = isUrl(rawValue)
  const activeCount = selectedKinds.length + selectedCategories.length + selectedTags.length + selectedRatings.length
  const primaryFormats = useMemo(() => Object.entries(counts || {}).filter(([id, count]) => id !== 'total' && count > 0).sort((a,b) => b[1] - a[1]).slice(0, 3), [counts])
  const sortLabel = order === 'asc' ? 'Oldest' : order === 'rating' ? 'Top rated' : 'Newest'

  useEffect(() => {
    const keydown = (event) => {
      if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
        event.preventDefault(); setFilterOpen(true)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])

  const changeInput = (event) => {
    const value = event.target.value
    if (isUrl(value)) { onQuickCaptureChange?.(value); onQueryChange?.('') }
    else { onQuickCaptureChange?.(''); onQueryChange?.(value) }
  }
  const toggleFormat = (kind) => onSelectKinds(selectedKinds.includes(kind) ? selectedKinds.filter((item) => item !== kind) : [...selectedKinds, kind])

  return <>
    <header className="lib-command-deck lib-command-deck--unified" data-enter>
      <div className="lib-deck-topline">
        <div className="lib-deck-brand">
          <div className="lib-deck-heading-copy">
            <span className="lib-deck-eyebrow">Knowledge base</span>
            <h1 className="lib-deck-title">Library</h1>
          </div>
          <div className="lib-deck-status" role="status" aria-live="polite">
            {isProcessingCount ? <><span className="lib-header-live-dot" />Syncing {isProcessingCount}</> : <><span>{total}</span> items</>}
          </div>
        </div>
        <div className="lib-deck-primary-actions">
          {hasMusic && <button type="button" className="lib-deck-secondary-action" onClick={onOpenExport}><Icon name="music" size={14} /><span>Playlist</span></button>}
          <button type="button" className={`lib-deck-secondary-action ${showShare ? 'lib-header-action-btn--active' : ''}`} onClick={onToggleShare}><Icon name="link" size={14} /><span>Connections</span></button>
          <button type="button" className="lib-btn lib-btn--primary lib-deck-add-btn" onClick={() => onOpenAddModal?.('url')}><Icon name="plus" size={14} /><span>Add to library</span><kbd className="lib-kbd lib-kbd--primary">{mac ? '⌘K' : 'Ctrl+K'}</kbd></button>
        </div>
      </div>

      <div className="lib-deck-search-row">
        <form className={`lib-command-bar lib-capture ${capturing ? 'lib-command-bar--capturing' : ''}`} onSubmit={(event) => { event.preventDefault(); if (capturing) onQuickCaptureSubmit?.(event) }} role="search">
          <div className="lib-capture-row"><Icon name={capturing ? 'link' : 'search'} size={17} /><input ref={(node) => { if (searchRef) searchRef.current = node; if (captureRef) captureRef.current = node }} className="lib-capture-input lib-command-input" value={rawValue} onChange={changeInput} placeholder={capturing ? 'Press Enter to save this link…' : `Search your library or paste a URL (${mac ? '⌘/' : 'Ctrl/'})`} aria-label="Search library or paste URL" />{rawValue && <button type="button" className="lib-command-clear" onClick={() => { onQueryChange?.(''); onQuickCaptureChange?.('') }} aria-label="Clear search"><Icon name="x" size={14} /></button>}</div>
        </form>
        <div className="lib-deck-control-actions">
          <button type="button" className={`lib-filter-menu-btn ${activeCount ? 'lib-filter-menu-btn--active' : ''}`} onClick={() => setFilterOpen(true)} aria-haspopup="dialog" aria-expanded={filterOpen}><Icon name="sliders" size={15} /><span>Filters</span>{activeCount > 0 && <span className="lib-pill-count">{activeCount}</span>}<kbd className="lib-filter-hotkey">F</kbd></button>
          <label className="lib-deck-sort-pill"><Icon name="down" size={12} /><span className="lib-sort-label">{sortLabel}</span><select value={order} onChange={(event) => onOrderChange?.(event.target.value)} aria-label="Sort order"><option value="desc">Newest</option><option value="asc">Oldest</option><option value="rating">Top rated</option></select></label>
          <div className="lib-segmented-control" role="group" aria-label="View display"><button type="button" className={`lib-segmented-btn ${layout === 'grid' ? 'lib-segmented-btn--active' : ''}`} onClick={() => onLayoutChange?.('grid')} aria-label="Grid view"><Icon name="grid" size={15} /></button><button type="button" className={`lib-segmented-btn ${layout === 'list' ? 'lib-segmented-btn--active' : ''}`} onClick={() => onLayoutChange?.('list')} aria-label="List view"><Icon name="list" size={15} /></button></div>
        </div>
      </div>

      <div className="lib-deck-browse-row">
        <span className="lib-deck-browse-label">Browse by format</span>
        <div className="lib-segmented-tabs" role="group" aria-label="Quick format filters">{primaryFormats.map(([kind, count]) => <button key={kind} type="button" className={`lib-tab-btn ${selectedKinds.includes(kind) ? 'lib-tab-btn--active' : ''}`} onClick={() => toggleFormat(kind)}><span className="lib-tab-content-wrap"><Icon name={KIND_ICON[kind] || 'file'} size={14} /><span className="capitalize">{kind}</span><span className="lib-tab-count">{count}</span></span></button>)}</div>
        {activeCount > 0 && <span className="lib-deck-active-note">{activeCount} active {activeCount === 1 ? 'filter' : 'filters'}</span>}
      </div>
    </header>
    <LibraryFilterDesk open={filterOpen} onClose={() => setFilterOpen(false)} total={total} showing={showing} counts={counts} categoryCounts={categoryCounts} tagCounts={tagCounts} appCounts={appCounts} ratingCounts={ratingCounts} selectedKinds={selectedKinds} selectedCategories={selectedCategories} selectedTags={selectedTags} selectedRatings={selectedRatings} onSelectKinds={onSelectKinds} onSelectCategories={onSelectCategories} onSelectTags={onSelectTags} onSelectRatings={onSelectRatings} onClear={onClearFilters}/>
  </>
}
