import React from 'react'
import Icon from '../Icon.jsx'

export default function DamonFooter({
  mode = 'standard', // 'standard' | 'weather' | 'split' | 'ask' | 'approve'
  query = '',
  onAskAmethyst,
  onSaveLink,
  onNewNote,
  onReveal,
  onCopyPath,
  onOpenWith,
}) {
  const hasQuery = Boolean(query && query.trim())

  if (mode === 'weather') {
    return (
      <div className="damon-footer">
        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↑↓</span>
            <span>Forecast</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↵</span>
            <span>View details</span>
          </div>
        </div>

        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">Esc</span>
            <span>Close</span>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'split') {
    return (
      <div className="damon-footer">
        <div className="damon-footer-actions">
          <button type="button" className="damon-footer-action-btn" onClick={onReveal}>
            <Icon name="folder" size={13} />
            <span>Reveal in files</span>
          </button>
          <button type="button" className="damon-footer-action-btn" onClick={onCopyPath}>
            <Icon name="copy" size={13} />
            <span>Copy path</span>
          </button>
          <button type="button" className="damon-footer-action-btn" onClick={onOpenWith}>
            <Icon name="code" size={13} />
            <span>Open</span>
          </button>
        </div>

        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↑↓</span>
            <span>Navigate</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↵</span>
            <span>Open</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">Esc</span>
            <span>Close</span>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'ask') {
    return (
      <div className="damon-footer">
        <div className="damon-footer-actions">
          <button type="button" className="damon-footer-action-btn" onClick={onNewNote}>
            <Icon name="plus" size={13} />
            <span>Save to note</span>
          </button>
        </div>

        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↵</span>
            <span>Ask question</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">Esc</span>
            <span>Back</span>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'approve') {
    return (
      <div className="damon-footer" style={{ justifyContent: 'flex-end' }}>
        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↵</span>
            <span>Allow once</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">Esc</span>
            <span>Dismiss</span>
          </div>
        </div>
      </div>
    )
  }

  // Standard Footer: spacious and context-aware
  return (
    <div className="damon-footer">
      <div className="damon-footer-actions">
        <button type="button" className="damon-footer-action-btn" onClick={onAskAmethyst}>
          <Icon name="spark" size={13} />
          <span>Ask Amethyst</span>
        </button>

        {/* When query is empty (initial recents), show creation shortcuts. When typing, hide them to keep footer airy */}
        {!hasQuery ? (
          <>
            <button type="button" className="damon-footer-action-btn" onClick={onNewNote}>
              <Icon name="plus" size={13} />
              <span>New note</span>
            </button>
            <button type="button" className="damon-footer-action-btn" onClick={onSaveLink}>
              <Icon name="link" size={13} />
              <span>Save link</span>
            </button>
          </>
        ) : query.startsWith('http') ? (
          <button type="button" className="damon-footer-action-btn" onClick={onSaveLink}>
            <Icon name="link" size={13} />
            <span>Save link to Library</span>
          </button>
        ) : null}
      </div>

      <div className="damon-footer-hints">
        <div className="damon-footer-hint-group">
          <span className="damon-footer-kbd">↑↓</span>
          <span>Navigate</span>
        </div>
        <div className="damon-footer-hint-group">
          <span className="damon-footer-kbd">↵</span>
          <span>Open</span>
        </div>
        <div className="damon-footer-hint-group">
          <span className="damon-footer-kbd">Esc</span>
          <span>Close</span>
        </div>
      </div>
    </div>
  )
}
