import React, { useEffect, useRef } from 'react'
import Icon from '../../components/Icon.jsx'
import Kbd from '../../components/ui/Kbd.jsx'

export default function LibraryShortcutsModal({ onClose }) {
  const modalRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose?.()
      }
    }
    const handleOutsideClick = (e) => {
      if (modalRef.current && !modalRef.current.contains(e.target)) {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('mousedown', handleOutsideClick, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('mousedown', handleOutsideClick, true)
    }
  }, [onClose])

  const shortcuts = [
    { key: 'J / K or ← / →', desc: 'Navigate to previous / next library item' },
    { key: 'Space', desc: 'Play / pause video (when not typing)' },
    { key: 'E', desc: 'Inline edit item title (Enter to save, Esc to cancel)' },
    { key: 'T', desc: 'Focus tag input in right rail' },
    { key: 'N', desc: 'Focus personal notes editor' },
    { key: 'C', desc: 'Copy item link to clipboard' },
    { key: '?', desc: 'Show this keyboard shortcuts guide' },
    { key: 'Esc', desc: 'Close detail view / cancel edit' },
  ]

  return (
    <div className="lib-shortcuts-overlay" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts">
      <div className="lib-shortcuts-dialog" ref={modalRef}>
        <div className="lib-shortcuts-header">
          <div className="lib-shortcuts-title-row">
            <Icon name="keyboard" size={15} />
            <span className="lib-shortcuts-title">Keyboard Shortcuts</span>
          </div>
          <button
            type="button"
            className="lib-shortcuts-close"
            onClick={onClose}
            aria-label="Close shortcuts guide"
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="lib-shortcuts-list">
          {shortcuts.map((sc) => (
            <div key={sc.key} className="lib-shortcuts-row">
              <span className="lib-shortcuts-desc">{sc.desc}</span>
              <kbd className="lib-shortcuts-kbd">{sc.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
