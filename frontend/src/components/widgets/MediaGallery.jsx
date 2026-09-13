import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import MediaCard from './MediaCard.jsx'
import { normaliseAll } from './media.js'

/* The media attached to a widget, if any.
 *
 * Renders nothing at all when there is nothing to show, which is the common
 * case -- most widgets carry no media, and an empty strip under every one of
 * them would be the feature announcing itself on answers it did not improve. */

/* Click-to-enlarge. One dialog for the gallery rather than one per card, so
   there is only ever one thing to close and one Escape handler to own. */
function Lightbox({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="media-lightbox" role="dialog" aria-modal="true" aria-label={item.title} onClick={onClose}>
      <button type="button" className="media-close" onClick={onClose} aria-label="Close">
        <Icon name="x" size={18} />
      </button>
      {/* The image itself does not close the dialog; the backdrop does. */}
      <img src={item.direct || item.thumbnail} alt={item.title} onClick={(e) => e.stopPropagation()} />
      <figcaption onClick={(e) => e.stopPropagation()}>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
        {item.source && <span>{item.source}</span>}
      </figcaption>
    </div>
  )
}

export default function MediaGallery({ media }) {
  const [open, setOpen] = useState(null)
  const items = normaliseAll(media)
  if (!items.length) return null

  // One video fills the width; a set of images is a grid. Counted rather than
  // configured, because the right layout follows from what is actually there.
  const onlyImages = items.every((i) => i.kind === 'image')

  return (
    <div className={`media-gallery${onlyImages && items.length > 1 ? ' is-grid' : ''}`}>
      {items.map((item, i) => <MediaCard key={i} item={item} onOpen={setOpen} />)}
      {open && <Lightbox item={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
