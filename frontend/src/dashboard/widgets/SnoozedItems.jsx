import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/need.snoozed/template.txt?raw'
import fixture from '../../../../widgets/need.snoozed/data.fixture.json'
import './snoozed/snoozed.css'

const LAYOUTS = [
  { value: 'minimal', label: 'Minimal spotlight', study: '01' },
  { value: 'timeline', label: 'Timeline', study: '02' },
  { value: 'grouped', label: 'Grouped', study: '03' },
  { value: 'agenda', label: 'Agenda', study: '04' },
  { value: 'compact', label: 'Compact list', study: '05' },
]

function adaptSnoozed(data, size, layoutChoice = 'minimal', theme = 'light') {
  const rawItems = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const sizeChoice = size === 'l' ? 'large' : 'medium'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      sizeChoice,
      scale: sizeChoice,
      layoutChoice,
      appearance: theme,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Could not load snoozed items',
      sizeChoice,
      scale: sizeChoice,
      layoutChoice,
      appearance: theme,
    }
  }

  if (rawItems.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      items: [],
      sizeChoice,
      scale: sizeChoice,
      layoutChoice,
      appearance: theme,
    }
  }

  const now = new Date()
  const items = rawItems.map((item, idx) => {
    const rawUntil = item.until
    const dateObj = rawUntil ? new Date(rawUntil) : now
    const hours = dateObj.getHours()
    const period = hours < 12 ? 'morning' : 'afternoon'
    const time = dateObj.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    const returnState = item.return_state || (dateObj <= now ? 'ready' : 'scheduled')
    const context = returnState === 'ready' ? 'Ready to resume' : `Returning at ${time}`

    let source = 'Projects'
    let kind = 'task'
    let type = 'Task'

    const src = String(item.source || '').toLowerCase()
    if (src.includes('reminder')) {
      source = 'Reminders'
      kind = 'reminder'
      type = 'Reminder'
    } else if (src.includes('deadline')) {
      source = 'Deadlines'
      kind = 'task'
      type = 'Deadline'
    } else if (src.includes('mail') || src.includes('waiting') || src.includes('draft')) {
      source = 'Mail'
      kind = 'followup'
      type = 'Follow-up'
    } else if (src.includes('note')) {
      source = 'Notes'
      kind = 'task'
      type = 'Task'
    }

    return {
      id: item.id || `snooze-${idx}`,
      title: item.title || `Item ${item.id}`,
      context,
      time,
      kind,
      type,
      source,
      priority: item.priority || 'Normal',
      period,
      returnState,
      untilDate: dateObj,
    }
  })

  // Sort ascending by return time
  items.sort((a, b) => a.untilDate.getTime() - b.untilDate.getTime())

  return {
    ...fixture,
    status: 'ready',
    sizeChoice,
    scale: sizeChoice,
    layoutChoice,
    appearance: theme,
    items,
  }
}

export default function SnoozedItems({ data, size = 'm', full = false }) {
  const [layoutChoice, setLayoutChoice] = useState(() => {
    try {
      return localStorage.getItem('amethyst:snoozed-layout') || 'minimal'
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
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-mode'],
    })
    return () => observer.disconnect()
  }, [])

  function handleLayoutSelect(newLayout) {
    setLayoutChoice(newLayout)
    try {
      localStorage.setItem('amethyst:snoozed-layout', newLayout)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptSnoozed(data, effectiveSize, layoutChoice, theme),
    [data, effectiveSize, layoutChoice, theme]
  )

  return (
    <div className="need-snoozed-root">
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
              Composition layout
            </span>
            <div className="snoozed-directions-row">
              {LAYOUTS.map(lay => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={lay.value}
                  type="button"
                  className={`snoozed-direction-btn ${layoutChoice === lay.value ? 'is-active' : ''}`}
                  onClick={() => handleLayoutSelect(lay.value)}
                >
                  {lay.label} ({lay.study})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
