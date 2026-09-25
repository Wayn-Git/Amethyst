import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { useDismiss } from '../hooks/useDismiss.js'
import { api } from '../api.js'
import { confirm } from '../components/ui/confirmStore.js'
import { SkeletonRows } from '../components/Skeleton.jsx'

/* Smart Buckets configuration */
const BUCKETS = [
  { id: 'my_day', label: 'My Day', icon: 'sun', blurb: 'Your To Do list called My Day.' },
  { id: 'missed', label: 'Missed', icon: 'clock', blurb: 'Past its deadline and still open.' },
  { id: 'important', label: 'Important', icon: 'star', blurb: 'Flagged, whatever the date.' },
  { id: 'general', label: 'General', icon: 'list', blurb: 'No date attached.' },
  { id: 'all', label: 'All open', icon: 'check', blurb: 'Everything still to do.' },
  { id: 'completed', label: 'Completed', icon: 'archive', blurb: 'Done. Cancelled is not done.' },
]

const LOCAL_ONLY = 'This list is only on this machine — it has not reached Microsoft To Do yet.'

/* Helper date parsers and formatters */
function when(value) {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function parse(value) {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

function isOverdue(task) {
  if (!task.due_at || task.status === 'done' || task.status === 'cancelled') return false
  return new Date(task.due_at.replace(' ', 'T')) < new Date(new Date().toDateString())
}

function dayLabel(value) {
  const date = parse(value)
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

function clock(value) {
  const date = parse(value)
  if (!date || (date.getHours() === 0 && date.getMinutes() === 0)) return null
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function span(task) {
  const start = clock(task.scheduled_at)
  const end = clock(task.due_at)
  if (start && end && parse(task.scheduled_at) < parse(task.due_at)) return `${start} – ${end}`
  return end || start
}

function huesByList(lists = []) {
  const order = [...lists].sort((a, b) => a.id - b.id)
  return new Map(order.map((list, i) => [list.id, i % 6]))
}

function reminder(task) {
  if (task.reminded_at) return `reminded ${when(task.reminded_at)}`
  if (task.reminder_at) return `reminder ${when(task.reminder_at)}`
  return null
}

/* =========================================================================
   Task Composer Modal (New Task)
   ========================================================================= */
function ComposerModal({ lists, presetList, initialStatus = 'todo', onAdded, onClose }) {
  const ref = useRef(null)
  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })
  const { toast } = useApp()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [remind, setRemind] = useState('')
  const [notes, setNotes] = useState('')
  const [list, setList] = useState(presetList || '')
  const [important, setImportant] = useState(false)
  const [myDay, setMyDay] = useState(presetList === 'My Day')
  const [busy, setBusy] = useState(false)
  const ready = title.trim().length > 0

  const submit = async (event) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      const made = await api.createTask({
        title: title.trim(),
        notes: notes.trim() || null,
        due_date_hint: due.trim() || null,
        reminder_hint: remind.trim() || null,
        list: list || null,
        important,
        add_to_my_day: myDay || presetList === 'My Day',
      })
      if (initialStatus && initialStatus !== 'todo' && made?.id) {
        await api.updateTask(made.id, { status: initialStatus })
      }
      toast(made.routed_to ? `Task added — ${made.routed_to}` : 'Task added', 'ok')
      onAdded()
      onClose()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <motion.div
      className="am-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="am-modal-card"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="New task"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="am-modal-header">
          <div className="am-modal-badge">
            <Icon name="plus" size={12} />
            <span>Create Task</span>
          </div>
          <button
            type="button"
            className="am-icon-btn am-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <form onSubmit={submit} className="am-modal-form">
          <div className="am-input-group">
            <input
              autoFocus
              className="am-input am-input--title"
              value={title}
              placeholder="What needs to be done?"
              aria-label="Task title"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="am-form-grid">
            <div className="am-input-group">
              <label className="am-input-label">
                <Icon name="clock" size={13} />
                <span>Due Date</span>
              </label>
              <input
                className="am-input"
                value={due}
                placeholder="tomorrow, friday 5pm"
                aria-label="Due date"
                onChange={(e) => setDue(e.target.value)}
              />
            </div>

            <div className="am-input-group">
              <label className="am-input-label">
                <Icon name="clock" size={13} />
                <span>Reminder</span>
              </label>
              <input
                className="am-input"
                value={remind}
                placeholder="optional reminder"
                aria-label="Reminder"
                onChange={(e) => setRemind(e.target.value)}
              />
            </div>
          </div>

          <div className="am-input-group">
            <label className="am-input-label">
              <Icon name="list" size={13} />
              <span>Assign to List</span>
            </label>
            <select
              className="am-select"
              value={list}
              aria-label="List"
              onChange={(e) => setList(e.target.value)}
            >
              <option value="">Default Tasks List</option>
              {lists.map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="am-input-group">
            <label className="am-input-label">
              <Icon name="file" size={13} />
              <span>Notes & Description</span>
            </label>
            <textarea
              className="am-textarea"
              rows={3}
              value={notes}
              placeholder="Add extra context or details…"
              aria-label="Notes"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="am-modal-toggles">
            <button
              type="button"
              className={`am-toggle-pill${important ? ' is-active' : ''}`}
              aria-pressed={important}
              onClick={() => setImportant((v) => !v)}
            >
              <Icon name="star" size={14} />
              <span>Important</span>
            </button>

            <button
              type="button"
              className={`am-toggle-pill${myDay ? ' is-active' : ''}`}
              aria-pressed={myDay}
              onClick={() => setMyDay((v) => !v)}
            >
              <Icon name="sun" size={14} />
              <span>My Day</span>
            </button>
          </div>

          <div className="am-modal-footer">
            <button
              type="button"
              className="am-btn am-btn--ghost"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="am-btn am-btn--primary"
              disabled={!ready || busy}
            >
              {busy ? (
                <>
                  <Icon name="refresh" size={14} className="am-spin" />
                  <span>Adding…</span>
                </>
              ) : (
                <>
                  <Icon name="plus" size={14} />
                  <span>Create Task</span>
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

/* =========================================================================
   Interactive Task Detail & Edit Modal (with completion progress slider)
   ========================================================================= */
function TaskDetailModal({ task, lists, hues, busy, onPatch, onDrop, onClose }) {
  const ref = useRef(null)
  useDismiss(ref, true, { onAway: onClose, onEscape: onClose })
  const done = task.status === 'done'
  const inProg = task.status === 'in_progress'
  const [title, setTitle] = useState(task.title || '')
  const [notes, setNotes] = useState(task.notes || '')
  const [due, setDue] = useState('')
  const [listId, setListId] = useState(task.list_id || '')
  const [progress, setProgress] = useState(() => {
    if (done) return 100
    try {
      const saved = localStorage.getItem('amethyst_task_progress')
      const map = saved ? JSON.parse(saved) : {}
      if (map[task.id] != null) return Number(map[task.id])
    } catch {}
    return inProg ? 50 : 0
  })
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (done) {
      setProgress(100)
      return
    }
    try {
      const saved = localStorage.getItem('amethyst_task_progress')
      const map = saved ? JSON.parse(saved) : {}
      if (map[task.id] != null) {
        setProgress(Number(map[task.id]))
        return
      }
    } catch {}
    setProgress(inProg ? 50 : 0)
  }, [task.id, done, inProg])

  const handleProgressChange = (val) => {
    const num = Math.min(100, Math.max(0, Number(val)))
    setProgress(num)
    try {
      const saved = localStorage.getItem('amethyst_task_progress')
      const map = saved ? JSON.parse(saved) : {}
      map[task.id] = num
      localStorage.setItem('amethyst_task_progress', JSON.stringify(map))
      window.dispatchEvent(
        new CustomEvent('amethyst-task-progress-updated', {
          detail: { taskId: task.id, progress: num },
        }),
      )
    } catch {}

    if (num >= 100 && task.status !== 'done') {
      onPatch(task, { status: 'done' }, 'Task completed')
    } else if (num > 0 && num < 100 && task.status !== 'in_progress') {
      onPatch(task, { status: 'in_progress' }, 'Moved to In Progress')
    } else if (num === 0 && task.status !== 'todo') {
      onPatch(task, { status: 'todo' }, 'Moved to To Do')
    }
  }

  const saveDetails = () => {
    const patchBody = {}
    if (title.trim() && title.trim() !== task.title) patchBody.title = title.trim()
    if (notes !== (task.notes || '')) patchBody.notes = notes.trim() || null
    if (due.trim()) patchBody.due_date_hint = due.trim()
    if (listId && listId !== task.list_id) {
      const selected = lists.find((l) => String(l.id) === String(listId))
      if (selected) patchBody.list = selected.name
    }
    try {
      const saved = localStorage.getItem('amethyst_task_progress')
      const map = saved ? JSON.parse(saved) : {}
      map[task.id] = progress
      localStorage.setItem('amethyst_task_progress', JSON.stringify(map))
      window.dispatchEvent(
        new CustomEvent('amethyst-task-progress-updated', {
          detail: { taskId: task.id, progress },
        }),
      )
    } catch {}
    if (Object.keys(patchBody).length > 0) {
      onPatch(task, patchBody, 'Task updated')
    }
    onClose()
  }

  return createPortal(
    <motion.div
      className="am-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="am-modal-card am-modal-card--detail"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="am-modal-header">
          <div className="am-modal-badge">
            <span className="am-status-dot" style={{ background: done ? 'var(--confirm)' : inProg ? 'var(--ember)' : 'var(--accent)' }} />
            <span>{done ? 'Completed Task' : inProg ? 'In Progress Task' : 'To Do Task'}</span>
          </div>
          <button
            type="button"
            className="am-icon-btn am-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="am-detail-body">
          {/* Status Segmented Control */}
          <div className="am-status-selector">
            <button
              type="button"
              className={`am-status-btn ${task.status === 'todo' ? 'is-active' : ''}`}
              onClick={() => {
                onPatch(task, { status: 'todo' }, 'Moved to To Do')
                handleProgressChange(0)
              }}
            >
              <Icon name="list" size={13} />
              <span>To Do</span>
            </button>
            <button
              type="button"
              className={`am-status-btn ${task.status === 'in_progress' ? 'is-active is-progress' : ''}`}
              onClick={() => {
                onPatch(task, { status: 'in_progress' }, 'Moved to In Progress')
                if (progress === 0 || progress === 100) handleProgressChange(50)
              }}
            >
              <Icon name="lightning" size={13} />
              <span>In Progress</span>
            </button>
            <button
              type="button"
              className={`am-status-btn ${task.status === 'done' ? 'is-active is-done' : ''}`}
              onClick={() => {
                onPatch(task, { status: 'done' }, 'Marked Completed')
                handleProgressChange(100)
              }}
            >
              <Icon name="check-circle" size={13} />
              <span>Completed</span>
            </button>
          </div>

          <div className="am-input-group">
            <label className="am-input-label">Task Title</label>
            <input
              className="am-input am-input--title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setDirty(true)
              }}
            />
          </div>

          {/* Progress Controller Slider */}
          <div className="am-progress-panel">
            <div className="am-progress-meta">
              <span className="am-progress-title">
                <Icon name="check-circle" size={14} />
                Progress Controller
              </span>
              <span className="am-progress-num">
                {progress === 100 ? '100% (Done!)' : `${progress}%`}
              </span>
            </div>
            <div className="am-progress-track">
              <div
                className="am-progress-bar"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="am-progress-stepper">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={progress}
                onChange={(e) => handleProgressChange(e.target.value)}
                className="am-slider"
              />
              <div className="am-progress-buttons">
                <button
                  type="button"
                  className="am-btn am-btn--xs am-btn--ghost"
                  onClick={() => handleProgressChange(Math.max(0, progress - 25))}
                >
                  -25%
                </button>
                <button
                  type="button"
                  className="am-btn am-btn--xs am-btn--ghost"
                  onClick={() => handleProgressChange(Math.min(100, progress + 25))}
                >
                  +25%
                </button>
                <button
                  type="button"
                  className="am-btn am-btn--xs am-btn--primary"
                  onClick={() => handleProgressChange(100)}
                >
                  Mark 100% Done
                </button>
              </div>
            </div>
          </div>

          <div className="am-form-grid">
            <div className="am-input-group">
              <label className="am-input-label">
                <Icon name="clock" size={13} />
                <span>Due Date Hint</span>
              </label>
              <input
                className="am-input"
                placeholder={task.due_at ? when(task.due_at) : 'e.g. tomorrow, friday 5pm'}
                value={due}
                onChange={(e) => {
                  setDue(e.target.value)
                  setDirty(true)
                }}
              />
            </div>

            <div className="am-input-group">
              <label className="am-input-label">
                <Icon name="list" size={13} />
                <span>List</span>
              </label>
              <select
                className="am-select"
                value={listId}
                onChange={(e) => {
                  setListId(e.target.value)
                  setDirty(true)
                }}
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="am-input-group">
            <label className="am-input-label">
              <Icon name="file" size={13} />
              <span>Notes</span>
            </label>
            <textarea
              className="am-textarea"
              rows={3}
              value={notes}
              placeholder="Add notes…"
              onChange={(e) => {
                setNotes(e.target.value)
                setDirty(true)
              }}
            />
          </div>

          {/* Quick Actions Bar */}
          <div className="am-detail-actions">
            <button
              type="button"
              className={`am-toggle-pill${task.important ? ' is-active' : ''}`}
              onClick={() => onPatch(task, { important: !task.important })}
            >
              <Icon name="star" size={14} />
              <span>{task.important ? 'Marked Important' : 'Make Important'}</span>
            </button>

            <button
              type="button"
              className="am-toggle-pill"
              onClick={() => onPatch(task, { status: done ? 'todo' : 'done' })}
            >
              <Icon name={done ? 'check-circle' : 'circle'} size={14} />
              <span>{done ? 'Mark Undone' : 'Mark Done'}</span>
            </button>

            <button
              type="button"
              className="am-btn am-btn--danger-ghost"
              onClick={() => {
                onDrop(task)
                onClose()
              }}
            >
              <Icon name="trash" size={14} />
              <span>Delete Task</span>
            </button>
          </div>
        </div>

        <div className="am-modal-footer">
          <button type="button" className="am-btn am-btn--ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="am-btn am-btn--primary"
            disabled={!dirty || busy}
            onClick={saveDetails}
          >
            Save Changes
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

/* =========================================================================
   Task Card Component (Taskmate Inspiration)
   ========================================================================= */
function TaskCard({
  task,
  lists,
  myDayListId,
  hues,
  view,
  busy,
  patch,
  drop,
  onOpenDetail,
}) {
  const done = task.status === 'done'
  const late = isOverdue(task)
  const listName = lists.find((l) => l.id === task.list_id)?.name
  const inMyDay = myDayListId != null && task.list_id === myDayListId
  const note = reminder(task)
  const day = dayLabel(task.due_at || task.scheduled_at)
  const hours = span(task)
  const progress = (() => {
    if (done) return 100
    try {
      const saved = localStorage.getItem('amethyst_task_progress')
      const map = saved ? JSON.parse(saved) : {}
      if (map[task.id] != null) return Number(map[task.id])
    } catch {}
    return task.status === 'in_progress' ? 50 : 0
  })()

  const state = done
    ? 'done'
    : late
      ? 'late'
      : day === 'Today'
        ? 'today'
        : task.due_at || task.scheduled_at
          ? 'soon'
          : task.important
            ? 'important'
            : 'none'

  const showList =
    Boolean(listName) &&
    (view.listId
      ? view.listId !== task.list_id
      : !(view.bucket === 'my_day' && inMyDay))

  return (
    <motion.article
      layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={`am-task-card am-card-${state}${done ? ' am-card--done' : ''}`}
      data-state={state}
    >
      {/* Top Banner Row */}
      <div className="am-card-top">
        {done ? (
          <span className="am-card-badge am-card-badge--done">
            <Icon name="check-circle" size={11} />
            <span>Completed</span>
          </span>
        ) : task.status === 'in_progress' ? (
          <span className="am-card-badge am-card-badge--progress">
            <Icon name="lightning" size={11} />
            <span>{progress > 0 ? `In Progress • ${progress}%` : 'In Progress'}</span>
          </span>
        ) : day ? (
          <span className={`am-card-badge${late ? ' am-card-badge--late' : ''}`}>
            <Icon name={task.important && !late ? 'star' : late ? 'alert' : 'clock'} size={11} />
            <span>{late ? `Due ${day}` : day}</span>
          </span>
        ) : task.important ? (
          <span className="am-card-badge am-card-badge--star">
            <Icon name="star" size={11} />
            <span>Important</span>
          </span>
        ) : (
          <span className="am-card-badge am-card-badge--neutral">
            <Icon name="list" size={11} />
            <span>To Do</span>
          </span>
        )}

        {/* Hover Action Controls */}
        <div className="am-card-tools">
          <motion.button
            type="button"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.88 }}
            className="am-icon-btn am-tool-open"
            title="Open Details & Edit"
            aria-label="Open task details"
            onClick={(e) => {
              e.stopPropagation()
              onOpenDetail(task)
            }}
          >
            <Icon name="arrow-up-right" size={13} />
          </motion.button>

          {!done && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.88 }}
              className={`am-icon-btn am-tool-progress${task.status === 'in_progress' ? ' is-active' : ''}`}
              disabled={busy}
              title={task.status === 'in_progress' ? 'Move back to To Do' : 'Move to In Progress'}
              aria-label={task.status === 'in_progress' ? 'Move back to To Do' : 'Move to In Progress'}
              onClick={(e) => {
                e.stopPropagation()
                patch(
                  task,
                  { status: task.status === 'in_progress' ? 'todo' : 'in_progress' },
                  task.status === 'in_progress' ? 'Moved to To Do' : 'Moved to In Progress',
                )
              }}
            >
              <Icon name="lightning" size={13} />
            </motion.button>
          )}

          <motion.button
            type="button"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.88 }}
            className={`am-icon-btn am-tool-sun${inMyDay ? ' is-active' : ''}`}
            disabled={busy}
            title={inMyDay ? 'Remove from My Day' : 'Add to My Day'}
            aria-label={`Move ${task.title} into My Day`}
            onClick={(e) => {
              e.stopPropagation()
              patch(
                task,
                { add_to_my_day: !inMyDay },
                inMyDay ? 'Moved out of My Day' : 'Moved into My Day',
              )
            }}
          >
            <Icon name="sun" size={13} />
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.88 }}
            className={`am-icon-btn am-tool-star${task.important ? ' is-active' : ''}`}
            disabled={busy}
            title={task.important ? 'Remove importance' : 'Mark important'}
            aria-label={`Mark ${task.title} important`}
            onClick={(e) => {
              e.stopPropagation()
              patch(task, { important: !task.important })
            }}
          >
            <Icon name="star" size={13} />
          </motion.button>

          <motion.button
            type="button"
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.88 }}
            className="am-icon-btn am-tool-drop"
            disabled={busy}
            title="Delete task"
            aria-label={`Delete ${task.title}`}
            onClick={(e) => {
              e.stopPropagation()
              drop(task)
            }}
          >
            <Icon name="x" size={13} />
          </motion.button>
        </div>
      </div>

      {/* Main Content Row */}
      <div className="am-card-main" onClick={() => onOpenDetail(task)}>
        <motion.button
          type="button"
          whileTap={{ scale: 0.82 }}
          className={`am-card-check${done ? ' is-checked' : ''}`}
          disabled={busy}
          aria-label={done ? `Mark not done` : `Mark done`}
          onClick={(e) => {
            e.stopPropagation()
            patch(task, { status: done ? 'todo' : 'done' })
          }}
        >
          {done ? (
            <motion.span
              initial={{ scale: 0, rotate: -45 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 25 }}
              className="am-card-check-icon"
            >
              <Icon name="check" size={12} />
            </motion.span>
          ) : (
            <span className="am-card-check-empty" />
          )}
        </motion.button>

        <div className="am-card-text">
          <h3 className={`am-card-title${done ? ' is-done' : ''}`}>{task.title}</h3>
          {task.notes && <p className="am-card-notes">{task.notes}</p>}
          {progress > 0 && !done && (
            <div
              className="am-card-progress-track"
              style={{
                height: 3,
                background: 'color-mix(in srgb, var(--hairline) 60%, transparent)',
                borderRadius: 999,
                overflow: 'hidden',
                marginTop: 6,
                width: '100%',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, var(--accent, #7132f5), var(--ember, #f59e0b))',
                  borderRadius: 999,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer Info Row */}
      <div className="am-card-foot">
        {hours && (
          <span className="am-card-time">
            <Icon name="clock" size={11} />
            <span>{hours}</span>
          </span>
        )}

        {showList && (
          <span className="am-card-chip am-card-chip--list">
            <i
              className="am-hue-dot"
              data-hue={hues.get(task.list_id) ?? 5}
              aria-hidden="true"
            />
            <span>{listName}</span>
          </span>
        )}

        {note && <span className="am-card-chip">{note}</span>}

        {late && (
          <button
            type="button"
            className="am-card-chip am-card-chip--action"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation()
              patch(task, { due_date_hint: 'tomorrow' }, 'Rescheduled to tomorrow')
            }}
          >
            Due Tomorrow
          </button>
        )}
      </div>
    </motion.article>
  )
}

/* =========================================================================
   Main Tasks View
   ========================================================================= */
export default function Tasks() {
  const rootRef = useRef(null)
  const { toast, setView, chat } = useApp()
  const [view, setViewKey] = useState({ bucket: 'my_day', listId: null })
  const [viewMode, setViewMode] = useState('board') // 'board' | 'grid' | 'list'
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTag, setFilterTag] = useState('all') // 'all' | 'important' | 'today' | 'overdue'

  const landed = useRef(false)
  const [tasks, setTasks] = useState([])
  const [counts, setCounts] = useState({
    buckets: {},
    lists: [],
    connected: false,
    my_day_list_id: null,
  })
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [detailTask, setDetailTask] = useState(null)
  const [busyTask, setBusyTask] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [namingList, setNamingList] = useState(false)
  const [listName, setListName] = useState('')
  const [showDone, setShowDone] = useState(false)

  useViewEntrance(rootRef)
  const loadToken = useRef(0)

  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const isCompletedBucket = view.bucket === 'completed'
      const [rows, allCompleted, allOpen, summary, cal] = await Promise.all([
        api.tasks(view.listId ? { listId: view.listId } : { bucket: isCompletedBucket ? 'all' : view.bucket }),
        api.tasks({ bucket: 'completed' }),
        api.tasks({ bucket: 'all' }),
        api.taskBuckets(),
        api.calendar(21),
      ])
      if (loadToken.current !== token) return

      let openRows = isCompletedBucket ? allOpen : rows
      let relevantCompleted = allCompleted

      if (view.listId != null) {
        relevantCompleted = allCompleted.filter((t) => Number(t.list_id) === Number(view.listId))
      } else if (view.bucket === 'important') {
        relevantCompleted = allCompleted.filter((t) => Boolean(t.important))
      } else if (view.bucket === 'my_day') {
        const explicitMyDay = allOpen.filter(
          (t) =>
            (summary.my_day_list_id != null && t.list_id === summary.my_day_list_id) ||
            dayLabel(t.due_at || t.scheduled_at) === 'Today',
        )
        const inProgress = allOpen.filter((t) => t.status === 'in_progress')

        const myDayTasksMap = new Map()
        for (const t of explicitMyDay) myDayTasksMap.set(t.id, t)
        for (const t of inProgress) myDayTasksMap.set(t.id, t)

        // If no todo tasks are explicitly assigned to My Day, populate To Do with open tasks
        const hasTodo = Array.from(myDayTasksMap.values()).some((t) => t.status !== 'in_progress')
        if (!hasTodo) {
          for (const t of allOpen) {
            myDayTasksMap.set(t.id, t)
          }
        }
        openRows = Array.from(myDayTasksMap.values())

        relevantCompleted = allCompleted.filter(
          (t) =>
            (summary.my_day_list_id != null && t.list_id === summary.my_day_list_id) ||
            dayLabel(t.completed_at) === 'Today' ||
            dayLabel(t.due_at || t.scheduled_at) === 'Today',
        )
      } else if (view.bucket === 'general') {
        relevantCompleted = allCompleted.filter(
          (t) =>
            !t.due_at &&
            !t.scheduled_at &&
            (summary.my_day_list_id == null || t.list_id !== summary.my_day_list_id),
        )
      } else if (view.bucket === 'missed') {
        relevantCompleted = allCompleted.filter((t) => isOverdue(t))
      }

      if (summary?.buckets) {
        const explicitMyDay = allOpen.filter(
          (t) =>
            (summary.my_day_list_id != null && t.list_id === summary.my_day_list_id) ||
            dayLabel(t.due_at || t.scheduled_at) === 'Today',
        )
        const inProgress = allOpen.filter((t) => t.status === 'in_progress')
        const myDayTasksMap = new Map()
        for (const t of explicitMyDay) myDayTasksMap.set(t.id, t)
        for (const t of inProgress) myDayTasksMap.set(t.id, t)
        const hasTodo = Array.from(myDayTasksMap.values()).some((t) => t.status !== 'in_progress')
        if (!hasTodo) {
          for (const t of allOpen) myDayTasksMap.set(t.id, t)
        }
        summary.buckets.my_day = myDayTasksMap.size
      }

      const taskMap = new Map()
      for (const t of openRows) {
        taskMap.set(t.id, t)
      }
      for (const t of relevantCompleted) {
        taskMap.set(t.id, t)
      }

      setTasks(Array.from(taskMap.values()))
      setCounts(summary)
      setEvents(cal)
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

  useEffect(() => {
    const handleProgressEvent = () => {
      load()
    }
    window.addEventListener('storage', handleProgressEvent)
    window.addEventListener('amethyst-task-progress-updated', handleProgressEvent)
    return () => {
      window.removeEventListener('storage', handleProgressEvent)
      window.removeEventListener('amethyst-task-progress-updated', handleProgressEvent)
    }
  }, [load])

  useEffect(() => {
    if (landed.current || !counts.buckets || Object.keys(counts.buckets).length === 0) return
    const { my_day: myDay = 0, missed = 0, all = 0 } = counts.buckets
    landed.current = true
    if (myDay > 0) return
    if (missed > 0) setViewKey({ bucket: 'missed', listId: null })
    else if (all > 0) setViewKey({ bucket: 'all', listId: null })
  }, [counts])

  const patch = useCallback(
    async (task, body, note) => {
      setBusyTask(task.id)
      try {
        if (body.status === 'done') {
          try {
            const saved = localStorage.getItem('amethyst_task_progress')
            const map = saved ? JSON.parse(saved) : {}
            map[task.id] = 100
            localStorage.setItem('amethyst_task_progress', JSON.stringify(map))
            window.dispatchEvent(
              new CustomEvent('amethyst-task-progress-updated', {
                detail: { taskId: task.id, progress: 100 },
              }),
            )
          } catch {}
        } else if (body.status === 'todo') {
          try {
            const saved = localStorage.getItem('amethyst_task_progress')
            const map = saved ? JSON.parse(saved) : {}
            map[task.id] = 0
            localStorage.setItem('amethyst_task_progress', JSON.stringify(map))
            window.dispatchEvent(
              new CustomEvent('amethyst-task-progress-updated', {
                detail: { taskId: task.id, progress: 0 },
              }),
            )
          } catch {}
        } else if (body.status === 'in_progress') {
          try {
            const saved = localStorage.getItem('amethyst_task_progress')
            const map = saved ? JSON.parse(saved) : {}
            if (!map[task.id] || map[task.id] === 0 || map[task.id] === 100) {
              map[task.id] = 50
              localStorage.setItem('amethyst_task_progress', JSON.stringify(map))
              window.dispatchEvent(
                new CustomEvent('amethyst-task-progress-updated', {
                  detail: { taskId: task.id, progress: 50 },
                }),
              )
            }
          } catch {}
        }
        await api.updateTask(task.id, body)
        if (note) toast(note, 'ok')
        await load()
      } catch (err) {
        toast(err.message, 'bad')
      } finally {
        setBusyTask(null)
      }
    },
    [load, toast],
  )

  const drop = useCallback(
    async (task) => {
      setBusyTask(task.id)
      try {
        try {
          const saved = localStorage.getItem('amethyst_task_progress')
          if (saved) {
            const map = JSON.parse(saved)
            delete map[task.id]
            localStorage.setItem('amethyst_task_progress', JSON.stringify(map))
            window.dispatchEvent(
              new CustomEvent('amethyst-task-progress-updated', {
                detail: { taskId: task.id, progress: 0 },
              }),
            )
          }
        } catch {}
        await api.deleteTask(task.id)
        toast('Task deleted', 'ok')
        await load()
      } catch (err) {
        toast(err.message, 'bad')
      } finally {
        setBusyTask(null)
      }
    },
    [load, toast],
  )

  const sync = useCallback(async () => {
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

  const newList = useCallback(
    async (name) => {
      const clean = name.trim()
      if (!clean) return
      try {
        const made = await api.createTaskList(clean)
        toast(made.note ? `List created — ${made.note}` : 'List created', 'ok')
        setNamingList(false)
        setListName('')
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
          title: `Delete "${targetList.name}" section?`,
          description: 'This will delete this custom section and cancel any tasks filed under it.',
          confirmLabel: 'Delete Section',
          tone: 'danger',
        })
      } catch {
        ok = window.confirm(`Delete "${targetList.name}" section? Tasks in this list will be removed.`)
      }
      if (!ok) return

      try {
        await api.deleteTaskList(targetList.id)
        toast(`Section "${targetList.name}" deleted`, 'ok')
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

  const hues = useMemo(() => huesByList(counts.lists), [counts.lists])

  /* Active Header Information */
  const active = useMemo(() => {
    if (view.listId) {
      const found = counts.lists?.find((l) => Number(l.id) === Number(view.listId))
      return {
        id: `list_${view.listId}`,
        label: found?.name || 'Custom Section',
        icon: 'list',
        blurb: found?.external_id ? null : LOCAL_ONLY,
        isCustomList: true,
        listId: view.listId,
        listName: found?.name,
        isDefault: Boolean(found?.is_default),
      }
    }
    const b = BUCKETS.find((bk) => bk.id === view.bucket) || BUCKETS[0]
    return { ...b, isCustomList: false }
  }, [view, counts])

  /* Filtered and Searched Tasks */
  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const titleMatch = t.title?.toLowerCase().includes(q)
        const notesMatch = t.notes?.toLowerCase().includes(q)
        if (!titleMatch && !notesMatch) return false
      }
      if (filterTag === 'important') return Boolean(t.important)
      if (filterTag === 'today') return dayLabel(t.due_at || t.scheduled_at) === 'Today'
      if (filterTag === 'overdue') return isOverdue(t)
      return true
    })
  }, [tasks, searchQuery, filterTag])

  /* Split for grid/list */
  const [mainTasks, completedTasks] = useMemo(() => {
    return [
      filteredTasks.filter((t) => t.status !== 'done'),
      filteredTasks.filter((t) => t.status === 'done'),
    ]
  }, [filteredTasks])

  /* Board Columns (Kanban) */
  const boardColumns = useMemo(() => {
    const todo = []
    const inProgress = []
    const done = []

    for (const task of filteredTasks) {
      if (task.status === 'done') {
        done.push(task)
      } else if (task.status === 'in_progress') {
        inProgress.push(task)
      } else {
        todo.push(task)
      }
    }

    return [
      { id: 'todo', label: 'To Do', icon: 'list', tasks: todo, color: 'var(--text-dim)' },
      { id: 'progress', label: 'In Progress', icon: 'lightning', tasks: inProgress, color: 'var(--ember)' },
      { id: 'done', label: 'Completed', icon: 'check-circle', tasks: done, color: 'var(--confirm)' },
    ]
  }, [filteredTasks])

  const headerCount = useMemo(() => {
    if (view.bucket === 'completed') {
      return tasks.filter((t) => t.status === 'done').length
    }
    const openCount = tasks.filter((t) => t.status !== 'done').length
    if (openCount === 0 && tasks.length > 0) {
      return tasks.length
    }
    return openCount
  }, [tasks, view.bucket])

  return (
    <div className="view am-tasks-viewport" ref={rootRef}>
      {/* Scoped Custom CSS that seamlessly adapts to any theme & custom accent color */}
      <style>{`
        .am-tasks-viewport {
          --am-card-radius: 18px;
          --am-card-pad: 16px;
          --am-border-subtle: color-mix(in srgb, var(--hairline) 70%, transparent);
          --am-accent-tint: color-mix(in srgb, var(--accent, #7132f5) 12%, var(--canvas, #121214));
          --am-surface-glass: color-mix(in srgb, var(--surface, #1e1e24) 85%, transparent);
        }

        .am-hero {
          position: relative;
          padding: 24px 28px;
          border-radius: 20px;
          background: linear-gradient(
            135deg,
            color-mix(in srgb, var(--accent, #7132f5) 16%, var(--surface, #18181b)) 0%,
            color-mix(in srgb, var(--accent, #7132f5) 4%, var(--canvas, #09090b)) 100%
          );
          border: 1px solid color-mix(in srgb, var(--accent, #7132f5) 25%, transparent);
          box-shadow: 0 12px 32px -8px color-mix(in srgb, var(--accent, #7132f5) 15%, transparent);
          margin-bottom: 24px;
          overflow: hidden;
        }

        .am-hero::before {
          content: '';
          position: absolute;
          top: -40px;
          right: -40px;
          width: 220px;
          height: 220px;
          border-radius: 50%;
          background: radial-gradient(circle, color-mix(in srgb, var(--accent, #7132f5) 25%, transparent) 0%, transparent 70%);
          pointer-events: none;
        }

        .am-hero-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
          margin-bottom: 16px;
        }

        .am-breadcrumbs {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: var(--text-xs, 12px);
          font-weight: 500;
          color: var(--text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .am-breadcrumbs-crumb {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .am-breadcrumbs-active {
          color: var(--accent);
          font-weight: 600;
        }

        .am-hero-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .am-hero-main {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 16px;
        }

        .am-hero-title-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .am-hero-title {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--text);
          margin: 0;
        }

        .am-count-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 28px;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--accent) 24%, var(--surface));
          color: var(--text);
          font-size: 13px;
          font-weight: 600;
          border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
        }

        .am-hero-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 14px;
        }

        .am-meta-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          background: color-mix(in srgb, var(--surface) 80%, transparent);
          color: var(--text-dim);
          border: 1px solid var(--hairline);
        }

        .am-meta-badge--accent {
          background: color-mix(in srgb, var(--accent) 18%, var(--surface));
          color: var(--text);
          border-color: color-mix(in srgb, var(--accent) 30%, transparent);
        }

        /* Avatar Stack */
        .am-avatar-stack {
          display: flex;
          align-items: center;
          margin-left: auto;
        }

        .am-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: 2px solid var(--surface);
          margin-left: -8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          background: var(--surface-raised, #27272a);
          color: var(--text);
        }

        .am-avatar:first-child {
          margin-left: 0;
        }

        .am-avatar--accent {
          background: var(--accent);
          color: #fff;
          box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 50%, transparent);
        }

        /* Controls & Filter Bar */
        .am-filter-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 20px;
        }

        .am-search-box {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 240px;
          flex: 1;
          max-width: 380px;
        }

        .am-search-box .am-search-icon {
          position: absolute;
          left: 12px;
          color: var(--text-dim);
          pointer-events: none;
        }

        .am-search-input {
          width: 100%;
          height: 38px;
          padding: 0 34px 0 36px;
          border-radius: 12px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          color: var(--text);
          font-size: 13px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .am-search-input:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
        }

        .am-search-clear {
          position: absolute;
          right: 10px;
          background: none;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          padding: 2px;
        }

        .am-tags-filter {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .am-tag-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 13px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          border: 1px solid var(--hairline);
          background: transparent;
          color: var(--text-dim);
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .am-tag-btn:hover {
          color: var(--text);
          border-color: var(--text-dim);
        }

        .am-tag-btn.is-active {
          background: color-mix(in srgb, var(--accent) 18%, var(--surface));
          color: var(--text);
          border-color: var(--accent);
          font-weight: 600;
        }

        .am-view-modes {
          display: inline-flex;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: 12px;
          padding: 3px;
          gap: 2px;
        }

        .am-view-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 10px;
          border-radius: 9px;
          border: none;
          background: transparent;
          color: var(--text-dim);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .am-view-btn.is-active {
          background: color-mix(in srgb, var(--accent) 20%, var(--surface));
          color: var(--text);
          font-weight: 600;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
        }

        /* Layout structure */
        .am-tasks-layout {
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr);
          gap: 24px;
          align-items: start;
        }

        @media (max-width: 900px) {
          .am-tasks-layout {
            grid-template-columns: 1fr;
          }
        }

        /* Sidebar / Rail */
        .am-rail {
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: 18px;
          padding: 12px 10px;
          position: sticky;
          top: 16px;
        }

        .am-rail-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 9px 12px;
          border-radius: 12px;
          border: none;
          background: transparent;
          color: var(--text-dim);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          text-align: left;
          transition: all 0.18s ease;
        }

        .am-rail-btn:hover {
          background: color-mix(in srgb, var(--accent) 8%, var(--surface));
          color: var(--text);
          transform: translateX(2px);
        }

        .am-rail-btn.is-active {
          background: color-mix(in srgb, var(--accent) 18%, var(--surface));
          color: var(--text);
          font-weight: 600;
          border-left: 3px solid var(--accent);
          padding-left: 9px;
        }

        .am-rail-label {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .am-rail-count {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-dim) 15%, transparent);
          color: var(--text-dim);
        }

        .am-rail-btn.is-active .am-rail-count {
          background: color-mix(in srgb, var(--accent) 30%, transparent);
          color: var(--text);
        }

        .am-rail-item-row {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
        }

        .am-rail-item-row .am-rail-btn {
          padding-right: 32px;
        }

        .am-rail-delete-btn {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: var(--text-faint);
          cursor: pointer;
          opacity: 0;
          transition: all 0.15s ease;
          z-index: 2;
        }

        .am-rail-item-row:hover .am-rail-delete-btn,
        .am-rail-delete-btn:focus-visible {
          opacity: 1;
        }

        .am-rail-delete-btn:hover {
          background: color-mix(in srgb, var(--ember) 20%, transparent);
          color: var(--ember);
        }

        .am-btn--danger-ghost {
          background: color-mix(in srgb, var(--ember) 10%, transparent);
          color: var(--ember);
          border: 1px solid color-mix(in srgb, var(--ember) 25%, transparent);
        }

        .am-btn--danger-ghost:hover {
          background: color-mix(in srgb, var(--ember) 20%, transparent);
        }

        .am-rail-sep {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 10px 6px 10px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-dim);
        }

        .am-rail-new-input {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px;
        }

        .am-rail-new-input input {
          width: 100%;
          padding: 6px 10px;
          font-size: 12px;
          border-radius: 8px;
          background: var(--canvas);
          border: 1px solid var(--accent);
          color: var(--text);
        }

        .am-hue-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        /* Six list hues */
        [data-hue="0"] { background: var(--live, #06b6d4); }
        [data-hue="1"] { background: var(--confirm, #22c55e); }
        [data-hue="2"] { background: var(--ember, #f59e0b); }
        [data-hue="3"] { background: var(--stop, #ef4444); }
        [data-hue="4"] { background: color-mix(in srgb, var(--live, #06b6d4) 50%, var(--text-dim)); }
        [data-hue="5"] { background: var(--text-dim); }

        /* Board Kanban View */
        .am-board {
          display: grid;
          grid-template-columns: repeat(3, minmax(280px, 1fr));
          gap: 18px;
          align-items: start;
        }

        @media (max-width: 1150px) {
          .am-board {
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          }
        }

        .am-board-col {
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: color-mix(in srgb, var(--surface) 60%, var(--canvas));
          border: 1px solid var(--hairline);
          border-radius: 20px;
          padding: 16px;
          height: 350px;
          box-sizing: border-box;
          overflow: hidden;
        }

        .am-col-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--hairline);
          flex-shrink: 0;
        }

        .am-col-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
        }

        .am-col-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .am-col-count {
          font-size: 11px;
          font-weight: 600;
          padding: 1px 7px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-dim) 15%, transparent);
          color: var(--text-dim);
        }

        .am-col-cards {
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
          scrollbar-width: thin;
          scrollbar-color: color-mix(in srgb, var(--text-dim) 25%, transparent) transparent;
        }

        .am-col-cards::-webkit-scrollbar {
          width: 5px;
        }

        .am-col-cards::-webkit-scrollbar-track {
          background: transparent;
        }

        .am-col-cards::-webkit-scrollbar-thumb {
          background: color-mix(in srgb, var(--text-dim) 25%, transparent);
          border-radius: 999px;
        }

        .am-col-cards::-webkit-scrollbar-thumb:hover {
          background: color-mix(in srgb, var(--text-dim) 50%, transparent);
        }

        /* Grid View */
        .am-cards-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
          gap: 16px;
        }

        /* List View */
        .am-cards-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        /* Task Card (Taskmate replica styling - compact & sleek) */
        .am-task-card {
          position: relative;
          padding: 11px 13px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--accent, #7132f5) 5%, var(--surface));
          border: 1px solid color-mix(in srgb, var(--accent, #7132f5) 15%, var(--hairline));
          box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.08);
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
          display: flex;
          flex-direction: column;
          gap: 7px;
          flex-shrink: 0;
        }

        .am-task-card:hover {
          border-color: color-mix(in srgb, var(--accent, #7132f5) 40%, transparent);
          box-shadow: 0 6px 16px -3px color-mix(in srgb, var(--accent, #7132f5) 16%, rgba(0, 0, 0, 0.18));
        }

        /* Dynamic states with theme tints */
        .am-card-today {
          background: color-mix(in srgb, var(--ember, #f59e0b) 9%, var(--surface));
          border-color: color-mix(in srgb, var(--ember, #f59e0b) 22%, var(--hairline));
        }
        .am-card-today:hover {
          border-color: color-mix(in srgb, var(--ember, #f59e0b) 50%, transparent);
        }

        .am-card-late {
          background: color-mix(in srgb, var(--stop, #ef4444) 10%, var(--surface));
          border-color: color-mix(in srgb, var(--stop, #ef4444) 25%, var(--hairline));
        }
        .am-card-late:hover {
          border-color: color-mix(in srgb, var(--stop, #ef4444) 50%, transparent);
        }

        .am-card-soon {
          background: color-mix(in srgb, var(--live, #06b6d4) 8%, var(--surface));
          border-color: color-mix(in srgb, var(--live, #06b6d4) 20%, var(--hairline));
        }

        .am-card-important {
          background: color-mix(in srgb, var(--ember, #f59e0b) 12%, var(--surface));
          border-color: color-mix(in srgb, var(--ember, #f59e0b) 30%, var(--hairline));
        }

        .am-card--done {
          background: color-mix(in srgb, var(--surface) 50%, var(--canvas));
          border-color: var(--hairline);
          opacity: 0.72;
        }
        .am-card--done:hover {
          opacity: 1;
        }

        /* Card Top */
        .am-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 20px;
        }

        .am-card-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 600;
          background: color-mix(in srgb, var(--accent) 15%, var(--surface));
          color: var(--text);
        }

        .am-card-badge--late {
          background: color-mix(in srgb, var(--stop) 20%, var(--surface));
          color: var(--stop);
        }

        .am-card-badge--star {
          background: color-mix(in srgb, var(--ember) 20%, var(--surface));
          color: var(--ember);
        }

        .am-card-badge--progress {
          background: color-mix(in srgb, var(--ember, #f59e0b) 18%, var(--surface));
          color: var(--ember, #f59e0b);
        }

        .am-card-badge--done {
          background: color-mix(in srgb, var(--confirm, #10b981) 18%, var(--surface));
          color: var(--confirm, #10b981);
        }

        .am-card-badge--neutral {
          background: color-mix(in srgb, var(--text-dim) 15%, var(--surface));
          color: var(--text-dim);
        }

        .am-card-tools {
          display: flex;
          align-items: center;
          gap: 3px;
          opacity: 0.65;
          transition: opacity 0.18s ease;
        }

        .am-task-card:hover .am-card-tools,
        .am-task-card:focus-within .am-card-tools {
          opacity: 1;
        }

        .am-icon-btn {
          width: 23px;
          height: 23px;
          border-radius: 50%;
          border: none;
          background: color-mix(in srgb, var(--surface) 60%, transparent);
          color: var(--text-dim);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .am-icon-btn:hover {
          background: color-mix(in srgb, var(--text-dim) 20%, transparent);
          color: var(--text);
        }

        .am-tool-star.is-active {
          color: var(--ember, #f59e0b);
          background: color-mix(in srgb, var(--ember) 22%, transparent);
        }

        .am-tool-sun.is-active {
          color: var(--ember, #f59e0b);
          background: color-mix(in srgb, var(--ember) 22%, transparent);
        }

        .am-tool-progress:hover {
          color: var(--ember, #f59e0b);
          background: color-mix(in srgb, var(--ember, #f59e0b) 20%, transparent);
        }

        .am-tool-progress.is-active {
          color: var(--ember, #f59e0b);
          background: color-mix(in srgb, var(--ember, #f59e0b) 24%, transparent);
        }

        .am-tool-drop:hover {
          color: var(--stop, #ef4444);
          background: color-mix(in srgb, var(--stop) 20%, transparent);
        }

        .am-tool-open:hover {
          color: var(--accent);
          background: color-mix(in srgb, var(--accent) 20%, transparent);
        }

        /* Status Segmented Control (Modal) */
        .am-status-selector {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px;
          background: color-mix(in srgb, var(--canvas) 60%, var(--surface));
          border: 1px solid var(--hairline);
          border-radius: 12px;
          margin-bottom: 16px;
        }

        .am-status-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px;
          border-radius: 9px;
          border: none;
          background: transparent;
          color: var(--text-dim);
          font-size: 12.5px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .am-status-btn:hover {
          color: var(--text);
          background: color-mix(in srgb, var(--surface) 80%, transparent);
        }

        .am-status-btn.is-active {
          background: var(--surface);
          color: var(--text);
          font-weight: 600;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
        }

        .am-status-btn.is-active.is-progress {
          color: var(--ember, #f59e0b);
          border: 1px solid color-mix(in srgb, var(--ember) 35%, transparent);
        }

        .am-status-btn.is-active.is-done {
          color: var(--confirm, #10b981);
          border: 1px solid color-mix(in srgb, var(--confirm) 35%, transparent);
        }

        /* Card Main */
        .am-card-main {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          cursor: pointer;
        }

        .am-card-check {
          width: 19px;
          height: 19px;
          border-radius: 50%;
          border: 2px solid color-mix(in srgb, var(--text-dim) 50%, transparent);
          background: transparent;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          flex-shrink: 0;
          margin-top: 1px;
          transition: all 0.18s ease;
        }

        .am-card-check:hover {
          border-color: var(--accent);
          background: color-mix(in srgb, var(--accent) 15%, transparent);
        }

        .am-card-check.is-checked {
          border-color: var(--confirm, #22c55e);
          background: var(--confirm, #22c55e);
          color: #fff;
        }

        .am-card-text {
          flex: 1;
          min-width: 0;
        }

        .am-card-title {
          font-size: 13.5px;
          font-weight: 600;
          line-height: 1.35;
          color: var(--text);
          margin: 0;
          word-break: break-word;
          transition: color 0.18s ease;
        }

        .am-card-title.is-done {
          text-decoration: line-through;
          color: var(--text-dim);
        }

        .am-card-notes {
          margin: 3px 0 0 0;
          font-size: 12px;
          color: var(--text-dim);
          line-height: 1.35;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* Card Foot */
        .am-card-foot {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 0;
          font-size: 10.5px;
        }

        .am-card-time {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: var(--text-dim);
          font-variant-numeric: tabular-nums;
        }

        .am-card-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 1.5px 7px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-dim) 12%, transparent);
          color: var(--text-dim);
          font-size: 10px;
        }

        .am-card-chip--list {
          color: var(--text);
          background: color-mix(in srgb, var(--accent) 10%, var(--surface));
          border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
        }

        .am-card-chip--action {
          border: none;
          background: color-mix(in srgb, var(--stop) 20%, transparent);
          color: var(--stop);
          cursor: pointer;
          font-weight: 600;
          transition: background 0.15s ease;
        }

        .am-card-chip--action:hover {
          background: color-mix(in srgb, var(--stop) 35%, transparent);
        }

        /* Add Task Tile */
        .am-add-tile {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 14px;
          min-height: 42px;
          border-radius: 14px;
          border: 1px dashed color-mix(in srgb, var(--accent) 40%, var(--hairline));
          background: color-mix(in srgb, var(--accent) 3%, transparent);
          color: var(--text-dim);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          flex-shrink: 0;
        }

        .am-add-tile:hover {
          background: color-mix(in srgb, var(--accent) 10%, var(--surface));
          border-color: var(--accent);
          color: var(--text);
          transform: translateY(-2px);
        }

        /* Calendar events section */
        .am-events-card {
          margin-top: 24px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: 20px;
          padding: 20px 22px;
        }

        .am-events-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }

        .am-events-title {
          font-size: 15px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--text);
        }

        .am-events-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        }

        .am-event-item {
          padding: 12px 14px;
          border-radius: 14px;
          background: color-mix(in srgb, var(--accent) 4%, var(--canvas));
          border: 1px solid var(--hairline);
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .am-event-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          border-radius: 10px;
          background: color-mix(in srgb, var(--accent) 18%, var(--surface));
          color: var(--accent);
          font-weight: 700;
          font-size: 11px;
          line-height: 1.2;
        }

        .am-event-details {
          flex: 1;
          min-width: 0;
        }

        .am-event-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .am-event-time {
          font-size: 11px;
          color: var(--text-dim);
          margin-top: 2px;
        }

        /* AI Prompt Banner */
        .am-ai-banner {
          margin-top: 20px;
          padding: 16px 20px;
          border-radius: 18px;
          background: linear-gradient(
            90deg,
            color-mix(in srgb, var(--accent) 14%, var(--surface)) 0%,
            color-mix(in srgb, var(--accent) 6%, var(--surface)) 100%
          );
          border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 14px;
        }

        .am-ai-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .am-ai-spark-icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: var(--accent);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 60%, transparent);
        }

        .am-ai-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
        }

        .am-ai-sub {
          font-size: 12px;
          color: var(--text-dim);
        }

        .am-ai-chips {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .am-ai-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 12px;
          background: color-mix(in srgb, var(--surface) 90%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--hairline));
          color: var(--text);
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .am-ai-chip:hover {
          background: var(--accent);
          color: #fff;
          transform: translateY(-1px);
        }

        /* Buttons & Inputs */
        .am-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .am-btn--primary {
          background: var(--accent);
          color: #fff;
          box-shadow: 0 4px 14px -3px color-mix(in srgb, var(--accent) 60%, transparent);
        }

        .am-btn--primary:hover:not(:disabled) {
          background: var(--accent-hover, var(--accent));
          transform: translateY(-1px);
          box-shadow: 0 6px 18px -3px color-mix(in srgb, var(--accent) 70%, transparent);
        }

        .am-btn--ghost {
          background: color-mix(in srgb, var(--surface) 80%, transparent);
          color: var(--text);
          border: 1px solid var(--hairline);
        }

        .am-btn--ghost:hover:not(:disabled) {
          background: color-mix(in srgb, var(--text-dim) 15%, transparent);
        }

        .am-btn--xs {
          padding: 4px 10px;
          font-size: 11px;
          border-radius: 8px;
        }

        .am-btn--danger-ghost {
          background: transparent;
          color: var(--stop, #ef4444);
          border: 1px solid color-mix(in srgb, var(--stop) 30%, transparent);
        }

        .am-btn--danger-ghost:hover {
          background: color-mix(in srgb, var(--stop) 15%, transparent);
        }

        .am-spin {
          animation: am-spin 1s linear infinite;
        }

        @keyframes am-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* Modals */
        .am-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(6px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }

        .am-modal-card {
          width: 100%;
          max-width: 520px;
          background: var(--surface);
          border: 1px solid color-mix(in srgb, var(--accent) 25%, var(--hairline));
          border-radius: 22px;
          box-shadow: 0 24px 64px -12px rgba(0, 0, 0, 0.35);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .am-modal-card--detail {
          max-width: 560px;
        }

        .am-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 24px;
          border-bottom: 1px solid var(--hairline);
        }

        .am-modal-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }

        .am-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .am-modal-close {
          width: 28px;
          height: 28px;
        }

        .am-modal-form,
        .am-detail-body {
          padding: 22px 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .am-input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .am-input-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-dim);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .am-input,
        .am-textarea,
        .am-select {
          width: 100%;
          padding: 10px 14px;
          border-radius: 12px;
          background: var(--canvas);
          border: 1px solid var(--hairline);
          color: var(--text);
          font-size: 13px;
          transition: all 0.18s ease;
        }

        .am-input--title {
          font-size: 16px;
          font-weight: 600;
          padding: 12px 14px;
        }

        .am-input:focus,
        .am-textarea:focus,
        .am-select:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
        }

        .am-form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .am-modal-toggles,
        .am-detail-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }

        .am-toggle-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          background: color-mix(in srgb, var(--surface) 90%, var(--canvas));
          border: 1px solid var(--hairline);
          color: var(--text-dim);
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .am-toggle-pill:hover {
          color: var(--text);
          border-color: var(--text-dim);
        }

        .am-toggle-pill.is-active {
          background: color-mix(in srgb, var(--accent) 20%, var(--surface));
          color: var(--text);
          border-color: var(--accent);
          font-weight: 600;
        }

        .am-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 24px;
          background: color-mix(in srgb, var(--canvas) 60%, var(--surface));
          border-top: 1px solid var(--hairline);
        }

        /* Progress Panel */
        .am-progress-panel {
          padding: 16px;
          border-radius: 16px;
          background: color-mix(in srgb, var(--accent) 6%, var(--canvas));
          border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--hairline));
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .am-progress-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .am-progress-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .am-progress-num {
          font-size: 12px;
          font-weight: 700;
          color: var(--accent);
        }

        .am-progress-track {
          width: 100%;
          height: 8px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--hairline) 60%, transparent);
          overflow: hidden;
        }

        .am-progress-bar {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--accent) 0%, var(--confirm, #22c55e) 100%);
          transition: width 0.25s ease;
        }

        .am-progress-stepper {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .am-slider {
          width: 100%;
          cursor: pointer;
          accent-color: var(--accent);
        }

        .am-progress-buttons {
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `}</style>

      <div className="view-inner view-inner--wide">
        {/* Project & View Hero Header (Taskmate Replica) */}
        <section className="am-hero" data-enter>
          <div className="am-hero-top">
            <div className="am-breadcrumbs">
              <span className="am-breadcrumbs-crumb">
                <Icon name="folder" size={13} />
                <span>Amethyst</span>
              </span>
              <span>/</span>
              <span className="am-breadcrumbs-crumb">
                <span>Tasks</span>
              </span>
              <span>/</span>
              <span className="am-breadcrumbs-crumb am-breadcrumbs-active">
                {active.label}
              </span>
            </div>

            <div className="am-hero-actions">
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.96 }}
                className="am-btn am-btn--primary"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" size={15} />
                <span>New task</span>
              </motion.button>

              {active.isCustomList && !active.isDefault && (
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  className="am-btn am-btn--danger-ghost"
                  onClick={() => {
                    const found = counts.lists?.find((l) => Number(l.id) === Number(view.listId))
                    if (found) deleteList(found)
                  }}
                  title="Delete this custom section"
                >
                  <Icon name="trash" size={14} />
                  <span>Delete Section</span>
                </motion.button>
              )}

              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                className="am-btn am-btn--ghost"
                disabled={syncing}
                onClick={sync}
              >
                <Icon
                  name="refresh"
                  size={15}
                  className={syncing ? 'am-spin' : ''}
                />
                <span>{syncing ? 'Syncing…' : 'Sync To Do'}</span>
              </motion.button>
            </div>
          </div>

          <div className="am-hero-main">
            <div className="am-hero-title-wrap">
              {view.listId && (
                <i
                  className="am-hue-dot"
                  style={{ width: 14, height: 14 }}
                  data-hue={hues.get(view.listId) ?? 5}
                  aria-hidden="true"
                />
              )}
              <h1 className="am-hero-title">{active.label}</h1>
              <span className="am-count-pill">{loaded ? headerCount : '…'}</span>
            </div>

            {/* Team / Assistant Avatar Stack */}
            <div className="am-avatar-stack">
              <span className="am-avatar" title="You (Jadugar)">
                <Icon name="user" size={14} />
              </span>
              <span className="am-avatar am-avatar--accent" title="AMETHYST AI Assistant">
                <Icon name="sparkle" size={14} />
              </span>
              <span className="am-avatar" title="Shared with workspace">
                +1
              </span>
            </div>
          </div>

          <div className="am-hero-meta">
            <span className="am-meta-badge am-meta-badge--accent">
              <Icon name="lightning" size={12} />
              <span>
                {counts.buckets?.missed > 0
                  ? `${counts.buckets.missed} Overdue`
                  : 'On Track'}
              </span>
            </span>

            <span className="am-meta-badge">
              <Icon name="clock" size={12} />
              <span>Today • {new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            </span>

            {active.blurb && (
              <span className="am-meta-badge">
                <span>{active.blurb}</span>
              </span>
            )}
          </div>
        </section>

        {/* Filter, Search & View Controls Bar */}
        <section className="am-filter-bar" data-enter>
          <div className="am-search-box">
            <Icon name="search" size={14} className="am-search-icon" />
            <input
              type="text"
              className="am-search-input"
              placeholder="Search tasks, notes or tags…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="am-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <Icon name="x" size={13} />
              </button>
            )}
          </div>

          <div className="am-tags-filter">
            <button
              type="button"
              className={`am-tag-btn${filterTag === 'all' ? ' is-active' : ''}`}
              onClick={() => setFilterTag('all')}
            >
              All
            </button>
            <button
              type="button"
              className={`am-tag-btn${filterTag === 'today' ? ' is-active' : ''}`}
              onClick={() => setFilterTag('today')}
            >
              Today
            </button>
            <button
              type="button"
              className={`am-tag-btn${filterTag === 'important' ? ' is-active' : ''}`}
              onClick={() => setFilterTag('important')}
            >
              <Icon name="star" size={12} />
              <span>Important</span>
            </button>
            <button
              type="button"
              className={`am-tag-btn${filterTag === 'overdue' ? ' is-active' : ''}`}
              onClick={() => setFilterTag('overdue')}
            >
              <Icon name="clock" size={12} />
              <span>Overdue</span>
            </button>
          </div>

          <div className="am-view-modes">
            <button
              type="button"
              className={`am-view-btn${viewMode === 'board' ? ' is-active' : ''}`}
              onClick={() => setViewMode('board')}
              title="Board Kanban View"
            >
              <Icon name="layout" size={14} />
              <span>Board</span>
            </button>
            <button
              type="button"
              className={`am-view-btn${viewMode === 'grid' ? ' is-active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Cards Grid View"
            >
              <Icon name="grid" size={14} />
              <span>Grid</span>
            </button>
            <button
              type="button"
              className={`am-view-btn${viewMode === 'list' ? ' is-active' : ''}`}
              onClick={() => setViewMode('list')}
              title="Compact List View"
            >
              <Icon name="list" size={14} />
              <span>List</span>
            </button>
          </div>
        </section>

        {/* Main Content Area */}
        <div className="am-tasks-layout" data-enter>
          {/* Sidebar / Rail Navigation */}
          <nav className="am-rail" aria-label="Task Navigation">
            {BUCKETS.map((bucket) => {
              const activeMatch = !view.listId && view.bucket === bucket.id
              const count = loaded ? (counts.buckets?.[bucket.id] ?? 0) : ''
              return (
                <button
                  key={bucket.id}
                  type="button"
                  className={`am-rail-btn${activeMatch ? ' is-active' : ''}`}
                  onClick={() => setViewKey({ bucket: bucket.id, listId: null })}
                >
                  <Icon name={bucket.icon} size={15} />
                  <span className="am-rail-label">{bucket.label}</span>
                  {count !== '' && <span className="am-rail-count">{count}</span>}
                </button>
              )
            })}

            <div className="am-rail-sep">
              <span>My Lists</span>
              <button
                type="button"
                className="am-icon-btn"
                title="Create New List"
                aria-label="Create list"
                onClick={() => setNamingList((n) => !n)}
              >
                <Icon name={namingList ? 'x' : 'plus'} size={13} />
              </button>
            </div>

            {namingList && (
              <form
                className="am-rail-new-input"
                onSubmit={(e) => {
                  e.preventDefault()
                  newList(listName)
                }}
              >
                <input
                  autoFocus
                  placeholder="New list name"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setNamingList(false)
                      setListName('')
                    }
                  }}
                />
                <button
                  type="submit"
                  className="am-btn am-btn--xs am-btn--primary"
                  disabled={!listName.trim()}
                >
                  Add
                </button>
              </form>
            )}

            {counts.lists
              ?.filter((l) => l.id !== counts.my_day_list_id)
              .map((l) => {
                const isCustom = !l.is_default && l.id !== counts.my_day_list_id
                const isActive = Number(view.listId) === Number(l.id)
                return (
                  <div key={l.id} className="am-rail-item-row">
                    <button
                      type="button"
                      className={`am-rail-btn${isActive ? ' is-active' : ''}`}
                      onClick={() => setViewKey({ bucket: 'all', listId: l.id })}
                    >
                      <i
                        className="am-hue-dot"
                        data-hue={hues.get(l.id) ?? 5}
                        aria-hidden="true"
                      />
                      <span className="am-rail-label">{l.name}</span>
                      <span className="am-rail-count">{l.open}</span>
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        className="am-rail-delete-btn"
                        title={`Delete "${l.name}" section`}
                        aria-label={`Delete "${l.name}" section`}
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteList(l)
                        }}
                      >
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
          </nav>

          {/* Main Task Viewport */}
          <main className="am-tasks-content">
            {!loaded && <SkeletonRows rows={5} controls={3} />}

            {loaded && error && (
              <div className="empty-state" style={{ padding: 24 }}>
                <Icon name="alert" size={24} />
                <div>
                  <div style={{ fontWeight: 600 }}>{error}</div>
                  <div className="empty-actions" style={{ marginTop: 12 }}>
                    <button type="button" className="am-btn am-btn--ghost" onClick={load}>
                      <Icon name="refresh" size={13} /> Retry
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Board (Kanban) View */}
            {loaded && !error && viewMode === 'board' && (
              <div className="am-board">
                {boardColumns.map((col) => (
                  <div className="am-board-col" key={col.id}>
                    <div className="am-col-head">
                      <div className="am-col-title">
                        <span className="am-col-dot" style={{ background: col.color }} />
                        <span>{col.label}</span>
                        <span className="am-col-count">{col.tasks.length}</span>
                      </div>
                      <button
                        type="button"
                        className="am-icon-btn"
                        title="Add Task to Column"
                        onClick={() =>
                          setAdding({
                            status: col.id === 'progress' ? 'in_progress' : col.id === 'done' ? 'done' : 'todo',
                            list: view.listId
                              ? counts.lists?.find((l) => l.id === view.listId)?.name
                              : view.bucket === 'my_day'
                              ? counts.lists?.find((l) => l.id === counts.my_day_list_id)?.name || 'My Day'
                              : undefined,
                          })
                        }
                      >
                        <Icon name="plus" size={13} />
                      </button>
                    </div>

                    <div className="am-col-cards">
                      <AnimatePresence>
                        {col.tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            lists={counts.lists}
                            myDayListId={counts.my_day_list_id}
                            hues={hues}
                            view={view}
                            busy={busyTask === task.id}
                            patch={patch}
                            drop={drop}
                            onOpenDetail={setDetailTask}
                          />
                        ))}
                      </AnimatePresence>

                      <button
                        type="button"
                        className="am-add-tile"
                        onClick={() =>
                          setAdding({
                            status: col.id === 'progress' ? 'in_progress' : col.id === 'done' ? 'done' : 'todo',
                            list: view.listId
                              ? counts.lists?.find((l) => l.id === view.listId)?.name
                              : view.bucket === 'my_day'
                              ? counts.lists?.find((l) => l.id === counts.my_day_list_id)?.name || 'My Day'
                              : undefined,
                          })
                        }
                      >
                        <Icon name="plus" size={14} />
                        <span>Add Task</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Grid View (Taskmate style) */}
            {loaded && !error && viewMode === 'grid' && (
              <div>
                {mainTasks.length === 0 && completedTasks.length === 0 ? (
                  <div className="empty-state" style={{ padding: 28 }}>
                    <Icon name="check" size={24} />
                    <div style={{ marginTop: 8, fontWeight: 600 }}>
                      {view.bucket === 'missed'
                        ? 'No overdue tasks!'
                        : 'No tasks in this list yet.'}
                    </div>
                    <button
                      type="button"
                      className="am-btn am-btn--primary"
                      style={{ marginTop: 14 }}
                      onClick={() => setAdding(true)}
                    >
                      <Icon name="plus" size={14} /> Create a Task
                    </button>
                  </div>
                ) : (
                  <div className="am-cards-grid">
                    <AnimatePresence>
                      {mainTasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          lists={counts.lists}
                          myDayListId={counts.my_day_list_id}
                          hues={hues}
                          view={view}
                          busy={busyTask === task.id}
                          patch={patch}
                          drop={drop}
                          onOpenDetail={setDetailTask}
                        />
                      ))}
                    </AnimatePresence>

                    <button
                      type="button"
                      className="am-add-tile"
                      onClick={() => setAdding(true)}
                    >
                      <Icon name="plus" size={15} />
                      <span>Add new task</span>
                    </button>
                  </div>
                )}

                {/* Collapsible Done Section for non-completed views */}
                {view.bucket !== 'completed' && completedTasks.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <button
                      type="button"
                      className="am-btn am-btn--ghost"
                      onClick={() => setShowDone((s) => !s)}
                      style={{ marginBottom: 14 }}
                    >
                      <Icon
                        name={showDone ? 'chevron-down' : 'chevron-right'}
                        size={13}
                      />
                      <span>Completed ({completedTasks.length})</span>
                    </button>

                    <AnimatePresence>
                      {showDone && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.24 }}
                          className="am-cards-grid"
                        >
                          {completedTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              lists={counts.lists}
                              myDayListId={counts.my_day_list_id}
                              hues={hues}
                              view={view}
                              busy={busyTask === task.id}
                              patch={patch}
                              drop={drop}
                              onOpenDetail={setDetailTask}
                            />
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            )}

            {/* List View */}
            {loaded && !error && viewMode === 'list' && (
              <div className="am-cards-list">
                <AnimatePresence>
                  {filteredTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      lists={counts.lists}
                      myDayListId={counts.my_day_list_id}
                      hues={hues}
                      view={view}
                      busy={busyTask === task.id}
                      patch={patch}
                      drop={drop}
                      onOpenDetail={setDetailTask}
                    />
                  ))}
                </AnimatePresence>

                <button
                  type="button"
                  className="am-add-tile"
                  style={{ minHeight: 48 }}
                  onClick={() => setAdding(true)}
                >
                  <Icon name="plus" size={14} />
                  <span>Add task</span>
                </button>
              </div>
            )}

            {/* Upcoming Agenda / Calendar Events (Next 3 weeks) */}
            <div className="am-events-card">
              <div className="am-events-head">
                <div className="am-events-title">
                  <Icon name="clock" size={16} />
                  <span>Next Three Weeks Schedule • {loaded ? events.length : '…'}</span>
                </div>
              </div>

              {loaded && events.length === 0 ? (
                <div className="empty-state" style={{ padding: 16 }}>
                  <Icon name="clock" size={20} />
                  <span>No upcoming calendar events scheduled.</span>
                </div>
              ) : (
                <div className="am-events-grid">
                  {events.map((event) => {
                    const startDate = parse(event.starts_at)
                    const dayStr = startDate ? startDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Event'
                    const timeStr = startDate ? clock(event.starts_at) : ''

                    return (
                      <div className="am-event-item" key={event.id}>
                        <div className="am-event-badge">
                          <span>{dayStr.split(' ')[0]}</span>
                          <span>{dayStr.split(' ')[1] || ''}</span>
                        </div>
                        <div className="am-event-details">
                          <div className="am-event-title">{event.title}</div>
                          <div className="am-event-time">
                            {timeStr}
                            {event.location ? ` · ${event.location}` : ''}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* AI Assistant Banner */}
            <section className="am-ai-banner">
              <div className="am-ai-left">
                <div className="am-ai-spark-icon">
                  <Icon name="sparkle" size={18} />
                </div>
                <div>
                  <div className="am-ai-title">Amethyst Assistant</div>
                  <div className="am-ai-sub">Ask Amethyst to manage, plan, or schedule your tasks</div>
                </div>
              </div>

              <div className="am-ai-chips">
                <button
                  type="button"
                  className="am-ai-chip"
                  onClick={() => {
                    setView('chat')
                    chat.focusComposer?.()
                  }}
                >
                  <Icon name="clock" size={13} />
                  <span>Schedule team sync</span>
                </button>
                <button
                  type="button"
                  className="am-ai-chip"
                  onClick={() => {
                    setView('chat')
                    chat.focusComposer?.()
                  }}
                >
                  <Icon name="sun" size={13} />
                  <span>Plan my day with top tasks</span>
                </button>
                <button
                  type="button"
                  className="am-ai-chip"
                  onClick={() => {
                    setView('chat')
                    chat.focusComposer?.()
                  }}
                >
                  <Icon name="chat" size={13} />
                  <span>Open Chat</span>
                </button>
              </div>
            </section>
          </main>
        </div>
      </div>

      {/* New Task Modal */}
      <AnimatePresence>
        {Boolean(adding) && (
          <ComposerModal
            lists={counts.lists || []}
            presetList={
              (typeof adding === 'object' && adding?.list) ||
              (view.listId
                ? counts.lists?.find((l) => l.id === view.listId)?.name
                : view.bucket === 'my_day'
                ? counts.lists?.find((l) => l.id === counts.my_day_list_id)?.name || 'My Day'
                : undefined)
            }
            initialStatus={typeof adding === 'object' && adding?.status ? adding.status : 'todo'}
            onAdded={() => {
              setAdding(false)
              load()
            }}
            onClose={() => setAdding(false)}
          />
        )}
      </AnimatePresence>

      {/* Interactive Task Detail Modal */}
      <AnimatePresence>
        {detailTask && (
          <TaskDetailModal
            task={detailTask}
            lists={counts.lists || []}
            hues={hues}
            busy={busyTask === detailTask.id}
            onPatch={patch}
            onDrop={drop}
            onClose={() => setDetailTask(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
