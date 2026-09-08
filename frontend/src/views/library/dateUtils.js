/** Formats a date string (YYYY-MM-DD or ISO) into human headers like "Sun Jul 19 2026" */
export function formatGroupDate(dateStr) {
  if (!dateStr) return 'Earlier'
  try {
    // Treat YYYY-MM-DD as local date to prevent timezone shift
    let d
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, day] = dateStr.split('-').map(Number)
      d = new Date(y, m - 1, day)
    } else {
      d = new Date(dateStr)
    }
    if (isNaN(d.getTime())) return dateStr

    const now = new Date()
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()

    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const isYesterday =
      d.getFullYear() === yesterday.getFullYear() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getDate() === yesterday.getDate()

    const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
    const formatted = d.toLocaleDateString('en-US', options).replace(/,/g, '')

    if (isToday) return `Today · ${formatted}`
    if (isYesterday) return `Yesterday · ${formatted}`
    return formatted
  } catch {
    return dateStr
  }
}

/** Groups an array of library items by chronological date while preserving the current sort order */
export function groupItemsByDate(items) {
  if (!items || !items.length) return []

  const groups = []
  let currentGroup = null

  for (const item of items) {
    const rawDate = item.consumed_on || (item.created_at ? item.created_at.slice(0, 10) : '')
    const key = rawDate || 'undated'

    if (!currentGroup || currentGroup.dateKey !== key) {
      currentGroup = {
        dateKey: key,
        heading: formatGroupDate(rawDate),
        items: [item],
      }
      groups.push(currentGroup)
    } else {
      currentGroup.items.push(item)
    }
  }

  return groups
}
