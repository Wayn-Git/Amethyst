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
          <span style={{ fontWeight: 600 }}>Offline</span>
          {onRetry ? (
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              style={{
                background: 'none',
                border: 'none',
                color: '#0A84FF',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '0 2px',
                fontFamily: 'inherit',
                opacity: retrying ? 0.6 : 1,
              }}
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
