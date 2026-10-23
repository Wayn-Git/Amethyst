import { Button as HouseButton, Input as HouseInput } from '../ui/bento/index.jsx'
import Icon from '../Icon.jsx'

export default function DamonHeader({
  query,
  activeMode,
  flash,
  inputRef,
  onChange,
  onKeyDown,
  onClearMode,
  onToggleCapture,
  capturing,
}) {
  const getModeBadge = () => {
    switch (activeMode) {
      case 'youtube':
        return { label: 'YouTube', icon: 'play', tone: 'yt' }
      case 'web':
        return { label: 'Web', icon: 'globe', tone: 'web' }
      case 'images':
        return { label: 'Images', icon: 'image', tone: 'img' }
      case 'commands':
        return { label: 'Commands', icon: 'zap', tone: 'cmd' }
      case 'library':
        return { label: 'Library', icon: 'book', tone: 'lib' }
      case 'tasks':
        return { label: 'Tasks', icon: 'check', tone: 'task' }
      case 'github':
        return { label: 'GitHub', icon: 'code', tone: 'gh' }
      default:
        return null
    }
  }

  const badge = getModeBadge()

  const defaultPlaceholder =
    activeMode === 'youtube'
      ? 'Search YouTube videos…'
      : activeMode === 'web'
      ? 'Search the web…'
      : activeMode === 'images'
      ? 'Search images…'
      : activeMode === 'commands'
      ? 'Search commands…'
      : activeMode === 'library'
      ? 'Search library…'
      : activeMode === 'tasks'
      ? 'Search tasks…'
      : 'Search for apps and commands...'

  return (
    <div className="palette-input damon-header">
      <div className="damon-input-leading">
        {badge ? (
          <HouseButton
            type="button"
            className={`damon-badge-tag damon-badge-tag--${badge.tone}`}
            onClick={onClearMode}
            title="Press Backspace or Esc to clear mode"
          >
            <Icon name={badge.icon} size={13} />
            <span>{badge.label}</span>
            <Icon name="x" size={11} />
          </HouseButton>
        ) : (
          <Icon name="search" size={18} className="damon-search-icon" />
        )}
      </div>

      <HouseInput
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={defaultPlaceholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); onKeyDown?.(e) }}
        aria-label="Spotlight search and commands"
      />

      <div className="damon-header-trailing">
        {flash && (
          <span className="palette-flash damon-flash">{flash}</span>
        )}
        {query ? (
          <HouseButton
            type="button"
            className="damon-clear-btn"
            onClick={() => onChange('')}
            title="Clear search"
          >
            <Icon name="x" size={14} />
          </HouseButton>
        ) : (
          <div className="damon-ask-ai-pill" title="Press Tab to cycle filter modes">
            <span className="damon-ask-ai-text">Ask AI</span>
            <kbd className="damon-header-kbd">Tab</kbd>
          </div>
        )}
        {onToggleCapture && (
          <HouseButton
            type="button"
            className={`damon-header-capture-btn widget-buttons${capturing ? ' active' : ''}`}
            onClick={onToggleCapture}
            aria-label="Quick capture"
            title={capturing ? 'Close quick capture' : 'Quick capture'}
          >
            <Icon name={capturing ? 'x' : 'edit-3'} size={13} />
          </HouseButton>
        )}
      </div>
    </div>
  )
}

