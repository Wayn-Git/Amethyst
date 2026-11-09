import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/agent.brief/template.txt?raw'
import fixture from '../../../../widgets/agent.brief/data.fixture.json'
import './brief/brief.css'

const DIRECTIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'split', label: 'Split', study: '02' },
  { value: 'timeline', label: 'Timeline', study: '03' },
  { value: 'editorial', label: 'Editorial', study: '04' },
  { value: 'dashboard', label: 'Dashboard', study: '05' },
]

function getRealDate() {
  const now = new Date()
  const day = String(now.getDate())
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const month = now.toLocaleDateString('en-US', { month: 'long' })
  const monthShort = now.toLocaleDateString('en-US', { month: 'short' })
  const year = String(now.getFullYear())
  const short = `${now.toLocaleDateString('en-US', { weekday: 'short' })}, ${monthShort} ${day}`
  const full = `${weekday}, ${month} ${day}`
  return { day, weekday, month, monthShort, year, short, full }
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function adaptBrief(data, size, direction = 'editorial', theme = 'light') {
  const rawItems = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const widgetSize = size === 's' ? 'small' : size === 'l' ? 'large' : 'medium'
  const darkPreview = theme === 'dark'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      widgetSize,
      direction,
      darkPreview,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Daily overview unavailable',
      widgetSize,
      direction,
      darkPreview,
    }
  }

  const date = getRealDate()
  const greeting = getGreeting()

  let tasks = []
  let events = []
  let dayNote = 'All caught up. Review your priorities for today.'

  if (rawItems.length > 0) {
    dayNote = `${rawItems[0].title}. ${rawItems.length} priority items on your agenda.`
    const taskCandidates = rawItems.filter(it => it.widget_id !== 'glance.next-event' && it.widget_id !== 'task.agenda')
    const eventCandidates = rawItems.filter(it => it.widget_id === 'glance.next-event' || it.widget_id === 'task.agenda')

    tasks = (taskCandidates.length > 0 ? taskCandidates : rawItems).map((it, idx) => ({
      id: String(it.item_id || it.id || `task-${idx}`),
      title: it.title || 'Task',
      done: false,
      priority: idx === 0,
      deadline: it.detail || '',
    }))

    events = eventCandidates.map((it, idx) => ({
      id: String(it.item_id || it.id || `event-${idx}`),
      title: it.title || 'Upcoming event',
      timeLabel: it.detail || 'Today',
      priority: idx === 0,
    }))

    if (events.length === 0 && tasks.length > 1) {
      const moved = tasks.pop()
      events.push({
        id: moved.id,
        title: moved.title,
        timeLabel: moved.deadline || 'Today',
        priority: false,
      })
    }
  } else {
    // Empty state fallback or default tasks
    tasks = [
      { id: 'inbox', title: 'Clear inbox', done: true, priority: false, deadline: '' },
      { id: 'review', title: 'Plan priorities', done: false, priority: true, deadline: 'Today' },
    ]
    events = [
      { id: 'focus', title: 'Deep work session', timeLabel: '11:00 AM', priority: false },
    ]
  }

  const topTask = tasks.find(t => t.priority)?.id || tasks[0]?.id || ''

  return {
    ...fixture,
    status: 'ready',
    widgetSize,
    direction,
    darkPreview,
    date,
    greeting,
    dayNote,
    tasks,
    events,
    topTask,
    disabled: Boolean(data?.disabled),
  }
}

export default function DailyOverview({
  data,
  refresh,
  size = 'm',
  full = false,
}) {
  const [direction, setDirection] = useState(() => {
    try {
      return localStorage.getItem('amethyst:brief-direction') || 'editorial'
    } catch {
      return 'editorial'
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
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-mode'],
    })
    return () => observer.disconnect()
  }, [])

  function handleDirectionSelect(newDirection) {
    setDirection(newDirection)
    try {
      localStorage.setItem('amethyst:brief-direction', newDirection)
    } catch {
      // Local storage unavailable
    }
  }

  async function handleToggleModel() {
    try {
      await request('/widgets/agent.brief/settings', 'PUT', {
        model_enabled: !data?.disabled,
      })
      await refresh?.()
    } catch (err) {
      console.error('Failed to toggle model brief:', err)
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptBrief(data, effectiveSize, direction, theme),
    [data, effectiveSize, direction, theme]
  )

  return (
    <div className="agent-brief-root">
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
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
              Design direction
            </span>
            <div className="brief-directions-row">
              {DIRECTIONS.map(dir => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={dir.value}
                  type="button"
                  className={`brief-direction-btn ${direction === dir.value ? 'is-active' : ''}`}
                  onClick={() => handleDirectionSelect(dir.value)}
                >
                  {dir.label} ({dir.study})
                </button>
              ))}
            </div>
          </div>
          {data?.disabled !== undefined && (
            <div style={{ marginTop: '12px' }}>
              {/* oxlint-disable-next-line amethyst-ui/no-raw-controls */}
              <button
                type="button"
                className="brief-direction-btn"
                onClick={handleToggleModel}
              >
                {data.disabled ? 'Enable model synthesis' : 'Disable model synthesis'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
