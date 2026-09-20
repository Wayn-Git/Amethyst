import { useMemo } from 'react'

const DAY_WIDTH = 8
const DAY_GAP = 3
const CHART_HEIGHT = 48

/** Visual bar chart of automation run history over the last 30 days.

    Each day is a bar: green for success, red for failure, amber for partial/blocked,
    grey for no runs. The chart is pure SVG, no dependencies. */
export default function RunHistoryChart({ stats, totalRuns }) {
  const days = useMemo(() => {
    if (!stats?.by_day) return []
    const result = []
    const now = new Date()
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      const dayData = stats.by_day[key]
      const success = dayData?.success || 0
      const failed = dayData?.failed || 0
      const partial = (dayData?.partial || 0) + (dayData?.blocked || 0)
      const skipped = dayData?.skipped || 0
      const total = success + failed + partial + skipped
      result.push({
        date: key,
        success,
        failed,
        partial,
        skipped,
        total,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
    }
    return result
  }, [stats])

  const maxTotal = useMemo(() => {
    return Math.max(1, ...days.map((d) => d.total))
  }, [days])

  const succeeded = useMemo(() => days.reduce((s, d) => s + d.success, 0), [days])
  const failed = useMemo(() => days.reduce((s, d) => s + d.failed, 0), [days])
  const partial = useMemo(() => days.reduce((s, d) => s + d.partial, 0), [days])

  const totalWidth = days.length * (DAY_WIDTH + DAY_GAP)

  return (
    <div className="run-history-card" data-enter>
      <div className="run-history-head">
        <div>
          <span className="run-history-title">Run history</span>
          <span className="run-history-subtitle">Last 30 days</span>
        </div>
        <div className="run-history-legend">
          {succeeded > 0 && (
            <span className="run-history-legend-item">
              <span className="run-history-dot run-history-dot--success" />
              {succeeded} Succeeded
            </span>
          )}
          {failed > 0 && (
            <span className="run-history-legend-item">
              <span className="run-history-dot run-history-dot--failed" />
              {failed} Failed
            </span>
          )}
          {partial > 0 && (
            <span className="run-history-legend-item">
              <span className="run-history-dot run-history-dot--partial" />
              {partial} Partial
            </span>
          )}
          {succeeded === 0 && failed === 0 && partial === 0 && (
            <span className="run-history-legend-item run-history-legend-item--muted">
              No runs yet
            </span>
          )}
          {totalRuns != null && (
            <span className="run-history-total">{totalRuns} runs</span>
          )}
        </div>
      </div>
      <div className="run-history-chart">
        <svg
          width={totalWidth}
          height={CHART_HEIGHT}
          viewBox={`0 0 ${totalWidth} ${CHART_HEIGHT}`}
          className="run-history-svg"
        >
          {days.map((day, i) => {
            const x = i * (DAY_WIDTH + DAY_GAP)
            const barY = CHART_HEIGHT - 2
            const successH = day.total > 0
              ? Math.max(2, (day.success / maxTotal) * (CHART_HEIGHT - 4))
              : 0
            const failedH = day.total > 0 && day.failed > 0
              ? Math.max(2, (day.failed / maxTotal) * (CHART_HEIGHT - 4))
              : 0
            const partialH = day.total > 0 && day.partial > 0
              ? Math.max(2, (day.partial / maxTotal) * (CHART_HEIGHT - 4))
              : 0
            let offset = 0

            return (
              <g key={day.date}>
                {day.total === 0 ? (
                  // Empty day - small grey dot
                  <rect
                    x={x}
                    y={CHART_HEIGHT - 4}
                    width={DAY_WIDTH}
                    height={2}
                    rx={1}
                    fill="var(--text-faint)"
                    opacity={0.3}
                  />
                ) : (
                  <>
                    {/* Success bar */}
                    {day.success > 0 && (
                      <rect
                        x={x}
                        y={barY - successH - (offset = 0, 0)}
                        width={DAY_WIDTH}
                        height={successH}
                        rx={2}
                        fill="var(--live)"
                        opacity={0.8}
                      />
                    )}
                    {/* Partial bar (stacked) */}
                    {day.partial > 0 && (
                      <rect
                        x={x}
                        y={barY - successH - partialH}
                        width={DAY_WIDTH}
                        height={partialH}
                        rx={2}
                        fill="var(--confirm)"
                        opacity={0.8}
                      />
                    )}
                    {/* Failed bar (stacked on top) */}
                    {day.failed > 0 && (
                      <rect
                        x={x}
                        y={barY - successH - partialH - failedH}
                        width={DAY_WIDTH}
                        height={failedH}
                        rx={2}
                        fill="var(--stop)"
                        opacity={0.8}
                      />
                    )}
                  </>
                )}
                {/* Date labels (every 5th day) */}
                {i % 5 === 0 && (
                  <text
                    x={x + DAY_WIDTH / 2}
                    y={CHART_HEIGHT}
                    textAnchor="middle"
                    className="run-history-date-label"
                  >
                    {day.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
