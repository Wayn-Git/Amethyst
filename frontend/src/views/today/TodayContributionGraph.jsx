import { useMemo } from 'react'

/**
 * Small GitHub-contribution-style graph showing task completion activity over time.
 * Rendered in the theme's active accent color.
 */
export default function TodayContributionGraph({ completedTasks = [] }) {
  const { weeks, totalRecent } = useMemo(() => {
    // Map completed dates (YYYY-MM-DD) to count
    const counts = new Map()
    for (const t of completedTasks) {
      const raw = t.completed_at || t.updated_at
      if (!raw) continue
      const d = String(raw).replace(' ', 'T').slice(0, 10)
      counts.set(d, (counts.get(d) || 0) + 1)
    }

    // Generate last 15 weeks up to today
    const now = new Date()
    const days = []
    const totalDays = 15 * 7

    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const count = counts.get(dateStr) || 0

      let level = 0
      if (count >= 3) level = 3
      else if (count === 2) level = 2
      else if (count === 1) level = 1

      days.push({
        date: dateStr,
        count,
        level,
        formatted: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      })
    }

    // Split into weeks (arrays of 7 days)
    const weeksList = []
    for (let i = 0; i < days.length; i += 7) {
      weeksList.push(days.slice(i, i + 7))
    }

    const total = completedTasks.length
    return { weeks: weeksList, totalRecent: total }
  }, [completedTasks])

  return (
    <div className="today-tasks-graph-section">
      <div className="today-tasks-graph-header">
        <span>Completion Activity</span>
        <span>{totalRecent} completed</span>
      </div>

      <div className="today-contrib-grid-wrapper">
        <div className="today-contrib-grid">
          {weeks.map((week, wIdx) =>
            week.map((day, dIdx) => (
              <div
                key={`${wIdx}-${dIdx}`}
                className="today-contrib-cell"
                data-level={day.level}
                title={`${day.formatted}: ${day.count} ${day.count === 1 ? 'task' : 'tasks'} completed`}
              />
            )),
          )}
        </div>
      </div>
    </div>
  )
}
