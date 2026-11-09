import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/need.waiting/template.txt?raw'
import fixture from '../../../../widgets/need.waiting/data.fixture.json'
import './waiting/waiting.css'

const LAYOUTS = [
  { value: 'minimal', label: 'Minimal spotlight', study: '01' },
  { value: 'inbox', label: 'Inbox table', study: '02' },
  { value: 'timeline', label: 'Sent timeline', study: '03' },
  { value: 'followup', label: 'Follow-up queue', study: '04' },
  { value: 'grouped', label: 'Grouped by source', study: '05' },
]

function parseContact(str) {
  if (!str) return { name: 'Unknown', firstName: 'there', initials: 'U' }
  const match = str.match(/^"?([^"<]+)"?\s*<([^>]+)>/)
  let name = ''
  if (match) {
    name = match[1].trim()
  } else if (str.includes('@')) {
    name = str.split('@')[0]
  } else {
    name = str.trim()
  }
  const parts = name.split(/\s+/).filter(Boolean)
  const firstName = parts[0] || 'there'
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (parts[0]?.slice(0, 2) || 'U').toUpperCase()
  return { name, firstName, initials }
}

function adaptWaiting(data, size, layout = 'minimal', theme = 'light') {
  const items = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const sizeChoice = size === 'l' ? 'large' : 'medium'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      scale: sizeChoice,
      sizeChoice,
      layout,
      appearance: theme,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Could not load waiting items',
      scale: sizeChoice,
      sizeChoice,
      layout,
      appearance: theme,
    }
  }

  if (items.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      messages: [],
      scale: sizeChoice,
      sizeChoice,
      layout,
      appearance: theme,
    }
  }

  const now = new Date()
  const thresholdDays = Number(data?.days || 3)

  const messages = items.map((item, idx) => {
    const rawDate = item.date || item.sent_at
    const dateObj = rawDate ? new Date(rawDate) : now
    const diffMs = Math.max(0, now.getTime() - dateObj.getTime())
    const diffDays = Math.floor(diffMs / 86400000)
    const diffHours = Math.floor((diffMs % 86400000) / 3600000)
    const diffMins = Math.floor((diffMs % 3600000) / 60000)

    let wait = '0m'
    if (diffDays > 0) {
      wait = diffHours > 0 ? `${diffDays}d ${diffHours}h` : `${diffDays}d`
    } else if (diffHours > 0) {
      wait = diffMins > 0 ? `${diffHours}h ${diffMins}m` : `${diffHours}h`
    } else {
      wait = `${Math.max(1, diffMins)}m`
    }

    const due = diffDays >= thresholdDays
    const recent = diffDays === 0
    const status = due ? 'Overdue' : recent ? 'Recent' : 'Waiting'

    const sentDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const sentDate = dateObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    const sentTime = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const sentAt = `${sentDay} · ${sentTime}`

    const contactStr = item.recipient || item.from || item.to || 'Contact'
    const { name, firstName, initials } = parseContact(contactStr)

    const rawSource = String(item.source || 'Email').toLowerCase()
    let sourceId = 'email'
    let sourceLabel = 'Email'
    if (rawSource.includes('slack')) {
      sourceId = 'slack'
      sourceLabel = 'Slack'
    } else if (rawSource.includes('message') || rawSource.includes('mobile')) {
      sourceId = 'messages'
      sourceLabel = 'Messages'
    } else if (rawSource.includes('manual')) {
      sourceId = 'email'
      sourceLabel = 'Manual'
    }

    return {
      id: item.id || `item-${idx}`,
      manual_id: item.manual_id,
      name,
      firstName,
      initials,
      subject: item.subject || item.title || 'No subject',
      preview: item.snippet || item.preview || '',
      sourceId,
      source: sourceLabel,
      sentDay,
      sentDate,
      sentTime,
      sentAt,
      wait,
      due,
      recent,
      status,
      diffMs,
    }
  })

  // Sort by wait descending (longest waiting first)
  messages.sort((a, b) => b.diffMs - a.diffMs)

  return {
    ...fixture,
    status: 'ready',
    scale: sizeChoice,
    sizeChoice,
    layout,
    appearance: theme,
    messages,
    snapshot: `${messages.length} pending ${messages.length === 1 ? 'reply' : 'replies'} · ${
      messages.filter(m => m.due).length
    } overdue`,
  }
}

export default function WaitingReplies({ data, size = 'm', full = false, refresh }) {
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem('amethyst:waiting-layout') || 'minimal'
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
    setLayout(newLayout)
    try {
      localStorage.setItem('amethyst:waiting-layout', newLayout)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptWaiting(data, effectiveSize, layout, theme),
    [data, effectiveSize, layout, theme]
  )

  async function handleAction(action) {
    if (!action) return

    // Clipboard copy action
    if (action.type === 'copy' && action.payload?.value) {
      try {
        await navigator.clipboard.writeText(action.payload.value)
      } catch (err) {
        console.error('Clipboard copy failed:', err)
      }
      return
    }

    // Direct follow-up nudge draft creation
    if (action.type === 'nudge' && action.payload) {
      try {
        await request('/widgets/need.waiting/actions/nudge', 'POST', action.payload)
        await refresh?.()
      } catch (err) {
        console.error('Failed to create nudge draft:', err)
      }
      return
    }

    // Direct mark-complete action for manual items
    if (action.type === 'complete' && action.payload?.id) {
      try {
        await request('/widgets/need.waiting/actions/complete', 'POST', {
          id: action.payload.id,
        })
        await refresh?.()
      } catch (err) {
        console.error('Failed to complete waiting item:', err)
      }
      return
    }
  }

  return (
    <div className="need-waiting-root">
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
              Composition layout
            </span>
            <div className="waiting-directions-row">
              {LAYOUTS.map(lay => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={lay.value}
                  type="button"
                  className={`waiting-direction-btn ${layout === lay.value ? 'is-active' : ''}`}
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
