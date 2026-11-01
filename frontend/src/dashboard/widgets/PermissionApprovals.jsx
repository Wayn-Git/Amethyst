import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import template from '../../../../widgets/need.approvals/template.txt?raw'
import fixture from '../../../../widgets/need.approvals/data.fixture.json'
import './approvals/approvals.css'

const DIRECTIONS = [
  { value: 'minimal', label: 'Minimal', study: '01' },
  { value: 'review', label: 'Review-focused', study: '02' },
  { value: 'inbox', label: 'Inbox-style', study: '03' },
  { value: 'security', label: 'Security-focused', study: '04' },
  { value: 'editorial', label: 'Editorial', study: '05' },
]

function getInitials(str) {
  if (!str) return 'AG'
  const clean = str.replace(/^[@#]/, '').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase() || 'AG'
}

function mapToolIcon(name) {
  const n = String(name || '').toLowerCase()
  if (n.includes('github') || n.includes('git') || n.includes('code') || n.includes('bash') || n.includes('command')) {
    return 'square-code'
  }
  if (n.includes('mail') || n.includes('message') || n.includes('send')) {
    return 'mail'
  }
  if (n.includes('file') || n.includes('write') || n.includes('doc')) {
    return 'document'
  }
  if (n.includes('lock') || n.includes('vault') || n.includes('secret')) {
    return 'lock'
  }
  return 'shield-check'
}

function formatPrompt(item, localDecision) {
  const tool = item.title || item.tool_name || 'Tool'
  const icon = mapToolIcon(tool)
  const agent = item.agent || (item.conversation_id ? `Agent #${String(item.conversation_id).slice(0, 6)}` : 'Agent')
  const initials = getInitials(agent)
  const detail = String(item.detail || '')

  let risk = 'low'
  if (detail.toLowerCase().includes('high') || detail.toLowerCase().includes('critical')) {
    risk = 'high'
  } else if (detail.toLowerCase().includes('medium') || detail.toLowerCase().includes('moderat')) {
    risk = 'moderate'
  }

  const riskLabel = risk === 'high' ? 'High risk' : risk === 'moderate' ? 'Moderate risk' : 'Low risk'
  const riskTone = risk === 'high' ? 'danger' : risk === 'moderate' ? 'warning' : 'secondary'
  const riskTextTone = riskTone
  const urgent = risk === 'high'

  let scope = 'Workspace access'
  let description = detail || 'Requested gated tool operation'
  if (item.arguments) {
    try {
      const parsed = typeof item.arguments === 'string' ? JSON.parse(item.arguments) : item.arguments
      if (parsed.path) {
        scope = String(parsed.path)
      } else if (parsed.command) {
        scope = String(parsed.command).slice(0, 40)
      } else if (parsed.url) {
        scope = String(parsed.url)
      }
      description = JSON.stringify(parsed).slice(0, 80)
    } catch {
      // arguments were not raw json
    }
  }

  return {
    id: String(item.id),
    tool,
    icon,
    agent,
    initials,
    action: `Run ${tool}`,
    description,
    scope,
    permission: risk === 'high' ? 'Gated execution' : 'Standard permission',
    accessTitle: `${tool} execution`,
    accessNote: detail || 'Requires explicit confirmation',
    riskLabel,
    riskTone,
    riskTextTone,
    timestamp: 'Just now',
    urgent,
    urgentNote: urgent ? 'Requires urgent review' : '',
    editorial: `Let ${agent} execute ${tool}.`,
    decision: localDecision || 'pending',
    boundaries: [
      { icon: 'check', text: `Execute ${tool} with provided arguments.` },
      { icon: 'lock', text: 'Action strictly limited to declared scope.' },
    ],
  }
}

function adaptApprovals(data, size, direction = 'minimal', decisions = {}, theme = 'light') {
  const rawItems = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const widgetSize = size === 'l' ? 'large' : 'medium'
  const darkAppearance = theme === 'dark'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      widgetSize,
      direction,
      darkAppearance,
      requests: [],
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Approvals unavailable',
      widgetSize,
      direction,
      darkAppearance,
      requests: [],
    }
  }

  if (rawItems.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      widgetSize,
      direction,
      darkAppearance,
      requests: [],
      pendingCount: 0,
    }
  }

  const requests = rawItems.map(item => formatPrompt(item, decisions[String(item.id)]))
  const pendingCount = requests.filter(r => r.decision === 'pending').length

  return {
    ...fixture,
    status: 'ready',
    widgetSize,
    direction,
    darkAppearance,
    requests,
    pendingCount,
  }
}

export default function PermissionApprovals({
  data,
  refresh,
  size = 'm',
  full = false,
}) {
  const [direction, setDirection] = useState(() => {
    try {
      return localStorage.getItem('amethyst:approvals-direction') || 'minimal'
    } catch {
      return 'minimal'
    }
  })

  const [decisions, setDecisions] = useState({})

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
      localStorage.setItem('amethyst:approvals-direction', newDirection)
    } catch {
      // Local storage unavailable
    }
  }

  async function handleAction(action) {
    if (!action) return
    const id = action.id
    const act = action.action
    if (!id || !act) return

    if (act === 'undo') {
      setDecisions(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }

    setDecisions(prev => ({ ...prev, [id]: act }))
    try {
      await request(`/widgets/need.approvals/actions/${act}`, 'POST', { id })
      await refresh?.()
    } catch (err) {
      console.error(`Failed to ${act} approval:`, err)
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptApprovals(data, effectiveSize, direction, decisions, theme),
    [data, effectiveSize, direction, decisions, theme]
  )

  return (
    <div className="need-approvals-root">
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
            <div className="approvals-directions-row">
              {DIRECTIONS.map(dir => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={dir.value}
                  type="button"
                  className={`approvals-direction-btn ${direction === dir.value ? 'is-active' : ''}`}
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
