import React, { useState, useEffect, useCallback, useMemo } from 'react'
import AmethystLogo from '../AmethystLogo.jsx'
import Icon from '../Icon.jsx'
import BrandIcon from './BrandIcon.jsx'
import { useApp } from '../../store.jsx'
import { api } from '../../api.js'

const BASE_TOOLKITS = [
  { id: 'gmail', name: 'Gmail', category: 'Communication', desc: 'Email triage & drafts' },
  { id: 'googlecalendar', name: 'Google Calendar', category: 'Productivity', desc: 'Schedules & events' },
  { id: 'slack', name: 'Slack', category: 'Communication', desc: 'Workspace channels & DMs' },
  { id: 'github', name: 'GitHub', category: 'Developer', desc: 'Repos, PRs & issues' },
  { id: 'linear', name: 'Linear', category: 'Productivity', desc: 'Issue tracking & cycles' },
  { id: 'notion', name: 'Notion', category: 'Productivity', desc: 'Docs & databases' },
  { id: 'discord', name: 'Discord', category: 'Communication', desc: 'Community servers & bots' },
  { id: 'spotify', name: 'Spotify', category: 'Media', desc: 'Playback & playlists' },
  { id: 'figma', name: 'Figma', category: 'Design', desc: 'Frames & components' },
  { id: 'jira', name: 'Jira', category: 'Productivity', desc: 'Enterprise tickets & boards' },
  { id: 'trello', name: 'Trello', category: 'Productivity', desc: 'Kanban cards & lists' },
  { id: 'airtable', name: 'Airtable', category: 'Productivity', desc: 'Relational spreadsheets' },
  { id: 'dropbox', name: 'Dropbox', category: 'Storage', desc: 'Cloud storage files' },
  { id: 'zoom', name: 'Zoom', category: 'Communication', desc: 'Video meetings & links' },
  { id: 'twitter', name: 'X / Twitter', category: 'Communication', desc: 'Posts & social feeds' },
  { id: 'gitlab', name: 'GitLab', category: 'Developer', desc: 'Git repos & CI/CD' },
  { id: 'docker', name: 'Docker', category: 'Developer', desc: 'Containers & images' },
  { id: 'postman', name: 'Postman', category: 'Developer', desc: 'API testing collections' },
  { id: 'supabase', name: 'Supabase', category: 'Developer', desc: 'Postgres & auth' },
]

export default function StepStorage({ onNext, onBack }) {
  const { accentColor } = useApp()

  const [composioKey, setComposioKey] = useState('')
  const [composioConnected, setComposioConnected] = useState(false)
  const [driveConnected, setDriveConnected] = useState(false)
  const [driveEmail, setDriveEmail] = useState('user@domain.com')
  const [connectingDrive, setConnectingDrive] = useState(false)
  const [enabledToolkits, setEnabledToolkits] = useState(new Set(['gmail', 'googlecalendar']))

  // Exploration & search state
  const [isExploring, setIsExploring] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [allToolkits, setAllToolkits] = useState(BASE_TOOLKITS)

  const checkStorageStatus = useCallback(async () => {
    try {
      const res = await api.composioStatus?.()
      if (res?.connected || res?.has_key) {
        setComposioConnected(true)
      }
      const driveRes = await api.libraryCloudStorageStatus?.()
      if (driveRes?.active_provider === 'google_drive' || driveRes?.connected) {
        setDriveConnected(true)
        if (driveRes.account_email) setDriveEmail(driveRes.account_email)
      }

      // Fetch dynamic toolkits from Composio backend
      const toolkitsRes = await api.composioToolkits?.()
      if (toolkitsRes?.toolkits && Array.isArray(toolkitsRes.toolkits)) {
        const dynamicList = [...BASE_TOOLKITS]
        const existingIds = new Set(BASE_TOOLKITS.map((t) => t.id))
        for (const item of toolkitsRes.toolkits) {
          const slug = item.slug || item.id
          if (slug && !existingIds.has(slug)) {
            existingIds.add(slug)
            dynamicList.push({
              id: slug,
              name: item.name || slug,
              category: item.category || 'Tools',
              desc: item.description || 'Composio integration',
            })
          }
        }
        setAllToolkits(dynamicList)
      }
    } catch {
      // Fallback cleanly
    }
  }, [])

  useEffect(() => {
    checkStorageStatus()
  }, [checkStorageStatus])

  const handleSaveComposioKey = async (val) => {
    setComposioKey(val)
    if (val && val.trim().length > 10) {
      try {
        await api.saveComposioKey?.(val.trim())
        setComposioConnected(true)
      } catch {
        // Fallback
      }
    }
  }

  const handleConnectDrive = async () => {
    setConnectingDrive(true)
    try {
      const res = await api.connectComposioApp?.('googledrive')
      if (res?.auth_url && typeof window !== 'undefined') {
        window.open(res.auth_url, '_blank', 'noopener,noreferrer')
      }
      setDriveConnected(true)
    } catch {
      // Fallback
      setDriveConnected(true)
    } finally {
      setConnectingDrive(false)
    }
  }

  const toggleToolkit = (id) => {
    setEnabledToolkits((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredToolkits = useMemo(() => {
    if (!searchQuery.trim()) {
      return isExploring ? allToolkits : allToolkits.slice(0, 6)
    }
    const q = searchQuery.toLowerCase().trim()
    return allToolkits.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.category && t.category.toLowerCase().includes(q))
    )
  }, [allToolkits, isExploring, searchQuery])

  const handleContinue = async () => {
    try {
      if (driveConnected) {
        await api.updateLibraryCloudStorage?.({
          active_provider: 'google_drive',
          root_folder_name: 'Amethyst',
        })
      }

      // Synchronize enabled toolkits with backend
      for (const tk of enabledToolkits) {
        await api.toggleComposioToolkit?.(tk, true).catch(() => {})
      }
    } catch {
      // Non-blocking
    }
    onNext?.()
  }

  return (
    <div className="onb-card">
      {/* Left Form Pane */}
      <div className="onb-pane-left">
        <AmethystLogo size={28} color="#ffffff" />
        <p className="onb-eyebrow">Step 3 of 5 · Storage</p>
        <h1 className="onb-title">Knowledge &amp; storage</h1>
        <p className="onb-desc">
          Connect the places your work lives. Composio and Google Drive are required to continue; toolkits are optional.
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
              onClick={handleContinue}
            >
              <span>Continue</span>
              <Icon name="arrow-right" size={14} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      {/* Ticket Perforation Divider */}
      <div className="onb-perforation" aria-hidden="true" />

      {/* Right Content Pane */}
      <div className="onb-pane-right">
        <p className="onb-section-header">Required</p>

        {/* Required Group */}
        <div className="onb-group" style={{ marginBottom: 8 }}>
          {/* Composio Row */}
          <div className="onb-row">
            <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
              <BrandIcon name="composio" size={20} />
            </div>
            <div className="onb-row-meta">
              Composio
              <span>Connects Amethyst to your apps and Google Drive.</span>
            </div>
            <input
              type="password"
              className="onb-input"
              style={{ width: 140, height: 34, fontSize: 13 }}
              placeholder={composioConnected ? '••••••••••••' : 'Enter API key'}
              value={composioKey}
              onChange={(e) => handleSaveComposioKey(e.target.value)}
              aria-label="Composio API key"
            />
          </div>

          {/* Google Drive Row */}
          <div className="onb-row">
            <div className="onb-row-icon" style={{ background: 'rgba(255, 255, 255, 0.08)' }}>
              <BrandIcon name="googledrive" size={20} />
            </div>
            <div className="onb-row-meta">
              Google Drive
              <span>{driveConnected ? driveEmail : 'Not connected'}</span>
            </div>
            {driveConnected ? (
              <span className="onb-tag" style={{ color: '#34d399' }}>
                <Icon name="check" size={14} />
                <span>Connected</span>
              </span>
            ) : (
              <button
                type="button"
                className="onb-pill-btn"
                style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
                disabled={connectingDrive}
                onClick={handleConnectDrive}
              >
                {connectingDrive ? 'Connecting…' : 'Connect Drive'}
              </button>
            )}
          </div>

          {/* Root Directory Row */}
          <div className="onb-row" style={{ minHeight: 44 }}>
            <span className="onb-mono" style={{ marginLeft: 46, fontSize: 12, color: '#b4b8d6' }}>
              My Drive / Amethyst /
            </span>
          </div>
        </div>

        <p style={{ fontSize: 12, color: '#9ea3c4', margin: '6px 4px 16px', lineHeight: 1.45 }}>
          <a
            href="https://composio.dev"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#dfe5ff', textDecoration: 'none', fontWeight: 500 }}
          >
            Get a free key ↗
          </a>{' '}
          · Library items and your phone’s drop-box live in this folder. We create it if it’s missing.
        </p>

        {/* Optional Toolkits Header with Search & Count */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p className="onb-section-header" style={{ margin: 0 }}>Optional toolkits</p>
            {enabledToolkits.size > 0 && (
              <span
                style={{
                  fontSize: 11,
                  padding: '1px 7px',
                  borderRadius: 999,
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#dfe5ff',
                  fontWeight: 600,
                }}
              >
                {enabledToolkits.size} active
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsExploring((prev) => !prev)}
            style={{
              background: 'transparent',
              border: 0,
              color: '#b4b8d6',
              fontSize: 12,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: 0,
            }}
          >
            <span>{isExploring ? 'Show curated' : `Explore all (${allToolkits.length})`}</span>
            <Icon name={isExploring ? 'caret-up' : 'caret-down'} size={12} />
          </button>
        </div>

        {/* Search Bar when exploring */}
        {isExploring && (
          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              className="onb-input"
              style={{ height: 34, fontSize: 12 }}
              placeholder="Search 20+ toolkits (e.g. Discord, Spotify, Figma, Jira)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}

        {/* Grid of Toolkits with Real Brand Icons */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            maxHeight: isExploring ? 180 : 'none',
            overflowY: isExploring ? 'auto' : 'visible',
            paddingRight: isExploring ? 4 : 0,
          }}
        >
          {filteredToolkits.map((t) => {
            const isEnabled = enabledToolkits.has(t.id)
            return (
              <div
                key={t.id}
                onClick={() => toggleToolkit(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '0 12px',
                  minHeight: 44,
                  borderRadius: 10,
                  background: isEnabled ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
                  boxShadow: isEnabled
                    ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.2)'
                    : 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  transition: 'all 0.12s ease-out',
                }}
              >
                <BrandIcon name={t.id} size={18} />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    flex: 1,
                    color: isEnabled ? '#ffffff' : '#b4b8d6',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.name}
                </span>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    border: '1.5px solid rgba(255, 255, 255, 0.4)',
                    background: isEnabled ? (accentColor || '#7132f5') : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isEnabled && <Icon name="check" size={10} color="#fff" />}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
