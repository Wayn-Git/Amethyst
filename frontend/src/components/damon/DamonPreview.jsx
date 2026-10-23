import React from 'react'
import Icon from '../Icon.jsx'
import Button from '../ui/AppButton.jsx'

export default function DamonPreview({ item, onAction }) {
  if (!item) {
    return null
  }

  const {
    preview_type,
    preview_data = {},
    title = item.label || 'Action',
    subtitle = item.hint || '',
    icon = item.icon || 'play',
    actions = [],
  } = item
  const primaryAction = actions.find((a) => a.is_primary) || actions[0]

  if (preview_type === 'app_info') {
    return (
      <div className="damon-preview-content damon-preview-app">
        <div className="damon-preview-app-header">
          <div className="damon-preview-app-icon-wrap">
            <Icon name={icon || 'cpu'} className="damon-preview-app-icon" />
          </div>
          <div className="damon-preview-app-titles">
            <h3 className="damon-preview-app-name">{title}</h3>
            {subtitle && <p className="damon-preview-app-subtitle">{subtitle}</p>}
          </div>
        </div>

        <div className="damon-preview-meta-list">
          {preview_data.exec && (
            <div className="damon-preview-meta-row">
              <span className="damon-preview-meta-label">Command</span>
              <code className="damon-preview-meta-val">{preview_data.exec}</code>
            </div>
          )}
          {preview_data.path && (
            <div className="damon-preview-meta-row">
              <span className="damon-preview-meta-label">Path</span>
              <code className="damon-preview-meta-val">{preview_data.path}</code>
            </div>
          )}
          {preview_data.categories && preview_data.categories.length > 0 && (
            <div className="damon-preview-meta-row">
              <span className="damon-preview-meta-label">Categories</span>
              <div className="damon-preview-tags">
                {preview_data.categories.slice(0, 4).map((cat) => (
                  <span key={cat} className="damon-preview-tag">{cat}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {primaryAction && (
          <div className="damon-preview-actions-bar">
            <Button
              className="damon-preview-primary-btn"
              onClick={() => onAction && onAction(primaryAction)}
            >
              <Icon name="play" />
              <span>{primaryAction.title}</span>
              <kbd className="damon-preview-kbd">↵</kbd>
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (preview_type === 'markdown') {
    const textContent = preview_data.excerpt || preview_data.markdown || 'No description available.'
    return (
      <div className="damon-preview-content damon-preview-reader">
        <div className="damon-preview-reader-header">
          <div className="damon-preview-reader-badge">
            <Icon name={icon || 'book'} />
            <span>{preview_data.kind || item.badge || 'Item'}</span>
          </div>
          <h3 className="damon-preview-reader-title">{title}</h3>
          {preview_data.site && (
            <span className="damon-preview-reader-site">{preview_data.site}</span>
          )}
        </div>

        <div className="damon-preview-reader-body">
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.5', fontSize: '13px' }}>
            {textContent}
          </div>
        </div>

        {actions.length > 0 && (
          <div className="damon-preview-actions-bar">
            {primaryAction && (
              <Button
                className="damon-preview-primary-btn"
                onClick={() => onAction && onAction(primaryAction)}
              >
                <Icon name="arrow-up-right" />
                <span>{primaryAction.title}</span>
                <kbd className="damon-preview-kbd">↵</kbd>
              </Button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Default preview for navigation commands or standard launcher actions
  return (
    <div className="damon-preview-content damon-preview-app">
      <div className="damon-preview-app-header">
        <div className="damon-preview-app-icon-wrap">
          <Icon name={icon} className="damon-preview-app-icon" size={24} />
        </div>
        <div className="damon-preview-app-titles">
          <h3 className="damon-preview-app-name">{title}</h3>
          {subtitle && <p className="damon-preview-app-subtitle">{subtitle}</p>}
        </div>
      </div>

      <div className="damon-preview-meta-list">
        <div className="damon-preview-meta-row">
          <span className="damon-preview-meta-label">Category</span>
          <span className="damon-preview-tag">{item.badge || item.group || 'Action'}</span>
        </div>
        {item.binding && (
          <div className="damon-preview-meta-row">
            <span className="damon-preview-meta-label">Shortcut</span>
            <code className="damon-preview-meta-val">{item.binding}</code>
          </div>
        )}
      </div>

      <div className="damon-preview-actions-bar">
        <Button
          className="damon-preview-primary-btn"
          onClick={() => {
            if (item.run) item.run()
            else if (onAction && primaryAction) onAction(primaryAction)
          }}
        >
          <Icon name="play" size={13} />
          <span>Execute</span>
          <kbd className="damon-preview-kbd">↵</kbd>
        </Button>
      </div>
    </div>
  )
}
