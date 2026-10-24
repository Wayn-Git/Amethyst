/* Calendar: the month a schedule actually lived in.

   Past days carry the runs that happened, colored by their outcome — the
   statuses are the same words the rest of this page uses, and the colours
   are the same tokens. Nothing is projected: a grid of invented future runs
   would be the schedule lying the first time the server was off for a day.
   What the scheduler will actually do next is a short strip above the grid:
   each active automation and its next run, which is the one future fact the
   database vouches for. */

import { useEffect, useMemo, useState } from 'react'
import Icon from '../Icon.jsx'
import Skeleton from '../Skeleton.jsx'
import EmptyState from '../ui/EmptyState.jsx'
import Button from '../ui/AppButton.jsx'
import { api } from '../../api.js'

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const STATUS_CLASS = {
  success: 'is-ok',
  failed: 'is-failed',
  blocked: 'is-waiting',
  partial: 'is-waiting',
  running: 'is-running',
  skipped: 'is-skipped',
}

function dayKey(iso) {
  if (!iso) return null
  return String(iso).slice(0, 10)
}

/** Six weeks of days, Monday-first, each cell a UTC date or null. */
function gridCells(year, month) {
  const cells = []
  const first = new Date(Date.UTC(year, month, 1))
  // getUTCDay(): 0=Sunday..6=Saturday; a Monday-first grid, so pad to Monday.
  const lead = (first.getUTCDay() + 6) % 7
  for (let i = 0; i < lead; i += 1) cells.push(null)
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  for (let d = 1; d <= days; d += 1) cells.push(new Date(Date.UTC(year, month, d)))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function shiftMonth({ year, month }, by) {
  const at = new Date(Date.UTC(year, month + by, 1))
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() }
}

function monthTitle({ year, month }) {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  })
}

/** What runs next, the only future the database actually promises. */
function NextRuns({ rows }) {
  const upcoming = rows
    .filter((r) => r.enabled && r.next_run_at)
    .sort((a, b) => String(a.next_run_at).localeCompare(String(b.next_run_at)))
    .slice(0, 4)
  if (upcoming.length === 0) return null
  return (
    <div className="auto-calendar-next">
      <span className="auto-calendar-next-label">Next</span>
      {upcoming.map((r) => (
        <span key={r.id} className="auto-calendar-next-item">
          <Icon name="zap" size={10} />
          {r.name} ·{' '}
          {new Date(r.next_run_at).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      ))}
    </div>
  )
}

export default function CalendarView({ rows, onSelectRun }) {
  const [runs, setRuns] = useState(null)
  const today = useMemo(() => new Date(), [])
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }))

  useEffect(() => {
    api.recentRuns(200)
      .then((data) => setRuns(data.runs || []))
      .catch(() => setRuns([]))
  }, [])

  const cellGrid = useMemo(() => gridCells(cursor.year, cursor.month), [cursor])
  const runsByDay = useMemo(() => {
    const byDay = new Map()
    for (const run of runs || []) {
      const key = dayKey(run.created_at)
      if (!key) continue
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key).push(run)
    }
    return byDay
  }, [runs])
  const todayKey = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }, [])
  const monthHasRuns = useMemo(
    () => cellGrid.some((d) => d && runsByDay.has(d.toISOString().slice(0, 10))),
    [cellGrid, runsByDay],
  )

  if (runs === null) {
    return (
      <div className="auto-calendar auto-calendar--loading" aria-hidden="true">
        <div className="auto-calendar-grid">
          {Array.from({ length: 35 }, (_, i) => (
            <div key={i} className="auto-calendar-day">
              <Skeleton w="100%" h={52} r={6} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="auto-calendar" data-enter>
      <NextRuns rows={rows} />
      <div className="auto-calendar-head">
        <span className="auto-calendar-title">{monthTitle(cursor)}</span>
        <div className="auto-calendar-nav">
          <Button variant="ghost" size="small" onClick={() => setCursor((c) => shiftMonth(c, -1))}>
            <Icon name="caret-left" size={12} />
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
          >
            Today
          </Button>
          <Button variant="ghost" size="small" onClick={() => setCursor((c) => shiftMonth(c, 1))}>
            <Icon name="caret-right" size={12} />
          </Button>
        </div>
      </div>
      <div className="auto-calendar-week">
        {WEEK.map((day) => (
          <span key={day} className="auto-calendar-week-day">{day}</span>
        ))}
      </div>
      <div className="auto-calendar-grid">
        {cellGrid.map((date, i) => {
          if (!date) return <span key={`empty-${i}`} className="auto-calendar-day is-empty" />
          const key = date.toISOString().slice(0, 10)
          const dayRuns = runsByDay.get(key) || []
          return (
            <div key={key} className="auto-calendar-day">
              <span className="auto-calendar-day-number">
                {date.getUTCDate()}
                {key === todayKey && <span className="auto-calendar-today-dot" aria-label="today" />}
              </span>
              <div className="auto-calendar-dots">
                {dayRuns.slice(0, 4).map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    className={`auto-calendar-dot ${STATUS_CLASS[run.status] || 'is-skipped'}`}
                    title={`${run.automation_name} · ${run.status}${dayRuns.length > 4 && dayRuns.indexOf(run) === 3 ? ` (+${dayRuns.length - 4} more)` : ''}`}
                    onClick={() => onSelectRun?.(run.id)}
                  />
                ))}
                {dayRuns.length > 4 && (
                  <span className="auto-calendar-more">+{dayRuns.length - 4}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {!monthHasRuns && (
        <EmptyState icon="calendar">No runs this month yet.</EmptyState>
      )}
    </div>
  )
}
