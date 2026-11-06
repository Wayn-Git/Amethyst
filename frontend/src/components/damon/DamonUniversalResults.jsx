import React, { useState } from 'react'
import Icon from '../Icon.jsx'

function AppIconRenderer({ icon, iconUrl, title, isApp = false, isMath = false }) {
  const [imgFailed, setImgFailed] = useState(false)

  if (isMath || icon === 'calculator') {
    return (
      <div className="damon-row-icon-wrap" style={{ background: '#2563eb', color: '#ffffff' }}>
        <Icon name="calculator" size={18} />
      </div>
    )
  }

  const isBrandAmethyst =
    title?.toLowerCase() === 'amethyst' || icon === 'amethyst' || icon === 'diamond'

  if (isBrandAmethyst) {
    return (
      <div className="damon-row-icon-wrap" style={{ background: '#7132f5', color: '#ffffff' }}>
        <Icon name="diamond" size={18} />
      </div>
    )
  }

  const url = iconUrl || (isApp && icon && icon !== 'app' && icon !== 'search' ? `/api/launcher/icon?name=${encodeURIComponent(icon)}` : null)

  return (
    <div className="damon-row-icon-wrap">
      {url && !imgFailed ? (
        <img
          src={url}
          alt=""
          className="damon-row-img-icon"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <Icon name={icon || 'app'} size={18} />
      )}
    </div>
  )
}

export default function DamonUniversalResults({
  query,
  topHit,
  libraryItems = [],
  fileItems = [],
  appItems = [],
  actionItems = [],
  onSelectResult,
  onSelectTab,
  selectedIndex,
  getItemIndex,
}) {
  return (
    <div className="damon-universal-results">
      {/* 1. Top Hit */}
      {topHit && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Top hit</span>
            </div>
          </div>

          <div className="damon-list-container">
            {(() => {
              const idx = getItemIndex(topHit)
              const isSelected = selectedIndex === idx
              return (
                <button
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectResult(topHit)}
                >
                  <AppIconRenderer
                    icon={topHit.icon}
                    iconUrl={topHit.icon_url || topHit.preview_data?.icon_url}
                    title={topHit.title}
                    isApp={topHit.provider_id === 'apps'}
                    isMath={topHit.isMath}
                  />
                  <div className="damon-row-main">
                    <div className="damon-row-title">{topHit.title}</div>
                    <div className="damon-row-subtitle">
                      {topHit.subtitle || topHit.badge || 'Application'}
                    </div>
                  </div>
                  <div className="damon-row-trailing">
                    <span className="damon-row-shortcut">↵</span>
                  </div>
                </button>
              )
            })()}
          </div>
        </div>
      )}

      {/* 2. Library Section (Horizontal Cards) */}
      {libraryItems.length > 0 && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Library</span>
              <span className="damon-section-count">{libraryItems.length}</span>
            </div>
            <button
              type="button"
              className="damon-section-action damon-section-action--see-all"
              onClick={() => onSelectTab?.('library')}
            >
              See all
            </button>
          </div>

          <div className="damon-cards-grid">
            {libraryItems.slice(0, 4).map((item) => {
              const kind = (item.kind || item.type || 'note').toLowerCase()
              const tagClass =
                kind === 'reel' || kind === 'video'
                  ? 'damon-tag--reel'
                  : kind === 'doc' || kind === 'article'
                  ? 'damon-tag--doc'
                  : 'damon-tag--note'
              const tagLabel =
                kind === 'reel' || kind === 'video'
                  ? 'Reel'
                  : kind === 'doc' || kind === 'article'
                  ? 'Doc'
                  : 'Note'
              const iconName =
                kind === 'reel' || kind === 'video'
                  ? 'play'
                  : kind === 'doc' || kind === 'article'
                  ? 'document'
                  : 'edit'

              return (
                <button
                  key={item.id}
                  type="button"
                  className="damon-card-item"
                  onClick={() => onSelectResult(item)}
                >
                  <div className="damon-card-header">
                    <div className="damon-card-icon-box">
                      {item.thumbnail_url || (item.id && typeof item.id === 'number') ? (
                        <img
                          src={item.thumbnail_url || `/api/library/${item.id}/thumbnail`}
                          alt=""
                          className="damon-card-thumb-img"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                            const fallback = e.currentTarget.parentElement.querySelector('.damon-card-icon-fallback')
                            if (fallback) fallback.style.display = 'flex'
                          }}
                        />
                      ) : null}
                      <span
                        className="damon-card-icon-fallback"
                        style={{ display: item.thumbnail_url || typeof item.id === 'number' ? 'none' : 'flex' }}
                      >
                        <Icon name={iconName} size={15} />
                      </span>
                    </div>
                    <span className="damon-card-title">{item.title}</span>
                  </div>
                  <div className="damon-card-footer">
                    <span className={`damon-tag ${tagClass}`}>{tagLabel}</span>
                    <span>{item.date_label || item.time_ago || 'Recently'}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 3. Files & Folders Section */}
      {fileItems.length > 0 && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Files and folders</span>
              <span className="damon-section-count">{fileItems.length}</span>
            </div>
            <button
              type="button"
              className="damon-section-action damon-section-action--see-all"
              onClick={() => onSelectTab?.('files')}
            >
              See all
            </button>
          </div>

          <div className="damon-list-container">
            {fileItems.map((file, i) => {
              const idx = getItemIndex(file)
              const isSelected = selectedIndex === idx
              const isFolder =
                file.is_dir || file.icon === 'folder' || file.title?.endsWith('/')
              const iconName = isFolder ? 'folder' : file.icon || 'file-text'
              const shortcutNumber = i < 9 ? `⌘${i + 1}` : null

              return (
                <button
                  key={file.id || `file-${i}`}
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectResult(file)}
                >
                  <div className="damon-row-icon-wrap">
                    <Icon name={iconName} size={18} />
                  </div>
                  <div className="damon-row-main">
                    <div className="damon-row-title">{file.title}</div>
                    <div className="damon-row-subtitle">{file.subtitle || file.path || ''}</div>
                  </div>
                  <div className="damon-row-trailing">
                    {shortcutNumber && (
                      <span className="damon-row-shortcut">{shortcutNumber}</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 5. Apps Section (if filtered by Apps or general) */}
      {appItems.length > 0 && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Applications</span>
              <span className="damon-section-count">{appItems.length}</span>
            </div>
          </div>

          <div className="damon-list-container">
            {appItems.map((app, i) => {
              const idx = getItemIndex(app)
              const isSelected = selectedIndex === idx
              const shortcutBadge = idx < 9 ? `⌘${idx + 1}` : null

              return (
                <button
                  key={app.id || `app-${i}`}
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectResult(app)}
                >
                  <AppIconRenderer
                    icon={app.icon}
                    iconUrl={app.icon_url || app.preview_data?.icon_url}
                    title={app.title}
                    isApp={true}
                  />
                  <div className="damon-row-main">
                    <div className="damon-row-title">{app.title}</div>
                    <div className="damon-row-subtitle">{app.subtitle || 'Application'}</div>
                  </div>
                  <div className="damon-row-trailing">
                    {isSelected ? (
                      <span className="damon-row-shortcut">↵</span>
                    ) : shortcutBadge ? (
                      <span className="damon-row-shortcut">{shortcutBadge}</span>
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

      {/* 6. Actions Section */}
      {actionItems.length > 0 && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Actions</span>
              <span className="damon-section-count">{actionItems.length}</span>
            </div>
          </div>

          <div className="damon-list-container">
            {actionItems.map((act, i) => {
              const idx = getItemIndex(act)
              const isSelected = selectedIndex === idx
              const shortcutBadge = idx < 9 ? `⌘${idx + 1}` : null

              return (
                <button
                  key={act.id || `act-${i}`}
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectResult(act)}
                >
                  <div className="damon-row-icon-wrap">
                    <Icon name={act.icon || 'zap'} size={18} />
                  </div>
                  <div className="damon-row-main">
                    <div className="damon-row-title">{act.title || act.label}</div>
                    <div className="damon-row-subtitle">{act.subtitle || act.hint || 'Command'}</div>
                  </div>
                  <div className="damon-row-trailing">
                    {isSelected ? (
                      <span className="damon-row-shortcut">↵</span>
                    ) : shortcutBadge ? (
                      <span className="damon-row-shortcut">{shortcutBadge}</span>
                    ) : (
                      <span className="damon-row-shortcut">↵</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 7. Web & AI Fallback Actions */}
      {query && (
        <div className="damon-section-group">
          <div className="damon-section-header">
            <div className="damon-section-title-wrap">
              <span>Actions & Search</span>
            </div>
          </div>

          <div className="damon-list-container">
            {/* Ask AI row */}
            {(() => {
              const askItem = {
                id: 'ask-amethyst-fallback',
                type: 'ask',
                title: `Ask Amethyst: “${query}”`,
                subtitle: 'AI reasoning, answer, and follow-ups',
                isAsk: true,
              }
              const idx = getItemIndex(askItem)
              const isSelected = selectedIndex === idx

              return (
                <button
                  key="ask-amethyst-fallback"
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectResult(askItem)}
                >
                  <div className="damon-row-icon-wrap" style={{ background: 'rgba(113, 50, 245, 0.12)', color: '#7132f5' }}>
                    <Icon name="spark" size={17} />
                  </div>
                  <div className="damon-row-main">
                    <div className="damon-row-title">Ask Amethyst: “{query}”</div>
                    <div className="damon-row-subtitle">AI reasoning, answer, and follow-ups</div>
                  </div>
                  <div className="damon-row-trailing">
                    <span className="damon-row-shortcut">↵</span>
                  </div>
                </button>
              )
            })()}

            {/* Web Search row */}
            {(() => {
              const webItem = {
                id: 'web-fallback',
                type: 'web',
                title: `Search the web for “${query}”`,
                subtitle: 'Default search engine',
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
              }
              const idx = getItemIndex(webItem)
              const isSelected = selectedIndex === idx

              return (
                <button
                  key="web-fallback"
                  type="button"
                  className={`damon-row palette-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => onSelectResult(webItem)}
                >
                  <div className="damon-row-icon-wrap">
                    <Icon name="globe" size={17} />
                  </div>
                  <div className="damon-row-main">
                    <div className="damon-row-title">Search the web for “{query}”</div>
                    <div className="damon-row-subtitle">Default search engine</div>
                  </div>
                  <div className="damon-row-trailing">
                    <Icon name="arrow-up-right" size={16} />
                  </div>
                </button>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
