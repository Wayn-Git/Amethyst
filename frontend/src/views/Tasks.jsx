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
  { id: 'general', label: 'All Tasks', icon: 'list' },
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

function isOverdue(task) {
  if (!task.due_at || task.status === 'done' || task.status === 'cancelled') return false
  return new Date(task.due_at.replace(' ', 'T')) < new Date(new Date().toDateString())
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

function isCreatedToday(task) {
  if (!task) return false
  const stamp = task.created_at || task.created
  if (!stamp) return false
  if (dayLabel(stamp) === 'Today') return true
  if (typeof stamp === 'string' && !stamp.endsWith('Z') && !stamp.includes('+')) {
    const dUtc = parseDate(stamp.replace(' ', 'T') + 'Z')
    if (dUtc && dayLabel(dUtc.toISOString()) === 'Today') return true
  }
  return false
}

/* =========================================================================
   Slide-over Task Inspector Sheet
   ========================================================================= */
function TaskInspector({ task, lists, busy, onPatch, onDrop, onClose }) {
  const [title, setTitle] = useState(task.title || '')
  const [notes, setNotes] = useState(task.notes || '')
  const [dueHint, setDueHint] = useState('')
  const [reminderHint, setReminderHint] = useState('')
  const [listId, setListId] = useState(task.list_id || '')
  const [dirty, setDirty] = useState(false)

  const isDone = task.status === 'done'
  const isProg = task.status === 'in_progress'

  useEffect(() => {
    setTitle(task.title || '')
    setNotes(task.notes || '')
    setListId(task.list_id || '')
    setDueHint('')
    setReminderHint('')
    setDirty(false)
  }, [task])

  const handleSave = async () => {
    const patchBody = {}
    if (title.trim() && title.trim() !== task.title) patchBody.title = title.trim()
    if (notes !== (task.notes || '')) patchBody.notes = notes.trim() || null
    if (dueHint.trim()) patchBody.due_date_hint = dueHint.trim()
    if (reminderHint.trim()) patchBody.reminder_hint = reminderHint.trim()
    if (listId && listId !== task.list_id) {
      const selected = lists.find((l) => String(l.id) === String(listId))
      if (selected) patchBody.list = selected.name
    }

    if (Object.keys(patchBody).length > 0) {
      await onPatch(task, patchBody, 'Task updated')
    }
    onClose()
  }

  return (
    <div className="tasks-inspector-backdrop" onClick={onClose}>
      <motion.aside
        className="tasks-inspector-panel"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Task Inspector"
      >
        <div className="tasks-inspector-head">
          <div className="tasks-status-control">
            <button
              type="button"
              className={`tasks-status-btn ${task.status === 'todo' ? 'is-active' : ''}`}
              onClick={() => onPatch(task, { status: 'todo' }, 'Moved to To Do')}
            >
              <Icon name="list" size={12} />
              <span>To Do</span>
            </button>
            <button
              type="button"
              className={`tasks-status-btn ${isProg ? 'is-active is-prog' : ''}`}
              onClick={() => onPatch(task, { status: 'in_progress' }, 'In progress')}
            >
              <Icon name="lightning" size={12} />
              <span>In Progress</span>
            </button>
            <button
              type="button"
              className={`tasks-status-btn ${isDone ? 'is-active is-done' : ''}`}
              onClick={() => onPatch(task, { status: 'done' }, 'Task completed')}
            >
              <Icon name="check-circle" size={12} />
              <span>Completed</span>
            </button>
          </div>

          <button
            type="button"
            className="tasks-inspector-close"
            onClick={onClose}
            aria-label="Close details"
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="tasks-inspector-body">
          <input
            className="tasks-inspector-title"
            value={title}
            placeholder="Task title"
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
            }}
          />

          <div className="tasks-field-group">
            <label className="tasks-field-label">
              <Icon name="list" size={12} />
              <span>List</span>
            </label>
            <select
              className="tasks-field-select"
              value={listId}
              onChange={(e) => {
                setListId(e.target.value)
                setDirty(true)
              }}
            >
              <option value="">Default List</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div className="tasks-field-group">
            <label className="tasks-field-label">
              <Icon name="clock" size={12} />
              <span>Due Date</span>
            </label>
            <input
              className="tasks-field-input"
              placeholder={task.due_at ? formatDate(task.due_at) : 'e.g. tomorrow, friday 5pm'}
              value={dueHint}
              onChange={(e) => {
                setDueHint(e.target.value)
                setDirty(true)
              }}
            />
          </div>

          <div className="tasks-field-group">
            <label className="tasks-field-label">
              <Icon name="clock" size={12} />
              <span>Reminder</span>
            </label>
            <input
              className="tasks-field-input"
              placeholder={task.reminder_at ? formatDate(task.reminder_at) : 'e.g. tomorrow 9am'}
              value={reminderHint}
              onChange={(e) => {
                setReminderHint(e.target.value)
                setDirty(true)
              }}
            />
          </div>

          <div className="tasks-field-group">
            <label className="tasks-field-label">
              <Icon name="file" size={12} />
              <span>Notes</span>
            </label>
            <textarea
              className="tasks-field-textarea"
              placeholder="Add details, links, or context…"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value)
                setDirty(true)
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className={`tasks-quick-toggle-btn ${task.important ? 'is-active' : ''}`}
              onClick={() => onPatch(task, { important: !task.important })}
            >
              <Icon name="star" size={14} weight={task.important ? 'fill' : 'regular'} />
              <span>{task.important ? 'Important' : 'Mark Important'}</span>
            </button>
          </div>
        </div>

        <div className="tasks-inspector-foot">
          <div className="tasks-sync-stamp">
            <Icon name="plugs-connected" size={13} />
            <span>
              {task.external_source === 'microsoft-todo' || task.external_id
                ? 'Synced with Microsoft To Do'
                : 'Local task'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="tasks-delete-btn"
              disabled={busy}
              onClick={() => {
                onDrop(task)
                onClose()
              }}
            >
              <Icon name="trash" size={13} />
              <span>Delete</span>
            </button>

            <button
              type="button"
              className="tasks-save-btn"
              disabled={!dirty || busy}
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      </motion.aside>
    </div>
  )
}

/* =========================================================================
   Task Row Item (Understated Minimalist Row)
   ========================================================================= */
function TaskItemRow({ task, lists, view, busy, onPatch, onSelect }) {
  const isDone = task.status === 'done'
  const isLate = isOverdue(task)
  const isProg = task.status === 'in_progress'
  const day = dayLabel(task.due_at || task.scheduled_at)
  const listName = lists.find((l) => l.id === task.list_id)?.name

  return (
    <motion.div
      layout="position"
      className={`task-item-row${isDone ? ' is-done' : ''}`}
      onClick={() => onSelect(task)}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <button
        type="button"
        className={`task-check-btn${isDone ? ' is-checked' : ''}`}
        disabled={busy}
        aria-label={isDone ? 'Mark incomplete' : 'Mark complete'}
        onClick={(e) => {
          e.stopPropagation()
          onPatch(task, { status: isDone ? 'todo' : 'done' })
        }}
      >
        {isDone && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            <Icon name="check" size={11} />
          </motion.span>
        )}
      </button>

      <div className="task-item-main">
        <span className="task-item-title">{task.title}</span>
        {task.notes && (
          <span className="task-item-notes-preview">{task.notes}</span>
        )}
      </div>

      <div className="task-item-meta" onClick={(e) => e.stopPropagation()}>
        {isProg && !isDone && (
          <span className="task-meta-item is-prog">
            <Icon name="lightning" size={12} />
            <span>In Progress</span>
          </span>
        )}

        {day && !isDone && (
          <span
            className={`task-meta-item ${
              isLate ? 'is-overdue' : day === 'Today' ? 'is-today' : ''
            }`}
          >
            <Icon name="clock" size={12} />
            <span>{isLate ? `Overdue • ${day}` : day}</span>
          </span>
        )}

        {listName && !view.listId && view.bucket !== 'my_day' && (
          <span className="task-meta-item is-list">
            <Icon name="folder" size={12} />
            <span>{listName}</span>
          </span>
        )}

        <button
          type="button"
          className={`task-star-btn${task.important ? ' is-starred' : ''}`}
          disabled={busy}
          title={task.important ? 'Remove importance' : 'Mark important'}
          aria-label={task.important ? 'Remove importance' : 'Mark important'}
          onClick={(e) => {
            e.stopPropagation()
            onPatch(task, { important: !task.important })
          }}
        >
          <Icon name="star" size={14} weight={task.important ? 'fill' : 'regular'} />
        </button>
      </div>
    </motion.div>
  )
}

/* =========================================================================
   Board Kanban Column Card
   ========================================================================= */
function BoardCard({ task, busy, onPatch, onSelect }) {
  const isDone = task.status === 'done'
  const isLate = isOverdue(task)
  const day = dayLabel(task.due_at || task.scheduled_at)

  return (
    <motion.div
      layout="position"
      className={`tasks-board-card${isDone ? ' is-done' : ''}`}
      onClick={() => onSelect(task)}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <div className="tasks-board-card-top">
        <button
          type="button"
          className={`task-check-btn${isDone ? ' is-checked' : ''}`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation()
            onPatch(task, { status: isDone ? 'todo' : 'done' })
          }}
        >
          {isDone && <Icon name="check" size={10} />}
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

      <div style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
        {day && (
          <span
            className={`task-meta-item ${
              isLate ? 'is-overdue' : day === 'Today' ? 'is-today' : ''
            }`}
          >
            <Icon name="clock" size={11} />
            <span>{day}</span>
          </span>
        )}
      </div>
    </motion.div>
  )
}

/* =========================================================================
   Main Tasks View
   ========================================================================= */
export default function Tasks() {
  const rootRef = useRef(null)
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
  const [showDone, setShowDone] = useState(false)

  /* Subnav list creation */
  const [namingList, setNamingList] = useState(false)
  const [listName, setListName] = useState('')

  /* Inline quick task input */
  const [quickTitle, setQuickTitle] = useState('')
  const [quickImportant, setQuickImportant] = useState(false)
  const [quickBusy, setQuickBusy] = useState(false)

  useViewEntrance(rootRef)
  const loadToken = useRef(0)

  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      if (!view.listId && view.bucket === 'all') {
        setViewKey({ bucket: 'general', listId: null })
        return
      }
      const isCompletedBucket = view.bucket === 'completed'
      const isAllBucket = view.bucket === 'general'
      const [rows, allCompleted, allOpen, summary] = await Promise.all([
        api.tasks(
          view.listId
            ? { listId: view.listId }
            : { bucket: isCompletedBucket || isAllBucket ? 'all' : view.bucket },
        ),
        api.tasks({ bucket: 'completed' }),
        api.tasks({ bucket: 'all' }),
        api.taskBuckets(),
      ])
      if (loadToken.current !== token) return

      let openRows = isCompletedBucket ? allOpen : rows
      let relevantCompleted = allCompleted

      if (view.listId != null) {
        relevantCompleted = allCompleted.filter((t) => Number(t.list_id) === Number(view.listId))
      } else if (view.bucket === 'important') {
        relevantCompleted = allCompleted.filter((t) => Boolean(t.important))
      } else if (view.bucket === 'my_day') {
        openRows = allOpen.filter((t) => isCreatedToday(t))
        relevantCompleted = allCompleted.filter((t) => isCreatedToday(t))
      } else if (view.bucket === 'general') {
        openRows = allOpen
        relevantCompleted = allCompleted
      } else if (view.bucket === 'missed') {
        relevantCompleted = allCompleted.filter((t) => isOverdue(t))
      }

      if (summary?.buckets) {
        summary.buckets.my_day = allOpen.filter((t) => isCreatedToday(t)).length
        summary.buckets.general = allOpen.length
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
    if (landed.current || !counts.buckets || Object.keys(counts.buckets).length === 0) return
    const { my_day: myDay = 0, missed = 0, general = 0, all = 0 } = counts.buckets
    landed.current = true
    if (myDay > 0) return
    if (missed > 0) setViewKey({ bucket: 'missed', listId: null })
    else if (general > 0 || all > 0) setViewKey({ bucket: 'general', listId: null })
  }, [counts])

  /* Mutation handlers */
  const patchTask = useCallback(
    async (task, body, note) => {
      setBusyTaskId(task.id)
      try {
        await api.updateTask(task.id, body)
        if (note) toast(note, 'ok')
        await load()
      } catch (err) {
        toast(err.message, 'bad')
      } finally {
        setBusyTaskId(null)
      }
    },
    [load, toast],
  )

  const dropTask = useCallback(
    async (task) => {
      setBusyTaskId(task.id)
      try {
        await api.deleteTask(task.id)
        toast('Task deleted', 'ok')
        if (inspectingTask?.id === task.id) setInspectingTask(null)
        await load()
      } catch (err) {
        toast(err.message, 'bad')
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
        setNamingList(false)
        setListName('')
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

  /* Inline quick task submit */
  const handleQuickAdd = async (e) => {
    e.preventDefault()
    const clean = quickTitle.trim()
    if (!clean || quickBusy) return

    setQuickBusy(true)
    try {
      const targetList = view.listId
        ? counts.lists?.find((l) => l.id === view.listId)?.name
        : view.bucket === 'my_day'
        ? counts.lists?.find((l) => l.id === counts.my_day_list_id)?.name || 'My Day'
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
    const b = BUCKETS.find((bk) => bk.id === (view.bucket === 'all' ? 'general' : view.bucket)) || BUCKETS[0]
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

  const [openTasks, completedTasks] = useMemo(() => {
    return [
      filteredTasks.filter((t) => t.status !== 'done'),
      filteredTasks.filter((t) => t.status === 'done'),
    ]
  }, [filteredTasks])

  /* Board Columns */
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
      { id: 'todo', label: 'To Do', tasks: todo },
      { id: 'progress', label: 'In Progress', tasks: inProg },
      { id: 'done', label: 'Completed', tasks: done },
    ]
  }, [filteredTasks])

  const customLists = useMemo(() => {
    return (counts.lists || []).filter((l) => l.id !== counts.my_day_list_id)
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
              {loaded ? `${openTasks.length} ${openTasks.length === 1 ? 'task' : 'tasks'}` : '…'}
            </span>
          </div>

          <div className="tasks-top-right">
            <div className="tasks-search-wrap">
              <Icon name="search" size={13} className="tasks-search-icon" />
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
                  <Icon name="x" size={12} />
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
                <Icon name="list" size={13} />
                <span>List</span>
              </button>
              <button
                type="button"
                className={`tasks-view-switch-btn${viewMode === 'board' ? ' is-active' : ''}`}
                onClick={() => setViewMode('board')}
                title="Board view"
              >
                <Icon name="layout" size={13} />
                <span>Board</span>
              </button>
            </div>

            <button
              type="button"
              className="tasks-sync-btn"
              disabled={syncing}
              onClick={syncToDo}
              title={counts.connected ? 'Synced with Microsoft To Do' : 'Sync tasks'}
            >
              <span
                className={`tasks-sync-indicator${counts.connected ? ' is-connected' : ''}`}
              />
              <Icon
                name="refresh"
                size={13}
                className={syncing ? 'am-spin' : ''}
              />
              <span>{syncing ? 'Syncing…' : 'Sync'}</span>
            </button>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
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
                  <Icon name={bucket.icon} size={14} />
                  <span>{bucket.label}</span>
                  {count != null && <span className="tasks-tab-badge">({count})</span>}
                </button>
              )
            })}
          </div>

          {/* Microsoft To Do Lists Menu */}
          <div className="tasks-lists-selector-wrap">
            <select
              className="tasks-lists-select"
              value={view.listId || ''}
              aria-label="Select List"
              onChange={(e) => {
                const val = e.target.value
                if (val) {
                  setViewKey({ bucket: 'all', listId: Number(val) })
                } else {
                  setViewKey({ bucket: 'my_day', listId: null })
                }
              }}
            >
              <option value="">Lists ({customLists.length})…</option>
              {customLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.open})
                </option>
              ))}
            </select>

            {namingList ? (
              <form
                style={{ display: 'inline-flex', gap: 4 }}
                onSubmit={(e) => {
                  e.preventDefault()
                  createList(listName)
                }}
              >
                <input
                  autoFocus
                  placeholder="New list name"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setNamingList(false)
                  }}
                  style={{
                    background: 'var(--surface-raised, #18181b)',
                    border: '1px solid var(--hairline, rgba(255, 255, 255, 0.12))',
                    borderRadius: 4,
                    padding: '3px 7px',
                    fontSize: 12,
                    color: '#fff',
                    outline: 'none',
                  }}
                />
              </form>
            ) : (
              <button
                type="button"
                className="tasks-subnav-action-btn"
                onClick={() => setNamingList(true)}
                title="Create a new list"
              >
                <Icon name="plus" size={12} />
                <span>New List</span>
              </button>
            )}

            {activeHeader.isCustom && !activeHeader.list?.is_default && (
              <button
                type="button"
                className="tasks-subnav-action-btn is-danger"
                title={`Delete list "${activeHeader.label}"`}
                onClick={() => deleteList(activeHeader.list)}
              >
                <Icon name="trash" size={12} />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ----------------- Main Workspace Content ----------------- */}
      <main className="tasks-main">
        {/* Full-Width Quick-Add Bar */}
        <form className="tasks-quick-bar" onSubmit={handleQuickAdd}>
          <Icon name="plus" size={16} className="tasks-quick-plus" />
          <input
            className="tasks-quick-input"
            placeholder={`Add a task to ${activeHeader.label}…`}
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

        {!loaded && <SkeletonRows rows={8} controls={2} />}

        {loaded && error && (
          <div className="tasks-empty">
            <div className="tasks-empty-icon">
              <Icon name="alert" size={20} />
            </div>
            <div className="tasks-empty-title">Failed to load tasks</div>
            <div className="tasks-empty-desc">{error}</div>
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
        )}

        {/* List View */}
        {loaded && !error && viewMode === 'list' && (
          <div className="tasks-list-wrap">
            {openTasks.length === 0 && completedTasks.length === 0 && (
              <div className="tasks-empty">
                <div className="tasks-empty-icon">
                  <Icon name="check" size={20} />
                </div>
                <div className="tasks-empty-title">All tasks clear</div>
                <div className="tasks-empty-desc">
                  {searchQuery
                    ? 'No tasks match your search.'
                    : 'No open tasks in this list. Use the box above to add one.'}
                </div>
              </div>
            )}

            <AnimatePresence>
              {openTasks.map((task) => (
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

            {/* Collapsible Completed Section */}
            {view.bucket !== 'completed' && completedTasks.length > 0 && (
              <div>
                <button
                  type="button"
                  className="tasks-completed-toggle"
                  onClick={() => setShowDone((s) => !s)}
                >
                  <Icon
                    name={showDone ? 'chevron-down' : 'chevron-right'}
                    size={12}
                  />
                  <span>Completed ({completedTasks.length})</span>
                </button>

                <AnimatePresence>
                  {showDone && (
                    <motion.div
                      className="tasks-list-wrap"
                      style={{ marginTop: 4 }}
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

        {/* Board Kanban View */}
        {loaded && !error && viewMode === 'board' && (
          <div className="tasks-board-grid">
            {boardColumns.map((col) => (
              <div className="tasks-board-col" key={col.id}>
                <div className="tasks-col-head">
                  <span>{col.label}</span>
                  <span className="tasks-col-count">{col.tasks.length}</span>
                </div>

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
            ))}
          </div>
        )}
      </main>

      {/* Slide-over Task Inspector Sheet */}
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
