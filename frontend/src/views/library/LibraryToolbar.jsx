import Icon from '../../components/Icon.jsx'

export default function LibraryToolbar({
  query,
  onQueryChange,
  searchRef,
  order,
  onOrderChange,
  layout,
  onLayoutChange,
  railOpen,
  onToggleRail,
  onOpenAdd,
  onToggleShare,
  showShare,
  onOpenExportPlaylist,
  hasMusic = false,
  activeFilterCount = 0,
}) {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || '')

  return (
    <nav className="lib-toolbar" aria-label="Library commands and filters">
      <div className="lib-toolbar-left">
        {/* Toggle Taxonomy Sidebar */}
        <button
          type="button"
          className={`lib-rail-toggle-btn ${railOpen ? 'lib-rail-toggle-btn--active' : ''}`}
          onClick={onToggleRail}
          title={railOpen ? 'Collapse knowledge index' : 'Expand knowledge index'}
          aria-label={railOpen ? 'Collapse knowledge index' : 'Expand knowledge index'}
          aria-pressed={railOpen}
        >
          <Icon name="sidebar" size={15} />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="lib-filter-count-badge">{activeFilterCount}</span>
          )}
        </button>

        {/* Global Instant Search */}
        <div className="lib-search-box">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search knowledge by title, topic, domain..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Search library"
          />
          {query ? (
            <button
              type="button"
              className="lib-search-clear"
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
            >
              <Icon name="x" size={12} />
            </button>
          ) : (
            <kbd className="lib-kbd">{isMac ? '⌘/' : 'Ctrl+/'}</kbd>
          )}
        </div>
      </div>

      <div className="lib-toolbar-right">
        {/* Sort Chronology */}
        <div className="lib-select-container">
          <span>{order === 'asc' ? 'Oldest first' : 'Newest first'}</span>
          <Icon name="down" size={12} className="lib-select-icon" />
          <select
            value={order}
            onChange={(e) => onOrderChange(e.target.value)}
            aria-label="Sort order"
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>

        {/* Segmented Layout Toggle: Grid vs List */}
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

        {/* External Capture & Integrations */}
        <button
          type="button"
          className={`lib-btn ${showShare ? 'lib-btn--active' : ''}`}
          onClick={onToggleShare}
          title="External capture & integrations (browser, phone, relay)"
          aria-expanded={showShare}
        >
          <Icon name="link" size={14} />
          <span>Sync & Capture</span>
        </button>

        {/* Export to Spotify Playlist */}
        {hasMusic && onOpenExportPlaylist && (
          <button
            type="button"
            className="lib-btn"
            onClick={onOpenExportPlaylist}
            title="Export discovered audio to Spotify playlist"
          >
            <Icon name="music" size={14} />
            <span>Playlist</span>
          </button>
        )}

        {/* Primary Add Resource */}
        <button
          type="button"
          className="lib-btn lib-btn--primary"
          onClick={onOpenAdd}
          title={`Add resource (${isMac ? '⌘K' : 'Ctrl+K'})`}
        >
          <Icon name="plus" size={14} />
          <span>Add</span>
          <kbd className="lib-kbd" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', borderColor: 'transparent' }}>
            {isMac ? '⌘K' : 'Ctrl+K'}
          </kbd>
        </button>
      </div>
    </nav>
  )
}
