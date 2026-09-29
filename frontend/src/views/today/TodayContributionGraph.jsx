import { useMemo, useState, useRef, useEffect } from 'react'

/**
 * GitHub-style Contribution Graph for Task Completions:
 * - 52-week calendar grid (365 days) aligned Sunday to Saturday
 * - Local calendar date calculations (zero UTC offset drift)
 * - Accurate month labels (Jan-Dec) aligned with week columns
 * - Weekday labels (Mon, Wed, Fri) aligned with rows
 * - Dynamic 5-level activity scaling (Level 0 empty, Levels 1-4 graduated)
 * - Auto-scrolls to today's date on initial mount
 * - Interactive floating tooltip with task counts, formatted dates, and task names
 * - "Less ... More" level legend matching GitHub's layout
 * - Fully theme-adaptive with custom accent color support
 */

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CELL_SIZE = 10
const CELL_GAP = 3
const COL_WIDTH = CELL_SIZE + CELL_GAP

function formatLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function TodayContributionGraph({ completedTasks = [] }) {
  const scrollRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)

  // Auto-scroll to the right (most recent days) on load
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [])

  const { weeks, monthLabels, totalCount, activeYear } = useMemo(() => {
    // Map completed dates (YYYY-MM-DD) to count & titles
    const counts = new Map()
    const taskTitlesByDate = new Map()

    for (const t of completedTasks) {
      const raw = t.completed_at || t.updated_at
      if (!raw) continue
      const dStr = String(raw).replace(' ', 'T').slice(0, 10)
      counts.set(dStr, (counts.get(dStr) || 0) + 1)

      const titles = taskTitlesByDate.get(dStr) || []
      if (t.title && titles.length < 4) {
        titles.push(t.title)
      }
      taskTitlesByDate.set(dStr, titles)
    }

    // Determine max count for graduated 5-level quartile scaling
    let maxCount = 0
    for (const cnt of counts.values()) {
      if (cnt > maxCount) maxCount = cnt
    }

    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const currentDayOfWeek = today.getDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat

    // End date is Saturday of current week (or today)
    const endOfWeekSunday = new Date(today)
    endOfWeekSunday.setDate(today.getDate() - currentDayOfWeek)

    const TOTAL_WEEKS = 52
    const startDate = new Date(endOfWeekSunday)
    startDate.setDate(startDate.getDate() - (TOTAL_WEEKS - 1) * 7)

    const generatedWeeks = []
    const rawMonthLabels = []
    let lastMonth = -1
    let lastLabelCol = -4

    for (let w = 0; w < TOTAL_WEEKS; w++) {
      const weekDays = []
      let weekFirstValidDayMonth = -1

      for (let d = 0; d < 7; d++) {
        const curDate = new Date(startDate)
        curDate.setDate(startDate.getDate() + w * 7 + d)

        const isFuture = curDate > today
        const dateStr = formatLocalDate(curDate)
        const count = isFuture ? 0 : counts.get(dateStr) || 0
        const titles = taskTitlesByDate.get(dateStr) || []

        if (!isFuture && weekFirstValidDayMonth === -1) {
          weekFirstValidDayMonth = curDate.getMonth()
        }

        // 5-Level Activity Scaling (0 to 4)
        let level = 0
        if (count > 0) {
          if (maxCount <= 4) {
            level = Math.min(4, count)
          } else {
            const q1 = Math.max(1, Math.floor(maxCount * 0.25))
            const q2 = Math.max(2, Math.floor(maxCount * 0.5))
            const q3 = Math.max(3, Math.floor(maxCount * 0.75))
            if (count <= q1) level = 1
            else if (count <= q2) level = 2
            else if (count <= q3) level = 3
            else level = 4
          }
        }

        weekDays.push({
          date: dateStr,
          dayOfWeek: d,
          count,
          level,
          isFuture,
          titles,
          formatted: curDate.toLocaleDateString(undefined, {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
        })
      }

      // Check month boundary for header labels
      const firstDay = weekDays[0]
      const curMonth = firstDay ? new Date(firstDay.date).getMonth() : -1
      if (curMonth !== -1 && curMonth !== lastMonth) {
        if (w - lastLabelCol >= 3 && w < TOTAL_WEEKS - 1) {
          rawMonthLabels.push({
            name: MONTH_NAMES[curMonth],
            colIndex: w,
          })
          lastLabelCol = w
        }
        lastMonth = curMonth
      }

      generatedWeeks.push(weekDays)
    }

    return {
      weeks: generatedWeeks,
      monthLabels: rawMonthLabels,
      totalCount: completedTasks.length,
      activeYear: now.getFullYear(),
    }
  }, [completedTasks])

  const handleMouseEnter = (day, e) => {
    if (day.isFuture || day.count === 0) return
    const cellRect = e.currentTarget.getBoundingClientRect()
    const sectionEl = e.currentTarget.closest('.today-tasks-graph-section')
    const sectionRect = sectionEl?.getBoundingClientRect() || cellRect

    const rawX = cellRect.left - sectionRect.left + CELL_SIZE / 2
    const sectionWidth = sectionRect.width || 300
    const clampedX = Math.max(80, Math.min(sectionWidth - 80, rawX))
    const rawY = cellRect.top - sectionRect.top - 8

    setTooltip({
      day,
      x: clampedX,
      y: rawY,
    })
  }

  const handleMouseLeave = () => {
    setTooltip(null)
  }

  return (
    <div className="today-tasks-graph-section">
      {/* Top Header */}
      <div className="today-tasks-graph-header">
        <div className="today-graph-title-group">
          <span className="today-graph-title">Completion Activity</span>
          <span className="today-graph-pill">{totalCount} in {activeYear}</span>
        </div>
        <span className="today-graph-period">Past 52 weeks</span>
      </div>

      {/* Contribution Calendar Scroll Area */}
      <div className="today-contrib-scroll" ref={scrollRef}>
        <div className="today-contrib-canvas">
          {/* Month Labels Row */}
          <div className="today-contrib-months">
            <div className="today-contrib-day-gutter" aria-hidden="true" />
            <div className="today-contrib-months-track">
              {monthLabels.map((m, idx) => (
                <span
                  key={`${m.name}-${idx}`}
                  className="today-contrib-month-label"
                  style={{ left: m.colIndex * COL_WIDTH }}
                >
                  {m.name}
                </span>
              ))}
            </div>
          </div>

          {/* Grid with Day Labels on Left */}
          <div className="today-contrib-body">
            {/* Weekday Labels (Mon, Wed, Fri aligned with rows 1, 3, 5) */}
            <div className="today-contrib-day-labels" aria-hidden="true">
              <span className="today-contrib-day-label"></span>
              <span className="today-contrib-day-label">Mon</span>
              <span className="today-contrib-day-label"></span>
              <span className="today-contrib-day-label">Wed</span>
              <span className="today-contrib-day-label"></span>
              <span className="today-contrib-day-label">Fri</span>
              <span className="today-contrib-day-label"></span>
            </div>

            {/* Weeks Columns */}
            <div className="today-contrib-weeks">
              {weeks.map((week, wIdx) => (
                <div key={`w-${wIdx}`} className="today-contrib-col">
                  {week.map((day, dIdx) => {
                    if (day.isFuture) {
                      return (
                        <div
                          key={`d-${wIdx}-${dIdx}`}
                          className="today-contrib-cell is-future"
                          aria-hidden="true"
                        />
                      )
                    }
                    return (
                      <div
                        key={`d-${wIdx}-${dIdx}`}
                        className="today-contrib-cell"
                        data-level={day.level}
                        onMouseEnter={(e) => handleMouseEnter(day, e)}
                        onMouseLeave={handleMouseLeave}
                        aria-label={`${day.count} tasks completed on ${day.formatted}`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Floating Tooltip outside scroll area */}
      {tooltip && (
        <div
          className="today-contrib-tooltip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          <div className="today-contrib-tooltip-count">
            {tooltip.day.count === 0 ? (
              'No tasks completed'
            ) : (
              <>
                <strong>{tooltip.day.count}</strong> {tooltip.day.count === 1 ? 'task' : 'tasks'} completed
              </>
            )}
          </div>
          <div className="today-contrib-tooltip-date">{tooltip.day.formatted}</div>
          {tooltip.day.titles.length > 0 && (
            <div className="today-contrib-tooltip-tasks">
              {tooltip.day.titles.map((title, i) => (
                <div key={i} className="today-contrib-tooltip-task-item">
                  • {title}
                </div>
              ))}
              {tooltip.day.count > tooltip.day.titles.length && (
                <div className="today-contrib-tooltip-more">
                  +{tooltip.day.count - tooltip.day.titles.length} more
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer Bar: Description & Less/More Legend */}
      <div className="today-tasks-graph-footer">
        <span className="today-contrib-hint">Tasks completed over time</span>
        <div className="today-contrib-legend">
          <span className="today-legend-label">Less</span>
          <span className="today-contrib-cell" data-level="0" />
          <span className="today-contrib-cell" data-level="1" />
          <span className="today-contrib-cell" data-level="2" />
          <span className="today-contrib-cell" data-level="3" />
          <span className="today-contrib-cell" data-level="4" />
          <span className="today-legend-label">More</span>
        </div>
      </div>
    </div>
  )
}

