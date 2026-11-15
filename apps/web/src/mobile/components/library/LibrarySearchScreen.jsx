import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../../api.js'
import { safeStorage } from '../../../lib/storage.js'
import { ListRowCard, SectionLabel, Skeleton } from '../libraryUi.jsx'
import { INK, MUTED, BLUE, BLUE_SOFT, DEEP_BLUE, ALL_11_TYPES, GLASS_STYLE, CARD_SHADOW } from './tokens.js'

const RECENT_SEARCHES_KEY = 'amethyst.mobile.recent_searches'

export default function LibrarySearchScreen({
  open = true,
  onClose,
  onBack,
  onSelectItem,
  onOpenItem,
  onOpenActions,
}) {
  const handleClose = onBack || onClose
  const handleSelect = onSelectItem || onOpenItem
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('all')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [recentSearches, setRecentSearches] = useState([])
  const [tryTerms, setTryTerms] = useState(['design', 'ai', 'video', 'tools', 'code'])
  const inputRef = useRef(null)

  // Load recent searches from storage
  useEffect(() => {
    if (open) {
      try {
        const raw = safeStorage.getItem(RECENT_SEARCHES_KEY)
        if (raw) setRecentSearches(JSON.parse(raw))
      } catch {}
      setTimeout(() => inputRef.current?.focus(), 80)

      // Fetch sample real terms for "Try instead"
      api
        .libraryTags()
        .then((res) => {
          if (res?.tags?.length) {
            setTryTerms(res.tags.slice(0, 5).map((t) => t.name))
          }
        })
        .catch(() => {})
    }
  }, [open])

  // Save query to recent searches
  const saveRecentSearch = (q) => {
    const text = q.trim()
    if (!text) return
    const next = [text, ...recentSearches.filter((s) => s.toLowerCase() !== text.toLowerCase())].slice(0, 8)
    setRecentSearches(next)
    try {
      safeStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next))
    } catch {}
  }

  const clearRecentSearches = () => {
    setRecentSearches([])
    try {
      safeStorage.removeItem(RECENT_SEARCHES_KEY)
    } catch {}
  }

  // Live full-text search with debounce
  useEffect(() => {
    if (!open) return
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = setTimeout(() => {
      api
        .library({
          q: query.trim(),
          kind: activeType === 'all' ? '' : activeType,
          limit: 100,
        })
        .then((res) => {
          setResults(res?.items || [])
        })
        .catch(() => {
          setResults([])
        })
        .finally(() => {
          setLoading(false)
        })
    }, 200)

    return () => clearTimeout(timer)
  }, [open, query, activeType])

  if (!open) return null

  const isQueryEmpty = !query.trim()
  const isZeroResults = !isQueryEmpty && !loading && results.length === 0

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#F2F2F7',
        zIndex: 120,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Search Header */}
      <div
        style={{
          padding: 'max(50px, env(safe-area-inset-top, 0px)) 16px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#F2F2F7',
          flex: 'none',
        }}
      >
        {/* 52pt glass search field with radius 26 */}
        <div
          style={{
            flex: 1,
            height: 52,
            borderRadius: 26,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px 0 16px',
            gap: 8,
            boxShadow: 'inset 0 0 0 1.5px #0B5FD9, 0 0 0 4px rgba(11,95,217,.14)',
            ...GLASS_STYLE,
            background: 'rgba(255,255,255,0.7)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#636366" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveRecentSearch(query)
              }
            }}
            placeholder="Search your library"
            style={{
              flex: 1,
              border: 0,
              outline: 'none',
              background: 'transparent',
              fontSize: 17,
              color: INK,
            }}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear input"
              onClick={() => setQuery('')}
              style={{
                border: 0,
                background: 'transparent',
                padding: 4,
                color: '#8E8E93',
                cursor: 'pointer',
                display: 'flex',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm4.3 14.3a.996.996 0 01-1.41 0L12 13.41 9.11 16.3a.996.996 0 11-1.41-1.41L10.59 12 7.7 9.11a.996.996 0 111.41-1.41L12 10.59l2.89-2.89a.996.996 0 111.41 1.41L13.41 12l2.89 2.89c.38.38.38 1.02 0 1.41z" />
              </svg>
            </button>
          )}
        </div>

        {/* Cancel button that stays inside screen */}
        <button
          type="button"
          onClick={handleClose}
          style={{
            border: 0,
            background: 'transparent',
            color: '#0A55C4',
            fontSize: 17,
            fontWeight: 600,
            padding: '0 4px',
            cursor: 'pointer',
            flex: 'none',
          }}
        >
          Cancel
        </button>
      </div>

      {/* Wrapping type chips */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          padding: '0 16px 12px',
          borderBottom: '1px solid #ECECF0',
          background: '#F2F2F7',
          flex: 'none',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveType('all')}
          style={{
            height: 38,
            padding: '0 16px',
            borderRadius: 19,
            border: activeType === 'all' ? 'none' : '1px solid #D8D8DE',
            background: activeType === 'all' ? INK : '#FFFFFF',
            color: activeType === 'all' ? '#FFFFFF' : INK,
            fontSize: 14,
            fontWeight: activeType === 'all' ? 650 : 500,
            cursor: 'pointer',
          }}
        >
          All
        </button>
        {ALL_11_TYPES.map((t) => {
          const on = activeType === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveType(on ? 'all' : t.id)}
              style={{
                height: 38,
                padding: '0 14px',
                borderRadius: 19,
                border: on ? 'none' : '1px solid #D8D8DE',
                background: on ? INK : '#FFFFFF',
                color: on ? '#FFFFFF' : INK,
                fontSize: 14,
                fontWeight: on ? 650 : 500,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Scrollable search body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          padding: '16px',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 40px)',
        }}
      >
        {/* Loading state */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={84} radius={22} />
            <Skeleton height={84} radius={22} />
            <Skeleton height={84} radius={22} />
          </div>
        )}

        {/* Empty Query State: Recent Searches + Browse By Tiles */}
        {isQueryEmpty && !loading && (
          <div>
            {recentSearches.length > 0 && (
              <div style={{ marginBottom: 28 }}>
                <SectionLabel
                  text="Recent searches"
                  style={{ margin: '8px 4px 10px' }}
                  action={
                    <button
                      type="button"
                      onClick={clearRecentSearches}
                      style={{
                        border: 0,
                        background: 'transparent',
                        color: '#0A55C4',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Clear
                    </button>
                  }
                />
                <div style={{ borderRadius: 20, background: '#FFFFFF', boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
                  {recentSearches.map((term, i) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => setQuery(term)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        minHeight: 52,
                        padding: '0 16px',
                        border: 0,
                        borderBottom: i === recentSearches.length - 1 ? 'none' : '1px solid #ECECF0',
                        background: 'transparent',
                        color: INK,
                        fontSize: 16,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span style={{ flex: 1 }}>{term}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Browse By Tiles */}
            <SectionLabel text="Browse by" style={{ margin: '8px 4px 12px' }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {[
                { label: 'Tags', icon: '#', action: () => setQuery('#') },
                { label: 'Creators', icon: '👤', action: () => {} },
                { label: 'Sources', icon: '🌐', action: () => {} },
                { label: 'Date saved', icon: '📅', action: () => {} },
              ].map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={b.action}
                  style={{
                    height: 72,
                    borderRadius: 18,
                    border: 0,
                    background: '#FFFFFF',
                    boxShadow: CARD_SHADOW,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    color: INK,
                    fontSize: 14,
                    fontWeight: 650,
                  }}
                >
                  <span style={{ fontSize: 20 }}>{b.icon}</span>
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Page 17: No Search Results State */}
        {isZeroResults && (
          <div style={{ textAlign: 'center', padding: '60px 24px 20px' }}>
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 28,
                background: '#E5E5EA',
                color: '#636366',
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4M8.5 11h5" />
              </svg>
            </div>

            <h2 style={{ margin: '18px 0 0', fontSize: 22, fontWeight: 800, letterSpacing: '-0.025em', color: INK }}>
              No results for “{query}”
            </h2>

            <p style={{ margin: '8px 0 0', fontSize: 15, color: MUTED }}>
              Checked titles, notes and tags.
            </p>

            <div style={{ marginTop: 20 }}>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setActiveType('all')
                }}
                style={{
                  height: 48,
                  padding: '0 24px',
                  borderRadius: 24,
                  border: 0,
                  background: BLUE,
                  color: '#FFFFFF',
                  fontSize: 16,
                  fontWeight: 650,
                  cursor: 'pointer',
                }}
              >
                Clear all filters
              </button>
            </div>

            {/* Try instead suggestions */}
            {tryTerms.length > 0 && (
              <div style={{ marginTop: 36, textAlign: 'left' }}>
                <SectionLabel text="Try instead" style={{ margin: '10px 4px 10px' }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {tryTerms.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setQuery(t)}
                      style={{
                        height: 40,
                        padding: '0 16px',
                        borderRadius: 20,
                        border: '1px solid #D8D8DE',
                        background: '#FFFFFF',
                        color: INK,
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live Search Results List */}
        {!isQueryEmpty && !loading && results.length > 0 && (
          <div>
            <SectionLabel
              text="Results"
              style={{ margin: '8px 4px 12px' }}
              action={
                <span style={{ fontSize: 13, color: MUTED }}>
                  {results.length} {results.length === 1 ? 'match' : 'matches'}
                </span>
              }
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {results.map((item) => (
                <ListRowCard
                  key={item.id}
                  item={item}
                  onClick={() => {
                    saveRecentSearch(query)
                    handleSelect?.(item)
                    handleClose?.()
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
