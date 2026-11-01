import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/need.inbox/template.txt?raw'
import fixture from '../../../../widgets/need.inbox/data.fixture.json'
import './inbox/inbox.css'

const MEDIUM_STYLES = [
  { value: 'minimal', label: 'Minimal spotlight', study: '01' },
  { value: 'inbox', label: 'Inbox stack', study: '02' },
  { value: 'mediumEditorial', label: 'Editorial lead', study: '03' },
]

const LARGE_STYLES = [
  { value: 'grouped', label: 'Grouped triage', study: '01' },
  { value: 'priority', label: 'Ranked priorities', study: '02' },
  { value: 'largeEditorial', label: 'Editorial digest', study: '03' },
]

function parseSender(str) {
  if (!str) return { sender: 'Unknown sender', email: '', initials: 'U' }
  const match = str.match(/^"?([^"<]+)"?\s*<([^>]+)>/)
  let name = ''
  let email = ''
  if (match) {
    name = match[1].trim()
    email = match[2].trim()
  } else if (str.includes('@')) {
    email = str.trim()
    name = str.split('@')[0]
  } else {
    name = str.trim()
  }
  const parts = name.split(/\s+/).filter(Boolean)
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.slice(0, 2) || 'U').toUpperCase()
  return { sender: name, email, initials }
}

function formatMailTime(dateString) {
  if (!dateString) return 'Today'
  try {
    const d = new Date(dateString)
    const now = new Date()
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    if (isToday) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    }
    const isYesterday =
      d.getDate() === now.getDate() - 1 &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    if (isYesterday) return 'Yesterday'
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return 'Today'
  }
}

function adaptInbox(data, size, mediumStyle, largeStyle, selectedId, theme = 'light') {
  const rawItems = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const density = size === 'l' ? 'large' : 'medium'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      density,
      scale: density,
      mediumStyle,
      largeStyle,
      selectedId,
      appearance: theme,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Could not load priority inbox',
      density,
      scale: density,
      mediumStyle,
      largeStyle,
      selectedId,
      appearance: theme,
    }
  }

  if (rawItems.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      messages: [],
      density,
      scale: density,
      mediumStyle,
      largeStyle,
      selectedId: '',
      appearance: theme,
    }
  }

  const messages = rawItems.map((item, idx) => {
    const { sender, email, initials } = parseSender(item.from)
    const time = formatMailTime(item.date)
    const snippet = item.snippet || ''
    const preview = item.reason ? `Priority reason: ${item.reason}` : snippet

    return {
      id: item.id || `mail-${idx}`,
      sender,
      initials,
      email,
      subject: item.subject || 'No subject',
      preview: preview.slice(0, 200),
      body: snippet,
      time,
      unread: Boolean(item.unread),
      needsReply: Boolean(item.reason || item.unread),
      priority: item.reason ? 'urgent' : item.unread ? 'important' : 'other',
    }
  })

  return {
    ...fixture,
    status: 'ready',
    density,
    scale: density,
    mediumStyle,
    largeStyle,
    selectedId,
    appearance: theme,
    messages,
  }
}

export default function PriorityInbox({ data, size = 'm', full = false, refresh, widgetId = 'need.inbox' }) {
  const [mediumStyle, setMediumStyle] = useState(() => {
    try {
      return localStorage.getItem('amethyst:inbox-medium-style') || 'minimal'
    } catch {
      return 'minimal'
    }
  })

  const [largeStyle, setLargeStyle] = useState(() => {
    try {
      return localStorage.getItem('amethyst:inbox-large-style') || 'grouped'
    } catch {
      return 'grouped'
    }
  })

  const [selectedId, setSelectedId] = useState('')

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

  function handleMediumSelect(newStyle) {
    setMediumStyle(newStyle)
    setSelectedId('')
    try {
      localStorage.setItem('amethyst:inbox-medium-style', newStyle)
    } catch {
      // Local storage unavailable
    }
  }

  function handleLargeSelect(newStyle) {
    setLargeStyle(newStyle)
    setSelectedId('')
    try {
      localStorage.setItem('amethyst:inbox-large-style', newStyle)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptInbox(data, effectiveSize, mediumStyle, largeStyle, selectedId, theme),
    [data, effectiveSize, mediumStyle, largeStyle, selectedId, theme]
  )

  function handleAction(action) {
    if (!action) return
    if (action.updateState?.selectedId !== undefined) {
      setSelectedId(action.updateState.selectedId)
    }
  }

  async function toggleModelRanking() {
    try {
      await request(`/widgets/${widgetId}/settings`, 'PUT', {
        model_enabled: !data?.model_enabled,
      })
      await refresh?.()
    } catch (err) {
      console.error('Failed to toggle model ranking:', err)
    }
  }

  return (
    <div className="need-inbox-root">
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
              Medium card style
            </span>
            <div className="inbox-directions-row">
              {MEDIUM_STYLES.map(style => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={style.value}
                  type="button"
                  className={`inbox-direction-btn ${mediumStyle === style.value ? 'is-active' : ''}`}
                  onClick={() => handleMediumSelect(style.value)}
                >
                  {style.label} ({style.study})
                </button>
              ))}
            </div>
          </div>
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
              Large card style
            </span>
            <div className="inbox-directions-row">
              {LARGE_STYLES.map(style => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={style.value}
                  type="button"
                  className={`inbox-direction-btn ${largeStyle === style.value ? 'is-active' : ''}`}
                  onClick={() => handleLargeSelect(style.value)}
                >
                  {style.label} ({style.study})
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: '12px' }}>
            {/* oxlint-disable-next-line amethyst-ui/no-raw-controls */}
            <button
              type="button"
              className={`inbox-direction-btn ${data?.model_enabled ? 'is-active' : ''}`}
              onClick={toggleModelRanking}
            >
              {data?.model_enabled ? '✓ Model priority ranking active' : 'Enable model priority ranking'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
