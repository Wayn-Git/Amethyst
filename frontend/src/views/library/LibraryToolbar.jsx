import { useMemo } from 'react'
import Icon from '../../components/Icon.jsx'
import { IS_MAC } from '../../keys.js'

const BARE_DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/.*)?$/i

function checkIsUrl(str) {
  if (!str) return false
  const trimmed = str.trim()
  return /^https?:\/\//i.test(trimmed) || BARE_DOMAIN_RE.test(trimmed)
}

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
}) {
  const isMac =
    IS_MAC ||
    (typeof navigator !== 'undefined' &&
      /Mac|iPod|iPhone|iPad/.test(navigator.platform || ''))

  const rawVal = quickCaptureText !== '' ? quickCaptureText : query
  const trimmed = rawVal.trim()

  // Detect if current input text is a URL
  const isUrl = useMemo(() => checkIsUrl(trimmed), [trimmed])

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
    <div className="lib-command-deck" data-enter>
      {/* Left: Brand / Title & Live Item Count */}
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

      {/* Center: Search / Omnibar Quick Capture */}
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
                : `Search knowledge or paste URL to capture (${isMac ? '⌘/' : 'Ctrl+/'})`
            }
            value={rawVal}
            onChange={handleInputChange}
            aria-label="Search knowledge or paste URL to capture"
          />

          <div className="lib-command-actions">
            {/* If URL detected, show primary Save button */}
            {isUrl && (
              <button
                type="submit"
                className="lib-capture-pill-btn"
                title="Save directly to library (Enter)"
              >
                <Icon name="plus" size={12} />
                <span>Save</span>
                <kbd className="lib-kbd-inline">↵</kbd>
              </button>
            )}

            {/* Clear button when search text entered */}
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

            {/* Keyboard shortcut hint when empty */}
            {!rawVal && (
              <kbd className="lib-kbd" title="Search shortcut">
                {isMac ? '⌘/' : 'Ctrl+/'}
              </kbd>
            )}

            <div className="lib-command-divider" aria-hidden="true" />

            {/* Compact Integrated Sort Selector */}
            <div className="lib-select-container lib-select-container--compact" title="Change sort order">
              <Icon name="down" size={11} className="lib-select-icon" />
              <span>{order === 'asc' ? 'Oldest' : 'Newest'}</span>
              <select
                value={order}
                onChange={(e) => onOrderChange?.(e.target.value)}
                aria-label="Sort order"
              >
                <option value="desc">Newest</option>
                <option value="asc">Oldest</option>
              </select>
            </div>
          </div>
        </div>
      </form>

      {/* Right: Layout Switcher + Secondary Tools + Primary Add */}
      <div className="lib-deck-actions">
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
          <button
            type="button"
            className="lib-header-action-btn"
            onClick={onOpenExport}
            title="Export discovered audio to Spotify playlist"
          >
            <Icon name="music" size={14} />
          </button>
        )}

        {/* External Capture & Integrations */}
        {onToggleShare && (
          <button
            type="button"
            className={`lib-header-action-btn ${showShare ? 'lib-header-action-btn--active' : ''}`}
            onClick={onToggleShare}
            title="External capture & integrations (browser, phone, relay)"
            aria-expanded={showShare}
          >
            <Icon name="link" size={14} />
          </button>
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
    </div>
  )
}
