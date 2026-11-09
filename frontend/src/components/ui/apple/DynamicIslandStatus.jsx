import React, { useState } from 'react'
import './error-states.css'

export function DynamicIslandStatus({
  status = 'direct', // 'direct' | 'standalone' | 'offline'
  latency = -1,
  onRetry,
}) {
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    if (retrying || !onRetry) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  const isOffline = status === 'offline'
  const isDirect = status === 'direct'
  const isStandalone = status === 'standalone'

  const rootClass = [
    'apple-dynamic-island',
    isOffline ? 'apple-dynamic-island--expanded' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const indicatorClass = [
    'apple-dynamic-island-indicator',
    isDirect
      ? 'apple-dynamic-island-indicator--direct'
      : isStandalone
      ? 'apple-dynamic-island-indicator--standalone'
      : 'apple-dynamic-island-indicator--offline',
  ].join(' ')

  return (
    <div className={rootClass} role="status" aria-live="polite">
      <div className={indicatorClass} aria-hidden="true" />

      {isDirect ? (
        <span>
          LAN {latency > 0 ? `(${latency}ms)` : ''}
        </span>
      ) : null}

      {isStandalone ? (
        <span>Cloud Relay</span>
      ) : null}

      {isOffline ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 600 }}>Offline</span>
            <span style={{ fontSize: '10px', opacity: 0.7 }}>No Host Link</span>
          </div>

          {onRetry ? (
            <button
              type="button"
              className="apple-pill-btn apple-pill-btn--primary"
              style={{ padding: '4px 10px', fontSize: '11px', height: '24px' }}
              onClick={handleRetry}
              disabled={retrying}
            >
              {retrying ? 'Connecting…' : 'Reconnect'}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export default DynamicIslandStatus
