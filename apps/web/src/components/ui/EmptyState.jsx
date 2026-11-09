import { useRef } from 'react'
import Icon from '../Icon.jsx'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

/** A `.card.empty-state`, extracted from the shape Memory and Logs already
 * had right: an icon, a message, and — only when there's something to do
 * about it — a small action row below. */
export default function EmptyState({ icon = 'info', message, children, action }) {
  const containerRef = useRef(null)
  
  useGSAP(() => {
    gsap.fromTo(
      containerRef.current,
      { opacity: 0, y: 15 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
    )
  }, { scope: containerRef })

  const body = message ?? children
  if (!action) {
    return (
      <div className="card empty-state" ref={containerRef} style={{ opacity: 0 }}>
        <Icon name={icon} size={22} />
        {body}
      </div>
    )
  }
  return (
    <div className="card empty-state" ref={containerRef} style={{ opacity: 0 }}>
      <Icon name={icon} size={22} />
      <div>
        <div>{body}</div>
        <div className="empty-actions">{action}</div>
      </div>
    </div>
  )
}
