import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api, appendAuthToken, getBase } from '../../api.js'
import { safeStorage } from '../../lib/storage.js'

function formatSavedDate(dateStr) {
  if (!dateStr) return 'Recently'
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return 'Recently'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function getItemDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function resolveThumbnail(item) {
  if (!item) return ''
  if (item.thumbnail_url) {
    if (item.thumbnail_url.startsWith('http')) return appendAuthToken(item.thumbnail_url)
    if (item.thumbnail_url.startsWith('/api')) {
      return appendAuthToken(`${getBase().replace(/\/api$/, '')}${item.thumbnail_url}`)
    }
    return api.thumbnailUrl ? api.thumbnailUrl(item.id) : item.thumbnail_url
  }
  if (item.thumbnail_path || item.has_thumbnail) {
    return api.thumbnailUrl ? api.thumbnailUrl(item.id) : ''
  }
  return ''
}

function resolveCollectionCover(collection) {
  if (!collection) return ''
  if (collection.cover_item_id) {
    return api.thumbnailUrl ? api.thumbnailUrl(collection.cover_item_id) : ''
  }
  if (collection.thumbnail_url) {
    if (collection.thumbnail_url.startsWith('http')) return appendAuthToken(collection.thumbnail_url)
    if (collection.thumbnail_url.startsWith('/api')) {
      return appendAuthToken(`${getBase().replace(/\/api$/, '')}${collection.thumbnail_url}`)
    }
    return collection.thumbnail_url
  }
  return ''
}

export default function MobileLibrary({ onSelectItem, onOpenAsk }) {
  const [items, setItems] = useState(() => {
    try {
      const cached = safeStorage.getItem('amethyst.cached_library')
      return cached ? JSON.parse(cached) : []
    } catch {
      return []
    }
  })
  const [lists, setLists] = useState([])
  const [counts, setCounts] = useState({})
  const [activeTab, setActiveTab] = useState('saved') // 'saved' | 'collections'
  const [filter, setFilter] = useState('all') // 'all' | 'video' | 'article' | 'post'
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [loading, setLoading] = useState(!items.length)
  const [syncing, setSyncing] = useState(false)
  const [syncNotice, setSyncNotice] = useState('')
  const [earlierLimit, setEarlierLimit] = useState(15)

  const loadLibrary = useCallback(async (isManualSync = false) => {
    if (isManualSync) setSyncing(true)
    try {
      if (isManualSync) {
        // Trigger background Google Drive sync engine run if connected
        try {
          await api.post('/library/sync/start', {})
        } catch {}
      }

      const [libRes, listsRes] = await Promise.allSettled([
        api.library({ limit: 300 }),
        api.get('/library/lists'),
      ])

      let loadedCount = 0
      if (libRes.status === 'fulfilled' && libRes.value) {
        if (libRes.value.items) {
          setItems(libRes.value.items)
          loadedCount = libRes.value.items.length
          try {
            safeStorage.setItem('amethyst.cached_library', JSON.stringify(libRes.value.items))
          } catch {}
        }
        if (libRes.value.counts) setCounts(libRes.value.counts)
      }

      if (listsRes.status === 'fulfilled' && Array.isArray(listsRes.value)) {
        setLists(listsRes.value)
      }

      if (isManualSync) {
        setSyncNotice(`Synced ${loadedCount} items with Google Drive`)
        setTimeout(() => setSyncNotice(''), 4000)
      }
    } catch (err) {
      console.warn('[MobileLibrary] Load failed:', err.message)
      if (isManualSync) {
        setSyncNotice(`Sync notice: ${err.message}`)
        setTimeout(() => setSyncNotice(''), 4000)
      }
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'video' && item.kind !== 'video' && item.kind !== 'reel') return false
      if (filter === 'article' && item.kind !== 'article') return false
      if (filter === 'post' && item.kind !== 'post') return false
      if (query.trim()) {
        const q = query.toLowerCase()
        const titleMatch = (item.title || '').toLowerCase().includes(q)
        const summaryMatch = (item.summary || '').toLowerCase().includes(q)
        const authorMatch = (item.author || item.channel || '').toLowerCase().includes(q)
        return titleMatch || summaryMatch || authorMatch
      }
      return true
    })
  }, [items, filter, query])

  // Clean chronological grouping: Today, Yesterday, This Week, and Month groups
  const dateGroups = useMemo(() => {
    const now = new Date()
    const todayStr = now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const yesterdayStr = yesterday.toDateString()
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const todayList = []
    const yesterdayList = []
    const thisWeekList = []
    const monthMap = new Map()

    filteredItems.forEach((item) => {
      const d = new Date(item.created_at || Date.now())
      const dStr = d.toDateString()
      if (dStr === todayStr) {
        todayList.push(item)
      } else if (dStr === yesterdayStr) {
        yesterdayList.push(item)
      } else if (d > oneWeekAgo) {
        thisWeekList.push(item)
      } else {
        const monthYear = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        if (!monthMap.has(monthYear)) monthMap.set(monthYear, [])
        monthMap.get(monthYear).push(item)
      }
    })

    const groups = []
    if (todayList.length) groups.push({ id: 'today', title: 'Today', items: todayList })
    if (yesterdayList.length) groups.push({ id: 'yesterday', title: 'Yesterday', items: yesterdayList })
    if (thisWeekList.length) groups.push({ id: 'this_week', title: 'This Week', items: thisWeekList })
    for (const [title, list] of monthMap.entries()) {
      groups.push({ id: title.toLowerCase().replace(/\s+/g, '_'), title, items: list })
    }
    return groups
  }, [filteredItems])

  const [expandedGroups, setExpandedGroups] = useState({})

  const toggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  const renderItemCard = (item, idx, listRef) => {
    const thumb = resolveThumbnail(item)
    const isVideo = item.kind === 'video' || item.kind === 'reel' || item.is_reel

    return (
      <div key={item.id || idx}>
        <div
          className="r"
          style={{ padding: '12px 0', gap: 12, cursor: 'pointer' }}
          onClick={() => onSelectItem(item)}
        >
          {/* Actual Thumbnail or domain fallback badge */}
          <div
            style={{
              width: 88,
              height: 56,
              borderRadius: 14,
              background: '#101012',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
              letterSpacing: '-0.03em',
              flex: 'none',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {thumb && (
              <img
                src={thumb}
                alt={item.title}
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  if (e.currentTarget.nextElementSibling) {
                    e.currentTarget.nextElementSibling.style.display = 'flex'
                  }
                }}
              />
            )}
            <span
              style={{
                display: thumb ? 'none' : 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                height: '100%',
                textAlign: 'center',
                padding: '0 6px',
                color: '#8E8E93',
                fontSize: 11,
                fontWeight: 600,
                background: '#1A1A1E',
              }}
            >
              {item.kind === 'note' ? '📝 Note' : (item.channel || item.author || getItemDomain(item.url) || 'Amethyst')}
            </span>

            {isVideo && (
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="#fff" aria-hidden="true">
                  <polygon points="6 3 20 12 6 21 6 3" />
                </svg>
              </span>
            )}
          </div>

          {/* Content details */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              className="ttl"
              style={{
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.title}
            </div>
            <div className="m" style={{ marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.author || item.channel || getItemDomain(item.url) || 'Web'} ·{' '}
              {item.kind ? item.kind.charAt(0).toUpperCase() + item.kind.slice(1) : 'Article'}
              {item.duration ? ` · ${item.duration}` : ''}
            </div>
          </div>
        </div>
        {idx < listRef.length - 1 && <div className="hr" />}
      </div>
    )
  }

  return (
    <motion.div
      className="b"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{ paddingBottom: 'max(140px, calc(env(safe-area-inset-bottom, 24px) + 120px))' }}
    >
      {/* Top Header */}
      <div className="r sp">
        <h1 className="h">Library</h1>
        <div className="r" style={{ gap: 8 }}>
          {/* Real Sync Button */}
          <button
            type="button"
            className="ib"
            aria-label="Sync library with Google Drive"
            title="Sync with Google Drive & PC"
            disabled={syncing}
            onClick={() => loadLibrary(true)}
            style={{ width: 38, height: 38 }}
          >
            <motion.svg
              animate={syncing ? { rotate: 360 } : { rotate: 0 }}
              transition={syncing ? { repeat: Infinity, duration: 1, ease: 'linear' } : {}}
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </motion.svg>
          </button>

          <button
            type="button"
            className="ib"
            aria-label="Search"
            style={{ width: 38, height: 38 }}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>

          <button
            type="button"
            className="ib"
            aria-label="Add"
            style={{ width: 38, height: 38 }}
            onClick={onOpenAsk}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sync Status Banner */}
      <AnimatePresence>
        {syncNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="r"
            style={{
              padding: '8px 14px',
              background: '#E5F0FF',
              color: '#0058B8',
              borderRadius: 14,
              fontSize: 12.5,
              fontWeight: 500,
              gap: 8,
            }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span>{syncNotice}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Expandable Search Input Bar */}
      <AnimatePresence>
        {searchOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="r"
            style={{
              background: '#FFFFFF',
              borderRadius: 999,
              padding: '0 16px',
              boxShadow: '0 1px 2px rgba(0,0,0,.05)',
            }}
          >
            <span style={{ color: '#6E6E73', display: 'flex' }}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </span>
            <input
              className="in"
              autoFocus
              placeholder="Search saves, videos, articles…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                style={{ border: 0, background: 'none', color: '#6E6E73', cursor: 'pointer' }}
              >
                ✕
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Segmented Control: Saved vs Collections */}
      <div className="seg">
        <span
          className={activeTab === 'saved' ? 'on' : ''}
          onClick={() => setActiveTab('saved')}
        >
          Saved ({filteredItems.length})
        </span>
        <span
          className={activeTab === 'collections' ? 'on' : ''}
          onClick={() => setActiveTab('collections')}
        >
          Collections ({lists.length})
        </span>
      </div>

      {activeTab === 'saved' ? (
        <>
          {/* Category Filter Chips */}
          <div className="r sp">
            <div className="r" style={{ gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
              <button
                type="button"
                className={`ch ${filter === 'all' ? 'on' : ''}`}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`ch ${filter === 'video' ? 'on' : ''}`}
                onClick={() => setFilter('video')}
              >
                Videos
              </button>
              <button
                type="button"
                className={`ch ${filter === 'article' ? 'on' : ''}`}
                onClick={() => setFilter('article')}
              >
                Articles
              </button>
              <button
                type="button"
                className={`ch ${filter === 'post' ? 'on' : ''}`}
                onClick={() => setFilter('post')}
              >
                Posts
              </button>
            </div>
          </div>

          {/* Chronological Date Groups */}
          {dateGroups.map((group) => {
            const isExpanded = Boolean(expandedGroups[group.id])
            const visibleItems = isExpanded ? group.items : group.items.slice(0, 8)
            const remaining = group.items.length - 8

            return (
              <div key={group.id} className="col" style={{ gap: 8 }}>
                <div className="r sp" style={{ marginBottom: -2, marginTop: 4 }}>
                  <span className="st" style={{ fontSize: 17 }}>
                    {group.title}
                  </span>
                  <span className="m">{group.items.length} saved</span>
                </div>
                <div className="c" style={{ padding: '2px 16px' }}>
                  {visibleItems.map((item, idx) => renderItemCard(item, idx, visibleItems))}
                </div>
                {remaining > 0 && (
                  <button
                    type="button"
                    className="ch glass"
                    style={{
                      width: '100%',
                      justifyContent: 'center',
                      padding: '10px 0',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleGroup(group.id)}
                  >
                    {isExpanded ? 'Show less ↑' : `Show all ${group.items.length} items (${remaining} more) ↓`}
                  </button>
                )}
              </div>
            )
          })}

          {!filteredItems.length && !loading && (
            <div style={{ textAlign: 'center', padding: '48px 16px' }} className="col">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#8E8E93" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 8px' }} aria-hidden="true">
                <path d="M12 7v14" />
                <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
              </svg>
              <div style={{ fontWeight: 600, fontSize: 17 }}>Your Library is empty</div>
              <div className="m" style={{ maxWidth: 280, margin: '4px auto 16px' }}>
                Your saved videos and notes sync directly from your desktop and Google Drive.
              </div>
              <button
                type="button"
                className="bt"
                style={{ margin: '0 auto', padding: '0 24px', height: 44, borderRadius: 999 }}
                onClick={() => loadLibrary(true)}
                disabled={syncing}
              >
                {syncing ? 'Syncing library…' : 'Sync Library Now'}
              </button>
            </div>
          )}
        </>
      ) : (
        /* Collections Grid with real cover thumbnails */
        <div className="g2" style={{ rowGap: 18 }}>
          {lists.length > 0 ? (
            lists.map((collection, idx) => {
              const coverThumb = resolveCollectionCover(collection)

              return (
                <motion.div
                  key={collection.id || idx}
                  className="col"
                  style={{ gap: 8, cursor: 'pointer' }}
                  whileTap={{ scale: 0.97 }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: 120,
                      borderRadius: 24,
                      background: idx % 2 === 0 ? '#111113' : '#E5E5EA',
                      color: idx % 2 === 0 ? '#fff' : '#1D1D1F',
                      overflow: 'hidden',
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    {coverThumb ? (
                      <img
                        src={coverThumb}
                        alt={collection.title}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    ) : (
                      <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                        <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
                        <circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
                        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {collection.title || collection.name}
                    </div>
                    <div className="m">
                      {collection.item_count !== undefined ? `${collection.item_count} items` : 'Collection'}
                    </div>
                  </div>
                </motion.div>
              )
            })
          ) : (
            <div className="c m" style={{ gridColumn: 'span 2', textAlign: 'center', padding: 24 }}>
              No collections created yet.
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}
