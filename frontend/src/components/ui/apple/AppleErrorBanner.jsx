import React, { useState } from 'react'
import './error-states.css'

export function AppleErrorBanner({
  visible = true,
  service = 'google_drive',
  email = '',
  onReauth,
  onDismiss,
}) {
  const [reauthing, setReauthing] = useState(false)

  if (!visible) return null

  const handleReauth = async () => {
    if (reauthing) return
    setReauthing(true)
    try {
      if (onReauth) {
        await onReauth()
      }
    } finally {
      setReauthing(false)
    }
  }

  const serviceName = service === 'google_drive' ? 'Google Drive' : service

  return (
    <div className="apple-glass-banner" role="alert" aria-live="assertive">
      <div className="apple-glass-banner-content">
        <span className="apple-amber-badge" aria-hidden="true">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 600 }}>{serviceName} session expired</span>
          {email ? (
            <span style={{ opacity: 0.65, fontSize: '12px' }}>({email})</span>
          ) : null}
          <span style={{ opacity: 0.55, fontSize: '12px' }}>— Sign in to resume sync</span>
        </div>
      </div>

      <div className="apple-glass-banner-actions">
        <button
          type="button"
          className="apple-pill-btn apple-pill-btn--primary"
          onClick={handleReauth}
          disabled={reauthing}
        >
          {reauthing ? 'Connecting…' : 'Re-authenticate'}
        </button>
        {onDismiss ? (
          <button
            type="button"
            className="apple-pill-btn apple-pill-btn--secondary"
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default AppleErrorBanner
