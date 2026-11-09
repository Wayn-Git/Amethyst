import React from 'react'
import Icon from '../Icon.jsx'

export const PREFIX_META = {
  yt: { id: 'yt', label: 'YouTube', icon: 'play', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  youtube: { id: 'yt', label: 'YouTube', icon: 'play', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
  gh: { id: 'gh', label: 'GitHub', icon: 'code', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  github: { id: 'gh', label: 'GitHub', icon: 'code', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)' },
  g: { id: 'g', label: 'Web', icon: 'globe', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  web: { id: 'web', label: 'Web', icon: 'globe', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.15)' },
  wiki: { id: 'wiki', label: 'Wikipedia', icon: 'book', color: '#64748b', bg: 'rgba(100, 116, 139, 0.15)' },
  sys: { id: 'sys', label: 'System', icon: 'power', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  emoji: { id: 'emoji', label: 'Emoji', icon: 'sparkles', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.15)' },
  bm: { id: 'bm', label: 'Bookmarks', icon: 'bookmark', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  bookmark: { id: 'bm', label: 'Bookmarks', icon: 'bookmark', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  note: { id: 'note', label: 'Notes', icon: 'note', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  kill: { id: 'kill', label: 'Kill Process', icon: 'x-circle', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.15)' },
}

export default function DamonHeader({
  query = '',
  inputRef,
  onChange,
  onKeyDown,
  onClear,
  isAskMode = false,
  onToggleAsk,
  activePrefix = null,
  onClearPrefix,
  expandedFeatures = false,
  onToggleExpanded,
  hotkeyLabel = '⌥ Space',
  placeholder = 'Search apps, files, the web, or ask Amethyst',
}) {
  const prefixConfig = activePrefix ? PREFIX_META[activePrefix] : null

  return (
    <div className="damon-header palette-input">
      <div className="damon-header-leading">
        {prefixConfig ? (
          <span
            className="damon-prefix-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 9px',
              borderRadius: 8,
              fontSize: 12.5,
              fontWeight: 600,
              color: prefixConfig.color,
              background: prefixConfig.bg,
              border: `1px solid ${prefixConfig.color}40`,
              letterSpacing: '0.02em',
              userSelect: 'none',
              animation: 'damon-fade-in-only 140ms ease-out',
            }}
          >
            <Icon name={prefixConfig.icon} size={13} />
            <span>{prefixConfig.label}</span>
            <button
              type="button"
              onClick={onClearPrefix}
              title="Clear prefix (Backspace)"
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: '0 2px',
                lineHeight: 1,
                fontSize: 14,
                opacity: 0.75,
              }}
            >
              ×
            </button>
          </span>
        ) : isAskMode ? (
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
        placeholder={
          prefixConfig
            ? `Search ${prefixConfig.label}…`
            : isAskMode
            ? 'Ask Amethyst anything...'
            : placeholder
        }
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        aria-label="Spotlight search and commands"
      />

      <div className="damon-header-trailing">
        {query || activePrefix ? (
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
          <>
            <button
              type="button"
              className={`damon-compact-toggle-btn${expandedFeatures ? ' is-active' : ''}`}
              onClick={onToggleExpanded}
              title={
                expandedFeatures
                  ? 'Collapse to clean search bar'
                  : 'Expand to show all features (tabs, recents, shortcuts)'
              }
              aria-label="Toggle daemon features"
            >
              <Icon name={expandedFeatures ? 'minimize-2' : 'layout-grid'} size={12} />
              <span>{expandedFeatures ? 'Clean' : 'Features'}</span>
            </button>
            <span className="damon-hotkey-badge" aria-hidden="true">
              {hotkeyLabel}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
