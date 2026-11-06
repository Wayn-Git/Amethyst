import React from 'react'
import Icon from '../Icon.jsx'

export default function DamonFooter({
  mode = 'standard', // 'standard' | 'weather' | 'split' | 'ask' | 'approve'
  onAskAmethyst,
  onSaveLink,
  onNewNote,
  onReveal,
  onCopyPath,
  onOpenWith,
  onSelectAction,
}) {
  if (mode === 'weather') {
    return (
      <div className="damon-footer">
        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↑</span>
            <span className="damon-footer-kbd">↓</span>
            <span>Move</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↵</span>
            <span>Select</span>
          </div>
        </div>

        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span>Recent</span>
            <span className="damon-footer-kbd">⇧</span>
          </div>
          <div className="damon-footer-hint-group">
            <span>Widgets</span>
            <span className="damon-footer-kbd">⌘</span>
          </div>
          <div className="damon-footer-hint-group">
            <span>Settings</span>
            <span className="damon-footer-kbd">⌥</span>
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
            <Icon name="folder" size={14} />
            <span>Reveal</span>
          </button>
          <button type="button" className="damon-footer-action-btn" onClick={onCopyPath}>
            <Icon name="copy" size={14} />
            <span>Copy path</span>
          </button>
          <button type="button" className="damon-footer-action-btn" onClick={onOpenWith}>
            <Icon name="code" size={14} />
            <span>Open with</span>
          </button>
        </div>

        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↑</span>
            <span className="damon-footer-kbd">↓</span>
            <span>Move</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↵</span>
            <span>Select</span>
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
          <button type="button" className="damon-footer-action-btn" onClick={onAskAmethyst}>
            <Icon name="spark" size={14} />
            <span>Ask Amethyst</span>
          </button>
          <button type="button" className="damon-footer-action-btn" onClick={onSaveLink}>
            <Icon name="link" size={14} />
            <span>Save link</span>
          </button>
          <button type="button" className="damon-footer-action-btn" onClick={onNewNote}>
            <Icon name="plus" size={14} />
            <span>New note</span>
          </button>
        </div>

        <div className="damon-footer-hints">
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">↵</span>
            <span>Follow up</span>
          </div>
          <div className="damon-footer-hint-group">
            <span className="damon-footer-kbd">Esc</span>
            <span>Close</span>
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
            <span>Close</span>
          </div>
        </div>
      </div>
    )
  }

  // Standard Footer
  return (
    <div className="damon-footer">
      <div className="damon-footer-actions">
        <button type="button" className="damon-footer-action-btn" onClick={onAskAmethyst}>
          <Icon name="spark" size={14} />
          <span>Ask Amethyst</span>
        </button>
        <button type="button" className="damon-footer-action-btn" onClick={onSaveLink}>
          <Icon name="link" size={14} />
          <span>Save link</span>
        </button>
        <button type="button" className="damon-footer-action-btn" onClick={onNewNote}>
          <Icon name="plus" size={14} />
          <span>New note</span>
        </button>
      </div>

      <div className="damon-footer-hints">
        <div className="damon-footer-hint-group">
          <span className="damon-footer-kbd">↑</span>
          <span className="damon-footer-kbd">↓</span>
          <span>Move</span>
        </div>
        <div className="damon-footer-hint-group">
          <span className="damon-footer-kbd">↵</span>
          <span>Select</span>
        </div>
        <div className="damon-footer-hint-group">
          <span className="damon-footer-kbd">Esc</span>
          <span>Close</span>
        </div>
      </div>
    </div>
  )
}
