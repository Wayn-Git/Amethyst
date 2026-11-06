import React from 'react'
import Icon from '../Icon.jsx'

export default function DamonSplitView({
  folderItems = [],
  documentItems = [],
  selectedItem,
  onSelectItem,
  onOpenItem,
  onRevealItem,
  filterRoot = 'Home ~ (Global)',
  filterDate = 'All time',
  onClearTypeFilter,
  selectedIndex,
  getItemIndex,
}) {
  const current = selectedItem || documentItems[0] || folderItems[0]

  return (
    <div className="damon-split-container">
      {/* 1. Filter Chips Bar */}
      <div className="damon-chips-bar">
        <span>Looking for</span>
        <button
          type="button"
          className="damon-filter-chip"
          onClick={onClearTypeFilter}
          title="Clear Files filter"
        >
          <Icon name="file-text" size={14} />
          <span>Files</span>
          <Icon name="x" size={12} />
        </button>

        <button type="button" className="damon-filter-chip">
          <Icon name="calendar" size={14} />
          <span>{filterDate}</span>
          <Icon name="caret-down" size={12} />
        </button>

        <button type="button" className="damon-filter-chip">
          <Icon name="folder" size={14} />
          <span>{filterRoot}</span>
          <Icon name="caret-down" size={12} />
        </button>
      </div>

      {/* 2. Split Pane Layout */}
      <div className="damon-split-layout">
        {/* Left Column (Results List) */}
        <div className="damon-split-left">
          {/* Folders */}
          {folderItems.length > 0 && (
            <div className="damon-section-group">
              <div className="damon-section-header">
                <div className="damon-section-title-wrap">
                  <span>Folders</span>
                  <span className="damon-section-count">{folderItems.length}</span>
                </div>
              </div>

              <div className="damon-list-container">
                {folderItems.map((folder) => {
                  const idx = getItemIndex(folder)
                  const isSelected = selectedIndex === idx || current?.id === folder.id

                  return (
                    <button
                      key={folder.id}
                      type="button"
                      className={`damon-row${isSelected ? ' is-selected' : ''}`}
                      onClick={() => onSelectItem(folder)}
                    >
                      <div className="damon-row-icon-wrap">
                        <Icon name="folder" size={18} />
                      </div>
                      <div className="damon-row-main">
                        <div className="damon-row-title">{folder.title}</div>
                      </div>
                      <div className="damon-row-trailing">
                        <Icon name="arrow-up-right" size={16} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Documents */}
          {documentItems.length > 0 && (
            <div className="damon-section-group">
              <div className="damon-section-header">
                <div className="damon-section-title-wrap">
                  <span>Documents</span>
                  <span className="damon-section-count">{documentItems.length}</span>
                </div>
              </div>

              <div className="damon-list-container">
                {documentItems.map((doc) => {
                  const idx = getItemIndex(doc)
                  const isSelected = selectedIndex === idx || current?.id === doc.id

                  return (
                    <button
                      key={doc.id}
                      type="button"
                      className={`damon-row${isSelected ? ' is-selected' : ''}`}
                      onClick={() => onSelectItem(doc)}
                    >
                      <div className="damon-row-icon-wrap">
                        <Icon name={doc.icon || 'file-text'} size={18} />
                      </div>
                      <div className="damon-row-main">
                        <div className="damon-row-title">{doc.title}</div>
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
        </div>

        {/* Right Column (Detail Preview Pane) */}
        <div className="damon-split-right">
          {current ? (
            <>
              <div>
                <div className="damon-preview-header">
                  <div className="damon-preview-icon-box">
                    <Icon name={current.icon || 'file-text'} size={24} />
                  </div>
                  <div className="damon-preview-meta">
                    <span className="damon-preview-filename">{current.title}</span>
                    <span className="damon-preview-sub">
                      {current.preview_data?.size_str
                        ? `${current.preview_data.size_str} · ${current.preview_data.mod_str || 'File'}`
                        : current.subtitle || 'File · Local storage'}
                    </span>
                  </div>
                </div>

                <div className="damon-preview-content-card">
                  {current.preview_data?.snippet ||
                    current.preview_data?.markdown ||
                    current.content ||
                    current.summary ||
                    `# ${current.title}\nReady to open or view in your system file manager.`}
                </div>

                <div className="damon-preview-path">
                  {current.path || current.preview_data?.path || current.subtitle || ''}
                </div>
              </div>

              <div className="damon-preview-actions">
                <button
                  type="button"
                  className="damon-btn-primary"
                  onClick={() => onOpenItem(current)}
                >
                  <span>Open</span>
                  <Icon name="arrow-up-right" size={14} />
                </button>
                <button
                  type="button"
                  className="damon-btn-secondary"
                  onClick={() => onRevealItem(current)}
                >
                  Reveal
                </button>
              </div>
            </>
          ) : (
            <div style={{ color: 'rgb(91, 95, 104)', fontSize: 13 }}>No file selected.</div>
          )}
        </div>
      </div>
    </div>
  )
}
