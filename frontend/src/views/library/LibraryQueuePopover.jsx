import React, { useRef, useEffect } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function LibraryQueuePopover({
  items = [],
  currentIndex = 0,
  onNavigate,
  onClose,
}) {
  const popoverRef = useRef(null)

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose?.()
      }
    }
    window.addEventListener('mousedown', handleOutsideClick, true)
    return () => window.removeEventListener('mousedown', handleOutsideClick, true)
  }, [onClose])

  if (!items || items.length === 0) return null

  // Slice a window around currentIndex (up to 7 items)
  const windowRadius = 3
  const start = Math.max(0, currentIndex - windowRadius)
  const end = Math.min(items.length, currentIndex + windowRadius + 1)
  const neighborItems = items.slice(start, end).map((it, idx) => ({
    item: it,
    originalIndex: start + idx,
  }))

  return (
    <div className="lib-queue-popover" ref={popoverRef} role="dialog" aria-label="Library Queue">
      <div className="lib-queue-header">
        <span className="lib-queue-title">Queue</span>
        <span className="lib-queue-count">
          Item {currentIndex + 1} of {items.length}
        </span>
      </div>

      <div className="lib-queue-list">
        {neighborItems.map(({ item, originalIndex }) => {
          const isCurrent = originalIndex === currentIndex
          const thumbUrl = api.thumbnailUrl ? api.thumbnailUrl(item.id) : null

          return (
            <button
              key={item.id}
              type="button"
              className={`lib-queue-row ${isCurrent ? 'lib-queue-row--current' : ''}`}
              onClick={() => {
                onNavigate?.(item)
                onClose?.()
              }}
            >
              <div className="lib-queue-row-index">{originalIndex + 1}</div>

              <div className="lib-queue-row-thumb">
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt=""
                    className="lib-queue-img"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                ) : null}
                <div className="lib-queue-placeholder">
                  <Icon name={item.kind === 'video' ? 'play' : 'link'} size={11} />
                </div>
              </div>

              <div className="lib-queue-row-info">
                <span className="lib-queue-row-title" title={item.title}>
                  {item.title}
                </span>
                <span className="lib-queue-row-sub">
                  {item.author || item.site || item.app || 'Library item'}
                </span>
              </div>

              {isCurrent && (
                <div className="lib-queue-current-indicator">
                  <span className="lib-dash-indicator" />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
