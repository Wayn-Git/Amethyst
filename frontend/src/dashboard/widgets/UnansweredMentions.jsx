import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/need.mentions/template.txt?raw'
import fixture from '../../../../widgets/need.mentions/data.fixture.json'
import './mentions/mentions.css'

const LAYOUTS = [
  { value: 'minimal', label: 'Minimal spotlight', study: '01' },
  { value: 'unified', label: 'Unified inbox', study: '02' },
  { value: 'grouped', label: 'Grouped by platform', study: '03' },
  { value: 'timeline', label: 'Timeline', study: '04' },
  { value: 'priority', label: 'Priority-focused', study: '05' },
]

function getInitials(name) {
  if (!name) return '?'
  const clean = name.replace(/^[@#]/, '').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase() || '?'
}

function formatRelativeTime(isoString) {
  if (!isoString) return { time: 'Now', ageHours: 0 }
  try {
    const then = new Date(isoString).getTime()
    const now = Date.now()
    const diffMs = Math.max(0, now - then)
    const ageHours = diffMs / (1000 * 60 * 60)
    if (diffMs < 60 * 1000) return { time: '1m', ageHours }
    if (diffMs < 60 * 60 * 1000) return { time: `${Math.round(diffMs / 60000)}m`, ageHours }
    if (ageHours < 24) return { time: `${Math.round(ageHours)}h`, ageHours }
    const days = Math.round(ageHours / 24)
    return { time: `${days}d`, ageHours }
  } catch {
    return { time: '1h', ageHours: 1 }
  }
}

function parseContextAndSender(item) {
  const isGithub = String(item.source || '').toLowerCase() === 'github'

  if (isGithub) {
    let repo = 'GitHub'
    if (item.url) {
      const match = item.url.match(/github\.com\/([^/]+\/[^/]+)/)
      if (match) repo = match[1]
    }
    const isPr = item.url?.includes('/pull/')
    const numMatch = item.url?.match(/\/(?:issues|pull)\/(\d+)/)
    const num = numMatch ? `#${numMatch[1]}` : ''
    const kind = isPr ? 'PR' : 'Issue'
    const context = `${repo} · ${kind} ${num}`.trim()
    const sender = item.sender || repo.split('/')[1] || 'GitHub'

    return {
      sender,
      context,
      preview: item.title || 'Mentioned in thread',
      platform: 'github',
      platformName: 'GitHub',
    }
  }

  // Slack
  let preview = item.title || 'Mentioned in conversation'
  // Clean raw user mention tags like <@U1234>
  preview = preview.replace(/<@[A-Z0-9]+>/g, '@user').trim()
  const sender = item.sender || 'Slack Team'
  const context = item.context || 'Slack · Conversation'

  return {
    sender,
    context,
    preview,
    platform: 'slack',
    platformName: 'Slack',
  }
}

function adaptMentions(data, size, layout = 'unified', theme = 'light') {
  const rawItems = Array.isArray(data?.items) ? data.items : []
  const isError = data?.state === 'error' || Boolean(data?.error)
  const isLoading = !data || data.state === 'loading'
  const sizeMode = size === 'l' ? 'large' : 'medium'

  if (isLoading) {
    return {
      ...fixture,
      status: 'loading',
      sizeMode,
      scale: sizeMode,
      layout,
      appearance: theme,
    }
  }

  if (isError) {
    return {
      ...fixture,
      status: 'error',
      message: data.error || 'Could not load mentions',
      sizeMode,
      scale: sizeMode,
      layout,
      appearance: theme,
    }
  }

  if (rawItems.length === 0) {
    return {
      ...fixture,
      status: 'empty',
      mentions: [],
      sizeMode,
      scale: sizeMode,
      layout,
      appearance: theme,
    }
  }

  const mentions = rawItems.map((item, idx) => {
    const { sender, context, preview, platform, platformName } = parseContextAndSender(item)
    const { time, ageHours } = formatRelativeTime(item.at)
    const initials = getInitials(sender)
    const unread = item.unread !== undefined ? Boolean(item.unread) : ageHours < 12

    return {
      id: String(item.id || `mention-${idx}`),
      platform,
      platformName,
      sender,
      initials,
      context,
      preview,
      time,
      ageHours,
      unread,
      url: item.url || '#',
    }
  })

  // Sort by ageHours ascending (newest first)
  mentions.sort((a, b) => a.ageHours - b.ageHours)

  return {
    ...fixture,
    status: 'ready',
    sizeMode,
    scale: sizeMode,
    layout,
    appearance: theme,
    mentions,
  }
}

export default function UnansweredMentions({ data, size = 'm', full = false }) {
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem('amethyst:mentions-layout') || 'unified'
    } catch {
      return 'unified'
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
      localStorage.setItem('amethyst:mentions-layout', newLayout)
    } catch {
      // Local storage unavailable
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptMentions(data, effectiveSize, layout, theme),
    [data, effectiveSize, layout, theme]
  )

  return (
    <div className="need-mentions-root">
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
            <div className="mentions-directions-row">
              {LAYOUTS.map(lay => (
                /* oxlint-disable-next-line amethyst-ui/no-raw-controls */
                <button
                  key={lay.value}
                  type="button"
                  className={`mentions-direction-btn ${layout === lay.value ? 'is-active' : ''}`}
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
