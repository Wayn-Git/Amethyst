export const SPANS = { s: 3, m: 6, l: 12 }
export function moveWidget(widgets, id, targetId) {
  const from = widgets.findIndex(w => w.id === id)
  const to = widgets.findIndex(w => w.id === targetId)
  if (from < 0 || to < 0 || from === to) return widgets
  const next = [...widgets]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
export function resizeWidget(item, sizes, dx, dy, width, rowHeight = 152) {
  const index = sizes.indexOf(item.size)
  const steps = Math.round((Math.abs(dx) >= Math.abs(dy) ? dx / Math.max(width / 4, 1) : dy / rowHeight))
  return { ...item, size: sizes[Math.max(0, Math.min(sizes.length - 1, index + steps))] || item.size }
}

// Only upgrade the untouched legacy default; custom layouts retain their order and sizes.
const LEGACY_MORNING = ['glance.clock', 'glance.weather', 'glance.next-event', 'glance.music', 'need.inbox', 'need.drafts', 'need.waiting', 'need.mentions', 'need.overdue', 'agent.brief', 'agent.feed', 'task.today', 'dev.prs', 'lib.resurface', 'feed.news']
export function morningLayout(layout) {
  if (layout.widgets.length !== LEGACY_MORNING.length || !layout.widgets.every((item, index) => item.id === LEGACY_MORNING[index] && item.height === 3 && item.size === (index === 0 || index === 2 ? 's' : 'm'))) return layout
  return { ...layout, widgets: layout.widgets.map(item => ({ ...item, size: ['agent.brief', 'task.today'].includes(item.id) ? 'l' : item.size })) }
}
export function quietNow(settings = {}, now = new Date()) {
  if (settings.snoozed_until && new Date(settings.snoozed_until) > now) return true
  if (!settings.enabled) return false
  try {
    const current = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
    const start = settings.start || '22:00', end = settings.end || '07:00'
    return start < end ? current >= start && current < end : current >= start || current < end
  } catch { return false }
}

export function freshness(value, now = new Date()) {
  if (!value) return '—'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '—'
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000))
  return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}

export function previewRows(payload) {
  let count = 0, remaining = 5
  function visit(value) {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(visit)
    return Object.fromEntries(Object.entries(value).map(([key, list]) => {
      if (!['items', 'history', 'shortcuts', 'hours', 'branches', 'remotes'].includes(key) || !Array.isArray(list)) return [key, visit(list)]
      if (key === 'items' && list.some(item => Array.isArray(item.items))) return [key, list.map(visit).filter(item => item.items.length)]
      count += list.length
      const selected = list.slice(0, remaining)
      remaining = Math.max(0, remaining - selected.length)
      return [key, selected]
    }))
  }
  const preview = visit(payload)
  return { payload: preview, count }
}

export const SYSTEM_WIDGETS = ['dash.sync', 'dash.quiet', 'dash.shortcuts', 'dash.gallery']
export const NEED_WIDGETS = ['need.inbox', 'need.drafts', 'need.waiting', 'need.mentions', 'need.overdue']
export const GLANCE_WIDGETS = ['glance.clock', 'glance.weather', 'glance.next-event', 'glance.music']
export function rankNeeds(manifests, records) {
  const kind = { 'need.inbox': 'MAIL', 'need.drafts': 'DRAFT', 'need.waiting': 'WAITING', 'need.mentions': 'MENTION', 'need.overdue': 'OVERDUE' }
  const action = { 'need.inbox': 'Read', 'need.drafts': 'Review', 'need.waiting': 'Follow up', 'need.mentions': 'Open', 'need.overdue': 'Review' }
  return manifests.flatMap(m => (records[m.id]?.payload?.items || []).map(item => ({
    ...item, widgetId: m.id, kind: kind[m.id], action: action[m.id], title: item.title || item.subject,
    why: item.reason || item.snippet || item.detail || (m.id === 'need.overdue' ? `Overdue · ${item.due_at || ''}` : item.recipient || item.from || item.status || m.title),
    at: item.due_at || item.date || item.at || '',
  }))).sort((a, b) => (a.kind === 'OVERDUE' ? 0 : 1) - (b.kind === 'OVERDUE' ? 0 : 1) || (Date.parse(a.at) || Infinity) - (Date.parse(b.at) || Infinity) || `${a.widgetId}:${a.id}`.localeCompare(`${b.widgetId}:${b.id}`))
}

export const WIDGET_ICONS = {
  'glance.clock': 'clock', 'glance.weather': 'cloud', 'glance.next-event': 'calendar', 'glance.music': 'music',
  'glance.air': 'globe', 'glance.sun': 'sun', 'glance.travel': 'globe-west',
  'need.inbox': 'mail', 'need.drafts': 'compose', 'need.waiting': 'clock', 'need.mentions': 'chat', 'need.overdue': 'warning',
  'agent.brief': 'page', 'agent.feed': 'list', 'agent.running': 'play', 'agent.skills': 'skills', 'agent.knows': 'book', 'agent.usage': 'dash',
  'task.today': 'tasks', 'task.backlog': 'list', 'task.agenda': 'calendar', 'task.focus': 'clock', 'task.goals': 'check',
  'dev.prs': 'branch', 'dev.issues': 'warning', 'dev.ci': 'check', 'lib.resurface': 'books', 'lib.capture': 'plus', 'lib.search': 'search',
  'feed.news': 'globe', 'feed.rss': 'list', 'feed.podcasts': 'mic', 'dash.sync': 'refresh', 'dash.quiet': 'moon', 'dash.shortcuts': 'keyboard', 'dash.gallery': 'grid',
  agent: 'sparkle', task: 'tasks', dev: 'github', lib: 'bookmark', feed: 'globe', sys: 'settings', need: 'mail', comm: 'chat',
}

export const widgetTone = id => ['glance.clock', 'agent.feed'].includes(id) ? 'dark' : ['glance.weather', 'agent.brief'].includes(id) ? 'accent' : 'light'
