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
  onOpenAskChat,
  onToggleShare,
  showShare,
  activeFilterCount = 0,
}) {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || '')

  return (
    <div className="lib-toolbar" data-enter>
      <div className="lib-toolbar-left">
        {/* Toggle tag rail */}
        <button
          type="button"
          className={`btn btn--ghost btn--icon-only ${railOpen ? 'btn--active' : ''}`}
          onClick={onToggleRail}
          title={railOpen ? 'Hide knowledge index' : 'Show knowledge index'}
          aria-label={railOpen ? 'Hide knowledge index' : 'Show knowledge index'}
          aria-pressed={railOpen}
        >
          <Icon name="sidebar" size={15} />
          {activeFilterCount > 0 && <span className="lib-filter-dot" />}
        </button>

        {/* Search Input with Shortcut */}
        <div className="lib-search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="lib-search-input"
            placeholder="Search your knowledge (title, notes, concepts)..."
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
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
            <span className="lib-shortcut-badge mono">
              {isMac ? '⌘/' : 'Ctrl+/'}
            </span>
          )}
        </div>

      </div>

      <div className="lib-toolbar-right">
        {/* Sort order */}
        <div className="lib-select-wrap">
          <Icon name="clock" size={13} className="lib-select-icon" />
          <select
            className="lib-select"
            value={order}
            onChange={(e) => onOrderChange(e.target.value)}
            aria-label="Sort order"
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>

        {/* Layout switcher */}
        <div className="lib-layout-switch" role="group" aria-label="Layout view">
          <button
            type="button"
            className={`lib-layout-btn ${layout === 'grid' ? 'lib-layout-btn--active' : ''}`}
            onClick={() => onLayoutChange('grid')}
            title="Grid view"
            aria-label="Grid view"
            aria-pressed={layout === 'grid'}
          >
            <Icon name="grid" size={14} />
          </button>
          <button
            type="button"
            className={`lib-layout-btn ${layout === 'list' ? 'lib-layout-btn--active' : ''}`}
            onClick={() => onLayoutChange('list')}
            title="List view"
            aria-label="List view"
            aria-pressed={layout === 'list'}
          >
            <Icon name="list" size={14} />
          </button>
        </div>

        {/* Capture Integrations button */}
        <button
          type="button"
          className={`btn btn--ghost ${showShare ? 'btn--active' : ''}`}
          aria-expanded={showShare}
          onClick={onToggleShare}
          title="Save from phone, Instagram, or browser"
        >
          <Icon name="link" size={14} />
          <span className="lib-btn-label">Capture Integrations</span>
        </button>

        {/* Single Primary Add button (Screenshot 4) with Ctrl+K badge */}
        <button
          type="button"
          className="btn add-content-primary-btn"
          onClick={onOpenAdd}
          title="Add content (Ctrl+K)"
        >
          <Icon name="plus" size={14} />
          <span>Add</span>
          <span className="lib-shortcut-badge lib-shortcut-badge--contrast mono">
            {isMac ? '⌘K' : 'Ctrl+K'}
          </span>
        </button>
      </div>
    </div>
  )
}
