import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/need.overdue/template.txt?raw'
import fixture from '../../../../widgets/need.overdue/data.fixture.json'
import './overdue/overdue.css'

const DIRECTIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'timeline', label: 'Timeline', study: '02' },
  { value: 'priority', label: 'Priority', study: '03' },
  { value: 'grouped', label: 'Grouped', study: '04' },
  { value: 'editorial', label: 'Editorial', study: '05' },
]

function adaptOverdue(data, size, direction = 'minimal', theme = 'light') {
  const items = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      scale: size === 'l' ? 'large' : 'medium',
      direction,
      appearance: theme,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Could not load overdue items',
      scale: size === 'l' ? 'large' : 'medium',
      direction,
      appearance: theme,
    }
  }

  if (items.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      tasks: [],
      scale: size === 'l' ? 'large' : 'medium',
      direction,
      appearance: theme,
    }
  }

  const now = new Date()
  const tasks = items.map((item, idx) => {
    const dueTime = item.due_at ? new Date(item.due_at).getTime() : now.getTime() - 86400000
    const diffMs = Math.max(0, now.getTime() - dueTime)
    const days = Math.max(1, Math.floor(diffMs / 86400000))
    const due = item.due_at
      ? new Date(item.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'Today'

    let priority = 'Standard'
    let rank = 3
    let color = 'secondary'
    if (days >= 7) {
      priority = 'Critical'
      rank = 1
      color = 'danger'
    } else if (days >= 3) {
      priority = 'High'
      rank = 2
      color = 'warning'
    }

    const project =
      {
        tasks: 'Tasks',
        deadlines: 'Deadlines',
        reminders: 'Reminders',
      }[item.source] || 'Tasks'

    return {
      id: String(item.id),
      index: idx,
      title: item.title || 'Untitled task',
      due,
      days,
      priority,
      rank,
      color,
      project,
      medium: idx === 0,
      done: false,
      source: item.source || 'tasks',
    }
  })

  return {
    ...fixture,
    status: 'ready',
    tasks,
    scale: size === 'l' ? 'large' : 'medium',
    direction,
    appearance: theme,
  }
}

export default function OverdueItems({
  data,
  refresh,
  size = 'm',
  full = false,
}) {
  const [direction, setDirection] = useState(() => {
    try {
      return localStorage.getItem('amethyst:overdue-direction') || 'minimal'
    } catch {
      return 'minimal'
    }
  })
  const [theme, setTheme] = useState(() => {
    return typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-theme-mode') === 'dark'
      ? 'dark'
      : 'light'
  })

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const dark = document.documentElement.getAttribute('data-theme-mode') === 'dark'
      setTheme(dark ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => observer.disconnect()
  }, [])

  function handleDirectionSelect(newDirection) {
    setDirection(newDirection)
    try {
      localStorage.setItem('amethyst:overdue-direction', newDirection)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptOverdue(data, effectiveSize, direction, theme),
    [data, effectiveSize, direction, theme]
  )

  async function handleAction(action) {
    if (!action) return
    // Handle mark-complete action
    if (action.patchState || action.updateState) {
      const patch = action.patchState || action.updateState
      for (const [key, val] of Object.entries(patch)) {
        const match = key.match(/^tasks\.(\d+)\.done$/)
        if (match && val === true) {
          const index = parseInt(match[1], 10)
          const targetTask = widgetData.tasks[index]
          if (targetTask) {
            const targetWidget =
              targetTask.source === 'deadlines'
                ? 'task.deadlines'
                : targetTask.source === 'reminders'
                  ? 'task.reminders'
                  : 'task.today'
            try {
              await request(`/widgets/${targetWidget}/actions/complete`, 'POST', {
                id: targetTask.id,
              })
              await refresh?.()
            } catch (err) {
              console.error('Failed to complete task:', err)
            }
          }
        }
      }
    }
  }

  return (
    <div className="need-overdue-root">
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={handleAction}
      />
      {full && (
        <div style={{ marginTop: '20px' }} className="adoption-stack">
          <div style={{ marginBottom: '16px' }}>
            <span
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: 600,
                marginBottom: '8px',
                color: 'var(--w-text)',
              }}
            >
              Design study
            </span>
            <div className="overdue-directions-row">
              {DIRECTIONS.map(dir => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={dir.value}
                  type="button"
                  className={`overdue-direction-btn ${direction === dir.value ? 'is-active' : ''}`}
                  onClick={() => handleDirectionSelect(dir.value)}
                >
                  {dir.label} ({dir.study})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
