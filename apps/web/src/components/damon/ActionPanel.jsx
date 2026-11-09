import React, { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Button from '../ui/AppButton.jsx'

export default function ActionPanel({
  isOpen,
  activeItem,
  onSelectAction,
  onClose,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  const actions = activeItem?.actions || [
    { id: 'open', title: 'Open', shortcut: '↵', is_primary: true },
    { id: 'copy', title: 'Copy Text', shortcut: 'Cmd+C' },
    { id: 'ask', title: 'Ask AMETHYST', shortcut: 'Cmd+Shift+A' },
  ]

  useEffect(() => {
    setSelectedIndex(0)
  }, [isOpen, activeItem])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % actions.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + actions.length) % actions.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const action = actions[selectedIndex]
        if (action && onSelectAction) {
          onSelectAction(action, activeItem)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (onClose) onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isOpen, selectedIndex, actions, activeItem, onSelectAction, onClose])

  if (!isOpen) return null

  return (
    <div className="damon-action-panel" role="menu" aria-label="Action Menu">
      <div className="damon-action-panel-header">
        <span className="damon-action-panel-title">Actions for “{activeItem?.title || 'Selected Item'}”</span>
        <button
          type="button"
          className="damon-action-panel-close"
          onClick={onClose}
          aria-label="Close actions"
        >
          <kbd className="damon-action-shortcut">Esc</kbd>
        </button>
      </div>

      <div className="damon-action-list">
        {actions.map((act, i) => (
          <Button
            key={act.id}
            type="button"
            className={`damon-action-item ${i === selectedIndex ? 'active' : ''}`}
            onClick={() => onSelectAction && onSelectAction(act, activeItem)}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            <Icon name={act.icon || (act.is_primary ? 'play' : 'zap')} size={14} />
            <span className="damon-action-name">{act.title}</span>
            {act.shortcut && (
              <kbd className="damon-action-shortcut">{act.shortcut}</kbd>
            )}
          </Button>
        ))}
      </div>
    </div>
  )
}
