import React, { useState } from 'react'
import Icon from '../../components/Icon.jsx'

export const TRACKABLE_PROGRESS_KINDS = new Set([
  'book',
  'video',
  'movie',
  'place',
  'podcast',
  'article',
  'newsletter',
  'paper',
])

export function isTrackableKind(kind, isVideo = false) {
  if (isVideo) return true
  return TRACKABLE_PROGRESS_KINDS.has((kind || '').toLowerCase())
}

export function shouldShowProgress(item, isVideo = false) {
  if (!item) return false
  if (item.progress) return true
  const k = (item.kind || '').toLowerCase()
  if (isVideo || TRACKABLE_PROGRESS_KINDS.has(k)) return true
  return false
}

export function getProgressLabel(kind, status) {
  if (!status) return null
  const options = getProgressOptions(kind)
  const match = options.find((o) => o.key === status)
  return match ? match.label : status
}

export function getNextProgress(current = 'unstarted') {
  if (current === 'completed') return 'unstarted'
  if (current === 'in_progress') return 'completed'
  return 'in_progress'
}

/**
 * Kind-aware options mapping.
 * Each item maps to 3 standard states: 'unstarted' | 'in_progress' | 'completed'
 */
export function getProgressOptions(kind = 'book') {
  const k = (kind || '').toLowerCase()
  if (k === 'book') {
    return [
      { key: 'unstarted', label: 'Want to read' },
      { key: 'in_progress', label: 'Reading' },
      { key: 'completed', label: 'Read' },
    ]
  }
  if (k === 'video' || k === 'movie') {
    return [
      { key: 'unstarted', label: 'Want to watch' },
      { key: 'in_progress', label: 'Watching' },
      { key: 'completed', label: 'Watched' },
    ]
  }
  if (k === 'place') {
    return [
      { key: 'unstarted', label: 'Want to visit' },
      { key: 'in_progress', label: 'Visiting' },
      { key: 'completed', label: 'Visited' },
    ]
  }
  if (k === 'podcast') {
    return [
      { key: 'unstarted', label: 'Want to listen' },
      { key: 'in_progress', label: 'Listening' },
      { key: 'completed', label: 'Listened' },
    ]
  }
  if (k === 'article' || k === 'newsletter' || k === 'paper') {
    return [
      { key: 'unstarted', label: 'Want to read' },
      { key: 'in_progress', label: 'Reading' },
      { key: 'completed', label: 'Read' },
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
  kind = 'book',
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
