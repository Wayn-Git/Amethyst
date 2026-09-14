import Icon from '../../Icon.jsx'
import { copyText, openUrl } from '../../../api.js'
import LoadMoreSentinel from '../LoadMoreSentinel.jsx'

export default function WebResultsView({
  results = [],
  query = '',
  loading = false,
  note = null,
  error = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  activeIndex = 0,
  onSelect,
  onToast,
}) {
  if (loading && results.length === 0) {
    return (
      <div className="damon-loading-state">
        <div className="damon-spinner" />
        <span>Searching the web…</span>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="damon-empty-state">
        <Icon name={error ? 'alert-triangle' : 'globe'} size={24} />
        <p>{error ? 'Web search failed. Check your connection and try again.' : 'No web results came back for this.'}</p>
        <div className="damon-fallback-actions">
          <button
            type="button"
            className="damon-primary-action-btn"
            onClick={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent(query || '')}`)}
          >
            <Icon name="arrow-up-right" size={14} />
            <span>Search Google in browser</span>
          </button>
        </div>
      </div>
    )
  }

  const handleCopy = async (e, url) => {
    e.stopPropagation()
    const ok = await copyText(url)
    if (ok && onToast) onToast('URL copied to clipboard', 'ok')
  }

  return (
    <div className="damon-web-list" role="listbox" aria-label="Web search results">
      {note && <p className="damon-mixed-note">{note}</p>}
      {results.map((res, i) => {
        const isSelected = i === activeIndex
        return (
          <div
            key={res.url + i}
            role="option"
            aria-selected={isSelected}
            data-active={isSelected}
            className={`damon-web-item${isSelected ? ' is-active' : ''}`}
            style={{ '--i': i }}
            onClick={() => onSelect(res)}
          >
            <div className="damon-web-main">
              <div className="damon-web-meta">
                <span className="damon-web-domain">
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${res.domain}&sz=32`}
                    alt=""
                    className="damon-favicon"
                    onError={(e) => { e.target.style.display = 'none' }}
                  />
                  {res.domain}
                </span>
                <span className="damon-web-url">{res.url}</span>
              </div>
              <h4 className="damon-web-title">{res.title}</h4>
              {res.snippet && <p className="damon-web-snippet">{res.snippet}</p>}
            </div>

            <div className="damon-web-actions">
              <button
                type="button"
                className="damon-action-btn"
                title="Copy URL"
                onClick={(e) => handleCopy(e, res.url)}
              >
                <Icon name="copy" size={13} />
              </button>
              <kbd className="kbd">↵ Open</kbd>
            </div>
          </div>
        )
      })}
      <LoadMoreSentinel
        hasMore={hasMore}
        loading={loadingMore}
        onLoadMore={onLoadMore}
        label="More web results…"
      />
    </div>
  )
}
