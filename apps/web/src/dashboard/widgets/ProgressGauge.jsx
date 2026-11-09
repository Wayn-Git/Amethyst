import { WidgetCard, CardHeader, WidgetChip } from '../primitives.jsx'
import { useId } from 'react'

export function calculateProgress(completed, total) {
  if (!total || total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((completed / total) * 100)))
}

export default function ProgressGauge({ completed = 0, total = 0 }) {
  const gradientId = useId()
  const percent = calculateProgress(completed, total)
  // Semicircle arc radius 40, length = PI * 40 = 125.66
  const arcLength = 125.66
  const dashOffset = arcLength - (arcLength * percent) / 100

  const status = total === 0 ? 'No tasks today'
    : percent === 100 ? 'All completed!'
    : percent >= 75 ? 'Almost there'
    : percent >= 40 ? 'Good momentum'
    : 'In progress'

  return (
    <WidgetCard className="bento-gauge-card" aria-label="Today's task progress">
      <CardHeader className="bento-card-header">
        <WidgetChip className="bento-badge">Progress</WidgetChip>
        <span className="bento-card-sub">{total > 0 ? `${completed}/${total} tasks` : '0 tasks'}</span>
      </CardHeader>
      <div className="bento-gauge-body">
        <div className="bento-gauge-visual" aria-hidden="true">
          <svg viewBox="0 0 100 68" className="bento-gauge-svg">
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 70%, var(--confirm))" />
              </linearGradient>
            </defs>
            <path
              d="M 12 60 A 38 38 0 0 1 88 60"
              fill="none"
              stroke="var(--hairline-strong)"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path
              d="M 12 60 A 38 38 0 0 1 88 60"
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={arcLength}
              strokeDashoffset={dashOffset}
              style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.25, 1, 0.5, 1)' }}
            />
          </svg>
          <div className="bento-gauge-center">
            <strong className="bento-gauge-num">{percent}%</strong>
          </div>
        </div>
        <div className="bento-gauge-footer">
          <strong className="bento-gauge-status">{status}</strong>
          <p className="bento-gauge-hint">
            {total === 0 ? 'Add a task below to get started' : `${total - completed} remaining today`}
          </p>
        </div>
      </div>
    </WidgetCard>
  )
}
