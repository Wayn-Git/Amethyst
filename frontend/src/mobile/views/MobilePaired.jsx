import { useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui/bento/index.jsx'
import { clearBundle } from '../bundle.js'
import { resolveProviderConfig } from '../llmClient.js'
import {
  subscribeShareQueue,
  retryShareJob,
  removeShareJob,
  clearCompletedShareJobs,
  enqueueShare,
} from '../shareQueue.js'
import '../../views/pair.css'

export default function MobilePaired({ bundle, onUnpair, onDesktop }) {
  const [unpairing, setUnpairing] = useState(false)
  const [jobs, setJobs] = useState([])
  const [testInput, setTestInput] = useState('')
  const [showTestInput, setShowTestInput] = useState(false)

  useEffect(() => {
    const unsubscribe = subscribeShareQueue((updatedJobs) => {
      setJobs(updatedJobs)
    })
    return unsubscribe
  }, [])

  const handleUnpair = async () => {
    if (unpairing) return
    setUnpairing(true)
    try {
      await clearBundle()
      onUnpair?.()
    } finally {
      setUnpairing(false)
    }
  }

  const handleManualShare = async (e) => {
    e.preventDefault()
    if (!testInput.trim()) return
    const text = testInput.trim()
    setTestInput('')
    setShowTestInput(false)
    await enqueueShare(text)
  }

  const activeLlm = resolveProviderConfig(bundle?.llm)
  const rawModelName = activeLlm?.model || bundle?.llm?.model || 'Configured'
  const modelName = typeof rawModelName === 'object' && rawModelName !== null
    ? (rawModelName.model || rawModelName.provider || JSON.stringify(rawModelName))
    : String(rawModelName)
  const rawProvider = activeLlm?.provider || bundle?.llm?.provider || ''
  const modelProvider = (typeof rawProvider === 'object' && rawProvider !== null
    ? (rawProvider.provider || rawProvider.name || JSON.stringify(rawProvider))
    : String(rawProvider)).toUpperCase()
  const driveRoot = bundle?.drive?.root_folder_id || 'Not configured'
  const driveInbox = bundle?.drive?.inbox_folder_id

  const hasAuthError = jobs.some((j) => j.authError)
  const activeJobs = jobs.filter((j) => j.state === 'processing' || j.state === 'queued')
  const completedJobs = jobs.filter((j) => j.state === 'completed')
  const failedJobs = jobs.filter((j) => j.state === 'failed')

  return (
    <div className="pair-screen">
      <header className="pair-top-bar" />

      <main className="pair-center-content" style={{ width: '100%', maxWidth: 440 }}>
        {/* Auth Error Banner if 401/403 or unauthenticated */}
        {hasAuthError && (
          <div
            role="alert"
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 14,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#ef4444',
              marginBottom: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15 }}>
              <Icon name="alert-triangle" size={18} />
              <span>Authentication Required</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: 'var(--pair-text)' }}>
              {failedJobs.find((j) => j.authError)?.error || 'Authentication error occurred.'}
            </p>
            {failedJobs.some((j) => j.authSource === 'composio') ? (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pair-text-muted)', marginTop: 2 }}>
                Open Amethyst settings on your PC and reconnect Google Drive.
              </div>
            ) : (
              <Button
                type="button"
                onClick={handleUnpair}
                style={{
                  background: '#ef4444',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  borderRadius: 8,
                  padding: '8px 12px',
                  border: 0,
                  alignSelf: 'flex-start',
                  marginTop: 4,
                  cursor: 'pointer',
                }}
              >
                Re-scan QR on your PC
              </Button>
            )}
          </div>
        )}

        <div className="pair-dialog-card" style={{ width: '100%', padding: '24px 20px' }}>
          <div className="pair-status-glyph is-ok" aria-hidden="true" style={{ marginBottom: 12 }}>
            <Icon name="check-circle" size={40} />
          </div>

          <h1 className="pair-prompt-title" style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px 0' }}>
            Amethyst Companion
          </h1>
          <p className="pair-prompt-desc" style={{ fontSize: 13, margin: '0 0 18px 0' }}>
            Share target active. Summaries and PC jobs sync directly to Google Drive.
          </p>

          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              textAlign: 'left',
              marginBottom: 16,
            }}
          >
            {/* LLM Model Card */}
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'var(--pair-surface, #fff)',
                border: '1px solid var(--pair-border, rgba(0,0,0,0.1))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Icon name="cpu" size={14} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pair-text-muted)' }}>
                  LANGUAGE MODEL
                </span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-word' }}>
                {modelName}
              </div>
              {modelProvider && (
                <div style={{ fontSize: 11, color: 'var(--pair-text-faint)', marginTop: 2 }}>
                  Provider: {modelProvider}
                </div>
              )}
            </div>

            {/* Drive Folder Card */}
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                background: 'var(--pair-surface, #fff)',
                border: '1px solid var(--pair-border, rgba(0,0,0,0.1))',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <Icon name="folder" size={14} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pair-text-muted)' }}>
                  DRIVE STORAGE
                </span>
              </div>
              <div style={{ fontSize: 13, fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {driveRoot}
              </div>
              {driveInbox && (
                <div style={{ fontSize: 11, color: 'var(--pair-text-faint)', marginTop: 2, fontFamily: 'monospace' }}>
                  Inbox: {driveInbox}
                </div>
              )}
            </div>
          </div>

          {/* Share Target & Jobs Section */}
          <div
            style={{
              width: '100%',
              borderTop: '1px solid var(--pair-border, rgba(0,0,0,0.08))',
              paddingTop: 16,
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="share-2" size={16} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>Share Target</span>
                {activeJobs.length > 0 && (
                  <span
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#2563eb',
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 10,
                      padding: '1px 7px',
                    }}
                  >
                    {activeJobs.length} active
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowTestInput(!showTestInput)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {showTestInput ? 'Cancel' : '+ Test Share'}
                </button>
                {completedJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={clearCompletedShareJobs}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--pair-text-muted)',
                      fontSize: 12,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Clear done
                  </button>
                )}
              </div>
            </div>

            {/* Test Share input drawer */}
            {showTestInput && (
              <form onSubmit={handleManualShare} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                    placeholder="Paste article URL, IG reel, or note…"
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--pair-border, rgba(0,0,0,0.2))',
                      background: 'var(--pair-surface, #fff)',
                      color: 'var(--pair-text)',
                      fontSize: 13,
                    }}
                  />
                  <Button
                    type="submit"
                    style={{
                      borderRadius: 8,
                      padding: '8px 12px',
                      background: '#2563eb',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 600,
                      border: 0,
                      cursor: 'pointer',
                    }}
                  >
                    Share
                  </Button>
                </div>
              </form>
            )}

            {/* Jobs List */}
            {jobs.length === 0 ? (
              <div
                style={{
                  padding: '20px 12px',
                  textAlign: 'center',
                  background: 'rgba(0,0,0,0.02)',
                  borderRadius: 10,
                  fontSize: 13,
                  color: 'var(--pair-text-muted)',
                }}
              >
                No shares yet. Share article links, notes, or Instagram reels from any app to Amethyst.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto' }}>
                {jobs.map((job) => {
                  const isProcessing = job.state === 'processing' || job.state === 'queued'
                  const isSuccess = job.state === 'completed'
                  const isFailed = job.state === 'failed'

                  return (
                    <div
                      key={job.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'var(--pair-surface, #fff)',
                        border: '1px solid var(--pair-border, rgba(0,0,0,0.08))',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <Icon
                            name={
                              job.kind === 'video'
                                ? 'video'
                                : job.route === 'summary'
                                ? 'file-text'
                                : 'link'
                            }
                            size={14}
                            style={{ flexShrink: 0, color: 'var(--pair-text-muted)' }}
                          />
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              fontFamily: 'monospace',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {job.id}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: '1px 5px',
                              borderRadius: 4,
                              textTransform: 'uppercase',
                              fontWeight: 700,
                              background:
                                job.route === 'inbox'
                                  ? 'rgba(168, 85, 247, 0.12)'
                                  : 'rgba(14, 165, 233, 0.12)',
                              color: job.route === 'inbox' ? '#9333ea' : '#0284c7',
                            }}
                          >
                            {job.route === 'inbox' ? 'PC Inbox' : 'Summary'}
                          </span>
                        </div>

                        {/* Status Chip */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {isProcessing && (
                            <span
                              style={{
                                fontSize: 11,
                                color: '#2563eb',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <span
                                style={{
                                  display: 'inline-block',
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: '#2563eb',
                                  animation: 'pulse 1.5s infinite',
                                }}
                              />
                              Active
                            </span>
                          )}
                          {isSuccess && (
                            <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Done</span>
                          )}
                          {isFailed && (
                            <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>Failed</span>
                          )}
                        </div>
                      </div>

                      {/* Content snippet / URL */}
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--pair-text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {job.url || job.rawText}
                      </div>

                      {/* Progress / Error line */}
                      <div
                        style={{
                          fontSize: 11,
                          color: isFailed ? '#dc2626' : 'var(--pair-text-faint)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: 2,
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {job.authError ? 'Re-scan QR on your PC' : job.progress}
                        </span>

                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {isFailed && !job.authError && (
                            <button
                              type="button"
                              onClick={() => retryShareJob(job.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#2563eb',
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeShareJob(job.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--pair-text-faint)',
                              fontSize: 11,
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="pair-bottom-actions" style={{ width: '100%', maxWidth: 440, marginTop: 18 }}>
        <Button
          type="button"
          className="pair-auth-btn"
          style={{
            background: '#ef4444',
            color: '#ffffff',
            borderRadius: 999,
            minHeight: 46,
            width: '100%',
            fontWeight: 600,
            cursor: 'pointer',
            border: 0,
          }}
          onClick={handleUnpair}
          disabled={unpairing}
        >
          {unpairing ? 'Unpairing…' : 'Unpair Device'}
        </Button>

        {onDesktop && (
          <Button type="button" className="pair-desktop-link" onClick={onDesktop} style={{ marginTop: 10 }}>
            Use desktop interface
          </Button>
        )}
      </footer>
    </div>
  )
}
