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
  if (!str) return { name: 'Recipient', email: 'recipient@example.com' }
  const match = str.match(/^"?([^"<]+)"?\s*<([^>]+)>/)
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() }
  }
  if (str.includes('@')) {
    const namePart = str.split('@')[0].replace(/[._-]/g, ' ')
    const capitalized = namePart.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ')
    return { name: capitalized || str, email: str }
  }
  return { name: str, email: str }
}

function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Recently'
  try {
    const d = new Date(dateStr)
    const diffMs = Date.now() - d.getTime()
    const diffMin = Math.round(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `Edited ${diffMin} min ago`
    const diffHours = Math.round(diffMin / 60)
    if (diffHours < 24) return `Edited ${diffHours} hr ago`
    const diffDays = Math.round(diffHours / 24)
    return `Edited ${diffDays}d ago`
  } catch {
    return 'Recently'
  }
}

function adaptDrafts(data, size, composition = 'minimal', theme = 'light') {
  const items = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const footprint = size === 'l' ? 'large' : 'medium'
  const darkMode = theme === 'dark'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      footprint,
      composition,
      darkMode,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Drafts unavailable',
      footprint,
      composition,
      darkMode,
    }
  }

  if (items.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      drafts: [],
      footprint,
      composition,
      darkMode,
    }
  }

  const drafts = items.map((item) => {
    const recipient = parseRecipient(item.recipient)
    const status = item.status === 'approved' ? 'approved' : item.status === 'saved' ? 'saved' : 'awaiting'
    const editedAt = item.updated_at ? new Date(item.updated_at).getTime() : Date.now()
    return {
      id: String(item.id),
      recipient,
      subject: item.subject || 'Untitled draft',
      body: item.snippet || item.text || '',
      preview: item.snippet || item.text || '',
      status,
      edited: formatRelativeTime(item.updated_at),
      editedAt,
      removed: false,
    }
  })

  return {
    ...fixture,
    status: 'ready',
    drafts,
    selectedId: drafts[0]?.id || '',
    editingId: '',
    editSubject: '',
    editBody: '',
    lastRemoved: '',
    footprint,
    composition,
    darkMode,
  }
}

export default function MailDrafts({
  data,
  refresh,
  size = 'm',
  full = false,
}) {
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
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
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
    const update = action.updateState || action.patchState

    // Handle approving a draft
    if (Array.isArray(action.patchState)) {
      for (const op of action.patchState) {
        if (op?.path?.includes('.status') && op?.value === 'approved') {
          const match = op.path.match(/drafts\.(\d+)\.status/)
          if (match) {
            const idx = Number(match[1])
            const draft = widgetData.drafts[idx]
            if (draft) {
              try {
                const gate = await request('/widgets/need.drafts/actions/approve', 'POST', { id: Number(draft.id) })
                if (gate?.draft_id) {
                  await request(`/widgets/need.drafts/drafts/${gate.draft_id}`, 'POST', { approved: true })
                  window.dispatchEvent(new Event('dashboard-items-changed'))
                  await refresh?.()
                }
              } catch (err) {
                console.error('Failed to approve draft:', err)
              }
            }
          }
        }
        if (op?.path?.includes('.removed') && op?.value === true) {
          const match = op.path.match(/drafts\.(\d+)\.removed/)
          if (match) {
            const idx = Number(match[1])
            const draft = widgetData.drafts[idx]
            if (draft) {
              try {
                const gate = await request('/widgets/need.drafts/actions/remove', 'POST', { id: Number(draft.id) })
                if (gate?.draft_id) {
                  await request(`/widgets/need.drafts/drafts/${gate.draft_id}`, 'POST', { approved: true })
                  window.dispatchEvent(new Event('dashboard-items-changed'))
                  await refresh?.()
                }
              } catch (err) {
                console.error('Failed to remove draft:', err)
              }
            }
          }
        }
        if (op?.path?.includes('.subject') || op?.path?.includes('.body')) {
          const match = op.path.match(/drafts\.(\d+)\.(subject|body)/)
          if (match) {
            const idx = Number(match[1])
            const draft = widgetData.drafts[idx]
            if (draft) {
              // Wait for full patch before dispatching edit
              const subjectOp = action.patchState.find(p => p.path?.includes('.subject'))
              const bodyOp = action.patchState.find(p => p.path?.includes('.body'))
              if (subjectOp && bodyOp) {
                try {
                  const gate = await request('/widgets/need.drafts/actions/edit', 'POST', {
                    id: Number(draft.id),
                    recipient: draft.recipient?.email,
                    subject: subjectOp.value,
                    text: bodyOp.value,
                  })
                  if (gate?.draft_id) {
                    await request(`/widgets/need.drafts/drafts/${gate.draft_id}`, 'POST', { approved: true })
                    window.dispatchEvent(new Event('dashboard-items-changed'))
                    await refresh?.()
                  }
                } catch (err) {
                  console.error('Failed to save edited draft:', err)
                }
              }
            }
          }
        }
      }
    } else if (update?.editingId !== undefined) {
      // Handled via local state in template
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
                  {comp.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
