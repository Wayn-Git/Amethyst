/**
 * AMETHYST LIBRARY — Date Formatting & Grouping Utilities
 * Guaranteed resilient timezone-safe date parsing that never hides or clips dates.
 */

/** Formats a date string (YYYY-MM-DD or ISO) into readable display string, e.g. 'Sep 20, 2026' */
export function formatDisplayDate(dateStr, includeYear = true) {
  if (!dateStr) return ''
  try {
    let d
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parts = dateStr.slice(0, 10).split('-').map(Number)
      d = new Date(parts[0], parts[1] - 1, parts[2])
    } else {
      d = new Date(dateStr)
    }
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(includeYear ? { year: 'numeric' } : {}),
    })
  } catch {
    return dateStr
  }
}

/** Formats date with weekday and optional time for detailed inspection headers */
export function formatFullDateTime(dateStr) {
  if (!dateStr) return ''
  try {
    let d
    const hasTime = dateStr.includes('T') || (dateStr.includes(':') && dateStr.length > 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parts = dateStr.slice(0, 10).split('-').map(Number)
      d = new Date(parts[0], parts[1] - 1, parts[2])
    } else {
      d = new Date(dateStr)
    }
    if (isNaN(d.getTime())) return dateStr

    const datePart = d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    if (hasTime) {
      const timePart = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
      return `${datePart} · ${timePart}`
    }
    return datePart
  } catch {
    return dateStr
  }
}

/** Formats relative time description (e.g. 'Today', 'Yesterday', '3 days ago') */
export function formatRelativeDate(dateStr) {
  if (!dateStr) return ''
  try {
    let d
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const parts = dateStr.slice(0, 10).split('-').map(Number)
      d = new Date(parts[0], parts[1] - 1, parts[2])
    } else {
      d = new Date(dateStr)
    }
    if (isNaN(d.getTime())) return ''

    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays > 1 && diffDays < 30) return `${diffDays}d ago`
    return ''
  } catch {
    return ''
  }
}

/** Formats a date string into human headers like 'Sun Sep 20 2026' or 'Today · Sep 20 2026' */
export function formatGroupDate(dateStr) {
  if (!dateStr) return 'Earlier'
  try {
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
