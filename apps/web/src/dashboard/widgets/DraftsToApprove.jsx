import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/need.drafts/template.txt?raw'
import fixture from '../../../../widgets/need.drafts/data.fixture.json'
import './drafts/drafts.css'

const COMPOSITIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'inbox', label: 'Inbox', study: '02' },
  { value: 'editorial', label: 'Editorial', study: '03' },
  { value: 'review', label: 'Review', study: '04' },
]

function parseRecipient(str) {
  if (!str) return { name: 'Recipient', email: '', initials: 'R' }
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
      : (parts[0]?.slice(0, 2) || 'R').toUpperCase()
  return { name, email, initials }
}

function timeAgo(dateString) {
  if (!dateString) return 'Saved'
  try {
    const diffMs = Math.max(0, Date.now() - new Date(dateString).getTime())
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Edited just now'
    if (diffMins < 60) return `Edited ${diffMins} min ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `Edited ${diffHours} hr ago`
    const diffDays = Math.floor(diffHours / 24)
    return `Edited ${diffDays}d ago`
  } catch {
    return 'Saved'
  }
}

function adaptDrafts(data, size, composition = 'minimal', theme = 'light') {
  const rawItems = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const footprint = size === 'l' ? 'large' : 'medium'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      footprint,
      scale: footprint,
      composition,
      appearance: theme,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Could not load mail drafts',
      footprint,
      scale: footprint,
      composition,
      appearance: theme,
    }
  }

  if (rawItems.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      drafts: [],
      footprint,
      scale: footprint,
      composition,
      appearance: theme,
    }
  }

  const drafts = rawItems.map((item, idx) => {
    const recipient = parseRecipient(item.recipient)
    const body = item.snippet || item.text || ''
    const lines = body.split('\n').filter(l => l.trim().length > 0)
    const preview = lines[1] || lines[0] || body || 'Draft body ready for review.'
    const status = item.status === 'approved' ? 'approved' : 'awaiting'
    const edited = timeAgo(item.updated_at)
    const editedAt = item.updated_at ? new Date(item.updated_at).getTime() : Date.now()

    return {
      id: item.id || `draft-${idx}`,
      recipient,
      subject: item.subject || 'No subject',
      body,
      preview,
      status,
      edited,
      editedAt,
      removed: false,
    }
  })

  return {
    ...fixture,
    status: 'ready',
    footprint,
    scale: footprint,
    composition,
    appearance: theme,
    drafts,
  }
}

export default function DraftsToApprove({ data, size = 'm', full = false, refresh }) {
  const [composition, setComposition] = useState(() => {
    try {
      return localStorage.getItem('amethyst:drafts-composition') || 'minimal'
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

  function handleCompositionSelect(newComp) {
    setComposition(newComp)
    try {
      localStorage.setItem('amethyst:drafts-composition', newComp)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptDrafts(data, effectiveSize, composition, theme),
    [data, effectiveSize, composition, theme]
  )

  async function handleAction(action) {
    if (!action) return

    if (action.type === 'approve' && action.payload?.id) {
      try {
        const gate = await request('/widgets/need.drafts/actions/approve', 'POST', {
          id: action.payload.id,
        })
        if (gate?.draft_id) {
          await request(`/widgets/need.drafts/drafts/${gate.draft_id}`, 'POST', {
            approved: true,
          })
          window.dispatchEvent(new Event('dashboard-items-changed'))
          await refresh?.()
        }
      } catch (err) {
        console.error('Failed to approve draft:', err)
      }
    }
  }

  return (
    <div className="need-drafts-root">
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
            <div className="drafts-directions-row">
              {COMPOSITIONS.map(comp => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={comp.value}
                  type="button"
                  className={`drafts-direction-btn ${composition === comp.value ? 'is-active' : ''}`}
                  onClick={() => handleCompositionSelect(comp.value)}
                >
                  {comp.label} ({comp.study})
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
