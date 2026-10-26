import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Toaster } from 'sonner'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import Button from '../components/ui/AppButton.jsx'
import Icon from '../components/Icon.jsx'
import './home-shell.css'

export default function Drawer({ title, description, onClose, className = '', children }) {
  const ref = useRef(null)
  const id = useId()
  useFocusTrap(ref, true)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    dialog.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={ref} className={`today-drawer home-shell bento-foundation ${className}`} aria-labelledby={id} aria-describedby={description ? `${id}-description` : undefined} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') onClose() }} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { const box = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) onClose() }}><header className="today-drawer-heading"><div><h2 id={id}>{title}</h2>{description && <p id={`${id}-description`}>{description}</p>}</div><Button variant="ghost" size="icon" autoFocus onClick={onClose} aria-label={`Close ${title}`}><Icon name="x" size={18} /></Button></header><div className="today-drawer-body">{children}</div><Toaster id="home-drawer" /></dialog>, document.body)
}
