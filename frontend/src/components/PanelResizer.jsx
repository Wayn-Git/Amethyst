import { useCallback, useEffect, useRef, useState } from 'react'

import { useApp } from '../store.jsx'
import { PANEL_MAX, PANEL_MIN } from '../store.jsx'

/* The panel's left edge, as something you can pull.

   Pointer events rather than mouse events, so a trackpad, a stylus and a touch
   screen all work from one code path, and `setPointerCapture` so the drag keeps
   following the pointer when it leaves the four-pixel strip -- without it the
   handle drops the moment you move faster than React re-renders.

   Width is written on every move but only *saved* when the drag ends: the
   preference blob is read and rewritten whole on each save, and doing that at
   pointer-move frequency is a lot of JSON for a number still in motion. */
export default function PanelResizer() {
  const { panelWidth, setPanelWidth, panelExpanded } = useApp()
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })

  const onPointerDown = useCallback((e) => {
    // Left button only; a right-click on the edge should open a context menu.
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, w: panelWidth }
    setDragging(true)
  }, [panelWidth])

  const onPointerMove = useCallback((e) => {
    if (!dragging) return
    // The panel is on the right, so dragging left makes it wider.
    setPanelWidth(start.current.w - (e.clientX - start.current.x), { persist: false })
  }, [dragging, setPanelWidth])

  const end = useCallback(() => {
    if (!dragging) return
    setDragging(false)
    setPanelWidth(panelWidth)
  }, [dragging, panelWidth, setPanelWidth])

  /* While a drag is live the whole window gets the resize cursor and stops
     selecting text -- otherwise dragging across the transcript highlights it,
     and the cursor flickers back to a caret over every word it crosses. */
  useEffect(() => {
    if (!dragging) return undefined
    const previous = document.body.style.cssText
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => { document.body.style.cssText = previous }
  }, [dragging])

  // Nothing to drag when the panel is filling the window.
  if (panelExpanded) return null

  return (
    <div
      className={`panel-resizer${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the panel"
      aria-valuenow={panelWidth}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setPanelWidth(372)}
      // Keyboard users get the same control, in steps.
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); setPanelWidth(panelWidth + 24) }
        if (e.key === 'ArrowRight') { e.preventDefault(); setPanelWidth(panelWidth - 24) }
      }}
    />
  )
}
