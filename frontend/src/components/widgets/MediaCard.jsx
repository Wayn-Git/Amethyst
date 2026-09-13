import { useState } from 'react'
import Icon from '../Icon.jsx'

/* One piece of media, rendered as whatever it actually is.
 *
 * Four shapes, and the fallback is always a link. Nothing here fetches or
 * rehosts anything: the browser loads the bytes from whoever published them,
 * which is also what keeps the attribution line honest. */

function Attribution({ item }) {
  if (!item.source && !item.license) return null
  return (
    <p className="media-source">
      {item.source}
      {item.license && <span className="media-licence">{item.license}</span>}
    </p>
  )
}

/* The player is not loaded until someone asks for it.
 *
 * An `<iframe>` per video would have YouTube running scripts and setting up
 * connections for a video nobody has decided to watch, on every widget that
 * happens to carry one. The thumbnail is a picture; the frame arrives on the
 * click. */
function YouTube({ item }) {
  const [playing, setPlaying] = useState(false)

  return (
    <figure className="media-card media-youtube">
      {playing ? (
        <div className="media-embed">
          <iframe
            src={`${item.embed}?autoplay=1`}
            title={item.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            // The frame is a third-party page: it gets to be a video and
            // nothing else.
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
      ) : (
        <button type="button" className="media-poster" onClick={() => setPlaying(true)}>
          {item.thumbnail
            ? <img src={item.thumbnail} alt="" loading="lazy" />
            : <span className="media-poster-blank" />}
          <span className="media-play"><Icon name="play" size={18} /></span>
          {item.duration && <span className="media-duration">{item.duration}</span>}
        </button>
      )}
      <figcaption>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
        <Attribution item={item} />
      </figcaption>
    </figure>
  )
}

function Image({ item, onOpen }) {
  return (
    <figure className="media-card media-image">
      <button type="button" className="media-thumb" onClick={() => onOpen(item)} title="Enlarge">
        <img src={item.thumbnail || item.direct} alt={item.title} loading="lazy" />
      </button>
      <figcaption>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
        <Attribution item={item} />
      </figcaption>
    </figure>
  )
}

function Video({ item }) {
  return (
    <figure className="media-card media-video">
      {/* Only ever reached for a URL that ends in something a browser plays. */}
      <video src={item.direct} poster={item.thumbnail || undefined} controls preload="none" />
      <figcaption>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
        <Attribution item={item} />
      </figcaption>
    </figure>
  )
}

function LinkCard({ item }) {
  return (
    <a className="media-card media-link" href={item.url} target="_blank" rel="noopener noreferrer">
      {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
      <span className="media-link-body">
        <strong>{item.title}</strong>
        {item.snippet && <span className="media-snippet">{item.snippet}</span>}
        <span className="media-source">{item.source}</span>
      </span>
      <Icon name="arrow-up-right" size={13} />
    </a>
  )
}

export default function MediaCard({ item, onOpen }) {
  if (item.kind === 'youtube') return <YouTube item={item} />
  if (item.kind === 'image') return <Image item={item} onOpen={onOpen} />
  if (item.kind === 'video') return <Video item={item} />
  return <LinkCard item={item} />
}
