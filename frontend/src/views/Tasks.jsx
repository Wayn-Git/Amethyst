import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api } from '../api.js'
import { confirm } from '../components/ui/confirmStore.js'
import { SkeletonRows } from '../components/Skeleton.jsx'
import './tasks.css'

/* Smart Buckets configuration */
const BUCKETS = [
  { id: 'my_day', label: 'My Day', icon: 'sun' },
  { id: 'important', label: 'Important', icon: 'star' },
  { id: 'missed', label: 'Missed', icon: 'clock' },
  { id: 'all', label: 'All Tasks', icon: 'list' },
  { id: 'completed', label: 'Completed', icon: 'archive' },
]

/* Helper date parsers and formatters */
function parseDate(value) {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(value) {
  if (!value) return null
  const date = parseDate(value)
  if (!date) return value
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatRelativeCompleted(value) {
  if (!value) return 'Completed'
  const date = parseDate(value)
  if (!date) return 'Completed'
  const today = new Date().toDateString()
  if (date.toDateString() === today) {
    return `Completed today at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
  return `Completed ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

function isOverdue(task) {
  if (!task.due_at || task.status === 'done' || task.status === 'cancelled') return false
  const due = new Date(task.due_at.replace(' ', 'T'))
  const today = new Date(new Date().toDateString())
  return due < today
}

function dayLabel(value) {
  const date = parseDate(value)
  if (!date) return null
  const days = Math.round(
    (new Date(date.toDateString()) - new Date(new Date().toDateString())) / 86400000,
  )
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year })
}



/* =========================================================================
   Task Inspector Drawer (Ultra-clean, Minimalist Linear/Apple Architecture)
   ========================================================================= */
function TaskInspector({ task, lists, busy, onPatch, onDrop, onClose }) {
  const [title, setTitle] = useState(task.title || '')
  const [notes, setNotes] = useState(task.notes || '')
  const [newStepText, setNewStepText] = useState('')
  const [steps, setSteps] = useState(task.checklist_items || [])
  const [isListMenuOpen, setIsListMenuOpen] = useState(false)
  const [isDuePickerOpen, setIsDuePickerOpen] = useState(false)
  const [isReminderPickerOpen, setIsReminderPickerOpen] = useState(false)

  const listMenuRef = useRef(null)
  const dueRef = useRef(null)
  const reminderRef = useRef(null)

  const isDone = task.status === 'done'
  const isProg = task.status === 'in_progress'
  const isMyDay = Boolean(
    task.my_day_date || (task.external_categories && task.external_categories.includes('My Day')),
  )
  const isLate = isOverdue(task)

  useEffect(() => {
    setTitle(task.title || '')
    setNotes(task.notes || '')
    setSteps(Array.isArray(task.checklist_items) ? task.checklist_items : [])
    setNewStepText('')
    setIsListMenuOpen(false)
    setIsDuePickerOpen(false)
    setIsReminderPickerOpen(false)
  }, [task])

  useEffect(() => {
    const handleOutside = (e) => {
      if (listMenuRef.current && !listMenuRef.current.contains(e.target)) {
        setIsListMenuOpen(false)
      }
      if (dueRef.current && !dueRef.current.contains(e.target)) {
        setIsDuePickerOpen(false)
      }
      if (reminderRef.current && !reminderRef.current.contains(e.target)) {
        setIsReminderPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const currentList = useMemo(() => {
    return lists.find((l) => Number(l.id) === Number(task.list_id))
  }, [lists, task.list_id])

  const toggleDone = () => {
    onPatch(task, { status: isDone ? 'todo' : 'done' })
  }

  const cycleStatus = () => {
    if (task.status === 'todo') onPatch(task, { status: 'in_progress' })
    else if (task.status === 'in_progress') onPatch(task, { status: 'done' })
    else onPatch(task, { status: 'todo' })
  }

  const toggleChecklistStep = async (stepId) => {
    const updated = steps.map((s) => (s.id === stepId ? { ...s, isChecked: !s.isChecked } : s))
    setSteps(updated)
    await onPatch(task, { checklist_items: updated })
  }

  const addChecklistStep = async (e) => {
    e.preventDefault()
    const clean = newStepText.trim()
    if (!clean) return
    const newStep = {
      id: `step_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      displayName: clean,
      isChecked: false,
    }
    const updated = [...steps, newStep]
    setSteps(updated)
    setNewStepText('')
    await onPatch(task, { checklist_items: updated })
  }

  const deleteChecklistStep = async (stepId) => {
    const updated = steps.filter((s) => s.id !== stepId)
    setSteps(updated)
    await onPatch(task, { checklist_items: updated })
  }

  const completedStepsCount = steps.filter((s) => s.isChecked).length

  const setQuickDue = (hint) => {
    setIsDuePickerOpen(false)
    if (hint === 'clear') {
      onPatch(task, { clear_due: true, due_date_hint: 'clear' })
    } else {
      onPatch(task, { due_date_hint: hint })
    }
  }

  const setCustomDueDate = (dateStr) => {
    setIsDuePickerOpen(false)
    if (dateStr) {
      onPatch(task, { due_at: `${dateStr} 18:00:00` })
    }
  }

  const setQuickReminder = (hint) => {
    setIsReminderPickerOpen(false)
    if (hint === 'clear') {
      onPatch(task, { clear_reminder: true, reminder_hint: 'clear' })
    } else {
      onPatch(task, { reminder_hint: hint })
    }
  }

  return (
    <div className="tasks-inspector-backdrop" onClick={onClose}>
      <motion.aside
        className="tasks-inspector-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Task Details"
      >
        {/* Top Header Bar */}
        <div className="tasks-inspector-head">
          <div className="tasks-inspector-head-left">
            {/* Tactile Checkbox Button */}
            <button
              type="button"
              className={`tasks-inspector-checkbox${isDone ? ' is-done' : ''}`}
              onClick={toggleDone}
              title={isDone ? 'Mark uncompleted' : 'Mark completed'}
              aria-label="Toggle completion"
            >
              {isDone && <Icon name="check" size={13} />}
            </button>

            {/* Status indicator badge */}
            <button
              type="button"
              className={`tasks-status-badge${isDone ? ' is-done' : isProg ? ' is-prog' : ''}`}
              onClick={cycleStatus}
              title="Click to cycle status: To Do → In Progress → Completed"
            >
              <span className="tasks-status-dot" />
              <span>{isDone ? 'Completed' : isProg ? 'In Progress' : 'To Do'}</span>
            </button>
          </div>

          <div className="tasks-inspector-head-actions">
            <button
              type="button"
              className={`tasks-icon-action-btn${isMyDay ? ' is-active-myday' : ''}`}
              title={isMyDay ? 'In My Day (click to remove)' : 'Add to My Day'}
              onClick={() => onPatch(task, { add_to_my_day: !isMyDay })}
            >
              <Icon name="sun" size={15} />
            </button>

            <button
              type="button"
              className={`tasks-icon-action-btn${task.important ? ' is-active-star' : ''}`}
              title={task.important ? 'Important' : 'Mark Important'}
              onClick={() => onPatch(task, { important: !task.important })}
            >
              <Icon name="star" size={15} weight={task.important ? 'fill' : 'regular'} />
            </button>

            <button
              type="button"
              className="tasks-icon-action-btn is-delete"
              title="Delete task"
              disabled={busy}
              onClick={() => {
                onDrop(task)
                onClose()
              }}
            >
              <Icon name="trash" size={15} />
            </button>

            <div className="tasks-inspector-head-divider" />

            <button
              type="button"
              className="tasks-inspector-close"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="tasks-inspector-body">
          {/* Main Title Input (Seamless, borderless) */}
          <div className="tasks-inspector-title-wrap">
            <textarea
              className={`tasks-inspector-title${isDone ? ' is-done' : ''}`}
              value={title}
              placeholder="Task title…"
              rows={1}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title.trim() && title.trim() !== task.title) {
                  onPatch(task, { title: title.trim() })
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.target.blur()
                }
              }}
            />
          </div>

          {/* Prominent 3-State Status Segmented Bar */}
          <div className="tasks-status-segmented-bar" role="group" aria-label="Task Status">
            <button
              type="button"
              className={`tasks-status-segment-btn is-todo${!isProg && !isDone ? ' is-active' : ''}`}
              onClick={() => {
                if (isProg || isDone) {
                  onPatch(task, { status: 'todo' })
                }
              }}
              title="Set status to To Do"
            >
              <span className="tasks-status-segment-dot" />
              <span>To Do</span>
            </button>

            <button
              type="button"
              className={`tasks-status-segment-btn is-prog${isProg ? ' is-active' : ''}`}
              onClick={() => {
                if (!isProg) {
                  onPatch(task, { status: 'in_progress' })
                }
              }}
              title="Set status to In Progress"
            >
              <Icon name="clock" size={13} />
              <span>In Progress</span>
            </button>

            <button
              type="button"
              className={`tasks-status-segment-btn is-done${isDone ? ' is-active' : ''}`}
              onClick={() => {
                if (!isDone) {
                  onPatch(task, { status: 'done' })
                }
              }}
              title="Set status to Completed"
            >
              <Icon name="check" size={13} />
              <span>Completed</span>
            </button>
          </div>

          {/* Properties Card (Linear/Apple Reminders Elevated Stack) */}
          <div className="tasks-inspector-card">
            {/* List Picker Row */}
            <div className="tasks-card-prop-row" ref={listMenuRef}>
              <div className="tasks-card-prop-key">
                <Icon name="folder" size={13} />
                <span>List</span>
              </div>
              <div className="tasks-card-prop-val">
                <button
                  type="button"
                  className="tasks-custom-prop-btn"
                  onClick={() => setIsListMenuOpen((o) => !o)}
                >
                  <span>{currentList ? currentList.name : 'Default List'}</span>
                  <Icon name="chevron-down" size={11} className={isListMenuOpen ? 'am-rotate-180' : ''} />
                </button>

                <AnimatePresence>
                  {isListMenuOpen && (
                    <motion.div
                      className="tasks-custom-popover-menu"
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.12 }}
                    >
                      <div className="tasks-popover-menu-title">Select List</div>
                      {lists.map((l) => {
                        const isCur = Number(l.id) === Number(task.list_id)
                        return (
                          <div
                            key={l.id}
                            className={`tasks-popover-menu-item${isCur ? ' is-selected' : ''}`}
                            onClick={() => {
                              setIsListMenuOpen(false)
                              onPatch(task, { list: l.name })
                            }}
                          >
                            <span className="tasks-popover-item-dot" />
                            <span className="tasks-popover-item-name">{l.name}</span>
                            {isCur && <Icon name="check" size={12} className="tasks-popover-check" />}
                          </div>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="tasks-card-divider" />

            {/* Due Date Row */}
            <div className="tasks-card-prop-row" ref={dueRef}>
              <div className="tasks-card-prop-key">
                <Icon name="calendar" size={13} />
                <span>Due Date</span>
              </div>
              <div className="tasks-card-prop-val">
                <button
                  type="button"
                  className={`tasks-custom-prop-btn${task.due_at ? ' has-val' : ''}${isLate ? ' is-overdue' : ''}`}
                  onClick={() => setIsDuePickerOpen((o) => !o)}
                >
                  <span>{task.due_at ? formatDate(task.due_at) : 'Add date'}</span>
                  {task.due_at ? (
                    <span
                      className="tasks-prop-inline-clear"
                      onClick={(e) => {
                        e.stopPropagation()
                        setQuickDue('clear')
                      }}
                      title="Clear due date"
                    >
                      <Icon name="x" size={10} />
                    </span>
                  ) : (
                    <Icon name="chevron-down" size={11} className={isDuePickerOpen ? 'am-rotate-180' : ''} />
                  )}
                </button>

                <AnimatePresence>
                  {isDuePickerOpen && (
                    <motion.div
                      className="tasks-custom-popover-menu"
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.12 }}
                    >
                      <div className="tasks-popover-menu-title">Due Date Preset</div>
                      <div className="tasks-popover-chips-grid">
                        <button type="button" className="tasks-picker-chip" onClick={() => setQuickDue('today')}>
                          <Icon name="sun" size={12} />
                          <span>Today</span>
                        </button>
                        <button type="button" className="tasks-picker-chip" onClick={() => setQuickDue('tomorrow')}>
                          <Icon name="clock" size={12} />
                          <span>Tomorrow</span>
                        </button>
                        <button type="button" className="tasks-picker-chip" onClick={() => setQuickDue('next week')}>
                          <Icon name="calendar" size={12} />
                          <span>Next Week</span>
                        </button>
                      </div>
                      <div className="tasks-popover-custom-date">
                        <span className="tasks-popover-sub-label">Custom Date</span>
                        <input
                          type="date"
                          className="tasks-native-date-input"
                          defaultValue={task.due_at ? task.due_at.split(' ')[0] : ''}
                          onChange={(e) => setCustomDueDate(e.target.value)}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="tasks-card-divider" />

            {/* Reminder Row */}
            <div className="tasks-card-prop-row" ref={reminderRef}>
              <div className="tasks-card-prop-key">
                <Icon name="clock" size={13} />
                <span>Reminder</span>
              </div>
              <div className="tasks-card-prop-val">
                <button
                  type="button"
                  className={`tasks-custom-prop-btn${task.reminder_at ? ' has-val' : ''}`}
                  onClick={() => setIsReminderPickerOpen((o) => !o)}
                >
                  <span>{task.reminder_at ? formatDate(task.reminder_at) : 'Add reminder'}</span>
                  {task.reminder_at ? (
                    <span
                      className="tasks-prop-inline-clear"
                      onClick={(e) => {
                        e.stopPropagation()
                        setQuickReminder('clear')
                      }}
                      title="Clear reminder"
                    >
                      <Icon name="x" size={10} />
                    </span>
                  ) : (
                    <Icon name="chevron-down" size={11} className={isReminderPickerOpen ? 'am-rotate-180' : ''} />
                  )}
                </button>

                <AnimatePresence>
                  {isReminderPickerOpen && (
                    <motion.div
                      className="tasks-custom-popover-menu"
                      initial={{ opacity: 0, y: -4, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.12 }}
                    >
                      <div className="tasks-popover-menu-title">Reminder Preset</div>
                      <div className="tasks-popover-chips-grid">
                        <button type="button" className="tasks-picker-chip" onClick={() => setQuickReminder('later today')}>
                          <Icon name="clock" size={12} />
                          <span>Later Today</span>
                        </button>
                        <button type="button" className="tasks-picker-chip" onClick={() => setQuickReminder('tomorrow 9am')}>
                          <Icon name="sun" size={12} />
                          <span>Tomorrow 9am</span>
                        </button>
                        <button type="button" className="tasks-picker-chip" onClick={() => setQuickReminder('next monday 9am')}>
                          <Icon name="calendar" size={12} />
                          <span>Next Monday</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="tasks-card-divider" />

            {/* Priority Row */}
            <div className="tasks-card-prop-row">
              <div className="tasks-card-prop-key">
                <Icon name="flag" size={13} />
                <span>Priority</span>
              </div>
              <div className="tasks-card-prop-val">
                <div className="tasks-clean-priority-group">
                  {['low', 'medium', 'high'].map((p) => {
                    const isCur = task.priority === p
                    return (
                      <button
                        key={p}
                        type="button"
                        className={`tasks-priority-chip ${p}${isCur ? ' is-active' : ''}`}
                        onClick={() => onPatch(task, { priority: isCur ? null : p })}
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Subtasks (Checklist) Card */}
          <div className="tasks-inspector-checklist-card">
            <div className="tasks-checklist-header">
              <div className="tasks-checklist-title-wrap">
                <Icon name="check-square" size={13} className="tasks-checklist-icon" />
                <span className="tasks-checklist-label">Subtasks</span>
              </div>
              {steps.length > 0 && (
                <span className="tasks-checklist-counter">
                  {completedStepsCount} of {steps.length}
                </span>
              )}
            </div>

            {steps.length > 0 && (
              <div className="tasks-checklist-progress-track">
                <div
                  className="tasks-checklist-progress-fill"
                  style={{ width: `${(completedStepsCount / steps.length) * 100}%` }}
                />
              </div>
            )}

            <div className="tasks-checklist-list">
              {steps.map((step) => (
                <div key={step.id} className="tasks-checklist-item-row">
                  <button
                    type="button"
                    className={`tasks-checklist-disc${step.isChecked ? ' is-done' : ''}`}
                    onClick={() => toggleChecklistStep(step.id)}
                    aria-label={step.isChecked ? 'Mark step incomplete' : 'Mark step complete'}
                  >
                    {step.isChecked && <Icon name="check" size={9} />}
                  </button>
                  <span className={`tasks-checklist-text${step.isChecked ? ' is-done' : ''}`}>
                    {step.displayName}
                  </span>
                  <button
                    type="button"
                    className="tasks-checklist-del-btn"
                    title="Remove step"
                    onClick={() => deleteChecklistStep(step.id)}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Step Input */}
            <form className="tasks-checklist-add-form" onSubmit={addChecklistStep}>
              <Icon name="plus" size={12} className="tasks-checklist-plus" />
              <input
                className="tasks-checklist-add-input"
                placeholder="Add a subtask…"
                value={newStepText}
                onChange={(e) => setNewStepText(e.target.value)}
              />
              {newStepText.trim() && (
                <button type="submit" className="tasks-checklist-add-submit">
                  Add
                </button>
              )}
            </form>
          </div>

          {/* Notes Card */}
          <div className="tasks-inspector-notes-card">
            <div className="tasks-notes-header">
              <Icon name="file-text" size={13} className="tasks-notes-icon" />
              <span className="tasks-notes-label">Notes</span>
            </div>
            <textarea
              className="tasks-inspector-notes"
              value={notes}
              placeholder="Add notes, context, or links…"
              rows={4}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (task.notes || '')) {
                  onPatch(task, { notes: notes.trim() || null })
                }
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="tasks-inspector-footer">
          <div className="tasks-sync-status-indicator">
            <span
              className={`tasks-sync-indicator-dot${
                task.external_source === 'microsoft-todo' || task.external_id ? ' is-synced' : ''
              }`}
            />
            <span>
              {task.external_source === 'microsoft-todo' || task.external_id
                ? 'Synced with Microsoft To Do'
                : 'Local task'}
            </span>
          </div>

          <div className="tasks-created-stamp">
            {task.created_at ? `Created ${formatDate(task.created_at)}` : ''}
          </div>
        </div>
      </motion.aside>
    </div>
  )
}


/* =========================================================================
   Task Item Row (Double-bezel, Tactile, In-Progress First-Class, Steps Badge)
   ========================================================================= */
function TaskItemRow({ task, lists, view, busy, onPatch, onSelect }) {
  const isDone = task.status === 'done'
  const isProg = task.status === 'in_progress'
  const isLate = isOverdue(task)
  const day = dayLabel(task.due_at || task.scheduled_at)
  const listName = lists.find((l) => Number(l.id) === Number(task.list_id))?.name

  const steps = Array.isArray(task.checklist_items) ? task.checklist_items : []
  const stepsDone = steps.filter((s) => s.isChecked).length

  // Quick 1-click cycle status: todo -> in_progress -> done -> todo
  const cycleStatus = (e) => {
    e.stopPropagation()
    if (task.status === 'todo') onPatch(task, { status: 'in_progress' })
    else if (task.status === 'in_progress') onPatch(task, { status: 'done' })
    else onPatch(task, { status: 'todo' })
  }

  return (
    <motion.div
      layout="position"
      className={`task-item-card${isDone ? ' is-done' : ''}${isProg ? ' is-prog' : ''}`}
      onClick={() => onSelect(task)}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <div className="task-item-shell">
        {/* Check Disc */}
        <button
          type="button"
          className={`task-check-disc${isDone ? ' is-checked' : ''}${isProg ? ' is-prog' : ''}`}
          disabled={busy}
          title={isDone ? 'Mark incomplete' : 'Mark complete'}
          aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
          onClick={(e) => {
            e.stopPropagation()
            onPatch(task, { status: isDone ? 'todo' : 'done' })
          }}
        >
          {isDone ? (
            <Icon name="check" size={11} />
          ) : isProg ? (
            <span className="task-prog-inner-dot" />
          ) : null}
        </button>

        {/* Content Body */}
        <div className="task-item-core">
          <div className="task-item-title-row">
            <span className="task-item-title">{task.title}</span>
            {isProg && !isDone && (
              <span className="task-prog-pill" title="Status: In Progress">
                <Icon name="lightning" size={10} />
                <span>In Progress</span>
              </span>
            )}
          </div>

          {task.notes && (
            <span className="task-item-notes-preview">{task.notes}</span>
          )}
        </div>

        {/* Meta Indicators & Subtask Progress */}
        <div className="task-item-indicators" onClick={(e) => e.stopPropagation()}>
          {steps.length > 0 && (
            <span className={`task-steps-badge${stepsDone === steps.length ? ' is-all-done' : ''}`}>
              <Icon name="list" size={11} />
              <span>
                {stepsDone}/{steps.length}
              </span>
            </span>
          )}

          {isDone && task.completed_at && (
            <span className="task-meta-time" title={formatDate(task.completed_at)}>
              {formatRelativeCompleted(task.completed_at)}
            </span>
          )}

          {day && !isDone && (
            <span
              className={`task-meta-badge ${
                isLate ? 'is-overdue' : day === 'Today' ? 'is-today' : ''
              }`}
            >
              <Icon name="clock" size={11} />
              <span>{isLate ? `Overdue • ${day}` : day}</span>
            </span>
          )}

          {listName && !view.listId && view.bucket !== 'my_day' && (
            <span className="task-list-tag">
              <Icon name="folder" size={11} />
              <span>{listName}</span>
            </span>
          )}

          {/* Quick Status Cycle Pill */}
          {!isDone && (
            <button
              type="button"
              className={`task-quick-prog-toggle${isProg ? ' is-active' : ''}`}
              title={isProg ? 'Mark completed' : 'Mark in progress'}
              onClick={cycleStatus}
            >
              <Icon name="lightning" size={11} />
            </button>
          )}

          {/* Star Icon */}
          <button
            type="button"
            className={`task-star-btn${task.important ? ' is-starred' : ''}`}
            disabled={busy}
            title={task.important ? 'Starred' : 'Mark important'}
            aria-label="Star"
            onClick={(e) => {
              e.stopPropagation()
              onPatch(task, { important: !task.important })
            }}
          >
            <Icon name="star" size={13} weight={task.important ? 'fill' : 'regular'} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

/* =========================================================================
   Board Kanban Column Card
   ========================================================================= */
function BoardCard({ task, busy, onPatch, onSelect }) {
  const isDone = task.status === 'done'
  const isProg = task.status === 'in_progress'
  const isLate = isOverdue(task)
  const day = dayLabel(task.due_at || task.scheduled_at)
  const steps = Array.isArray(task.checklist_items) ? task.checklist_items : []

  return (
    <motion.div
      layout="position"
      className={`tasks-board-card${isDone ? ' is-done' : ''}${isProg ? ' is-prog' : ''}`}
      onClick={() => onSelect(task)}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <div className="tasks-board-card-top">
        <button
          type="button"
          className={`task-check-disc${isDone ? ' is-checked' : ''}${isProg ? ' is-prog' : ''}`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onPatch(task, { status: isDone ? 'todo' : 'done' })
          }}
        >
          {isDone ? <Icon name="check" size={10} /> : null}
        </button>

        <button
          type="button"
          className={`task-star-btn${task.important ? ' is-starred' : ''}`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onPatch(task, { important: !task.important })
          }}
        >
          <Icon name="star" size={13} weight={task.important ? 'fill' : 'regular'} />
        </button>
      </div>

      <h4 className="tasks-board-card-title">{task.title}</h4>

      {task.notes && <p className="tasks-board-card-notes">{task.notes}</p>}

      <div className="tasks-board-card-meta">
        {day && (
          <span className={`task-meta-badge ${isLate ? 'is-overdue' : day === 'Today' ? 'is-today' : ''}`}>
            <Icon name="clock" size={11} />
            <span>{day}</span>
          </span>
        )}

        {steps.length > 0 && (
          <span className="task-steps-badge">
            <Icon name="list" size={10} />
            <span>
              {steps.filter((s) => s.isChecked).length}/{steps.length}
            </span>
          </span>
        )}
      </div>
    </motion.div>
  )
}

/* =========================================================================
   Empty State Component (Context-aware, inspiring, zero void)
   ========================================================================= */
function TasksEmptyState({ bucket, activeLabel, searchQuery, onAction }) {
  if (searchQuery) {
    return (
      <div className="tasks-empty-container">
        <div className="tasks-empty-card">
          <div className="tasks-empty-icon-ring">
            <Icon name="search" size={20} />
          </div>
          <h3 className="tasks-empty-title">No matching tasks</h3>
          <p className="tasks-empty-desc">
            No tasks found matching &ldquo;{searchQuery}&rdquo;. Try another query.
          </p>
        </div>
      </div>
    )
  }

  const configs = {
    my_day: {
      icon: 'sun',
      title: 'Your day is clear',
      desc: 'Focus on what matters most. Add tasks for today or move tasks from your lists.',
      chip: '+ Add task for today',
    },
    important: {
      icon: 'star',
      title: 'No starred tasks',
      desc: 'Star critical items across your lists to highlight them in one consolidated view.',
      chip: '+ Add important task',
    },
    missed: {
      icon: 'clock',
      title: 'No overdue deadlines',
      desc: 'You are completely caught up. All scheduled tasks are on track.',
      chip: 'Schedule a task',
    },
    completed: {
      icon: 'check',
      title: 'No completed tasks yet',
      desc: 'Tasks finished today or earlier will appear here organized by timeline.',
      chip: null,
    },
    general: {
      icon: 'list',
      title: 'All tasks clear',
      desc: 'Your workspace is clear. Capture ideas or organize tasks for your projects.',
      chip: '+ New task',
    },
  }

  const cfg = configs[bucket] || {
    icon: 'folder',
    title: `${activeLabel} is empty`,
    desc: 'Add tasks to this list to sync with Microsoft To Do across your devices.',
    chip: `+ Add to ${activeLabel}`,
  }

  return (
    <div className="tasks-empty-container">
      <div className="tasks-empty-card">
        <div className="tasks-empty-icon-ring">
          <Icon name={cfg.icon} size={22} />
        </div>
        <h3 className="tasks-empty-title">{cfg.title}</h3>
        <p className="tasks-empty-desc">{cfg.desc}</p>
        {cfg.chip && (
          <button type="button" className="tasks-empty-action-chip" onClick={onAction}>
            <span>{cfg.chip}</span>
          </button>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
   Main Tasks View
   ========================================================================= */
export default function Tasks() {
  const rootRef = useRef(null)
  const quickInputRef = useRef(null)
  const { toast } = useApp()
  const [view, setViewKey] = useState({ bucket: 'my_day', listId: null })
  const [viewMode, setViewMode] = useState('list') // 'list' | 'board'
  const [searchQuery, setSearchQuery] = useState('')

  const landed = useRef(false)
  const [tasks, setTasks] = useState([])
  const [counts, setCounts] = useState({
    buckets: {},
    lists: [],
    connected: false,
    my_day_list_id: null,
  })
  const [error, setError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [inspectingTask, setInspectingTask] = useState(null)
  const [busyTaskId, setBusyTaskId] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [showDone, setShowDone] = useState(true)

  /* Inline quick task input */
  const [quickTitle, setQuickTitle] = useState('')
  const [quickImportant, setQuickImportant] = useState(false)
  const [quickBusy, setQuickBusy] = useState(false)

  /* Inline custom list creation */
  const [addingList, setAddingList] = useState(false)
  const [newListTitle, setNewListTitle] = useState('')

  useViewEntrance(rootRef)
  const loadToken = useRef(0)

  /* Main Data Fetcher */
  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const isCompletedBucket = !view.listId && view.bucket === 'completed'
      const isMyDay = !view.listId && view.bucket === 'my_day'

      const [rows, summary] = await Promise.all([
        api.tasks(
          view.listId
            ? { listId: view.listId }
            : { bucket: isCompletedBucket ? 'completed' : isMyDay ? 'my_day' : view.bucket || 'all' },
        ),
        api.taskBuckets(),
      ])
      if (loadToken.current !== token) return

      setTasks(rows || [])
      setCounts(summary)
      setError(null)
    } catch (err) {
      if (loadToken.current !== token) return
      setError(err.message)
      setTasks([])
      toast(err.message, 'bad')
    } finally {
      if (loadToken.current === token) setLoaded(true)
    }
  }, [view, toast])

  useEffect(() => {
    load()
  }, [load])

  /* Auto-sync on mount if connected, and on window visibility focus */
  useEffect(() => {
    let timer = null
    const runAutoSync = async () => {
      try {
        await api.syncTasks()
        await load()
      } catch {
        // silent fail on auto-sync background
      }
    }

    // Run background sync periodically (every 25 seconds)
    timer = setInterval(runAutoSync, 25000)

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        runAutoSync()
      }
    }
    document.addEventListener('visibilitychange', handleFocus)

    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', handleFocus)
    }
  }, [load])

  /* Default landing */
  useEffect(() => {
    if (landed.current || !counts.buckets || Object.keys(counts.buckets).length === 0) return
    const { my_day: myDay = 0, missed = 0, general = 0, all = 0 } = counts.buckets
    landed.current = true
    if (myDay > 0) return
    if (missed > 0) setViewKey({ bucket: 'missed', listId: null })
    else if (all > 0 || general > 0) setViewKey({ bucket: 'all', listId: null })
  }, [counts])

  /* Optimistic mutation handlers */
  const patchTask = useCallback(
    async (task, body, note) => {
      setBusyTaskId(task.id)
      // Optimistic local update
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, ...body } : t)),
      )
      if (inspectingTask?.id === task.id) {
        setInspectingTask((prev) => ({ ...prev, ...body }))
      }

      try {
        const updated = await api.updateTask(task.id, body)
        if (updated) {
          setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
        }
        if (note) toast(note, 'ok')
        // Refresh counts in background
        api.taskBuckets().then((s) => setCounts(s)).catch(() => {})
      } catch (err) {
        toast(err.message, 'bad')
        await load()
      } finally {
        setBusyTaskId(null)
      }
    },
    [inspectingTask, load, toast],
  )

  const dropTask = useCallback(
    async (task) => {
      setBusyTaskId(task.id)
      setTasks((prev) => prev.filter((t) => t.id !== task.id))
      try {
        await api.deleteTask(task.id)
        toast('Task deleted', 'ok')
        if (inspectingTask?.id === task.id) setInspectingTask(null)
        api.taskBuckets().then((s) => setCounts(s)).catch(() => {})
      } catch (err) {
        toast(err.message, 'bad')
        await load()
      } finally {
        setBusyTaskId(null)
      }
    },
    [inspectingTask, load, toast],
  )

  const syncToDo = useCallback(async () => {
    setSyncing(true)
    try {
      const report = await api.syncTasks()
      toast(report.summary || 'Synced with Microsoft To Do', 'ok')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSyncing(false)
    }
  }, [load, toast])

  const createList = useCallback(
    async (name) => {
      const clean = name.trim()
      if (!clean) return
      try {
        const made = await api.createTaskList(clean)
        toast(made.note ? `List created — ${made.note}` : 'List created', 'ok')
        if (made?.id) {
          setViewKey({ bucket: 'all', listId: made.id })
        }
        await load()
      } catch (err) {
        toast(err.message, 'bad')
      }
    },
    [load, toast],
  )

  const deleteList = useCallback(
    async (targetList) => {
      if (!targetList?.id) return
      if (targetList.is_default || Number(targetList.id) === Number(counts.my_day_list_id)) {
        toast('Cannot delete default system list', 'bad')
        return
      }
      let ok = false
      try {
        ok = await confirm({
          title: `Delete "${targetList.name}" list?`,
          description: 'This will delete this list and cancel any tasks filed in it.',
          confirmLabel: 'Delete List',
          tone: 'danger',
        })
      } catch {
        ok = window.confirm(`Delete "${targetList.name}" list?`)
      }
      if (!ok) return

      try {
        await api.deleteTaskList(targetList.id)
        toast(`List "${targetList.name}" deleted`, 'ok')
        if (Number(view.listId) === Number(targetList.id)) {
          setViewKey({ bucket: 'my_day', listId: null })
        }
        await load()
      } catch (err) {
        toast(err.message, 'bad')
      }
    },
    [counts, view.listId, load, toast],
  )

  const handleCreateListSubmit = async (e) => {
    e.preventDefault()
    const clean = newListTitle.trim()
    if (!clean) return
    try {
      const made = await api.createTaskList(clean)
      toast(made.note ? `List created — ${made.note}` : `List "${clean}" created`, 'ok')
      setNewListTitle('')
      setAddingList(false)
      const summary = await api.taskBuckets()
      setCounts(summary)
      if (made?.id) {
        setViewKey({ bucket: 'list', listId: made.id })
      }
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleRenameCurrentList = async () => {
    if (!activeHeader.list || activeHeader.list.is_default) return
    const newName = window.prompt('Rename list to:', activeHeader.list.name)
    if (!newName || !newName.trim() || newName.trim() === activeHeader.list.name) return
    try {
      await api.renameTaskList(activeHeader.list.id, newName.trim())
      toast(`Renamed to "${newName.trim()}"`, 'ok')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  const handleDeleteCurrentList = async () => {
    if (!activeHeader.list || activeHeader.list.is_default) return
    let ok = false
    try {
      ok = await confirm({
        title: `Delete "${activeHeader.list.name}" list?`,
        description: 'This will delete this list and cancel any tasks filed in it.',
        confirmLabel: 'Delete List',
        tone: 'danger',
      })
    } catch {
      ok = window.confirm(`Delete "${activeHeader.list.name}" list?`)
    }
    if (!ok) return
    try {
      await api.deleteTaskList(activeHeader.list.id)
      toast(`List "${activeHeader.list.name}" deleted`, 'ok')
      setViewKey({ bucket: 'general', listId: null })
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  /* Inline quick task submit */
  const handleQuickAdd = async (e) => {
    e.preventDefault()
    const clean = quickTitle.trim()
    if (!clean || quickBusy) return

    setQuickBusy(true)
    try {
      const targetList = view.listId
        ? counts.lists?.find((l) => Number(l.id) === Number(view.listId))?.name
        : view.bucket === 'my_day'
        ? counts.lists?.find((l) => Number(l.id) === Number(counts.my_day_list_id))?.name || 'My Day'
        : undefined

      await api.createTask({
        title: clean,
        important: quickImportant,
        list: targetList || null,
        add_to_my_day: view.bucket === 'my_day',
      })
      toast('Task added', 'ok')
      setQuickTitle('')
      setQuickImportant(false)
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setQuickBusy(false)
    }
  }

  /* Active Header Information */
  const activeHeader = useMemo(() => {
    if (view.listId) {
      const found = counts.lists?.find((l) => Number(l.id) === Number(view.listId))
      return {
        label: found?.name || 'Custom List',
        isCustom: true,
        list: found,
      }
    }
    const b = BUCKETS.find((bk) => bk.id === view.bucket) || BUCKETS[0]
    return { label: b.label, isCustom: false }
  }, [view, counts])

  /* Filtered Tasks */
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchTitle = t.title?.toLowerCase().includes(q)
        const matchNotes = t.notes?.toLowerCase().includes(q)
        if (!matchTitle && !matchNotes) return false
      }
      return true
    })
  }, [tasks, searchQuery])

  /* Open vs Completed split */
  const [openTasks, completedTasks] = useMemo(() => {
    if (view.bucket === 'completed') {
      // In completed bucket: ONLY completed tasks exist!
      return [[], filteredTasks.filter((t) => t.status === 'done')]
    }
    return [
      filteredTasks.filter((t) => t.status !== 'done'),
      filteredTasks.filter((t) => t.status === 'done'),
    ]
  }, [filteredTasks, view.bucket])

  /* Intelligent Section Grouping for Open Tasks */
  const taskSections = useMemo(() => {
    if (view.bucket === 'completed') return []
    if (view.bucket === 'my_day') {
      return [{ id: 'today_focus', label: "Today's Focus", tasks: openTasks }]
    }

    const overdue = []
    const dueToday = []
    const upcoming = []
    const noDate = []

    for (const t of openTasks) {
      if (isOverdue(t)) overdue.push(t)
      else if (dayLabel(t.due_at) === 'Today') dueToday.push(t)
      else if (t.due_at) upcoming.push(t)
      else noDate.push(t)
    }

    const sections = []
    if (overdue.length > 0) {
      sections.push({ id: 'overdue', label: 'Overdue', badge: overdue.length, tone: 'late', tasks: overdue })
    }
    if (dueToday.length > 0) {
      sections.push({ id: 'today', label: 'Due Today', badge: dueToday.length, tone: 'today', tasks: dueToday })
    }
    if (upcoming.length > 0) {
      sections.push({ id: 'upcoming', label: 'Upcoming', badge: upcoming.length, tasks: upcoming })
    }
    if (noDate.length > 0) {
      sections.push({
        id: 'no_date',
        label: sections.length > 0 ? 'No Due Date' : 'Tasks',
        badge: noDate.length,
        tasks: noDate,
      })
    }

    return sections
  }, [openTasks, view.bucket])

  /* Completed Tasks Grouping by Date for Completed View */
  const completedDateSections = useMemo(() => {
    if (view.bucket !== 'completed') return []
    const today = []
    const yesterday = []
    const thisMonth = []
    const older = []

    for (const t of completedTasks) {
      const stamp = t.completed_at
      const d = parseDate(stamp)
      if (!d) {
        older.push(t)
        continue
      }
      const label = dayLabel(stamp)
      if (label === 'Today') today.push(t)
      else if (label === 'Yesterday') yesterday.push(t)
      else if (new Date() - d < 30 * 86400000) thisMonth.push(t)
      else older.push(t)
    }

    const groups = []
    if (today.length > 0) groups.push({ id: 'done_today', label: 'Completed Today', tasks: today })
    if (yesterday.length > 0) groups.push({ id: 'done_yesterday', label: 'Yesterday', tasks: yesterday })
    if (thisMonth.length > 0) groups.push({ id: 'done_month', label: 'Earlier this Month', tasks: thisMonth })
    if (older.length > 0) groups.push({ id: 'done_older', label: 'Older Completed', tasks: older })

    if (groups.length === 0 && completedTasks.length > 0) {
      groups.push({ id: 'all_done', label: 'Completed Archive', tasks: completedTasks })
    }
    return groups
  }, [completedTasks, view.bucket])

  /* Board Kanban Columns */
  const boardColumns = useMemo(() => {
    const todo = []
    const inProg = []
    const done = []

    for (const task of filteredTasks) {
      if (task.status === 'done') done.push(task)
      else if (task.status === 'in_progress') inProg.push(task)
      else todo.push(task)
    }

    return [
      { id: 'todo', label: 'To Do', tasks: todo, status: 'todo' },
      { id: 'progress', label: 'In Progress', tasks: inProg, status: 'in_progress' },
      { id: 'done', label: 'Completed', tasks: done, status: 'done' },
    ]
  }, [filteredTasks])

  const customLists = useMemo(() => {
    return (counts.lists || []).filter((l) => {
      if (Number(l.id) === Number(counts.my_day_list_id)) return false
      if (l.is_default || l.name === 'Tasks') return false
      return true
    })
  }, [counts.lists, counts.my_day_list_id])

  return (
    <div className="view tasks-viewport" ref={rootRef}>
      {/* ----------------- Top Header & Navigation Subnav ----------------- */}
      <header className="tasks-header-container">
        {/* Top Command Bar */}
        <div className="tasks-top-bar">
          <div className="tasks-top-left">
            <h1 className="tasks-top-title">{activeHeader.label}</h1>
            <span className="tasks-count-label">
              {loaded
                ? view.bucket === 'completed'
                  ? `${completedTasks.length} completed`
                  : `${openTasks.length} ${openTasks.length === 1 ? 'task' : 'tasks'}`
                : '…'}
            </span>

            {/* Custom List Options: Rename and Delete */}
            {activeHeader.isCustom && !activeHeader.list?.is_default && (
              <div className="tasks-list-actions-bar">
                <button
                  type="button"
                  className="tasks-list-action-pill"
                  onClick={handleRenameCurrentList}
                  title={`Rename list "${activeHeader.list.name}"`}
                >
                  <Icon name="pencil" size={11} />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  className="tasks-list-action-pill is-danger"
                  onClick={handleDeleteCurrentList}
                  title={`Delete list "${activeHeader.list.name}"`}
                >
                  <Icon name="trash" size={11} />
                  <span>Delete</span>
                </button>
              </div>
            )}
          </div>

          <div className="tasks-top-right">
            <div className="tasks-search-wrap">
              <Icon name="search" size={14} className="tasks-search-icon" />
              <input
                type="text"
                className="tasks-search-input"
                placeholder="Search tasks…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="tasks-search-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  <Icon name="x" size={13} />
                </button>
              )}
            </div>

            <div className="tasks-view-switch">
              <button
                type="button"
                className={`tasks-view-switch-btn${viewMode === 'list' ? ' is-active' : ''}`}
                onClick={() => setViewMode('list')}
                title="List view"
              >
                <Icon name="list" size={14} />
                <span>List</span>
              </button>
              <button
                type="button"
                className={`tasks-view-switch-btn${viewMode === 'board' ? ' is-active' : ''}`}
                onClick={() => setViewMode('board')}
                title="Board view"
              >
                <Icon name="layout" size={14} />
                <span>Board</span>
              </button>
            </div>

            <button
              type="button"
              className="tasks-sync-btn"
              disabled={syncing}
              onClick={syncToDo}
              title={counts.connected ? 'Connected to Microsoft To Do' : 'Sync tasks'}
            >
              <span
                className={`tasks-sync-indicator${counts.connected ? ' is-connected' : ''}`}
              />
              <Icon
                name="refresh"
                size={14}
                className={syncing ? 'am-spin' : ''}
              />
              <span>{syncing ? 'Syncing…' : 'Sync'}</span>
            </button>
          </div>
        </div>

        {/* Integrated Navigation Tabs: Smart Buckets + User Lists */}
        <div className="tasks-subnav">
          <div className="tasks-tabs-track">
            {BUCKETS.map((bucket) => {
              const isActive = !view.listId && view.bucket === bucket.id
              const count = loaded ? counts.buckets?.[bucket.id] ?? 0 : null
              return (
                <button
                  key={bucket.id}
                  type="button"
                  className={`tasks-tab-btn${isActive ? ' is-active' : ''}`}
                  onClick={() => setViewKey({ bucket: bucket.id, listId: null })}
                >
                  <Icon name={bucket.icon} size={15} />
                  <span>{bucket.label}</span>
                  {count != null && <span className="tasks-tab-badge">({count})</span>}
                </button>
              )
            })}

            {/* Subtle Vertical Divider between Buckets and Lists */}
            {customLists.length > 0 && <div className="tasks-tabs-divider" />}

            {/* First-Class User Lists Directly as Tabs */}
            {customLists.map((l) => {
              const isActive = Number(view.listId) === Number(l.id)
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`tasks-tab-btn tasks-list-tab-btn${isActive ? ' is-active' : ''}`}
                  onClick={() => setViewKey({ bucket: 'list', listId: l.id })}
                  title={`List: ${l.name}`}
                >
                  <Icon name="folder" size={15} className="tasks-list-tab-icon" />
                  <span>{l.name}</span>
                  {l.open != null && <span className="tasks-tab-badge">({l.open})</span>}
                </button>
              )
            })}

            {/* Inline New List Creator Button / Form */}
            {addingList ? (
              <form className="tasks-new-list-inline-form" onSubmit={handleCreateListSubmit}>
                <Icon name="folder" size={14} className="tasks-new-list-icon" />
                <input
                  autoFocus
                  className="tasks-new-list-inline-input"
                  placeholder="New list name…"
                  value={newListTitle}
                  onChange={(e) => setNewListTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setAddingList(false)
                  }}
                />
                <button type="submit" className="tasks-new-list-submit-btn" disabled={!newListTitle.trim()}>
                  Add
                </button>
                <button type="button" className="tasks-new-list-cancel-btn" onClick={() => setAddingList(false)}>
                  <Icon name="x" size={13} />
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="tasks-tab-btn tasks-add-list-tab-btn"
                onClick={() => setAddingList(true)}
                title="Create a new task list"
              >
                <Icon name="plus" size={14} />
                <span>New List</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ----------------- Main Workspace Content ----------------- */}
      <main className="tasks-main">
        {/* Full-Width Quick-Add Bar */}
        {view.bucket !== 'completed' && (
          <form className="tasks-quick-bar" onSubmit={handleQuickAdd}>
            <Icon name="plus" size={15} className="tasks-quick-plus" />
            <input
              ref={quickInputRef}
              className="tasks-quick-input"
              placeholder={`Add task to ${activeHeader.label}…`}
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
            />
            <div className="tasks-quick-actions">
              <button
                type="button"
                className={`tasks-quick-toggle-btn${quickImportant ? ' is-active' : ''}`}
                onClick={() => setQuickImportant((v) => !v)}
                title="Mark important"
              >
                <Icon name="star" size={13} weight={quickImportant ? 'fill' : 'regular'} />
                <span>Important</span>
              </button>

              <kbd className="tasks-kbd-hint">Enter</kbd>
            </div>
          </form>
        )}

        {!loaded && <SkeletonRows rows={8} controls={2} />}

        {loaded && error && (
          <div className="tasks-empty-container">
            <div className="tasks-empty-card">
              <div className="tasks-empty-icon-ring">
                <Icon name="alert" size={20} />
              </div>
              <h3 className="tasks-empty-title">Failed to load tasks</h3>
              <p className="tasks-empty-desc">{error}</p>
              <button
                type="button"
                className="tasks-sync-btn"
                style={{ marginTop: 8 }}
                onClick={load}
              >
                <Icon name="refresh" size={13} />
                <span>Retry</span>
              </button>
            </div>
          </div>
        )}

        {/* ----------------- List View ----------------- */}
        {loaded && !error && viewMode === 'list' && (
          <div className="tasks-content-flow">
            {/* When Empty */}
            {openTasks.length === 0 && completedTasks.length === 0 && (
              <TasksEmptyState
                bucket={view.bucket}
                activeLabel={activeHeader.label}
                searchQuery={searchQuery}
                onAction={() => quickInputRef.current?.focus()}
              />
            )}

            {/* Completed Bucket View: Grouped cleanly by date, strictly no checkboxes to tick */}
            {view.bucket === 'completed' && (
              <div className="tasks-sections-stack">
                {completedDateSections.map((sec) => (
                  <div key={sec.id} className="tasks-section-group">
                    <div className="tasks-section-header">
                      <span className="tasks-section-title">{sec.label}</span>
                      <span className="tasks-section-badge">{sec.tasks.length}</span>
                    </div>

                    <div className="tasks-list-cards-wrap">
                      <AnimatePresence>
                        {sec.tasks.map((task) => (
                          <TaskItemRow
                            key={task.id}
                            task={task}
                            lists={counts.lists || []}
                            view={view}
                            busy={busyTaskId === task.id}
                            onPatch={patchTask}
                            onSelect={setInspectingTask}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Standard Open Tasks View: Grouped into readable sections */}
            {view.bucket !== 'completed' && (
              <div className="tasks-sections-stack">
                {taskSections.map((sec) => (
                  <div key={sec.id} className="tasks-section-group">
                    {taskSections.length > 1 && (
                      <div className="tasks-section-header">
                        <span className={`tasks-section-title ${sec.tone || ''}`}>
                          {sec.label}
                        </span>
                        <span className="tasks-section-badge">{sec.badge}</span>
                      </div>
                    )}

                    <div className="tasks-list-cards-wrap">
                      <AnimatePresence>
                        {sec.tasks.map((task) => (
                          <TaskItemRow
                            key={task.id}
                            task={task}
                            lists={counts.lists || []}
                            view={view}
                            busy={busyTaskId === task.id}
                            onPatch={patchTask}
                            onSelect={setInspectingTask}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}

                {/* Collapsible Completed Section in List/MyDay View */}
                {completedTasks.length > 0 && (
                  <div className="tasks-completed-collapsible-area">
                    <button
                      type="button"
                      className="tasks-completed-accordion-btn"
                      onClick={() => setShowDone((s) => !s)}
                    >
                      <Icon
                        name={showDone ? 'chevron-down' : 'chevron-right'}
                        size={12}
                      />
                      <span>
                        {view.bucket === 'my_day' ? 'Completed Today' : 'Completed'} (
                        {completedTasks.length})
                      </span>
                    </button>

                    <AnimatePresence>
                      {showDone && (
                        <motion.div
                          className="tasks-list-cards-wrap"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.15 }}
                        >
                          {completedTasks.map((task) => (
                            <TaskItemRow
                              key={task.id}
                              task={task}
                              lists={counts.lists || []}
                              view={view}
                              busy={busyTaskId === task.id}
                              onPatch={patchTask}
                              onSelect={setInspectingTask}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ----------------- Board Kanban View ----------------- */}
        {loaded && !error && viewMode === 'board' && (
          <div className="tasks-board-grid">
            {boardColumns.map((col) => (
              <div className="tasks-board-col" key={col.id}>
                <div className="tasks-col-head">
                  <div className="tasks-col-title-group">
                    {col.status === 'in_progress' && (
                      <span className="tasks-col-dot is-prog" />
                    )}
                    {col.status === 'done' && (
                      <span className="tasks-col-dot is-done" />
                    )}
                    {col.status === 'todo' && <span className="tasks-col-dot" />}
                    <span>{col.label}</span>
                  </div>
                  <span className="tasks-col-count">{col.tasks.length}</span>
                </div>

                <div className="tasks-col-cards-flow">
                  <AnimatePresence>
                    {col.tasks.map((task) => (
                      <BoardCard
                        key={task.id}
                        task={task}
                        busy={busyTaskId === task.id}
                        onPatch={patchTask}
                        onSelect={setInspectingTask}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ----------------- Slide-over Task Inspector Sheet ----------------- */}
      <AnimatePresence>
        {inspectingTask && (
          <TaskInspector
            task={inspectingTask}
            lists={counts.lists || []}
            busy={busyTaskId === inspectingTask.id}
            onPatch={patchTask}
            onDrop={dropTask}
            onClose={() => setInspectingTask(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
