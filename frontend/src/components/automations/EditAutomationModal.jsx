import { useCallback, useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import Button from '../ui/Button.jsx'
import Field from '../ui/Field.jsx'
import { api } from '../../api.js'
import { INTERVAL_PRESETS, WEEKDAYS, NOTIFICATION_OPTIONS, ActionsEditor } from './NewAutomationModal.jsx'

const SCHEDULE_OPTIONS = [
  { value: 'interval', label: 'Interval' },
  { value: 'daily_at', label: 'Daily at' },
  { value: 'weekly_at', label: 'Weekly on' },
]

function formatDuration(ms) {
  if (!ms) return '—'
  if (ms < 1000) return '<1s'
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

/** Edit automation modal with Overview and Runs tabs. */
export default function EditAutomationModal({ automation, onClose, onSaved, onDeleted, onSelectRun }) {
  const [tab, setTab] = useState('overview')
  const [name, setName] = useState(automation.name || '')
  const [description, setDescription] = useState(automation.description || '')
  const [prompt, setPrompt] = useState(automation.prompt || '')
  const [scheduleType, setScheduleType] = useState(automation.schedule_type || 'interval')
  const [dailyTime, setDailyTime] = useState(automation.daily_at_time || '07:00')
  const [weeklyDay, setWeeklyDay] = useState(automation.weekly_day ?? 0)
  const [intervalMinutes, setIntervalMinutes] = useState(automation.every_minutes || 60)
  const [notification, setNotification] = useState(automation.notification || 'app')
  const [enabled, setEnabled] = useState(automation.enabled)
  const [actions, setActions] = useState(automation.actions || [])
  const [grantable, setGrantable] = useState(null)
  const [busy, setBusy] = useState('')
  const [runs, setRuns] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Fetch grantable actions
  useEffect(() => {
    api.automationActions().then((data) => {
      setGrantable(data.actions || [])
    }).catch(() => {})
  }, [])

  // Load runs when switching to Runs tab
  useEffect(() => {
    if (tab === 'runs') {
      api.automationRuns(automation.id).then((data) => {
        setRuns(data.runs || [])
      }).catch(() => setRuns([]))
    }
  }, [tab, automation.id])

  const save = useCallback(async () => {
    setBusy('save')
    try {
      const body = {
        name: name.trim(),
        prompt: prompt.trim(),
        schedule_type: scheduleType,
        notification,
        enabled,
        description: description.trim() || null,
        actions: actions.length > 0 ? actions : [],
      }
      if (scheduleType === 'interval') {
        body.every_minutes = intervalMinutes
      } else if (scheduleType === 'daily_at') {
        body.daily_at_time = dailyTime
        body.every_minutes = 1440
      } else if (scheduleType === 'weekly_at') {
        body.daily_at_time = dailyTime
        body.weekly_day = weeklyDay
        body.every_minutes = 1440 * 7
      }
      await api.updateAutomation(automation.id, body)
      onSaved?.()
    } catch {
      // toast handled by parent
    } finally {
      setBusy('')
    }
  }, [automation.id, name, description, prompt, scheduleType, dailyTime, weeklyDay, intervalMinutes, notification, enabled, actions, onSaved])

  const toggle = useCallback(async () => {
    setBusy('toggle')
    try {
      await api.updateAutomation(automation.id, { enabled: !enabled })
      setEnabled(!enabled)
      onSaved?.()
    } catch {
      // toast handled by parent
    } finally {
      setBusy('')
    }
  }, [automation.id, enabled, onSaved])

  const runNow = useCallback(async () => {
    setBusy('run')
    try {
      await api.runAutomation(automation.id)
      onSaved?.()
    } catch {
      // toast handled by parent
    } finally {
      setBusy('')
    }
  }, [automation.id, onSaved])

  const deleteAuto = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy('delete')
    try {
      await api.deleteAutomation(automation.id)
      onDeleted?.()
    } catch {
      // toast handled by parent
    } finally {
      setBusy('')
      setConfirmDelete(false)
    }
  }, [automation.id, confirmDelete, onDeleted])

  // Show warnings for unavailable actions
  const unavailable = automation.unavailable_actions || []

  return (
    <div className="auto-modal-overlay" onClick={onClose}>
      <div className="auto-modal auto-modal--wide" onClick={(e) => e.stopPropagation()} data-enter>
        <div className="auto-modal-head">
          <div className="auto-modal-tabs">
            <button
              type="button"
              className={`auto-modal-tab${tab === 'overview' ? ' is-active' : ''}`}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={`auto-modal-tab${tab === 'runs' ? ' is-active' : ''}`}
              onClick={() => setTab('runs')}
            >
              Runs
            </button>
          </div>
          <div className="auto-modal-head-actions">
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        {tab === 'overview' && (
          <div className="auto-modal-body">
            <div className="auto-modal-status">
              <span className={`auto-status-dot ${enabled ? 'is-active' : ''}`} />
              <span>{enabled ? 'Active' : 'Paused'}</span>
              {automation.timezone && (
                <span className="auto-modal-tz">
                  <Icon name="clock" size={10} />
                  {automation.timezone}
                </span>
              )}
            </div>

            {/* Unavailable action warnings */}
            {unavailable.length > 0 && (
              <div className="auto-modal-warnings">
                {unavailable.map((ua) => (
                  <div key={ua.name} className="auto-modal-warning">
                    <Icon name="warning" size={12} />
                    <span>{ua.label}: {ua.detail}</span>
                  </div>
                ))}
              </div>
            )}

            <Field label="Name" id="edit-auto-name">
              <input
                id="edit-auto-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>

            <Field label="Description" id="edit-auto-desc">
              <input
                id="edit-auto-desc"
                value={description}
                placeholder="Optional short description"
                onChange={(e) => setDescription(e.target.value)}
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
            </div>

            <Field label="Instructions" id="edit-auto-prompt">
              <textarea
                id="edit-auto-prompt"
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </Field>

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
        )}

        {tab === 'runs' && (
          <div className="auto-modal-body auto-modal-body--runs">
            {runs === null ? (
              <div className="auto-runs-loading">Loading...</div>
            ) : runs.length === 0 ? (
              <div className="auto-runs-empty">No runs yet</div>
            ) : (
              <div className="auto-runs-list">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className="auto-run-item auto-run-item--clickable"
                    onClick={() => {
                      onClose()
                      onSelectRun?.(run.id)
                    }}
                  >
                    <span className={`auto-run-status auto-run-status--${run.status}`}>
                      {run.status === 'success' ? (
                        <Icon name="check" size={12} />
                      ) : run.status === 'failed' ? (
                        <Icon name="x" size={12} />
                      ) : run.status === 'running' ? (
                        <Icon name="clock" size={12} />
                      ) : run.status === 'blocked' ? (
                        <Icon name="warning" size={12} />
                      ) : run.status === 'partial' ? (
                        <Icon name="warning" size={12} />
                      ) : (
                        <Icon name="minus" size={12} />
                      )}
                    </span>
                    <span className="auto-run-info">
                      <span className="auto-run-summary">
                        {run.result_summary || run.error || 'No details'}
                      </span>
                      <span className="auto-run-meta">
                        {run.trigger} &middot; {run.duration_ms ? formatDuration(run.duration_ms) : '—'}
                        {run.created_at && ` \u00B7 ${new Date(run.created_at).toLocaleString()}`}
                      </span>
                    </span>
                    <Icon name="caret-right" size={12} className="auto-run-arrow" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="auto-modal-foot">
          <div className="auto-modal-foot-left">
            <Button
              variant={enabled ? 'ghost' : 'primary'}
              size="small"
              disabled={busy === 'toggle'}
              onClick={toggle}
            >
              {enabled ? 'Pause' : 'Resume'}
            </Button>
            <Button
              size="small"
              disabled={busy === 'run'}
              onClick={runNow}
            >
              Run now
            </Button>
          </div>
          <div className="auto-modal-foot-right">
            <Button
              variant="danger"
              size="small"
              disabled={busy === 'delete'}
              onClick={deleteAuto}
            >
              {confirmDelete ? 'Confirm delete' : 'Delete'}
            </Button>
            <Button
              variant="primary"
              size="small"
              disabled={busy === 'save'}
              busy={busy === 'save'}
              onClick={save}
            >
              {busy === 'save' ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
