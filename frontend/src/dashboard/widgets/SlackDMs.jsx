import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/need.lor-slack/template.txt?raw'
import fixture from '../../../../widgets/need.lor-slack/data.fixture.json'
import './slack/slack.css'

const DIRECTIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'conversation', label: 'Conversation', study: '02' },
  { value: 'inbox', label: 'Inbox', study: '03' },
  { value: 'timeline', label: 'Timeline', study: '04' },
  { value: 'priority', label: 'Priority', study: '05' },
]

function formatTime(ts) {
  if (!ts) return ''
  try {
    const d = new Date(parseFloat(ts) * 1000)
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)
  } catch {
    return ''
  }
}

function formatWait(ts) {
  if (!ts) return { waitLabel: 'Awaiting reply', waitShort: 'Pending' }
  try {
    const diffMs = Date.now() - parseFloat(ts) * 1000
    const diffMinutes = Math.max(1, Math.round(diffMs / 60000))
    if (diffMinutes < 60) {
      return { waitLabel: `Waiting ${diffMinutes}m`, waitShort: `${diffMinutes}m` }
    }
    const diffHours = Math.floor(diffMinutes / 60)
    const remainingMins = diffMinutes % 60
    if (diffHours < 24) {
      return {
        waitLabel: remainingMins > 0 ? `Waiting ${diffHours}h ${remainingMins}m` : `Waiting ${diffHours}h`,
        waitShort: `${diffHours}h`,
      }
    }
    const diffDays = Math.floor(diffHours / 24)
    return { waitLabel: `Waiting ${diffDays}d`, waitShort: `${diffDays}d` }
  } catch {
    return { waitLabel: 'Awaiting reply', waitShort: 'Pending' }
  }
}

function formatPersonName(person) {
  if (!person) return 'Colleague'
  // Clean up user id / handle
  if (person.startsWith('U') && person.length >= 8) {
    return `User ${person.slice(-4)}`
  }
  return person
}

function adaptSlackDMs(data, size, direction = 'minimal', theme = 'light') {
  const items = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const layoutSize = size === 'l' ? 'large' : 'medium'
  const darkMode = theme === 'dark'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      layoutSize,
      direction,
      darkMode,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Slack DMs unavailable',
      layoutSize,
      direction,
      darkMode,
    }
  }

  if (items.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      messages: [],
      layoutSize,
      direction,
      darkMode,
    }
  }

  // Find oldest
  let oldestTs = Infinity
  for (const item of items) {
    const t = parseFloat(item.ts || item.id)
    if (!Number.isNaN(t) && t < oldestTs) {
      oldestTs = t
    }
  }

  const messages = items.map((item, idx) => {
    const rawTs = item.ts || item.id
    const t = parseFloat(rawTs)
    const isOldest = !Number.isNaN(t) && t === oldestTs
    const { waitLabel, waitShort } = formatWait(rawTs)
    const name = formatPersonName(item.person || item.user)
    return {
      id: String(item.id || idx),
      name,
      photo: idx % (fixture.availableImages?.length || 1),
      preview: item.title || item.text || 'Message waiting for reply',
      time: formatTime(rawTs),
      shortTime: formatTime(rawTs),
      periodLabel: '',
      waitLabel,
      waitShort,
      unread: true,
      oldest: isOldest,
      context: item.url || '',
    }
  })

  // Sort with oldest waiting first for priority
  messages.sort((a, b) => (b.oldest ? 1 : 0) - (a.oldest ? 1 : 0))

  return {
    ...fixture,
    status: 'ready',
    messages,
    layoutSize,
    direction,
    darkMode,
  }
}

export default function SlackDMs({
  data,
  size = 'm',
  full = false,
}) {
  const [direction, setDirection] = useState(() => {
    try {
      return localStorage.getItem('amethyst:slack-direction') || 'minimal'
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
      localStorage.setItem('amethyst:slack-direction', newDirection)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptSlackDMs(data, effectiveSize, direction, theme),
    [data, effectiveSize, direction, theme]
  )

  return (
    <div className="need-slack-root">
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
            <div className="slack-directions-row">
              {DIRECTIONS.map(dir => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={dir.value}
                  type="button"
                  className={`slack-direction-btn ${direction === dir.value ? 'is-active' : ''}`}
                  onClick={() => handleDirectionSelect(dir.value)}
                >
                  {dir.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
