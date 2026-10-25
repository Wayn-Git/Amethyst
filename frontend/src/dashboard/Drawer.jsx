import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function Drawer({ title, onClose, children }) {
  const ref = useRef(null)
  const id = useId()
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    dialog.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={ref} className="widget-home home-drawer" aria-labelledby={id} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') onClose() }} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left) onClose() }}><header className="home-heading"><h2 id={id}>{title}</h2><button autoFocus onClick={onClose} aria-label={`Close ${title}`}>Close</button></header>{children}</dialog>, document.body)
}
