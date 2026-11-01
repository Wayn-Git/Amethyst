import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/need.decisions/template.txt?raw'
import fixture from '../../../../widgets/need.decisions/data.fixture.json'
import './decisions/decisions.css'

const DIRECTIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'inbox', label: 'Inbox', study: '02' },
  { value: 'comparison', label: 'Comparison', study: '03' },
  { value: 'priority', label: 'Priority', study: '04' },
  { value: 'editorial', label: 'Editorial', study: '05' },
]

function adaptDecisions(data, size, direction = 'minimal', theme = 'light') {
  const items = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      sizeMode: size === 'l' ? 'large' : 'medium',
      direction,
      appearance: theme,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Decisions unavailable',
      sizeMode: size === 'l' ? 'large' : 'medium',
      direction,
      appearance: theme,
    }
  }

  if (items.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      decisions: [],
      sizeMode: size === 'l' ? 'large' : 'medium',
      direction,
      appearance: theme,
    }
  }

  const decisions = items.map((ask) => {
    const q = ask.questions?.[0] || {
      question: ask.title || 'Decision waiting',
      options: [
        { label: 'Approve', value: 'approve' },
        { label: 'Dismiss', value: 'dismiss' },
      ],
    }
    const options = (q.options || []).map((opt) => ({
      value: opt.value || opt.label || 'option',
      label: opt.label || opt.value || 'Option',
      impact: opt.impact || opt.description || '',
      description: opt.description || '',
    }))
    return {
      id: String(ask.id),
      question: q.question || ask.title || 'Decision required',
      context: q.context || (ask.conversation_id ? `Conversation #${ask.conversation_id}` : ''),
      category: q.category || 'Agent decision',
      agent: ask.agent || 'Director agent',
      agentIcon: 'brain',
      wait: 'Pending',
      deadline: 'Waiting for your answer',
      priority: 'Time-sensitive',
      urgent: false,
      options,
    }
  })

  const outcomes = {}
  for (const d of decisions) {
    outcomes[d.id] = 'waiting'
  }

  return {
    ...fixture,
    status: 'ready',
    decisions,
    outcomes,
    sizeMode: size === 'l' ? 'large' : 'medium',
    direction,
    appearance: theme,
  }
}

export default function DecisionsWaiting({
  data,
  refresh,
  size = 'm',
  full = false,
}) {
  const [direction, setDirection] = useState(() => {
    try {
      return localStorage.getItem('amethyst:decisions-direction') || 'minimal'
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
      localStorage.setItem('amethyst:decisions-direction', newDirection)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptDecisions(data, effectiveSize, direction, theme),
    [data, effectiveSize, direction, theme]
  )

  async function handleAction(action) {
    if (!action) return
    const update = action.updateState || action.patchState
    if (update?.outcomes) {
      for (const [id, outcome] of Object.entries(update.outcomes)) {
        if (outcome === 'answered' || outcome === 'dismissed') {
          const actionName = outcome === 'answered' ? 'answer' : 'dismiss'
          try {
            await request(`/widgets/need.decisions/actions/${actionName}`, 'POST', {
              id,
              answer: update.selections?.[id] || '',
            })
            await refresh?.()
          } catch (err) {
            console.error(`Failed to ${actionName} decision:`, err)
          }
        }
      }
    }
  }

  return (
    <div className="need-decisions-root">
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
            <div className="decisions-directions-row">
              {DIRECTIONS.map(dir => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={dir.value}
                  type="button"
                  className={`decisions-direction-btn ${direction === dir.value ? 'is-active' : ''}`}
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
