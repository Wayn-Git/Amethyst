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
        <div className="apple-amber-badge" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div>
          <strong>{serviceName} session expired</strong>
          {email ? (
            <span style={{ opacity: 0.8, marginLeft: '6px' }}>({email})</span>
          ) : null}
          <div style={{ fontSize: '12px', opacity: 0.75, marginTop: '1px' }}>
            Re-authenticate to resume syncing library files and cloud catalogs.
          </div>
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
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default AppleErrorBanner
