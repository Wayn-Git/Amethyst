import React from 'react'
import Icon from '../../components/Icon.jsx'

/**
 * Standard Library Detail Row Component
 * Spec:
 * - min-height: 44px
 * - 32px leading icon / thumbnail with radius 6
 * - Title: 13px, medium (font-weight: 500)
 * - Subtitle: 12px, muted
 * - Trailing actions
 * - Plain row with hairline divider (no card-in-card wrapping)
 */
export default function LibraryDetailRow({
  icon,
  thumbnail,
  title,
  subtitle,
  isVideo = false,
  actions = null,
  onClick = null,
  className = '',
  titleFallback = 'Untitled save',
}) {
  // Strip emoji-only titles and clean title
  const cleanTitle = React.useMemo(() => {
    if (!title) return titleFallback
    const str = String(title).trim()
    // Strip pure emoji string if no alphanumeric characters
    const hasAlphaNumeric = /[\p{L}\p{N}]/u.test(str)
    if (!hasAlphaNumeric) return subtitle || titleFallback
    return str
  }, [title, subtitle, titleFallback])

  const isClickable = Boolean(onClick)

  return (
    <div
      className={`lib-detail-row ${isClickable ? 'lib-detail-row--clickable' : ''} ${className}`}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <div className="lib-detail-row-main">
        {/* Leading 32x32 Thumbnail / Icon */}
        <div className="lib-detail-row-media">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              className="lib-detail-row-thumb"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
                if (e.currentTarget.nextElementSibling) {
                  e.currentTarget.nextElementSibling.style.display = 'flex'
                }
              }}
            />
          ) : null}

          <div
            className="lib-detail-row-icon-fallback"
            style={{ display: thumbnail ? 'none' : 'flex' }}
          >
            {icon || <Icon name="link" size={14} />}
          </div>

          {/* Consistent small video play badge in same corner */}
          {isVideo && (
            <span className="lib-detail-row-video-badge" aria-label="Video">
              <Icon name="play" size={8} />
            </span>
          )}
        </div>

        {/* Content text */}
        <div className="lib-detail-row-text">
          <span className="lib-detail-row-title" title={cleanTitle}>
            {cleanTitle}
          </span>
          {subtitle && (
            <span className="lib-detail-row-subtitle" title={subtitle}>
              {subtitle}
            </span>
          )}
        </div>
      </div>

      {/* Trailing Actions */}
      {actions && (
        <div
          className="lib-detail-row-actions"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
