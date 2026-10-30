import React, { useState } from 'react'
import Icon from '../../components/Icon.jsx'

/**
 * Kind-aware options mapping.
 * Each item maps to 3 standard states: 'unstarted' | 'in_progress' | 'completed'
 */
export function getProgressOptions(kind = 'article') {
  const k = (kind || '').toLowerCase()
  if (k === 'book' || k === 'article' || k === 'newsletter' || k === 'paper') {
    return [
      { key: 'unstarted', label: 'Want to read' },
      { key: 'in_progress', label: 'Reading' },
      { key: 'completed', label: 'Read' },
    ]
  }
  if (k === 'video') {
    return [
      { key: 'unstarted', label: 'Want to watch' },
      { key: 'in_progress', label: 'Watching' },
      { key: 'completed', label: 'Watched' },
    ]
  }
  if (k === 'podcast' || k === 'music') {
    return [
      { key: 'unstarted', label: 'Want to listen' },
      { key: 'in_progress', label: 'Listening' },
      { key: 'completed', label: 'Listened' },
    ]
  }
  if (k === 'place') {
    return [
      { key: 'unstarted', label: 'Want to visit' },
      { key: 'in_progress', label: 'Visiting' },
      { key: 'completed', label: 'Visited' },
    ]
  }
  return [
    { key: 'unstarted', label: 'To do' },
    { key: 'in_progress', label: 'In progress' },
    { key: 'completed', label: 'Done' },
  ]
}

/**
 * ProgressSegmentedControl
 * High-taste squircle segmented control matching SaveToList & Wayn Design System.
 * Strict 12px squircle geometry, 44px touch targets, zero pill/circular buttons.
 */
export default function ProgressSegmentedControl({
  progress = 'unstarted',
  kind = 'article',
  onChange,
  variant = 'compact', // 'compact' | 'full'
  disabled = false,
}) {
  const options = getProgressOptions(kind)
  const currentKey = progress || 'unstarted'
  const currentOpt = options.find((o) => o.key === currentKey) || options[0]
  const isCompleted = currentKey === 'completed'
  const [showFullOnHover, setShowFullOnHover] = useState(false)

  // If compact variant and completed, show single badge unless hovered/clicked
  if (variant === 'compact' && isCompleted && !showFullOnHover) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setShowFullOnHover(true)
        }}
        onMouseEnter={() => setShowFullOnHover(true)}
        className="lib-progress-badge lib-progress-badge--completed"
        title="Status: Completed. Click to change."
        aria-label={`Status: ${currentOpt.label}`}
      >
        <Icon name="check" size={13} className="lib-progress-check-icon" />
        <span>{currentOpt.label}</span>
      </button>
    )
  }

  return (
    <div
      className={`lib-progress-segmented ${disabled ? 'lib-progress-segmented--disabled' : ''}`}
      onMouseLeave={() => {
        if (variant === 'compact' && isCompleted) {
          setShowFullOnHover(false)
        }
      }}
      role="radiogroup"
      aria-label="Reading progress"
    >
      {options.map((opt) => {
        const active = opt.key === currentKey
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              if (!disabled && opt.key !== currentKey) {
                onChange?.(opt.key)
              }
              if (opt.key === 'completed' && variant === 'compact') {
                setShowFullOnHover(false)
              }
            }}
            className={`lib-progress-segment ${active ? 'lib-progress-segment--active' : ''}`}
          >
            {active && opt.key === 'completed' && (
              <Icon name="check" size={12} className="lib-segment-check" />
            )}
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
