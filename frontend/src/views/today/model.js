export function dateValue(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
export function ageLabel(value, now = new Date()) {
  const date = dateValue(value)
  if (!date) return 'Date unavailable'
  const minutes = Math.max(0, Math.floor((now - date) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}
export function safeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}
export function isLater(item, now = new Date()) {
  return item.state === 'done' || (dateValue(item.snoozed_until)?.getTime() || 0) > now.getTime()
}
export function rankItems(items, now = new Date()) {
  const due = (item) => item.follow_up_at && dateValue(item.follow_up_at) <= now ? 1 : 0
  return [...items].sort((a, b) => Number(Boolean(b.priority)) - Number(Boolean(a.priority)) || due(b) - due(a) || (dateValue(a.occurred_at || a.created_at) - dateValue(b.occurred_at || b.created_at)))
}
export function rankTasks(tasks, now = new Date()) {
  const due = (task) => dateValue(task.due_at)?.getTime() ?? Infinity
  return tasks.filter(t => !['done', 'cancelled'].includes(t.status)).sort((a, b) => Number(due(b) < now.getTime()) - Number(due(a) < now.getTime()) || Number(Boolean(b.important)) - Number(Boolean(a.important)) || due(a) - due(b))
}
