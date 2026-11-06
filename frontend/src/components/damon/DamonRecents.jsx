import React from 'react'
import Icon from '../Icon.jsx'

export default function DamonRecents({
  recents = [],
  continueItems = [],
  onSelectRecent,
  onClearRecents,
  onOpenContinueItem,
  selectedIndex,
  startIndex = 0,
}) {
  return (
    <div className="damon-recents-view">
      {/* 1. Recent Searches Section */}
      {recents.length > 0 && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Recent searches</span>
              <span className="damon-section-count">{recents.length}</span>
            </div>
            <button
              type="button"
              className="damon-section-action damon-section-action--clear"
              onClick={onClearRecents}
            >
              Clear all
            </button>
          </div>

          <div className="damon-list-container">
            {recents.map((item, idx) => {
              const globalIdx = startIndex + idx
              const isSelected = selectedIndex === globalIdx
              const queryText = typeof item === 'string' ? item : item.query || item.title

              return (
                <button
                  key={`recent-${idx}`}
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectRecent(queryText)}
                  data-selected={isSelected || undefined}
                >
                  <div className="damon-row-icon-wrap">
                    <Icon name="clock" size={18} />
                  </div>
                  <div className="damon-row-main">
                    <div className="damon-row-title">{queryText}</div>
                  </div>
                  <div className="damon-row-trailing">
                    {isSelected ? (
                      <span className="damon-row-shortcut">↵</span>
                    ) : (
                      <Icon name="arrow-up-right" size={16} />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 2. Continue Where You Left Off */}
      {continueItems.length > 0 && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Continue where you left off</span>
            </div>
          </div>

          <div className="damon-cards-grid">
            {continueItems.slice(0, 4).map((item, idx) => {
              const kind = (item.kind || item.type || 'note').toLowerCase()
              const tagClass =
                kind === 'reel' || kind === 'video'
                  ? 'damon-tag--reel'
                  : kind === 'doc' || kind === 'article'
                  ? 'damon-tag--doc'
                  : kind === 'processing'
                  ? 'damon-tag--processing'
                  : 'damon-tag--note'

              const tagLabel =
                kind === 'reel' || kind === 'video'
                  ? 'Reel'
                  : kind === 'doc' || kind === 'article'
                  ? 'Doc'
                  : kind === 'processing'
                  ? 'Processing'
                  : 'Note'

              const iconName =
                kind === 'reel' || kind === 'video'
                  ? 'play'
                  : kind === 'processing'
                  ? 'circle-notch'
                  : kind === 'doc' || kind === 'article'
                  ? 'document'
                  : 'edit'

              const timeStr = item.time_ago || item.date_label || 'Recently'

              return (
                <button
                  key={item.id || `continue-${idx}`}
                  type="button"
                  className="damon-card-item"
                  onClick={() => onOpenContinueItem(item)}
                >
                  <div className="damon-card-header">
                    <div className="damon-card-icon-box">
                      <Icon name={iconName} size={15} />
                    </div>
                    <span className="damon-card-title">{item.title}</span>
                  </div>

                  <div className="damon-card-footer">
                    <span className={`damon-tag ${tagClass}`}>{tagLabel}</span>
                    <span>{timeStr}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
