import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'

export function extractDomain(url, fallback) {
  if (fallback) return fallback
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return fallback || ''
  }
}

export function Lightbox({ images, initialIndex, onClose }) {
  const [index, setIndex] = useState(initialIndex)
  const [favorites, setFavorites] = useState(() => new Set())
  const current = images[index] || images[0]

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIndex((i) => (i > 0 ? i - 1 : images.length - 1))
      if (e.key === 'ArrowRight') setIndex((i) => (i < images.length - 1 ? i + 1 : 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [images.length, onClose])

  if (!current) return null

  const domain = extractDomain(current.url, current.source)
  const isFav = favorites.has(current.url)
  const nextItem = images.length > 1 ? images[(index + 1) % images.length] : null

  const toggleFavorite = (e) => {
    e.stopPropagation()
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(current.url)) next.delete(current.url)
      else next.add(current.url)
      return next
    })
  }

  const modalNode = (
    <div
      className="chatgpt-lightbox-modal"
      role="dialog"
      aria-modal="true"
      aria-label={current.title || 'Image view'}
      onClick={onClose}
    >
      {/* Top Bar */}
      <div className="chatgpt-lightbox-topbar" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="chatgpt-lightbox-btn"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)"
        >
          <Icon name="x" size={20} />
        </button>

        <span className="chatgpt-lightbox-counter">
          {index + 1} / {images.length}
        </span>

        <button
          type="button"
          className={`chatgpt-lightbox-btn${isFav ? ' is-favorited' : ''}`}
          onClick={toggleFavorite}
          aria-label={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
          title={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
        >
          <Icon name="bookmark" size={20} />
        </button>
      </div>

      {/* Main Stage */}
      <div className="chatgpt-lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {images.length > 1 && (
          <button
            type="button"
            className="chatgpt-lightbox-nav is-prev"
            onClick={() => setIndex((i) => (i > 0 ? i - 1 : images.length - 1))}
            aria-label="Previous image"
          >
            <Icon name="back" size={22} />
          </button>
        )}

        <div className="chatgpt-lightbox-main-wrapper">
          <img
            src={current.url || current.thumbnail}
            alt={current.title || ''}
            className="chatgpt-lightbox-main-img"
          />
        </div>

        {images.length > 1 && (
          <button
            type="button"
            className="chatgpt-lightbox-nav is-next"
            onClick={() => setIndex((i) => (i < images.length - 1 ? i + 1 : 0))}
            aria-label="Next image"
          >
            <Icon name="caret-right" size={22} />
          </button>
        )}

        {/* Peek of next image on the right edge */}
        {nextItem && images.length > 2 && (
          <div
            className="chatgpt-lightbox-peek"
            onClick={() => setIndex((i) => (i < images.length - 1 ? i + 1 : 0))}
            title="Next image"
          >
            <img src={nextItem.thumbnail || nextItem.url} alt="" />
          </div>
        )}
      </div>

      {/* Bottom Metadata Overlay */}
      <div className="chatgpt-lightbox-footer" onClick={(e) => e.stopPropagation()}>
        {domain && (
          <div className="chatgpt-lightbox-domain">
            <Icon name="globe" size={13} />
            <span>{domain}</span>
          </div>
        )}
        <div className="chatgpt-lightbox-title">
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="chatgpt-lightbox-link"
          >
            {current.title || 'View Source'}
          </a>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modalNode, document.body) : modalNode
}

export function ImageCard({ item, index, total, onOpen, onToggleFav, isFav }) {
  const [error, setError] = useState(false)
  const isLastSlot = index === 2 && total > 3

  return (
    <div
      className="chatgpt-image-card"
      onClick={() => onOpen(index)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(index)
        }
      }}
    >
      {!error ? (
        <img
          src={item.thumbnail || item.url}
          alt={item.title || ''}
          className="chatgpt-card-image"
          loading="lazy"
          onError={() => setError(true)}
        />
      ) : (
        <div className="chatgpt-card-fallback">
          <Icon name="image" size={28} />
        </div>
      )}

      {/* Card Bookmark / Favorite Hover Button */}
      <button
        type="button"
        className={`chatgpt-card-favorite${isFav ? ' is-saved' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFav(item.url)
        }}
        aria-label={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
        title={isFav ? 'Remove from Favorites' : 'Add to Favorites'}
      >
        <Icon name="bookmark" size={15} />
      </button>

      {/* Count Badge on the 3rd card when more images exist */}
      {isLastSlot && (
        <div className="chatgpt-count-badge">
          <Icon name="layers" size={13} />
          <span>{total}</span>
        </div>
      )}
    </div>
  )
}

export default function ImageGallery({ data, items }) {
  const images = Array.isArray(data?.images)
    ? data.images
    : Array.isArray(items)
    ? items.map((it) => ({
        url: it.href || it.url,
        thumbnail: it.thumbnail || it.href || it.url,
        title: it.alt || it.title || '',
        source: extractDomain(it.href || it.url),
      }))
    : []

  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [favorites, setFavorites] = useState(() => new Set())
  const [toastMessage, setToastMessage] = useState(null)

  if (!images.length) return null

  // In chat messages, show up to 3 cards in the horizontal strip
  const visibleCards = images.slice(0, 3)
  const columnsCount = visibleCards.length

  const handleToggleFav = (url) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      const willAdd = !next.has(url)
      if (willAdd) {
        next.add(url)
        setToastMessage('Added to Favorites')
      } else {
        next.delete(url)
        setToastMessage('Removed from Favorites')
      }
      setTimeout(() => setToastMessage(null), 2500)
      return next
    })
  }

  return (
    <div className="chatgpt-gallery-root">
      {toastMessage && (
        <div className="chatgpt-fav-toast">
          <Icon name="bookmark" size={14} />
          <span>{toastMessage}</span>
        </div>
      )}

      <div
        className={`chatgpt-image-strip cols-${columnsCount}`}
        style={{
          gridTemplateColumns:
            columnsCount === 1
              ? '1fr'
              : columnsCount === 2
              ? 'repeat(2, 1fr)'
              : 'repeat(3, minmax(0, 1fr))',
        }}
      >
        {visibleCards.map((img, idx) => (
          <ImageCard
            key={idx}
            item={img}
            index={idx}
            total={images.length}
            onOpen={setLightboxIndex}
            onToggleFav={handleToggleFav}
            isFav={favorites.has(img.url)}
          />
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  )
}
