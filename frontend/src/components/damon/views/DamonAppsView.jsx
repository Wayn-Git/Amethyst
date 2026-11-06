import React, { useState } from 'react'
import Icon from '../../Icon.jsx'

export default function DamonAppsView({
  apps = [],
  query = '',
  selectedIndex = 0,
  onSelectApp,
  onLaunchApp,
}) {
  const [filterCat, setFilterCat] = useState('all')
  const [iconErrors, setIconErrors] = useState({})

  const cleanQ = query.toLowerCase().trim()

  const filteredApps = apps.filter((app) => {
    if (filterCat !== 'all') {
      const cats = (app.preview_data?.categories || []).map((c) => c.toLowerCase())
      if (!cats.some((c) => c.includes(filterCat))) return false
    }
    if (cleanQ) {
      const name = (app.title || app.name || '').toLowerCase()
      const desc = (app.subtitle || app.generic_name || app.comment || '').toLowerCase()
      return name.includes(cleanQ) || desc.includes(cleanQ)
    }
    return true
  })

  const current = filteredApps[selectedIndex] || filteredApps[0] || null

  const getIconUrl = (app) => {
    if (!app) return null
    if (iconErrors[app.id]) return null
    const iconName = app.icon || app.preview_data?.icon
    if (iconName && iconName !== 'app' && iconName !== 'search') {
      return `/api/launcher/icon?name=${encodeURIComponent(iconName)}`
    }
    return null
  }

  return (
    <div className="damon-apps-split-root">
      {/* 1. Category Bar */}
      <div className="damon-chips-bar">
        <span>Categories</span>
        {[
          { id: 'all', label: 'All Apps' },
          { id: 'development', label: 'Development' },
          { id: 'network', label: 'Internet' },
          { id: 'utility', label: 'Utilities' },
          { id: 'system', label: 'System' },
        ].map((c) => (
          <button
            key={c.id}
            type="button"
            className={`damon-filter-chip${filterCat === c.id ? ' is-active' : ''}`}
            onClick={() => setFilterCat(c.id)}
          >
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      {/* 2. Split Layout */}
      <div className="damon-split-layout">
        {/* Left: Apps List */}
        <div className="damon-split-left">
          {filteredApps.length === 0 ? (
            <div className="damon-empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
              <Icon name="app" size={28} />
              <p style={{ marginTop: 10, color: 'var(--damon-text-muted)' }}>
                {cleanQ ? `No application found for “${query}”` : 'No applications found.'}
              </p>
            </div>
          ) : (
            <div className="damon-list-container">
              {filteredApps.map((app, i) => {
                const isSelected = current?.id === app.id || i === selectedIndex
                const iconUrl = getIconUrl(app)
                const isAmethyst = app.title?.toLowerCase() === 'amethyst' || app.icon === 'amethyst' || app.icon === 'diamond'

                return (
                  <button
                    key={app.id || `app-${i}`}
                    type="button"
                    className={`damon-row${isSelected ? ' is-selected' : ''}`}
                    onClick={() => {
                      onSelectApp(app)
                      onLaunchApp(app)
                    }}
                  >
                    <div
                      className="damon-row-icon-wrap"
                      style={isAmethyst ? { background: '#7132f5', color: '#ffffff' } : undefined}
                    >
                      {isAmethyst ? (
                        <Icon name="diamond" size={18} />
                      ) : iconUrl ? (
                        <img
                          src={iconUrl}
                          alt=""
                          className="damon-row-img-icon"
                          onError={() => setIconErrors((prev) => ({ ...prev, [app.id]: true }))}
                        />
                      ) : (
                        <Icon name="app" size={18} />
                      )}
                    </div>

                    <div className="damon-row-main">
                      <div className="damon-row-title">{app.title || app.name}</div>
                      <div className="damon-row-subtitle">
                        {app.subtitle || app.generic_name || 'Application'}
                      </div>
                    </div>

                    <div className="damon-row-trailing">
                      {isSelected ? (
                        <span className="damon-row-shortcut">↵</span>
                      ) : (
                        <Icon name="arrow-up-right" size={15} />
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: App Preview Pane */}
        <div className="damon-split-right">
          {current ? (
            <div className="damon-app-preview-detail">
              <div className="damon-app-preview-hero">
                <div
                  className="damon-app-preview-hero-icon"
                  style={
                    current.title?.toLowerCase() === 'amethyst'
                      ? { background: '#7132f5', color: '#ffffff' }
                      : undefined
                  }
                >
                  {current.title?.toLowerCase() === 'amethyst' ? (
                    <Icon name="diamond" size={40} />
                  ) : getIconUrl(current) ? (
                    <img src={getIconUrl(current)} alt="" className="damon-app-hero-img" />
                  ) : (
                    <Icon name="app" size={36} />
                  )}
                </div>

                <div className="damon-app-hero-info">
                  <h3 className="damon-app-hero-title">{current.title || current.name}</h3>
                  <span className="damon-app-hero-sub">
                    {current.generic_name || current.preview_data?.generic_name || 'Desktop Application'}
                  </span>
                </div>
              </div>

              {/* Details card */}
              <div className="damon-preview-content-card">
                <div className="damon-app-meta-field">
                  <span className="damon-app-meta-label">Command:</span>
                  <code className="damon-app-meta-code">
                    {current.preview_data?.exec || current.clean_exec || current.title}
                  </code>
                </div>
                {current.preview_data?.path && (
                  <div className="damon-app-meta-field">
                    <span className="damon-app-meta-label">Entry:</span>
                    <span className="damon-app-meta-val">{current.preview_data.path}</span>
                  </div>
                )}
                {current.preview_data?.comment && (
                  <div className="damon-app-meta-field" style={{ marginTop: 8 }}>
                    <span className="damon-app-meta-label">About:</span>
                    <span className="damon-app-meta-val">{current.preview_data.comment}</span>
                  </div>
                )}
              </div>

              {/* Action */}
              <div className="damon-preview-actions">
                <button
                  type="button"
                  className="damon-btn-primary"
                  onClick={() => onLaunchApp(current)}
                >
                  <span>Launch Application</span>
                  <Icon name="arrow-up-right" size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div style={{ color: 'var(--damon-text-muted)', fontSize: 13, padding: 20 }}>
              Select an application to view details.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

