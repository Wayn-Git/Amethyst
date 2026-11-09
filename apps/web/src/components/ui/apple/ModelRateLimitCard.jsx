import React, { useState, useEffect } from 'react'
import './error-states.css'

function friendlyModelName(slug) {
  if (!slug) return 'AI Model'
  const clean = slug.split('/').pop() || slug
  if (clean.includes('claude-3-5') || clean.includes('claude-3.5')) return 'Claude 3.5 Sonnet'
  if (clean.includes('llama-3.3') || clean.includes('llama-3-3')) return 'Llama 3.3'
  if (clean.includes('gpt-4o')) return 'GPT-4o'
  return clean
}

export function ModelRateLimitCard({
  model = '',
  error = 'Rate limit reached',
  retryAfter = 30,
  fallbackModel = 'groq/llama-3.3-70b-versatile',
  onRetry,
  onSwitchFallback,
}) {
  const [remaining, setRemaining] = useState(retryAfter)

  useEffect(() => {
    if (remaining <= 0) {
      if (onRetry) onRetry()
      return
    }
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          if (onRetry) onRetry()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [remaining, onRetry])

  const modelLabel = friendlyModelName(model)
  const fallbackLabel = friendlyModelName(fallbackModel)

  return (
    <div className="apple-rate-limit-card" role="alert" aria-live="polite">
      <div className="apple-rate-limit-header">
        <span className="apple-amber-badge" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </span>
        <span className="apple-rate-limit-title">
          Rate Limit Exceeded · {modelLabel}
        </span>
        <span className="apple-rate-limit-countdown">
          ({remaining}s)
        </span>
      </div>

      <div className="apple-rate-limit-actions">
        <button
          type="button"
          className="apple-pill-btn apple-pill-btn--primary"
          onClick={() => onRetry && onRetry()}
        >
          Retry Now
        </button>

        {fallbackModel && onSwitchFallback ? (
          <button
            type="button"
            className="apple-pill-btn apple-pill-btn--secondary"
            onClick={() => onSwitchFallback(fallbackModel)}
          >
            Switch to {fallbackLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default ModelRateLimitCard
