import { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Button from '../ui/Button.jsx'
import Field from '../ui/Field.jsx'
import { useApp } from '../../store.jsx'
import { api } from '../../api.js'

const SCHEDULE_OPTIONS = [
  { value: 'interval', label: 'Interval' },
  { value: 'daily_at', label: 'Daily at' },
  { value: 'weekly_at', label: 'Weekly on' },
]

const INTERVAL_PRESETS = [
  { minutes: 1, label: 'every minute' },
  { minutes: 5, label: 'every 5 minutes' },
  { minutes: 15, label: 'every 15 minutes' },
  { minutes: 30, label: 'every 30 minutes' },
  { minutes: 60, label: 'hourly' },
  { minutes: 60 * 4, label: 'every 4 hours' },
  { minutes: 60 * 12, label: 'twice a day' },
  { minutes: 60 * 24, label: 'daily' },
  { minutes: 60 * 24 * 7, label: 'weekly' },
]

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const NOTIFICATION_OPTIONS = [
  { value: 'email+app', label: 'Email + App' },
  { value: 'email', label: 'Email only' },
  { value: 'app', label: 'App only' },
  { value: 'off', label: 'Off' },
]

function describeInterval(minutes) {
  const found = INTERVAL_PRESETS.find((e) => e.minutes === minutes)
  if (found) return found.label
  if (minutes % 1440 === 0) return `every ${minutes / 1440} days`
  if (minutes % 60 === 0) return `every ${minutes / 60} hours`
  return `every ${minutes} minutes`
}

function formatSchedule(auto) {
  if (auto.schedule_type === 'daily_at' && auto.daily_at_time) {
    return `Daily at ${auto.daily_at_time}`
  }
  if (auto.schedule_type === 'weekly_at' && auto.daily_at_time) {
    const day = WEEKDAYS[auto.weekly_day || 0]
    return `${day} at ${auto.daily_at_time}`
  }
  return describeInterval(auto.every_minutes)
}

/** Browser's IANA timezone. */
function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return null
  }
}

/** Actions/Grants editor — which tools an automation may use unattended. */
function ActionsEditor({ actions, grantable, onChange }) {
  if (!grantable || grantable.length === 0) return null

  // Group by integration/group
  const groups = {}
  for (const action of grantable) {
    const key = action.group || 'Other'
    if (!groups[key]) groups[key] = []
    groups[key].push(action)
  }

  const toggle = (name) => {
    const next = actions.includes(name)
      ? actions.filter((n) => n !== name)
      : [...actions, name]
    onChange(next)
  }

  return (
    <div className="auto-modal-section">
      <label className="auto-modal-label">Actions</label>
      <p className="auto-actions-hint">
        Tools this automation may use without asking. Read-only tools are always allowed.
      </p>
      {Object.entries(groups).map(([group, items]) => (
        <div key={group} className="auto-actions-group">
          <div className="auto-actions-group-label">{group}</div>
          {items.map((action) => (
            <label key={action.name} className={`auto-actions-item${!action.available ? ' is-unavailable' : ''}`}>
              <input
                type="checkbox"
                checked={actions.includes(action.name)}
                onChange={() => toggle(action.name)}
              />
              <span className="auto-actions-item-label">{action.label}</span>
              {!action.available && (
                <span className="auto-actions-item-warn">
                  <Icon name="warning" size={10} />
                  {action.detail}
                </span>
              )}
              {action.available && action.detail && (
                <span className="auto-actions-item-detail">{action.detail}</span>
              )}
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Modal for creating a new automation. Supports both blank creation
    and creation from a template. */
export default function NewAutomationModal({ template, onClose, onCreated }) {
  const { toast } = useApp()
  const [name, setName] = useState(template?.name || '')
  const [description, setDescription] = useState(template?.description || '')
  const [prompt, setPrompt] = useState(template?.prompt || '')
  const [scheduleType, setScheduleType] = useState(template?.schedule_type || 'daily_at')
  const [dailyTime, setDailyTime] = useState(template?.daily_at_time || '07:00')
  const [weeklyDay, setWeeklyDay] = useState(template?.weekly_day ?? 0)
  const [intervalMinutes, setIntervalMinutes] = useState(template?.every_minutes || 60)
  const [notification, setNotification] = useState(template?.notification || 'app')
  const [timezone, setTimezone] = useState(browserTimezone() || '')
  const [actions, setActions] = useState(template?.actions || [])
  const [grantable, setGrantable] = useState(null)
  const [busy, setBusy] = useState(false)

  // Fetch grantable actions
  useEffect(() => {
    api.automationActions().then((data) => {
      setGrantable(data.actions || [])
    }).catch(() => {})
  }, [])

  const ready = name.trim() && prompt.trim()

  const create = useCallback(async () => {
    if (!ready) return
    setBusy(true)
    try {
      const body = {
        name: name.trim(),
        prompt: prompt.trim(),
        schedule_type: scheduleType,
        notification,
        description: description.trim() || null,
        timezone: timezone || null,
        actions: actions.length > 0 ? actions : null,
      }

      if (scheduleType === 'interval') {
        body.every_minutes = intervalMinutes
      } else if (scheduleType === 'daily_at') {
        body.daily_at_time = dailyTime
        body.every_minutes = 1440 // fallback
      } else if (scheduleType === 'weekly_at') {
        body.daily_at_time = dailyTime
        body.weekly_day = weeklyDay
        body.every_minutes = 1440 * 7 // fallback
      }

      if (template?.id) {
        body.template_id = template.id
      }

      await api.createAutomation(body)
      toast(`"${name.trim()}" created`, 'ok')
      onCreated?.()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }, [name, description, prompt, scheduleType, dailyTime, weeklyDay, intervalMinutes, notification, timezone, actions, template, ready, toast, onCreated])

  return (
    <div className="auto-modal-overlay" onClick={onClose}>
      <div className="auto-modal auto-modal--wide" onClick={(e) => e.stopPropagation()} data-enter>
        <div className="auto-modal-head">
          <h2>New Automation</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="auto-modal-body">
          <Field label="Name" id="auto-name">
            <input
              id="auto-name"
              autoFocus
              value={name}
              placeholder="My Automation"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Description" id="auto-desc">
            <input
              id="auto-desc"
              value={description}
              placeholder="Optional short description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <Field label="Instructions" id="auto-prompt">
            <textarea
              id="auto-prompt"
              rows={5}
              value={prompt}
              placeholder="What should this automation do?"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>

          <div className="auto-modal-section">
            <label className="auto-modal-label">Triggers</label>
            <div className="auto-schedule-row">
              <select
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value)}
                className="auto-schedule-type"
              >
                {SCHEDULE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              {scheduleType === 'interval' && (
                <select
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                  className="auto-schedule-value"
                >
                  {INTERVAL_PRESETS.map((preset) => (
                    <option key={preset.minutes} value={preset.minutes}>{preset.label}</option>
                  ))}
                </select>
              )}

              {scheduleType === 'daily_at' && (
                <input
                  type="time"
                  value={dailyTime}
                  onChange={(e) => setDailyTime(e.target.value)}
                  className="auto-schedule-time"
                />
              )}

              {scheduleType === 'weekly_at' && (
                <>
                  <select
                    value={weeklyDay}
                    onChange={(e) => setWeeklyDay(Number(e.target.value))}
                    className="auto-schedule-day"
                  >
                    {WEEKDAYS.map((day, i) => (
                      <option key={i} value={i}>{day}</option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={dailyTime}
                    onChange={(e) => setDailyTime(e.target.value)}
                    className="auto-schedule-time"
                  />
                </>
              )}
            </div>
            {timezone && (
              <div className="auto-schedule-tz">
                <Icon name="clock" size={11} />
                <span>{timezone}</span>
              </div>
            )}
          </div>

          {/* Actions / Grants */}
          <ActionsEditor
            actions={actions}
            grantable={grantable}
            onChange={setActions}
          />

          <div className="auto-modal-section">
            <label className="auto-modal-label">Notification</label>
            <select
              value={notification}
              onChange={(e) => setNotification(e.target.value)}
              className="auto-notification-select"
            >
              {NOTIFICATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="auto-modal-foot">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} busy={busy} onClick={create}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export { formatSchedule, describeInterval, INTERVAL_PRESETS, WEEKDAYS, NOTIFICATION_OPTIONS, ActionsEditor }
