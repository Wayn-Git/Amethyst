import { useState, useEffect, useMemo } from 'react'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

/**
 * Library Card:
 * - Shows bookmarks/links saved to the library on the current date only
 * - Each entry: short title + small thumbnail, positioned per reference image
 * - Resets daily — starts fresh each new day, showing only that day's saves
 * - Empty state: "No bookmarks today."
 * - Fixed permanent size, internal scroll if bookmarks overflow
 * - Theme/accent-color aware, with interactive micro-animations on hover/open
 */
export default function TodayLibraryCard({ setView, todayItems = null }) {
  const [libraryItems, setLibraryItems] = useState([])
  const [loading, setLoading] = useState(true)

  const todayStr = useMemo(() => {
    // Current date string in local timezone (YYYY-MM-DD)
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const res = await api.library({ limit: 50, order: 'desc' })
        if (!cancelled && res?.items) {
          setLibraryItems(res.items)
        }
      } catch {
        if (!cancelled) setLibraryItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Filter items strictly saved on current date only
  const todaysBookmarks = useMemo(() => {
    // If todayItems from /today signals passed in and has items, check both
    const source = libraryItems.length > 0 ? libraryItems : (todayItems || [])
    return source.filter((item) => {
      if (item.consumed_on === todayStr) return true
      if (item.created_at && item.created_at.slice(0, 10) === todayStr) return true
      if (item.published_on === todayStr) return true
      return false
    })
  }, [libraryItems, todayItems, todayStr])

  return (
    <section className="today-card">
      {/* Header */}
      <div className="today-card-head">
        <div className="today-card-title-group">
          <div className="today-card-icon-pill">
            <Icon name="bookmark" size={16} />
          </div>
          <h3 className="today-card-title">Library</h3>
          <span className="today-card-badge">
            {todaysBookmarks.length} saved today
          </span>
        </div>

        <div className="today-card-actions">
          <button
            type="button"
            className="btn btn--small btn--ghost"
            style={{ borderRadius: 9999, padding: '4px 10px', fontSize: 12 }}
            onClick={() => setView?.('library')}
          >
            Library <Icon name="arrow-up-right" size={12} />
          </button>
        </div>
      </div>

      {/* Internal Scrollable Content */}
      <div className="today-card-scroll">
        {todaysBookmarks.length === 0 ? (
          <div className="today-card-empty">
            <div className="today-empty-icon-wrap">
              <Icon name="bookmark" size={24} />
            </div>
            <div className="today-empty-title">No bookmarks today.</div>
            <div className="today-empty-desc">
              Bookmarks and reading saved today will appear here and reset each new day.
            </div>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={() => setView?.('library')}
            >
              Browse library
            </button>
          </div>
        ) : (
          <div className="today-library-list">
            {todaysBookmarks.map((item) => {
              const domain = item.url
                ? item.url.replace(/^https?:\/\//, '').split('/')[0]
                : item.site || item.author || 'Bookmark'

              return (
                <a
                  key={item.id}
                  href={item.url || '#'}
                  target={item.url ? '_blank' : undefined}
                  rel="noreferrer"
                  className="today-library-row"
                  onClick={(e) => {
                    if (!item.url) {
                      e.preventDefault()
                      setView?.('library')
                    }
                  }}
                >
                  {/* Small thumbnail on left per reference image */}
                  <div className="today-library-thumb-wrap">
                    <img
                      src={api.thumbnailUrl(item.id)}
                      alt=""
                      className="today-library-thumb"
                      onError={(e) => {
                        e.target.style.display = 'none'
                        e.target.nextSibling.style.display = 'flex'
                      }}
                    />
                    <div
                      className="today-library-fallback-icon"
                      style={{ display: 'none', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Icon name="link" size={18} />
                    </div>
                  </div>

                  {/* Short Title & Meta info */}
                  <div className="today-library-info">
                    <div className="today-library-title" title={item.title}>
                      {item.title || 'Untitled bookmark'}
                    </div>
                    <div className="today-library-sub">
                      <span>{domain}</span>
                      {item.kind && (
                        <span className="today-library-kind-tag">
                          {item.kind}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ color: 'var(--text-faint)', flexShrink: 0 }}>
                    <Icon name="arrow-up-right" size={14} />
                  </div>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
