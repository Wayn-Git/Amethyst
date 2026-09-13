import Icon from '../../Icon.jsx'
import { copyText } from '../../../api.js'

export default function ImageGridView({
  results = [],
  loading = false,
  activeIndex = 0,
  onSelect,
  onToast,
}) {
  if (loading && results.length === 0) {
    return (
      <div className="damon-loading-state">
        <div className="damon-spinner" />
        <span>Searching images…</span>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="damon-empty-state">
        <Icon name="image" size={24} />
        <p>No images found for this query.</p>
      </div>
    )
  }

  const handleCopy = async (e, url) => {
    e.stopPropagation()
    const ok = await copyText(url)
    if (ok && onToast) onToast('Image URL copied', 'ok')
  }

  return (
    <div className="damon-image-grid" role="listbox" aria-label="Image search results">
      {results.map((img, i) => {
        const isSelected = i === activeIndex
        return (
          <div
            key={img.id || img.image || i}
            role="option"
            aria-selected={isSelected}
            data-active={isSelected}
            className={`damon-image-card${isSelected ? ' is-active' : ''}`}
            onClick={() => onSelect(img)}
          >
            <div className="damon-image-wrap">
              <img
                src={img.thumbnail || img.image}
                alt={img.title}
                loading="lazy"
                className="damon-img-thumb"
              />
              <div className="damon-image-overlay">
                <div className="damon-img-creator">{img.creator}</div>
                <div className="damon-img-card-actions">
                  <button
                    type="button"
                    className="damon-action-btn"
                    title="Copy image URL"
                    onClick={(e) => handleCopy(e, img.image)}
                  >
                    <Icon name="copy" size={12} />
                  </button>
                  <a
                    href={img.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="damon-action-btn"
                    title="Open source page"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="arrow-up-right" size={12} />
                  </a>
                </div>
              </div>
            </div>
            <div className="damon-image-caption" title={img.title}>
              {img.title}
            </div>
          </div>
        )
      })}
    </div>
  )
}
