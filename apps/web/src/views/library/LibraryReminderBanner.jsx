import React, { useState, useRef, useEffect } from 'react'
import Icon from '../../components/Icon.jsx'
import { useModalDismiss } from '../../hooks/useModalDismiss.js'

export function formatReminderTime(isoString) {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString

    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()

    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const isTomorrow = d.toDateString() === tomorrow.toDateString()

    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

    if (isToday) return `Today • ${timeStr}`
    if (isTomorrow) return `Tomorrow • ${timeStr}`

    const monthDay = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    return `${monthDay} • ${timeStr}`
  } catch {
    return isoString
  }
}

/**
 * Returns preset ISO date strings based on current local time
 */
export function getReminderPresets() {
  const now = new Date()

  // Tomorrow morning 09:00
  const tomMorning = new Date(now)
  tomMorning.setDate(tomMorning.getDate() + 1)
  tomMorning.setHours(9, 0, 0, 0)

  // Tomorrow evening 18:00
  const tomEvening = new Date(now)
  tomEvening.setDate(tomEvening.getDate() + 1)
  tomEvening.setHours(18, 0, 0, 0)

  // This weekend: Saturday 10:00
  const weekend = new Date(now)
  const daysUntilSat = (6 - weekend.getDay() + 7) % 7 || 7
  weekend.setDate(weekend.getDate() + daysUntilSat)
  weekend.setHours(10, 0, 0, 0)

  // Next week: Next Monday 09:00
  const nextMonday = new Date(now)
  const daysUntilMon = (1 - nextMonday.getDay() + 7) % 7 || 7
  nextMonday.setDate(nextMonday.getDate() + daysUntilMon)
  nextMonday.setHours(9, 0, 0, 0)

  return [
    { label: 'Tomorrow morning', time: '09:00', date: tomMorning.toISOString().slice(0, 19).replace('T', ' ') },
    { label: 'Tomorrow evening', time: '18:00', date: tomEvening.toISOString().slice(0, 19).replace('T', ' ') },
    { label: 'This weekend', time: 'Sat 10:00', date: weekend.toISOString().slice(0, 19).replace('T', ' ') },
    { label: 'Next week', time: 'Mon 09:00', date: nextMonday.toISOString().slice(0, 19).replace('T', ' ') },
  ]
}

export default function LibraryReminderBanner({
  item,
  onSaveReminder,
  onClearReminder,
  variant = 'card', // 'card' | 'detail' | 'compact'
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const popoverRef = useRef(null)
  const hasReminder = Boolean(item?.remind_at)
  const formattedTime = formatReminderTime(item?.remind_at)
  const defaultAction = item?.kind === 'book' || item?.kind === 'article' ? 'read' : item?.kind === 'video' ? 'watch' : 'revisit'
  const actionText = item?.remind_action || defaultAction

  const [customAction, setCustomAction] = useState(actionText)
  const [customDateTime, setCustomDateTime] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  useModalDismiss(open, () => setOpen(false))

  useEffect(() => {
    setCustomAction(item?.remind_action || defaultAction)
  }, [item?.remind_action, defaultAction])

  const handleSelectPreset = (presetDate) => {
    onSaveReminder?.({
      remind_at: presetDate,
      remind_action: customAction.trim() || defaultAction,
    })
    setOpen(false)
  }

  const handleCustomSubmit = (e) => {
    e.preventDefault()
    if (!customDateTime) return
    const formatted = customDateTime.replace('T', ' ')
    onSaveReminder?.({
      remind_at: formatted.length === 16 ? `${formatted}:00` : formatted,
      remind_action: customAction.trim() || defaultAction,
    })
    setOpen(false)
    setShowCustom(false)
  }

  // Popover content
  const popoverContent = open && (
    <div
      ref={popoverRef}
      className="lib-reminder-popover"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="lib-reminder-popover-head">
        <Icon name="bell" size={14} className="text-blue-500" />
        <span className="lib-reminder-popover-title">Set Reminder</span>
      </div>

      <div className="lib-reminder-action-input-wrap">
        <label className="lib-reminder-label">Action text</label>
        <div className="lib-reminder-action-field">
          <span className="text-neutral-400 text-xs">Remind me to</span>
          <input
            type="text"
            className="lib-reminder-action-input"
            value={customAction}
            onChange={(e) => setCustomAction(e.target.value)}
            placeholder={defaultAction}
          />
        </div>
      </div>

      {!showCustom ? (
        <div className="lib-reminder-presets-list">
          {getReminderPresets().map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="lib-reminder-preset-btn"
              onClick={() => handleSelectPreset(preset.date)}
            >
              <span className="lib-reminder-preset-label">{preset.label}</span>
              <span className="lib-reminder-preset-time">{preset.time}</span>
            </button>
          ))}
          <button
            type="button"
            className="lib-reminder-custom-btn"
            onClick={() => setShowCustom(true)}
          >
            <Icon name="calendar" size={13} />
            <span>Custom date & time...</span>
          </button>
        </div>
      ) : (
        <form onSubmit={handleCustomSubmit} className="lib-reminder-custom-form">
          <label className="lib-reminder-label">Choose date & time</label>
          <input
            type="datetime-local"
            className="lib-reminder-datetime-input"
            value={customDateTime}
            onChange={(e) => setCustomDateTime(e.target.value)}
            required
            autoFocus
          />
          <div className="lib-reminder-custom-actions">
            <button
              type="button"
              className="lib-reminder-btn-secondary"
              onClick={() => setShowCustom(false)}
            >
              Back
            </button>
            <button type="submit" className="lib-reminder-btn-primary">
              Set
            </button>
          </div>
        </form>
      )}

      {hasReminder && (
        <div className="lib-reminder-popover-footer">
          <button
            type="button"
            className="lib-reminder-clear-btn"
            onClick={() => {
              onClearReminder?.()
              setOpen(false)
            }}
          >
            <Icon name="trash" size={12} />
            <span>Remove reminder</span>
          </button>
        </div>
      )}
    </div>
  )

  // Banner view (SaveToList image 3: Berenjak card bottom callout)
  if (hasReminder) {
    return (
      <div className="lib-reminder-banner-container">
        <div
          className={`lib-reminder-banner ${variant === 'detail' ? 'lib-reminder-banner--detail' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((prev) => !prev)
          }}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={`Reminder set: Remind me to ${actionText} ${formattedTime}`}
        >
          <div className="lib-reminder-banner-left">
            <Icon name="bell" size={14} className="lib-reminder-bell-icon" />
            <span className="lib-reminder-text">Remind me to {actionText}</span>
          </div>
          <div className="lib-reminder-banner-right">
            <span className="lib-reminder-pill">
              {formattedTime} <Icon name="check" size={11} className="inline ml-1" />
            </span>
          </div>
        </div>
        {popoverContent}
      </div>
    )
  }

  // Trigger button when no reminder is active
  return (
    <div className="lib-reminder-trigger-wrap">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className={`lib-reminder-add-btn ${variant === 'detail' ? 'lib-reminder-add-btn--detail' : ''}`}
        title="Set a reminder to come back to this save"
        aria-label="Set reminder"
      >
        <Icon name="bell" size={14} />
        {variant === 'detail' && <span>Set reminder</span>}
      </button>
      {popoverContent}
    </div>
  )
}
