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
    <div className="error-states-showcase" style={{ padding: '24px', background: '#000000', minHeight: '100%', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif' }}>
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#f5f5f7', margin: 0, letterSpacing: '-0.01em' }}>
            System State & Recovery
          </h2>
          <p style={{ fontSize: '12px', color: '#86868b', margin: '2px 0 0 0' }}>
            Minimal native Apple surfaces for token expiration, rate limits, and network reachability
          </p>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            className="apple-pill-btn apple-pill-btn--secondary"
            onClick={() => {
              setDriveVisible(true)
              setModelCardVisible(true)
              setPhoneStatus('offline')
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(320px, 1fr)', gap: '20px', alignItems: 'start' }}>
        {/* Desktop macOS Window Frame */}
        <Window title="Amethyst — Chat" width="100%" height="auto">
          <div style={{ minHeight: '400px', display: 'flex', flexDirection: 'column', background: '#141416' }}>
            {/* Top Drive Expiration Banner */}
            <AppleErrorBanner
              visible={driveVisible}
              service="google_drive"
              email="wayne@amethyst.local"
              onReauth={async () => {
                await new Promise((r) => setTimeout(r, 500))
                setDriveVisible(false)
              }}
              onDismiss={() => setDriveVisible(false)}
            />

            {/* Transcript simulation */}
            <div style={{ padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.06)', padding: '10px 14px', borderRadius: '14px', maxWidth: '75%', alignSelf: 'flex-end', color: '#f5f5f7', fontSize: '13px', lineHeight: 1.4 }}>
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
                <div style={{ color: '#86868b', fontSize: '12.5px', padding: '6px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#30D158' }} />
                  <span>Switched to Llama 3.3 · Found 2 documents in vault</span>
                </div>
              )}
            </div>
          </div>
        </Window>

        {/* Companion iPhone Frame */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <Phone frame="pro" width={340}>
            <div style={{ padding: '8px 12px 16px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', background: '#000000' }}>
              {/* Dynamic Island at top */}
              <div style={{ marginTop: '2px', marginBottom: '28px' }}>
                <DynamicIslandStatus
                  status={phoneStatus}
                  latency={phoneLatency}
                  onRetry={async () => {
                    await new Promise((r) => setTimeout(r, 600))
                    setPhoneStatus('direct')
                    setPhoneLatency(3)
                  }}
                />
              </div>

              <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: '#86868b', fontSize: '12px', textAlign: 'center', gap: '6px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f5f5f7' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                    <line x1="12" x2="12.01" y1="18" y2="18" />
                  </svg>
                </div>
                <div style={{ fontWeight: 500, color: '#f5f5f7' }}>Companion Link</div>
                <div style={{ opacity: 0.6, fontSize: '11px' }}>
                  {phoneStatus === 'direct' ? 'Direct LAN connected' : phoneStatus === 'standalone' ? 'Cloud relay connected' : 'Host unreachable'}
                </div>

                <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
                  <button
                    type="button"
                    className="apple-pill-btn apple-pill-btn--secondary"
                    onClick={() => {
                      setPhoneStatus('direct')
                      setPhoneLatency(2)
                    }}
                  >
                    LAN
                  </button>
                  <button
                    type="button"
                    className="apple-pill-btn apple-pill-btn--secondary"
                    onClick={() => {
                      setPhoneStatus('standalone')
                    }}
                  >
                    Relay
                  </button>
                  <button
                    type="button"
                    className="apple-pill-btn apple-pill-btn--secondary"
                    onClick={() => {
                      setPhoneStatus('offline')
                    }}
                  >
                    Offline
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
