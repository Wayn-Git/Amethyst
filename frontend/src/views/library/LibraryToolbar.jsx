import { useMemo } from 'react'
import Icon from '../../components/Icon.jsx'

export default function LibraryToolbar({
  query = '',
  onQueryChange,
  searchRef,
  quickCaptureText = '',
  onQuickCaptureChange,
  onQuickCaptureSubmit,
  captureRef,
  order = 'desc',
  onOrderChange,
  onOpenAddModal,
}) {
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || '')

  const rawVal = quickCaptureText !== '' ? quickCaptureText : query
  const trimmed = rawVal.trim()

  // Detect if current input text is a URL
  const isUrl = useMemo(() => {
    if (!trimmed) return false
    return (
      /^https?:\/\//i.test(trimmed) ||
      (trimmed.includes('.') && !trimmed.includes(' ') && trimmed.length > 3)
    )
  }, [trimmed])

  const handleInputChange = (e) => {
    const val = e.target.value
    const looksUrl =
      /^https?:\/\//i.test(val) ||
      (val.includes('.') && !val.includes(' ') && val.length > 3)

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
    <div className="lib-command-bar-wrapper" data-enter>
      <form
        className={`lib-command-bar lib-capture ${isUrl ? 'lib-command-bar--capturing' : ''}`}
        onSubmit={handleSubmit}
        role="search"
      >
        <div className="lib-capture-row">
          <div className="lib-command-icon" aria-hidden="true">
            {isUrl ? (
              <Icon name="link" size={15} className="lib-icon-accent" />
            ) : (
              <Icon name="search" size={15} />
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
                ? 'Press Enter or click Save to capture into library...'
                : `Search knowledge by title, topic, domain... or paste URL to capture instantly (${isMac ? '⌘/' : 'Ctrl+/'})`
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
              <span>{order === 'asc' ? 'Oldest first' : 'Newest first'}</span>
              <select
                value={order}
                onChange={(e) => onOrderChange?.(e.target.value)}
                aria-label="Sort order"
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </div>

            {/* Quick Capture More Modal Trigger */}
            <button
              type="button"
              className="lib-command-more-btn"
              title="More capture options (Upload File, Note, Wikipedia)"
              onClick={() => onOpenAddModal?.('url')}
              aria-label="More capture options"
            >
              <Icon name="more" size={15} />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
