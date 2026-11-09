import { useState, useEffect, useMemo } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import { Button } from '../../components/ui/bento/index.jsx'
import { Input } from '../../components/ui/input.tsx'
import template from '../../../../widgets/task.today/template.txt?raw'
import './tasks/tasks.css'

const DIRECTIONS = [
  {
    value: 'minimal',
    label: '01 · Minimal',
    description: 'Quiet hierarchy. One clear next step, with details kept close.',
  },
  {
    value: 'list',
    label: '02 · List-focused',
    description: 'A compact checklist with aligned deadlines and explicit priorities.',
  },
  {
    value: 'timeline',
    label: '03 · Timeline',
    description: 'Time leads the composition; deadline columns organize the day.',
  },
  {
    value: 'progress',
    label: '04 · Progress-focused',
    description: 'Completion takes the lead, with the remaining work immediately below.',
  },
  {
    value: 'editorial',
    label: '05 · Editorial',
    description: 'Expressive system typography, a strong date, and deliberate reading order.',
  },
]

const SIZES = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
]

const GROUPS = [
  { id: 'overdue', label: 'Overdue', date: 'Earlier', tone: 'danger' },
  { id: 'today', label: 'Today', date: 'Today', tone: 'secondary' },
  { id: 'upcoming', label: 'Upcoming', date: 'Later', tone: 'secondary' },
]

function adaptTasks(data, now, size = 'm', direction = 'minimal', theme = 'light') {
  const widgetSize = size === 's' ? 'small' : size === 'm' ? 'medium' : 'large'
  const nowDate = new Date(now)

  const dateNumber = String(nowDate.getDate())
  const weekday = nowDate.toLocaleDateString([], { weekday: 'long' })
  const monthYear = nowDate.toLocaleDateString([], { month: 'long', year: 'numeric' })
  const monthShort = nowDate.toLocaleDateString([], { month: 'short' }).toUpperCase()

  const rawItems = Array.isArray(data?.items) ? data.items : []

  const tasks = rawItems.map((item, idx) => {
    const isCompleted = item.completed || item.status === 'done' || item.state === 'done'
    const dueAt = item.due_at ? new Date(item.due_at) : null
    const validDue = dueAt && Number.isFinite(dueAt.getTime())

    let group = 'today'
    let tone = 'secondary'
    let day = 'Today'
    let due = 'Today'
    let shortDue = 'Today'
    let time = '12:00'
    let meridiem = 'PM'

    if (validDue) {
      const diffSec = (dueAt.getTime() - now) / 1000
      const isOverdue = diffSec < 0 && !isCompleted
      if (isOverdue) {
        group = 'overdue'
        tone = 'danger'
        day = 'Overdue'
      } else {
        const dueDay = dueAt.toDateString()
        const todayDay = nowDate.toDateString()
        const tomorrowDay = new Date(now + 86400000).toDateString()
        if (dueDay === todayDay) {
          group = 'today'
          day = 'Today'
        } else if (dueDay === tomorrowDay) {
          group = 'upcoming'
          day = 'Tomorrow'
        } else {
          group = 'upcoming'
          day = dueAt.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
        }
      }

      const hours24 = dueAt.getHours()
      const mins = dueAt.getMinutes()
      const hours12 = hours24 % 12 || 12
      meridiem = hours24 >= 12 ? 'PM' : 'AM'
      time = `${hours12}:${String(mins).padStart(2, '0')}`
      shortDue =
        mins === 0
          ? `${hours12} ${meridiem}`
          : `${hours12}:${String(mins).padStart(2, '0')} ${meridiem}`
      due = `${day}, ${shortDue}`
    } else {
      group = 'today'
      day = 'Today'
      due = 'No deadline'
      shortDue = 'Today'
    }

    const rawPriority = (item.priority || '').toLowerCase()
    let priority = 'Normal'
    if (rawPriority.includes('high') || rawPriority.includes('urgent') || item.important) {
      priority = 'High'
      if (tone !== 'danger') tone = 'warning'
    } else if (rawPriority.includes('low')) {
      priority = 'Low'
    } else if (rawPriority.includes('med')) {
      priority = 'Medium'
      if (tone !== 'danger') tone = 'warning'
    }

    return {
      id: item.id,
      slot: idx,
      title: item.title || 'Untitled task',
      group,
      day,
      due,
      shortDue,
      time,
      meridiem,
      priority,
      tone,
      done: Boolean(isCompleted),
      initialDone: Boolean(isCompleted),
    }
  })

  let status = 'ready'
  if (!data || data.state === 'loading') {
    status = 'loading'
  } else if (data.state === 'error' || data.error) {
    status = 'error'
  } else if (tasks.length === 0) {
    status = 'empty'
  } else if (data.refreshing) {
    status = 'refreshing'
  }

  return {
    appearance: theme,
    status,
    direction,
    widgetSize,
    darkPreview: theme === 'dark',
    labels: {
      title: 'Upcoming tasks',
      subtitle: 'Five directions · fifteen purpose-built layouts',
      direction: 'Design direction',
      size: 'Widget size',
      dark: 'Dark',
      darkAppearance: 'Use dark appearance',
      upNext: 'UP NEXT',
      upcoming: 'Upcoming',
      yourList: 'Your list',
      workPersonal: 'Work & personal',
      horizon: 'On the horizon',
      steadyProgress: 'Steady progress',
      completed: 'Completed',
      remainingSuffix: ' remaining',
      completedSuffix: ' completed',
      prioritySuffix: ' priority',
      of: ' of ',
      markComplete: 'Mark complete',
      dateNumber,
      weekday,
      monthYear,
      monthShort,
      editorialHeading: 'Make space for what’s next.',
      sampleDate: `${weekday}, ${monthYear}`,
      localNote: 'Changes save automatically.',
      reset: 'Refresh',
      allDone: 'A clear list.',
      allDoneNote: 'Every task is completed. Enjoy your day.',
      noTasks: 'No tasks for today.',
      error: 'Could not load tasks.',
    },
    directions: DIRECTIONS,
    sizes: SIZES,
    groups: GROUPS,
    tasks,
    message: data?.error || '',
  }
}

export default function TodayTasks({
  data,
  refresh,
  full = false,
  size = 'm',
  onOpen,
}) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
  )
  const [now, setNow] = useState(() => Date.now())
  const [direction, setDirection] = useState('minimal')
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  async function handleComplete(taskId) {
    if (!taskId || busy) return
    setBusy(true)
    setError('')
    try {
      const draft = await request('/widgets/task.today/actions/complete', 'POST', { id: taskId })
      if (draft?.draft_id) {
        const approved = await request(`/widgets/task.today/drafts/${draft.draft_id}`, 'POST', {
          approved: true,
        })
        if (approved.state === 'applied') {
          window.dispatchEvent(new Event('dashboard-items-changed'))
          if (refresh) await refresh()
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleAddTask(e) {
    e.preventDefault()
    if (!newTitle.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const draft = await request('/widgets/task.today/actions/add', 'POST', {
        title: newTitle.trim(),
        due_at: null,
      })
      if (draft?.draft_id) {
        const approved = await request(`/widgets/task.today/drafts/${draft.draft_id}`, 'POST', {
          approved: true,
        })
        if (approved.state === 'applied') {
          setNewTitle('')
          window.dispatchEvent(new Event('dashboard-items-changed'))
          if (refresh) await refresh()
        }
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptTasks(data, now, effectiveSize, direction, theme),
    [data, now, effectiveSize, direction, theme]
  )

  function handleAction(action) {
    if (action?.action === 'task.complete' && action.id) {
      handleComplete(action.id)
    }
  }

  // Detail View (Drawer)
  if (full) {
    const items = Array.isArray(data?.items) ? data.items : []
    return (
      <div className="tasks-detail" role="region" aria-label="Today tasks details">
        <div className="tasks-detail-top">
          <h3 className="tasks-detail-title">Today's Tasks</h3>
          <p className="tasks-detail-subtitle">Manage open tasks on your Today list</p>
        </div>

        {error && (
          <p className="tasks-detail-subtitle" style={{ color: 'var(--w-danger, #ff453a)' }}>
            {error}
          </p>
        )}

        <form className="tasks-inline-add" onSubmit={handleAddTask}>
          <Input
            required
            aria-label="New task title"
            placeholder="Add a task to Today…"
            maxLength={500}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <Button variant="primary" size="small" type="submit" disabled={busy}>
            Add task
          </Button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
          <label style={{ fontSize: '13px', fontWeight: 500 }}>Composition style</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {DIRECTIONS.map((dir) => (
              <Button
                key={dir.value}
                type="button"
                variant={direction === dir.value ? 'primary' : 'default'}
                onClick={() => setDirection(dir.value)}
                style={{ borderRadius: '999px', textTransform: 'capitalize' }}
              >
                {dir.value}
              </Button>
            ))}
          </div>
        </div>

        {!items.length ? (
          <p className="tasks-detail-subtitle" role="status">
            No tasks found for today.
          </p>
        ) : (
          <ul className="tasks-detail-list">
            {items.map((item) => {
              const isCompleted = item.completed || item.status === 'done' || item.state === 'done'
              return (
                <li className="tasks-detail-item" key={item.id}>
                  <span
                    className="tasks-detail-item-title"
                    style={{ textDecoration: isCompleted ? 'line-through' : 'none' }}
                  >
                    {item.title}
                  </span>
                  {item.due_at && (
                    <span className="tasks-detail-item-due">
                      {new Date(item.due_at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                  {!isCompleted && item.editable && (
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => handleComplete(item.id)}
                    >
                      Complete
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  // Dashboard Tile View using WidgetRenderer
  return (
    <div
      className="tasks-widget-root"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (onOpen) onOpen()
        }
      }}
    >
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={handleAction}
      />
    </div>
  )
}
