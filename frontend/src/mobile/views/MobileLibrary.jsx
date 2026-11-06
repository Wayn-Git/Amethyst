import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

function formatSavedDate(dateStr) {
  if (!dateStr) return 'Recently'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function MobileLibrary({ onSelectItem, onOpenAsk }) {
  const [items, setItems] = useState([])
  const [lists, setLists] = useState([])
  const [counts, setCounts] = useState({})
  const [filter, setFilter] = useState('all') // 'all' | 'reel' | 'article' | 'note' | 'post'
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const loadLibrary = useCallback(async () => {
    try {
      const [libRes, listsRes] = await Promise.allSettled([
        api.library({ limit: 200 }),
        api.get('/library/lists'),
      ])

      if (libRes.status === 'fulfilled' && libRes.value) {
        if (libRes.value.items) setItems(libRes.value.items)
        if (libRes.value.counts) setCounts(libRes.value.counts)
      }
      if (listsRes.status === 'fulfilled' && Array.isArray(listsRes.value)) {
        setLists(listsRes.value)
      }
    } catch (err) {
      console.warn('[MobileLibrary] Load failed:', err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  const reelsCount =
    counts.reel ||
    counts.video ||
    items.filter((i) => i.kind === 'reel' || i.kind === 'video').length
  const articlesCount =
    counts.article ||
    counts.link ||
    items.filter((i) => i.kind === 'article' || i.kind === 'link').length
  const notesCount = counts.note || items.filter((i) => i.kind === 'note').length
  const postsCount =
    counts.post ||
    counts.social ||
    items.filter((i) => i.kind === 'post' || i.kind === 'social').length

  const filteredItems = items.filter((item) => {
    if (filter === 'reel' && item.kind !== 'reel' && item.kind !== 'video') return false
    if (filter === 'article' && item.kind !== 'article' && item.kind !== 'link') return false
    if (filter === 'note' && item.kind !== 'note') return false
    if (filter === 'post' && item.kind !== 'post' && item.kind !== 'social') return false
    if (
      query &&
      !item.title?.toLowerCase().includes(query.toLowerCase()) &&
      !item.summary?.toLowerCase().includes(query.toLowerCase())
    ) {
      return false
    }
    return true
  })

  return (
    <motion.div
      className="m-body"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Header */}
      <div className="m-r m-sp">
        <div>
          <div className="m-gl">Your</div>
          <h1 className="m-h">Library</h1>
        </div>
        <button
          type="button"
          className="m-ib"
          aria-label="Refresh"
          onClick={() => {
            setLoading(true)
            loadLibrary()
          }}
        >
          <Icon name="arrow-clockwise" size={20} />
        </button>
      </div>

      {/* Search Input with embedded Ask Button */}
      <div
        className="m-r"
        style={{
          background: '#F6F4F1',
          borderRadius: 999,
          padding: '0 8px 0 18px',
          boxShadow: '0 1px 2px rgba(30,25,20,0.05)',
        }}
      >
        <span style={{ color: '#6E6A64', display: 'flex' }}>
          <Icon name="search" size={18} />
        </span>
        <input
          className="m-in"
          placeholder="Search or ask your library"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="m-ib"
            style={{ width: 28, height: 28, background: 'none', boxShadow: 'none' }}
            onClick={() => setQuery('')}
          >
            <Icon name="x" size={14} />
          </button>
        )}
        <button
          type="button"
          className="m-ch"
          style={{ background: '#111113', color: '#fff', padding: '8px 14px' }}
          onClick={onOpenAsk}
        >
          <Icon name="sparkle" size={14} />
          Ask
        </button>
      </div>

      {/* Filter Chips */}
      <div className="m-r" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
        <button
          type="button"
          className={`m-ch ${filter === 'all' ? 'on' : ''}`}
          onClick={() => setFilter('all')}
        >
          All {items.length}
        </button>
        <button
          type="button"
          className={`m-ch ${filter === 'reel' ? 'on' : ''}`}
          onClick={() => setFilter('reel')}
        >
          Reels {reelsCount}
        </button>
        <button
          type="button"
          className={`m-ch ${filter === 'article' ? 'on' : ''}`}
          onClick={() => setFilter('article')}
        >
          Articles {articlesCount}
        </button>
        <button
          type="button"
          className={`m-ch ${filter === 'note' ? 'on' : ''}`}
          onClick={() => setFilter('note')}
        >
          Notes {notesCount}
        </button>
        <button
          type="button"
          className={`m-ch ${filter === 'post' ? 'on' : ''}`}
          onClick={() => setFilter('post')}
        >
          Posts {postsCount}
        </button>
      </div>

      {/* Bento Tiles Carousel */}
      <div
        className="m-r"
        style={{
          gap: 10,
          overflowX: 'auto',
          marginRight: -18,
          paddingRight: 18,
          scrollbarWidth: 'none',
        }}
      >
        {/* Read Later / Articles */}
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 24,
            padding: 14,
            background: filter === 'article' ? '#111113' : '#F9F8F6',
            color: filter === 'article' ? '#fff' : '#141414',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            cursor: 'pointer',
          }}
          onClick={() => setFilter(filter === 'article' ? 'all' : 'article')}
        >
          <Icon name="clock" size={20} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Articles</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{articlesCount} items</div>
          </div>
        </div>

        {/* Reels */}
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 24,
            padding: 14,
            background: filter === 'reel' ? '#111113' : '#F9F8F6',
            color: filter === 'reel' ? '#fff' : '#141414',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            cursor: 'pointer',
          }}
          onClick={() => setFilter(filter === 'reel' ? 'all' : 'reel')}
        >
          <Icon name="play" size={20} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Reels</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{reelsCount} saved</div>
          </div>
        </div>

        {/* Notes */}
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 24,
            padding: 14,
            background: filter === 'note' ? '#111113' : '#F9F8F6',
            color: filter === 'note' ? '#fff' : '#141414',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            cursor: 'pointer',
          }}
          onClick={() => setFilter(filter === 'note' ? 'all' : 'note')}
        >
          <Icon name="file-text" size={20} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Notes</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{notesCount} saved</div>
          </div>
        </div>

        {/* Posts */}
        <div
          style={{
            width: 104,
            height: 104,
            borderRadius: 24,
            padding: 14,
            background: filter === 'post' ? '#111113' : '#F9F8F6',
            color: filter === 'post' ? '#fff' : '#141414',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            cursor: 'pointer',
          }}
          onClick={() => setFilter(filter === 'post' ? 'all' : 'post')}
        >
          <Icon name="tag" size={20} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Posts</div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{postsCount} items</div>
          </div>
        </div>
      </div>

      {/* Collections Section */}
      <div className="m-r m-sp">
        <span className="m-st">Collections</span>
        <span className="m-m">{lists.length} lists</span>
      </div>

      <div className="m-r" style={{ gap: 12, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {lists.length > 0 ? (
          lists.map((list, idx) => (
            <div
              key={list.id || idx}
              className="m-col"
              style={{ gap: 8, minWidth: 140, flex: 1, cursor: 'pointer' }}
              onClick={() => {
                if (list.title) setQuery(list.title)
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: 104,
                  borderRadius: 24,
                  background: idx % 2 === 0 ? '#111113' : '#DAD5CC',
                  color: idx % 2 === 0 ? '#D6F23E' : '#111113',
                  overflow: 'hidden',
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name={list.icon || 'folder'} size={32} />
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{list.title}</div>
                <div className="m-m">{list.item_count || list.count || 0} items</div>
              </div>
            </div>
          ))
        ) : (
          <div
            className="m-c"
            style={{ width: '100%', padding: '16px 20px', textAlign: 'center', color: '#6E6A64' }}
          >
            No custom collections created yet.
          </div>
        )}
      </div>

      {/* Recent Items Section */}
      <div className="m-r m-sp">
        <span className="m-st">Recent</span>
        <span className="m-m">{filteredItems.length} items</span>
      </div>

      <div className="m-c" style={{ padding: '4px 16px' }}>
        {filteredItems.map((item, idx) => {
          let host = ''
          if (item.url) {
            try {
              host = new URL(item.url).hostname
            } catch {
              host = item.url
            }
          }
          return (
            <div key={item.uuid || item.id || idx}>
              <div
                className="m-r"
                style={{ padding: '12px 0', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}
                onClick={() => onSelectItem && onSelectItem(item)}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    background: idx % 2 === 0 ? '#D6F23E' : '#F2EFEA',
                    color: '#111113',
                    overflow: 'hidden',
                    flex: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon
                    name={
                      item.kind === 'reel' || item.kind === 'video'
                        ? 'play'
                        : item.kind === 'note'
                          ? 'file-text'
                          : 'book'
                    }
                    size={24}
                  />
                </div>

                <div className="m-col" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                  <div
                    className="m-ttl"
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title || 'Untitled save'}
                  </div>
                  <div
                    className="m-m"
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {host || (item.kind ? `${item.kind.toUpperCase()}` : 'Note')}, {formatSavedDate(item.created_at || item.saved_at)}
                  </div>
                  <span className="m-m m-r" style={{ gap: 4, color: '#141414' }}>
                    <Icon name="check" size={12} />
                    {item.summary ? 'Summarised' : 'Saved'}
                  </span>
                </div>
              </div>
              {idx < filteredItems.length - 1 && <div className="m-hr" />}
            </div>
          )
        })}

        {!filteredItems.length && !loading && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }} className="m-col">
            <Icon name="book" size={32} style={{ color: '#9A958E', margin: '0 auto 8px' }} />
            <div style={{ fontWeight: 600, fontSize: 16 }}>No items in library</div>
            <div className="m-m" style={{ marginTop: 4 }}>
              {query
                ? 'No saves match your search filter.'
                : 'Capture notes, links, or clips to see them here.'}
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '24px 16px', color: '#6E6A64' }}>
            Loading library…
          </div>
        )}
      </div>
    </motion.div>
  )
}
