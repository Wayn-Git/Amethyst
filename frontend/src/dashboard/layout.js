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
export function resizeWidget(item, sizes, dx, dy, width, rowHeight = 100) {
  const target = SPANS[item.size] + dx / Math.max(width / 12, 1)
  const size = sizes.reduce((best, value) => Math.abs(SPANS[value] - target) < Math.abs(SPANS[best] - target) ? value : best, item.size)
  return { ...item, size, height: Math.max(2, Math.min(8, item.height + Math.round(dy / (Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 100)))) }
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
