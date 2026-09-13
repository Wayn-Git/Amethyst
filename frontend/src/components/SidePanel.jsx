import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import Icon from './Icon.jsx'
import { panelIn, staggerIn, streamIn } from '../motion.js'

/* The shell's side panel as a component. The slot itself is owned by
 * `App.jsx` -- an `<aside id="wb-panel">` that every view shares -- so a
 * view fills it by portal rather than by rendering its own aside. That is
 * what lets the panel be a workbench concern (it collapses when nothing
 * fills it) while its contents belong to whichever view is open.
 *
 * Steps on Chat was the first consumer; Mail's thread panel is the second.
 * Both go through this so the head, the close button and the collapse
 * behaviour cannot drift between views.
 *
 * Structure: an eyebrow (the view that owns this panel) over a display-size
 * title, contents that stagger in behind the column's own entrance, and a
 * footer that rides a hairline. The eyebrow is what makes the panel feel
 * like part of its view rather than a docked drawer -- "MAIL / Thread" --
 * and it costs one prop.
 */
export default function SidePanel({
  title,
  eyebrow,
  count,
  footer,
  onClose,
  closeLabel,
  children,
  // A row of tabs under the head, for a panel that holds more than one thing.
  // Rendered outside `.wb-panel-body` so it does not scroll with the contents
  // and is not caught by the body's stagger on mount.
  tabs,
  live = false,
}) {
  const host = typeof document === 'undefined' ? null : document.getElementById('wb-panel')
  const rootRef = useRef(null)
  const bodyRef = useRef(null)

  // The column arrives once, then the contents stagger behind it. One pass
  // per mount; `key` at the consumer is what makes a new panel a new mount.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    panelIn(root)
    const items = root.querySelectorAll('.wb-panel-body > *')
    staggerIn(items, { each: 0.035, y: 8 })
    return undefined
  }, [])

  /* Streaming: a fresh block should be seen to arrive without moving anything
     else.

     This had no dependency array, so it ran on *every* render and faded the
     panel's last child from zero on each one. With a document streaming into
     the panel that is a render per delta, and typing in the composer re-renders
     the view too -- which is the whole of the "the artifact window flickers
     while the model writes and while I type" report. It now fires only when the
     number of blocks actually changes, which is the event it was always trying
     to describe. */
  const blockCount = useRef(0)
  useEffect(() => {
    const body = bodyRef.current
    if (!live || !body) return undefined
    const items = body.querySelectorAll('.wb-panel-body > *')
    const seen = blockCount.current
    blockCount.current = items.length
    // First paint is the mount animation's job, and a block leaving is not an
    // arrival.
    if (seen === 0 || items.length <= seen) return undefined
    const last = items[items.length - 1]
    if (last) streamIn(last)
    return undefined
  })

  if (!host) return null

  const label = closeLabel || `Hide the ${title || 'side'} panel`
  const body = (
    <div className="wb-panel-inner" ref={rootRef}>
      <div className="wb-panel-head">
        <div className="wb-panel-heading">
          {eyebrow && <span className="wb-panel-eyebrow">{eyebrow}</span>}
          <span className="wb-panel-title">{title}</span>
        </div>
        {count > 0 && <span className="wb-panel-count" title={`${count} in this panel`}>{count}</span>}
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} title={label} aria-label={label}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {tabs && <div className="wb-panel-tabs" role="tablist">{tabs}</div>}
      <div className="wb-panel-body" ref={bodyRef}>{children}</div>
      {footer && <div className="wb-panel-foot">{footer}</div>}
    </div>
  )
  return createPortal(body, host)
}
