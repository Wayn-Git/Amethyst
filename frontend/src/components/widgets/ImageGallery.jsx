import { useState, useRef, useEffect } from 'react'
import Icon from '../Icon.jsx'

function Lightbox({ images, initialIndex, onClose }) {
  const [index, setIndex] = useState(initialIndex)
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

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.title || 'Image view'}
      onClick={onClose}
    >
      <button
        type="button"
        className="media-close"
        onClick={onClose}
        aria-label="Close"
      >
        <Icon name="x" size={18} />
      </button>

      {images.length > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav-btn is-prev"
            onClick={(e) => {
              e.stopPropagation()
              setIndex((i) => (i > 0 ? i - 1 : images.length - 1))
            }}
            aria-label="Previous image"
          >
            <Icon name="back" size={20} />
          </button>
          <button
            type="button"
            className="lightbox-nav-btn is-next"
            onClick={(e) => {
              e.stopPropagation()
              setIndex((i) => (i < images.length - 1 ? i + 1 : 0))
            }}
            aria-label="Next image"
          >
            <Icon name="arrow-right" size={20} />
          </button>
        </>
      )}

      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img
          src={current.url || current.thumbnail}
          alt={current.title || ''}
          className="lightbox-image"
        />
        <figcaption className="lightbox-caption">
          <div className="lightbox-title-row">
            <span className="lightbox-title">{current.title}</span>
            {images.length > 1 && (
              <span className="lightbox-counter">
                {index + 1} / {images.length}
              </span>
            )}
          </div>
          {current.source && (
            <div className="lightbox-source">
              <a
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                className="lightbox-link"
              >
                <span>{current.source}</span>
                <Icon name="external-link" size={12} />
              </a>
            </div>
          )}
        </figcaption>
      </div>
    </div>
  )
}

function ImageCard({ item, index, onOpen }) {
  const [error, setError] = useState(false)

  return (
    <figure
      className="gallery-card"
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
      <div className="gallery-card-thumb">
        {!error ? (
          <img
            src={item.thumbnail || item.url}
            alt={item.title || ''}
            loading="lazy"
            onError={() => setError(true)}
          />
        ) : (
          <div className="gallery-card-fallback">
            <Icon name="image" size={24} />
          </div>
        )}
      </div>
      <figcaption className="gallery-card-caption">
        <div className="gallery-card-title" title={item.title}>
          {item.title || 'Image'}
        </div>
        {item.source && (
          <div className="gallery-card-source">
            <span className="source-domain">{item.source}</span>
          </div>
        )}
      </figcaption>
    </figure>
  )
}

export default function ImageGallery({ data }) {
  const images = Array.isArray(data?.images) ? data.images : []
  const [layout, setLayout] = useState(data?.layout === 'grid' ? 'grid' : 'carousel')
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const carouselRef = useRef(null)

  if (!images.length) return null

  const scroll = (direction) => {
    if (!carouselRef.current) return
    const offset = carouselRef.current.clientWidth * 0.75
    carouselRef.current.scrollBy({
      left: direction === 'left' ? -offset : offset,
      behavior: 'smooth',
    })
  }

  return (
    <div className="image-gallery-widget">
      <div className="image-gallery-header">
        <div className="gallery-header-left">
          <Icon name="image" size={16} />
          <span className="gallery-title">{data.title || 'Image Gallery'}</span>
          <span className="gallery-count">{images.length}</span>
        </div>
        <div className="gallery-header-right">
          <button
            type="button"
            className={`gallery-view-btn${layout === 'carousel' ? ' is-active' : ''}`}
            onClick={() => setLayout('carousel')}
            title="Carousel view"
            aria-label="Carousel view"
          >
            <Icon name="rows" size={14} />
          </button>
          <button
            type="button"
            className={`gallery-view-btn${layout === 'grid' ? ' is-active' : ''}`}
            onClick={() => setLayout('grid')}
            title="Grid view"
            aria-label="Grid view"
          >
            <Icon name="grid" size={14} />
          </button>
        </div>
      </div>

      <div className="image-gallery-body">
        {layout === 'carousel' ? (
          <div className="carousel-wrapper">
            <button
              type="button"
              className="carousel-btn is-prev"
              onClick={() => scroll('left')}
              aria-label="Previous images"
            >
              <Icon name="back" size={16} />
            </button>
            <div className="carousel-container" ref={carouselRef}>
              {images.map((img, idx) => (
                <div key={idx} className="carousel-item">
                  <ImageCard item={img} index={idx} onOpen={setLightboxIndex} />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="carousel-btn is-next"
              onClick={() => scroll('right')}
              aria-label="Next images"
            >
              <Icon name="arrow-right" size={16} />
            </button>
          </div>
        ) : (
          <div className="grid-container">
            {images.map((img, idx) => (
              <ImageCard key={idx} item={img} index={idx} onOpen={setLightboxIndex} />
            ))}
          </div>
        )}
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
