import Icon from '../Icon.jsx'

export const MODES = [
  { id: 'all', label: 'All', icon: 'search' },
  { id: 'commands', label: 'Commands', icon: 'zap', prefix: '>' },
  { id: 'web', label: 'Web', icon: 'globe', prefix: '> google ' },
  { id: 'youtube', label: 'YouTube', icon: 'play', prefix: '> youtube ' },
  { id: 'images', label: 'Images', icon: 'image', prefix: '> images ' },
  { id: 'library', label: 'Library', icon: 'book', prefix: '> library ' },
  { id: 'tasks', label: 'Tasks', icon: 'check', prefix: '> task ' },
]

export default function DamonModes({ activeMode, onSelectMode }) {
  return (
    <div className="damon-modes" role="tablist" aria-label="Search filter modes">
      {MODES.map((mode) => {
        const isActive = activeMode === mode.id
        return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`damon-mode-pill${isActive ? ' is-active' : ''}`}
            onClick={() => onSelectMode(mode.id)}
            tabIndex={-1}
          >
            <Icon name={mode.icon} size={13} />
            <span>{mode.label}</span>
          </button>
        )
      })}
    </div>
  )
}
