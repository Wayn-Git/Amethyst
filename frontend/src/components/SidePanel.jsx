import { createPortal } from 'react-dom'

import Icon from './Icon.jsx'

/* The shell's side panel as a component. The slot itself is owned by
 * `App.jsx` -- an `<aside id="wb-panel">` that every view shares -- so a
 * view fills it by portal rather than by rendering its own aside. That is
 * what lets the panel be a workbench concern (it collapses when nothing
 * fills it) while its contents belong to whichever view is open.
 *
 * Steps on Chat was the first consumer; Mail's thread panel is the second.
 * Both go through this so the head, the close button and the collapse
 * behaviour cannot drift between views. */
export default function SidePanel({ title, count, footer, onClose, closeLabel, children }) {
  const host = typeof document === 'undefined' ? null : document.getElementById('wb-panel')
  if (!host) return null

  const label = closeLabel || `Hide the ${title || 'side'} panel`
  const body = (
    <>
      <div className="wb-panel-head">
        <span className="wb-panel-title">{title}</span>
        {count > 0 && <span className="wb-panel-count">{count}</span>}
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} title={label} aria-label={label}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <div className="wb-panel-body">{children}</div>
      {footer && <div className="wb-panel-foot">{footer}</div>}
    </>
  )
  return createPortal(body, host)
}
