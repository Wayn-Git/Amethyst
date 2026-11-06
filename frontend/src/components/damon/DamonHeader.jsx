import React from 'react'
import Icon from '../Icon.jsx'

export default function DamonHeader({
  query,
  inputRef,
  onChange,
  onKeyDown,
  onClear,
  isAskMode,
  onToggleAsk,
  hotkeyLabel = '⌥ Space',
  placeholder = 'Search apps, files, the web, or ask Amethyst',
}) {
  return (
    <div className="damon-header palette-input">
      <div className="damon-header-leading">
        {isAskMode ? (
          <button
            type="button"
            className="damon-ask-pill"
            onClick={onToggleAsk}
            title="Click or press Esc to exit Ask mode"
          >
            <Icon name="spark" size={14} />
            <span>Ask</span>
          </button>
        ) : (
          <Icon name="search" size={24} className="damon-search-icon" />
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        className="damon-input"
        value={query}
        placeholder={isAskMode ? 'Ask Amethyst anything...' : placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        aria-label="Spotlight search and commands"
      />

      <div className="damon-header-trailing">
        {query ? (
          <button
            type="button"
            className="damon-clear-btn"
            onClick={onClear}
            title="Clear search (Esc)"
            aria-label="Clear query"
          >
            <Icon name="x" size={16} />
          </button>
        ) : (
          <span className="damon-hotkey-badge" aria-hidden="true">
            {hotkeyLabel}
          </span>
        )}
      </div>
    </div>
  )
}
