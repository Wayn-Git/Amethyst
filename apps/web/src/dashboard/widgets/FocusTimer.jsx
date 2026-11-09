import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/task.focus/template.txt?raw'
import fixture from '../../../../widgets/task.focus/data.fixture.json'
import './focus/focus.css'

const DIRECTIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'circular', label: 'Circular', study: '02' },
  { value: 'digital', label: 'Digital', study: '03' },
  { value: 'sessions', label: 'Session-based', study: '04' },
  { value: 'editorial', label: 'Editorial', study: '05' },
]

function adaptFocus(data, size, direction = 'minimal', theme = 'light', nowMs = Date.now()) {
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const widgetSize = size === 's' ? 'small' : size === 'l' ? 'large' : 'medium'
  const darkAppearance = theme === 'dark'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      widgetSize,
      direction,
      darkAppearance,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Focus timer unavailable',
      widgetSize,
      direction,
      darkAppearance,
    }
  }

  const focusMinutes = Number(data?.focus_minutes ?? 25)
  const breakMinutes = Number(data?.break_minutes ?? 5)
  const focusSeconds = focusMinutes * 60
  const breakSeconds = breakMinutes * 60
  const longBreakSeconds = 15 * 60

  const items = Array.isArray(data?.items) ? data.items : []
  const active = items.find(row => !row.ended_at)

  let phase = active?.mode || 'focus'
  let duration = active?.duration_s ?? (phase === 'focus' ? focusSeconds : breakSeconds)
  let deadline = 0
  let seconds = phase === 'focus' ? focusSeconds : breakSeconds
  let running = false

  if (active) {
    const startedMs = new Date(active.started_at).getTime()
    deadline = startedMs + duration * 1000
    const rem = Math.max(0, Math.ceil((deadline - nowMs) / 1000))
    if (rem > 0) {
      running = true
      seconds = rem
    } else {
      running = false
      seconds = 0
    }
  }

  // Calculate completed sessions and daily focus seconds from today
  const today = new Date().toDateString()
  let completed = 0
  let dailyFocusBefore = 0

  for (const item of items) {
    if (item.started_at && new Date(item.started_at).toDateString() === today) {
      if (item.completed) {
        completed += 1
      }
      if (item.mode === 'focus') {
        dailyFocusBefore += Number(item.duration_s || 0)
      }
    }
  }

  const sessionNumber = (completed % 4) + 1

  return {
    ...fixture,
    status: 'ready',
    widgetSize,
    direction,
    darkAppearance,
    running,
    deadline,
    seconds,
    focusSeconds,
    breakSeconds,
    longBreakSeconds,
    phase,
    sessionNumber,
    completed,
    dailyFocusBefore,
  }
}

export default function FocusTimer({
  data,
  refresh,
  size = 'm',
  full = false,
}) {
  const [direction, setDirection] = useState(() => {
    try {
      return localStorage.getItem('amethyst:focus-direction') || 'minimal'
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

  const [nowMs, setNowMs] = useState(Date.now)

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

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
      localStorage.setItem('amethyst:focus-direction', newDirection)
    } catch {
      // Local storage unavailable
    }
  }

  async function handleAction(action) {
    if (!action) return
    const update = action.updateState
    if (update) {
      if (update.running !== undefined) {
        if (update.running) {
          try {
            const draft = await request('/widgets/task.focus/actions/start', 'POST', {
              mode: update.phase || 'focus',
            })
            if (draft?.draft_id) {
              await request(`/widgets/task.focus/drafts/${draft.draft_id}`, 'POST', { approved: true })
            }
            await refresh?.()
          } catch (err) {
            console.error('Failed to start focus session:', err)
          }
        } else {
          try {
            const draft = await request('/widgets/task.focus/actions/stop', 'POST', {})
            if (draft?.draft_id) {
              await request(`/widgets/task.focus/drafts/${draft.draft_id}`, 'POST', { approved: true })
            }
            await refresh?.()
          } catch (err) {
            console.error('Failed to stop focus session:', err)
          }
        }
      }
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptFocus(data, effectiveSize, direction, theme, nowMs),
    [data, effectiveSize, direction, theme, nowMs]
  )

  return (
    <div className="task-focus-root">
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
              Design direction
            </span>
            <div className="focus-directions-row">
              {DIRECTIONS.map(dir => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={dir.value}
                  type="button"
                  className={`focus-direction-btn ${direction === dir.value ? 'is-active' : ''}`}
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
