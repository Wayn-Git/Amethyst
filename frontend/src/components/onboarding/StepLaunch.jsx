import React from 'react'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import AiProviderIcon from '../AiProviderIcon.jsx'
import BrandIcon from './BrandIcon.jsx'
import { getClientOS, getDisclaimerText } from './clientOS.js'
import { useApp } from '../../store.jsx'

export default function StepLaunch({ onFinish, onBack }) {
  const { accentColor, userProfile, theme } = useApp()
  const osName = getClientOS()

  const displayName = userProfile?.name || 'there'
  const handle = userProfile?.handle || '@user'

  return (
    <div className="onb-card">
      {/* Left Pitch Pane */}
      <div className="onb-pane-left">
        <AmethystLogo size={28} color="#ffffff" />
        <p className="onb-eyebrow">Step 5 of 5 · Launch</p>
        <h1 className="onb-title">You’re all set, {displayName}.</h1>
        <p className="onb-desc">
          Amethyst is ready. {getDisclaimerText(osName)}
        </p>

        <div style={{ marginTop: 'auto' }}>
          <div className="onb-nav-row">
            <button type="button" className="onb-btn-secondary" onClick={onBack}>
              Back
            </button>
            <button
              type="button"
              className="onb-btn-primary"
              style={{ background: accentColor || '#7132f5' }}
              onClick={onFinish}
            >
              <span>Open Amethyst</span>
              <Icon name="arrow-right" size={14} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      {/* Ticket Perforation Divider */}
      <div className="onb-perforation" aria-hidden="true" />

      {/* Right Summary Content Pane */}
      <div className="onb-pane-right">
        <p className="onb-section-header">Your setup</p>

        <div className="onb-group" style={{ marginBottom: 12 }}>
          {/* Profile */}
          <div className="onb-row">
            <div className="onb-row-icon">
              <Icon name="user" size={18} />
            </div>
            <div className="onb-row-meta">
              Profile
              <span>{displayName} · {handle} ({theme || 'system'})</span>
            </div>
            <span className="onb-tag" style={{ color: '#34d399' }}>
              <Icon name="check" size={14} />
            </span>
          </div>

          {/* AI engine */}
          <div className="onb-row">
            <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
              <AiProviderIcon provider="ollama" size={18} />
            </div>
            <div className="onb-row-meta">
              AI engine
              <span>Local Ollama · Free Cloud Providers</span>
            </div>
            <span className="onb-tag" style={{ color: '#34d399' }}>
              <Icon name="check" size={14} />
            </span>
          </div>

          {/* Storage */}
          <div className="onb-row">
            <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
              <BrandIcon name="googledrive" size={18} />
            </div>
            <div className="onb-row-meta">
              Storage
              <span>Composio · Google Drive Vault</span>
            </div>
            <span className="onb-tag" style={{ color: '#34d399' }}>
              <Icon name="check" size={14} />
            </span>
          </div>

          {/* Apps */}
          <div className="onb-row">
            <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
              <BrandIcon name="gmail" size={18} />
            </div>
            <div className="onb-row-meta">
              Apps
              <span>Gmail, Google Calendar &amp; Toolkits</span>
            </div>
            <span className="onb-tag" style={{ color: '#34d399' }}>
              <Icon name="check" size={14} />
            </span>
          </div>

          {/* Mobile */}
          <div className="onb-row">
            <div className="onb-row-icon">
              <Icon name="device-mobile" size={18} />
            </div>
            <div className="onb-row-meta">
              Mobile
              <span>Pair later from Settings</span>
            </div>
            <span className="onb-tag" style={{ color: '#34d399' }}>
              <Icon name="check" size={14} />
            </span>
          </div>
        </div>

        <p style={{ fontSize: 12, color: '#9ea3c4', margin: '8px 4px 0', lineHeight: 1.45 }}>
          You can change any of this later in Settings.
        </p>
      </div>
    </div>
  )
}

