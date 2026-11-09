import React from 'react'
import Icon from '../Icon.jsx'

export default function DamonAskView({
  steps = [],
  answerText = '',
  streaming = false,
  sources = [],
  followups = ['Show an example', 'Save to Library'],
  onSelectSource,
  onFollowup,
}) {
  return (
    <div className="damon-ask-view">
      {/* 1. Amethyst Agent Header */}
      <div className="damon-agent-header">
        <div className="damon-agent-avatar">
          <Icon name="diamond" size={16} />
        </div>
        <div>
          <div className="damon-agent-title">Amethyst</div>
          <div className="damon-agent-sub">Answer from the web and your Library</div>
        </div>
      </div>

      {/* 2. Reasoning / Execution Stepper */}
      {steps.length > 0 && (
        <div className="damon-stepper">
          {steps.map((step, i) => (
            <div key={i} className="damon-step-item">
              <div
                className={`damon-step-dot${step.pending ? ' damon-step-dot--pending' : ''}`}
              />
              <span>{step.label}</span>
              {step.badge && <span className="damon-step-badge">{step.badge}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 3. Streamed Answer Text */}
      <div className="damon-answer-stream">
        {answerText || (streaming ? 'Thinking...' : '')}
        {streaming && <span className="damon-cursor" />}
      </div>

      {/* 4. Sources Section */}
      {sources.length > 0 && (
        <div className="damon-section-group" style={{ marginTop: 10 }}>
          <div className="damon-section-header" style={{ padding: '0 0 10px 0' }}>
            <div className="damon-section-title-wrap">
              <span>Sources</span>
              <span className="damon-section-count">{sources.length}</span>
            </div>
          </div>

          <div className="damon-cards-grid" style={{ padding: '0 0 10px 0' }}>
            {sources.map((s, i) => {
              const kind = (s.kind || 'note').toLowerCase()
              const tagClass =
                kind === 'reel' ? 'damon-tag--reel' : kind === 'doc' ? 'damon-tag--doc' : 'damon-tag--note'
              const iconName = kind === 'reel' ? 'play' : kind === 'doc' ? 'globe' : 'document'

              return (
                <button
                  key={s.id || `src-${i}`}
                  type="button"
                  className="damon-card-item"
                  onClick={() => onSelectSource?.(s)}
                >
                  <div className="damon-card-header">
                    <div className="damon-card-icon-box">
                      <Icon name={iconName} size={15} />
                    </div>
                    <span className="damon-card-title">{s.title}</span>
                  </div>
                  <div className="damon-card-footer">
                    <span className={`damon-tag ${tagClass}`}>{s.badge || 'Library'}</span>
                    <span>{s.domain || 'Library'}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 5. Follow-up Action Chips */}
      {followups.length > 0 && (
        <div className="damon-followup-chips">
          {followups.map((f, i) => (
            <button
              key={i}
              type="button"
              className="damon-followup-chip"
              onClick={() => onFollowup(f)}
            >
              <Icon name="spark" size={13} style={{ color: '#2563eb' }} />
              <span>{f}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
