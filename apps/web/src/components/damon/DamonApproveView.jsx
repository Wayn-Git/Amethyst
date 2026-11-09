import React from 'react'
import Icon from '../Icon.jsx'

export default function DamonApproveView({
  confirmation,
  onAllowOnce,
  onAlwaysAllow,
  onDeny,
}) {
  const title = confirmation?.title || 'Create 3 drafts in Gmail'
  const desc =
    confirmation?.description || 'Nothing gets sent. You review each draft first.'
  const items = confirmation?.items || [
    { title: 'Re: Invoice follow-up', subtitle: 'Riya Sharma' },
    { title: 'Re: Intro call Thursday', subtitle: 'Kabir Nair' },
    { title: 'Re: Project handoff notes', subtitle: 'Aman Iyer' },
  ]
  const steps = confirmation?.steps || [
    { label: 'Read 8 unread messages', badge: 'read-only' },
    { label: 'Waiting for your approval', pending: true },
  ]

  return (
    <div className="damon-approval-view">
      {/* 1. Header */}
      <div className="damon-agent-header">
        <div className="damon-agent-avatar">
          <Icon name="diamond" size={16} />
        </div>
        <div>
          <div className="damon-agent-title">Amethyst</div>
          <div className="damon-agent-sub">Needs your approval</div>
        </div>
      </div>

      {/* 2. Stepper */}
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

      {/* 3. Approval Card */}
      <div className="damon-approval-card">
        <div className="damon-approval-lead">
          <div className="damon-shield-icon-box">
            <Icon name="shield-check" size={20} />
          </div>
          <div>
            <div className="damon-approval-title">{title}</div>
            <div className="damon-approval-desc">{desc}</div>
          </div>
        </div>

        {/* Draft/action items */}
        {items.length > 0 && (
          <div className="damon-approval-items">
            {items.map((item, idx) => (
              <div key={idx} className="damon-approval-item-row">
                <div className="damon-approval-item-left">
                  <Icon name="envelope" size={16} style={{ color: 'rgb(91, 95, 104)' }} />
                  <span>{item.title}</span>
                </div>
                <div className="damon-approval-item-right">{item.subtitle}</div>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="damon-approval-actions">
          <button
            type="button"
            className="damon-btn-primary"
            onClick={onAllowOnce}
          >
            <span>Allow once</span>
            <Icon name="arrow-up-right" size={14} />
          </button>
          <button
            type="button"
            className="damon-btn-secondary"
            onClick={onAlwaysAllow}
          >
            Always allow drafts
          </button>
          <button
            type="button"
            className="damon-btn-deny"
            onClick={onDeny}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}
