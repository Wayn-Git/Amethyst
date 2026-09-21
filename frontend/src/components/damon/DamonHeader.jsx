import Icon from '../Icon.jsx'

export default function DamonHeader({
  query,
  activeMode,
  flash,
  inputRef,
  onChange,
  onKeyDown,
  onClearMode,
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
        return { label: 'Actions', icon: 'zap', tone: 'cmd' }
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

  return (
    <div className="palette-input damon-header">
      <div className="damon-input-leading">
        {badge ? (
          <button
            type="button"
            className={`damon-badge-tag damon-badge-tag--${badge.tone}`}
            onClick={onClearMode}
            title="Press Backspace or Esc to clear mode"
          >
            <Icon name={badge.icon} size={12} />
            <span>{badge.label}</span>
            <Icon name="x" size={10} />
          </button>
        ) : (
          <Icon name="search" size={18} className="damon-search-icon" />
        )}
      </div>

      <input
        ref={inputRef}
        autoFocus
        value={query}
        placeholder={
          activeMode === 'youtube'
            ? 'Search YouTube videos…'
            : activeMode === 'web'
            ? 'Search the web…'
            : activeMode === 'images'
            ? 'Search free images…'
            : activeMode === 'commands'
            ? 'Type an action or shortcut…'
            : activeMode === 'library'
            ? 'Search or add to library…'
            : activeMode === 'tasks'
            ? 'Search tasks or type a new task…'
            : 'Type a command, question, or search (e.g. > youtube, > google, 24*7)…'
        }
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); onKeyDown?.(e) }}
        aria-label="Spotlight search and commands"
      />

      <div className="damon-header-trailing">
        {flash ? (
          <span className="palette-flash damon-flash">{flash}</span>
        ) : query ? (
          <button
            type="button"
            className="damon-clear-btn"
            onClick={() => onChange('')}
            title="Clear search"
          >
            <Icon name="x" size={14} />
          </button>
        ) : (
          <div className="damon-esc-hint">
            <kbd className="kbd">Esc</kbd>
          </div>
        )}
      </div>
    </div>
  )
}
