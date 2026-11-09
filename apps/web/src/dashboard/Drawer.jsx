import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import Button from '../components/ui/AppButton.jsx'
import Icon from '../components/Icon.jsx'
import './home-shell.css'

export default function Drawer({ title, description, onClose, className = '', children, open = true, inline = false, portal = true, closeDisabled = false }) {
  const ref = useRef(null)
  const exit = useRef(null)
  const live = useRef(false)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const dialog = ref.current
    live.current = true
    const previous = document.activeElement
    dialog.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => { if (media.matches) exit.current?.finish() }
    media.addEventListener('change', changed)
    return () => {
      live.current = false; exit.current?.cancel(); exit.current = null; dialog.inert = false
      media.removeEventListener('change', changed)
      dialog.close(); document.body.style.overflow = overflow
      const top = [...document.querySelectorAll('dialog:modal')].at(-1)
      if (previous?.isConnected && (!top || top.contains(previous))) previous.focus()
    }
  }, [open])
  function close(immediate = false) {
    if (closeDisabled || exit.current) return
    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return }
    const dialog = ref.current, style = getComputedStyle(dialog)
    const first = { opacity: style.opacity, transform: style.transform }
    dialog.getAnimations().forEach(animation => animation.cancel())
    dialog.inert = true
    exit.current = dialog.animate([first, { opacity: 0, transform: 'translateX(12px)' }], { duration: parseFloat(style.getPropertyValue('--widget-exit')) || 160, easing: 'ease-in', fill: 'forwards' })
    exit.current.finished.then(() => { if (live.current) onClose() }).catch(() => {})
  }
  function keyDown(event) {
    if (!open) return
    if (event.key === 'Tab') {
      const controls = [...ref.current.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')].filter(node => node.tabIndex >= 0 && !node.matches(':disabled,[aria-disabled="true"]') && !node.closest('[inert]') && node.checkVisibility())
      const first = controls[0], last = controls.at(-1)
      if (!first) { event.preventDefault(); ref.current.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') close(true)
  }
  const dialog = <dialog ref={ref} role={inline && !open ? 'region' : undefined} className={`today-drawer home-shell bento-foundation ${inline && !open ? 'is-inline' : ''} ${className}`} aria-labelledby={id} aria-describedby={description ? `${id}-description` : undefined} onKeyDown={keyDown} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (!open) return; const box = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close() }}><header className="today-drawer-heading"><div><h2 id={id}>{title}</h2>{description && <p id={`${id}-description`}>{description}</p>}</div><Button variant="ghost" size="icon" autoFocus={open} disabled={closeDisabled} onClick={() => close()} aria-label={`Close ${title}`}><Icon name="x" size={18} /></Button></header><div className="today-drawer-body">{children}</div></dialog>
  return portal ? createPortal(dialog, document.body) : dialog
}
