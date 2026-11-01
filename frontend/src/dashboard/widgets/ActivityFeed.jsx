import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/agent.feed/template.txt?raw'
import fixture from '../../../../widgets/agent.feed/data.fixture.json'
import './activity/activity.css'

const DIRECTIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'timeline', label: 'Timeline', study: '02' },
  { value: 'grouped', label: 'Grouped', study: '03' },
  { value: 'feed', label: 'Feed-focused', study: '04' },
  { value: 'editorial', label: 'Editorial', study: '05' },
]

function mapKindAndIcon(title, detail) {
  const combined = `${title} ${detail}`.toLowerCase()
  if (combined.includes('approve') || combined.includes('decision') || combined.includes('confirm')) {
    return { kind: 'approval', icon: 'check-circle' }
  }
  if (combined.includes('upload') || combined.includes('file') || combined.includes('write')) {
    return { kind: 'upload', icon: 'upload' }
  }
  if (combined.includes('comment') || combined.includes('ask') || combined.includes('question')) {
    return { kind: 'comment', icon: 'message' }
  }
  if (combined.includes('meet') || combined.includes('calendar') || combined.includes('event')) {
    return { kind: 'meeting', icon: 'calendar' }
  }
  if (combined.includes('doc') || combined.includes('note') || combined.includes('read')) {
    return { kind: 'document', icon: 'document' }
  }
  return { kind: 'milestone', icon: 'check-circle' }
}

function adaptActivity(data, size, direction = 'minimal', theme = 'light') {
  const rawItems = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const sizeChoice = size === 's' ? 'small' : size === 'l' ? 'large' : 'medium'
  const darkAppearance = theme === 'dark'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      sizeChoice,
      direction,
      darkAppearance,
      events: [],
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Activity feed unavailable',
      sizeChoice,
      direction,
      darkAppearance,
      events: [],
    }
  }

  if (rawItems.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      sizeChoice,
      direction,
      darkAppearance,
      events: [],
    }
  }

  const events = rawItems.map((item, idx) => {
    const title = item.title || 'Agent activity recorded'
    const detail = item.detail || 'Executed tool turn'
    const { kind, icon } = mapKindAndIcon(title, detail)
    const actor = item.conversation_id
      ? `Agent #${String(item.conversation_id).slice(0, 6)}`
      : 'Amethyst Agent'

    const time = idx === 0 ? 'Just now' : `${(idx + 1) * 8}m ago`
    const clock = '10:42 AM'
    const day = idx < 2 ? 'today' : idx < 4 ? 'yesterday' : 'earlier'

    return {
      id: String(item.id || `event-${idx}`),
      kind,
      icon,
      title,
      description: detail,
      actor,
      meta: detail,
      time,
      clock,
      day,
      important: idx === 0,
    }
  })

  const heroTitle = events[0]?.title || fixture.heroTitle

  return {
    ...fixture,
    status: 'ready',
    sizeChoice,
    direction,
    darkAppearance,
    events,
    heroTitle,
  }
}

export default function ActivityFeed({
  data,
  size = 'm',
  full = false,
}) {
  const [direction, setDirection] = useState(() => {
    try {
      return localStorage.getItem('amethyst:activity-direction') || 'minimal'
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

  function handleDirectionSelect(newDirection) {
    setDirection(newDirection)
    try {
      localStorage.setItem('amethyst:activity-direction', newDirection)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptActivity(data, effectiveSize, direction, theme),
    [data, effectiveSize, direction, theme]
  )

  return (
    <div className="agent-feed-root">
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
            <div className="activity-directions-row">
              {DIRECTIONS.map(dir => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={dir.value}
                  type="button"
                  className={`activity-direction-btn ${direction === dir.value ? 'is-active' : ''}`}
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
