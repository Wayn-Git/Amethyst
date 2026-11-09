import React from 'react'
import DamonPreview from './DamonPreview.jsx'

export default function DamonSplitPane({
  activeItem,
  onAction,
  children,
}) {
  const hasPreview = Boolean(
    activeItem &&
    (activeItem.preview_type === 'markdown' ||
     activeItem.preview_type === 'app_info' ||
     activeItem.preview_type === 'file' ||
     activeItem.has_preview)
  )

  return (
    <div className={`damon-split-pane ${hasPreview ? 'has-preview' : 'no-preview'}`}>
      <div className="damon-results-pane">
        {children}
      </div>
      {hasPreview && (
        <aside className="damon-preview-pane" aria-label="Item Preview">
          <DamonPreview item={activeItem} onAction={onAction} />
        </aside>
      )}
    </div>
  )
}

