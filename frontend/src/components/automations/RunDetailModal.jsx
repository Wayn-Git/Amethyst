import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'

function formatDuration(ms) {
  if (ms === undefined || ms === null) return '—'
  if (ms < 1000) return '<1s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function stepIcon(step) {
  if (step.kind === 'refused') return 'shield-warning'
  if (step.kind === 'email') return 'envelope'
  if (step.kind === 'notify') return 'bell'
  return 'terminal'
}

/** Full detail view for a single automation run. */
export default function RunDetailModal({ runId, onClose }) {
  const [run, setRun] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    api.automationRunDetail(runId).then((data) => {
      if (mounted) setRun(data)
    }).catch((err) => {
      if (mounted) setError(err.message || 'Failed to load run details')
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => { mounted = false }
  }, [runId])

  return (
    <div className="auto-modal-overlay" onClick={onClose}>
      <div className="auto-modal auto-modal--wide" onClick={(e) => e.stopPropagation()} data-enter>
        {/* Header */}
        <div className="auto-modal-head">
          <div className="auto-modal-head-left">
            <h2>{loading ? 'Run detail' : (run?.automation_name || 'Run detail')}</h2>
            {run && (
              <span className={`auto-status-badge auto-status-badge--${run.status}`}>
                {run.status === 'success' && <Icon name="check" size={10} />}
                {run.status === 'failed' && <Icon name="x" size={10} />}
                {run.status === 'running' && <Icon name="clock" size={10} />}
                {run.status === 'blocked' && <Icon name="warning" size={10} />}
                {run.status === 'partial' && <Icon name="warning" size={10} />}
                {run.status === 'skipped' && <Icon name="minus" size={10} />}
                {run.status}
              </span>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="auto-modal-body">
          {loading && <div className="auto-runs-loading">Loading...</div>}

          {error && !loading && (
            <div className="auto-run-detail-error">
              <Icon name="warning" size={14} />
              {error}
            </div>
          )}

          {run && !loading && (
            <>
              {/* Error banner */}
              {run.error && (
                <div className="auto-run-detail-error">
                  <Icon name="x" size={14} />
                  {run.error}
                </div>
              )}

              {/* Metadata */}
              <div className="auto-run-detail-meta">
                <div className="auto-run-detail-meta-item">
                  <span className="auto-run-detail-meta-label">Trigger</span>
                  <span className="auto-run-detail-meta-value">{run.trigger}</span>
                </div>
                <div className="auto-run-detail-meta-item">
                  <span className="auto-run-detail-meta-label">Started</span>
                  <span className="auto-run-detail-meta-value">
                    {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
                  </span>
                </div>
                <div className="auto-run-detail-meta-item">
                  <span className="auto-run-detail-meta-label">Completed</span>
                  <span className="auto-run-detail-meta-value">
                    {run.completed_at ? new Date(run.completed_at).toLocaleString() : '—'}
                  </span>
                </div>
                <div className="auto-run-detail-meta-item">
                  <span className="auto-run-detail-meta-label">Duration</span>
                  <span className="auto-run-detail-meta-value">{formatDuration(run.duration_ms)}</span>
                </div>
                {run.scheduled_for && (
                  <div className="auto-run-detail-meta-item">
                    <span className="auto-run-detail-meta-label">Scheduled for</span>
                    <span className="auto-run-detail-meta-value">
                      {new Date(run.scheduled_for).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Steps timeline */}
              {run.steps && run.steps.length > 0 && (
                <div className="auto-run-detail-section">
                  <div className="auto-run-detail-section-label">Steps</div>
                  <div className="auto-run-detail-steps">
                    {run.steps.map((step, idx) => (
                      <div key={idx} className={`auto-run-detail-step ${step.ok ? 'is-ok' : 'is-fail'}`}>
                        <div className="auto-run-detail-step-icon">
                          <Icon name={step.ok ? 'check' : 'x'} size={12} />
                        </div>
                        <div className="auto-run-detail-step-info">
                          <span className="auto-run-detail-step-name">
                            <Icon name={stepIcon(step)} size={12} />
                            {step.name || step.kind}
                          </span>
                          {step.detail && (
                            <span className="auto-run-detail-step-detail">{step.detail}</span>
                          )}
                        </div>
                        {step.duration_ms != null && (
                          <span className="auto-run-detail-step-duration">
                            {formatDuration(step.duration_ms)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Result */}
              {run.result && (
                <div className="auto-run-detail-section">
                  <div className="auto-run-detail-section-label">Result</div>
                  <pre className="auto-run-detail-result">{run.result}</pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
