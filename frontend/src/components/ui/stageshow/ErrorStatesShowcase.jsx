import React, { useState } from 'react'
import { Stage } from '../../../stageshow/kit/stage'
import { Window } from '../../../stageshow/kit/window'
import { Phone } from '../../../stageshow/kit/phone'
import { AppleErrorBanner } from '../apple/AppleErrorBanner'
import { ModelRateLimitCard } from '../apple/ModelRateLimitCard'
import { DynamicIslandStatus } from '../apple/DynamicIslandStatus'
import '../apple/error-states.css'

export function ErrorStatesShowcase({
  initialDriveExpired = true,
  initialModelRateLimited = true,
  initialPhoneStatus = 'offline',
}) {
  const [driveVisible, setDriveVisible] = useState(initialDriveExpired)
  const [modelCardVisible, setModelCardVisible] = useState(initialModelRateLimited)
  const [phoneStatus, setPhoneStatus] = useState(initialPhoneStatus)
  const [phoneLatency, setPhoneLatency] = useState(phoneStatus === 'direct' ? 4 : -1)

  return (
    <div className="error-states-showcase" style={{ padding: '24px', background: '#0a0a0c', minHeight: '100%' }}>
      <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#f5f5f7', margin: 0 }}>
            Amethyst Error States & Recovery
          </h2>
          <p style={{ fontSize: '13px', color: '#86868b', margin: '4px 0 0 0' }}>
            Apple-style translucent glass and Dynamic Island components built with Stageshow
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="apple-pill-btn apple-pill-btn--secondary"
            onClick={() => {
              setDriveVisible(true)
              setModelCardVisible(true)
              setPhoneStatus('offline')
            }}
          >
            Reset All
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(320px, 1fr)', gap: '24px', alignItems: 'start' }}>
        {/* Desktop macOS Window Frame */}
        <Window title="Amethyst — Chat & Storage" width="100%" height="auto">
          <div style={{ minHeight: '440px', display: 'flex', flexDirection: 'column' }}>
            {/* Top Drive Expiration Banner */}
            <AppleErrorBanner
              visible={driveVisible}
              service="google_drive"
              email="wayne@amethyst.local"
              onReauth={async () => {
                await new Promise((r) => setTimeout(r, 600))
                setDriveVisible(false)
              }}
              onDismiss={() => setDriveVisible(false)}
            />

            {/* Transcript simulation */}
            <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.05)', padding: '12px 16px', borderRadius: '14px', maxWidth: '80%', alignSelf: 'flex-end', color: '#f5f5f7', fontSize: '13px' }}>
                Search my Google Drive vault for the Q4 financials and summarize them.
              </div>

              {modelCardVisible ? (
                <ModelRateLimitCard
                  model="anthropic/claude-3-5-sonnet"
                  error="HTTP 429 Too Many Requests"
                  retryAfter={24}
                  fallbackModel="groq/llama-3.3-70b-versatile"
                  onRetry={() => setModelCardVisible(false)}
                  onSwitchFallback={() => setModelCardVisible(false)}
                />
              ) : (
                <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '14px 18px', borderRadius: '14px', color: '#f5f5f7', fontSize: '13px', lineHeight: 1.5 }}>
                  <strong>Switched to Llama 3.3 (Fallback):</strong> Found 2 documents in vault: <code>Q4_Financial_Review.pdf</code> and <code>Summary_Sheet.xlsx</code>.
                </div>
              )}
            </div>
          </div>
        </Window>

        {/* Companion iPhone Frame */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <Phone frame="pro" width={340}>
            <div style={{ padding: '12px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Dynamic Island at top */}
              <div style={{ marginTop: '4px', marginBottom: '24px' }}>
                <DynamicIslandStatus
                  status={phoneStatus}
                  latency={phoneLatency}
                  onRetry={async () => {
                    await new Promise((r) => setTimeout(r, 700))
                    setPhoneStatus('direct')
                    setPhoneLatency(3)
                  }}
                />
              </div>

              <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#86868b', fontSize: '13px', textAlign: 'center', gap: '8px' }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f5f5f7' }}>
                  📱
                </div>
                <div>Companion Client</div>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>
                  Status: <strong>{phoneStatus}</strong>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginTop: '16px' }}>
                  <button
                    type="button"
                    className="apple-pill-btn apple-pill-btn--secondary"
                    onClick={() => {
                      setPhoneStatus('direct')
                      setPhoneLatency(2)
                    }}
                  >
                    Set LAN
                  </button>
                  <button
                    type="button"
                    className="apple-pill-btn apple-pill-btn--secondary"
                    onClick={() => {
                      setPhoneStatus('standalone')
                    }}
                  >
                    Set Relay
                  </button>
                  <button
                    type="button"
                    className="apple-pill-btn apple-pill-btn--secondary"
                    onClick={() => {
                      setPhoneStatus('offline')
                    }}
                  >
                    Set Offline
                  </button>
                </div>
              </div>
            </div>
          </Phone>
        </div>
      </div>
    </div>
  )
}

export default ErrorStatesShowcase
