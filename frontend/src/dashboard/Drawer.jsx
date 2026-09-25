import { useEffect, useId, useRef } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import Button from '../components/ui/AppButton.jsx'
import './home-shell.css'
import { createPortal } from 'react-dom'

export default function Drawer({ title, onClose, className = '', children }) {
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
  return createPortal(<dialog ref={ref} className={`widget-home home-shell home-drawer${className ? ` ${className}` : ''}`} aria-labelledby={id} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') onClose() }} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left) onClose() }}><header className="home-heading drawer-heading"><h2 id={id}>{title}</h2><Button className="drawer-close-btn" autoFocus onClick={onClose} aria-label={`Close ${title}`}>Close</Button></header>{children}</dialog>, document.body)
}
