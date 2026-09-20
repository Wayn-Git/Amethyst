import Icon from '../../Icon.jsx'
import { copyText } from '../../../api.js'
import LoadMoreSentinel from '../LoadMoreSentinel.jsx'

export default function YouTubeBentoView({
  results = [],
  loading = false,
  error = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  activeIndex = 0,
  onSelect,
  onToast,
  sort = 'relevance',
  onSortChange,
}) {
  const sortBar = onSortChange ? (
    <div className="damon-yt-sort" role="group" aria-label="Sort videos">
      {[['relevance', 'Top'], ['date', 'Latest']].map(([id, label]) => (
        <button
          key={id}
          type="button"
          className={`damon-yt-sort-btn${sort === id ? ' is-active' : ''}`}
          aria-pressed={sort === id}
          onClick={() => onSortChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null

  if (loading && results.length === 0) {
    return (
      <>
      {sortBar}
      <div className="damon-loading-state">
        <div className="damon-spinner" />
        <span>Searching YouTube videos…</span>
      </div>
      </>
    )
  }

  if (results.length === 0) {
    return (
      <div className="damon-empty-state">
        <Icon name={error ? 'alert-triangle' : 'play'} size={24} />
        <p>{error ? 'YouTube search failed. Check your connection and try again.' : 'No YouTube videos found for this query.'}</p>
      </div>
    )
  }

  const handleCopy = async (e, url) => {
    e.stopPropagation()
    const ok = await copyText(url)
    if (ok && onToast) onToast('Video link copied', 'ok')
  }

  return (
    <>
    {sortBar}
    <div className="damon-youtube-grid" role="listbox" aria-label="YouTube search results">
      {results.map((video, i) => {
        const isSelected = i === activeIndex
        return (
          <div
            key={video.id || video.url}
            role="option"
            aria-selected={isSelected}
            data-active={isSelected}
            className={`damon-yt-card${isSelected ? ' is-active' : ''}`}
            style={{ '--i': i }}
            onClick={() => onSelect(video)}
          >
            <div className="damon-yt-thumb-wrap">
              <img
                src={video.thumbnail}
                alt={video.title}
                loading="lazy"
                className="damon-yt-thumb"
              />
              {video.duration && (
                <span className="damon-yt-duration">{video.duration}</span>
              )}
              <div className="damon-yt-play-overlay">
                <Icon name="play" size={20} />
              </div>
            </div>

            <div className="damon-yt-info">
              <h4 className="damon-yt-title" title={video.title}>
                {video.title}
              </h4>
              <div className="damon-yt-channel">{video.channel}</div>
              <div className="damon-yt-meta">
                {video.views && <span>{video.views}</span>}
                {video.views && video.published && <span>·</span>}
                {video.published && <span>{video.published}</span>}
              </div>
            </div>

            <div className="damon-yt-card-actions">
              <button
                type="button"
                className="damon-action-btn"
                title="Copy video link"
                onClick={(e) => handleCopy(e, video.url)}
              >
                <Icon name="copy" size={13} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
    <LoadMoreSentinel
      hasMore={hasMore}
      loading={loadingMore}
      onLoadMore={onLoadMore}
      label="More videos…"
    />
    </>
  )
}
