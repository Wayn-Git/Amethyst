import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { TimelineCard } from './LibraryListView.jsx'
import { GlassIconButton } from '../libraryUi.jsx'
import { safeStorage } from '../../../lib/storage.js'
import { INK, MUTED } from './tokens.js'

const RECENT_KEY = 'amethyst.library.recent_searches'

export default function LibrarySearchScreen({
  items = [],
  onBack,
  onOpenItem,
  onOpenActions,
  initialQuery = '',
}) {
  const [query, setQuery] = useState(initialQuery)
  const [recent, setRecent] = useState(() => {
    try {
      return JSON.parse(safeStorage.getItem(RECENT_KEY) || '[]')
    } catch {
      return []
    }
  })
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const saveToRecent = (q) => {
    const term = q.trim()
    if (!term) return
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 8)
    setRecent(next)
    try {
      safeStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {}
  }

  const clearRecent = () => {
    setRecent([])
    try {
      safeStorage.removeItem(RECENT_KEY)
    } catch {}
  }

  // Live filtered items
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return items.filter((item) => {
      const title = (item.title || '').toLowerCase()
      const author = (item.author || '').toLowerCase()
      const url = (item.url || '').toLowerCase()
      const notes = (item.notes || '').toLowerCase()
      const tags = Array.isArray(item.tags)
        ? item.tags.join(' ').toLowerCase()
        : String(item.tags || '').toLowerCase()
      return title.includes(q) || author.includes(q) || url.includes(q) || notes.includes(q) || tags.includes(q)
    })
  }, [items, query])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#F2F2F7', zIndex: 100, overflowY: 'auto', paddingBottom: 110 }}>
      {/* Top Search Bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          background: 'rgba(242,242,247,0.94)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px',
          zIndex: 10,
          borderBottom: '1px solid #ECECF0',
        }}
      >
        <GlassIconButton label="Back" width={42} onClick={onBack}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </GlassIconButton>

        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#8E8E93"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: 'absolute', left: 12 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>

          <input
            ref={inputRef}
            type="search"
            placeholder="Search titles, tags, notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                saveToRecent(query)
              }
            }}
            style={{
              width: '100%',
              height: 44,
              borderRadius: 14,
              border: '1px solid #D8D8DE',
              background: '#fff',
              padding: '0 38px 0 38px',
              fontSize: 16,
              color: INK,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />

          {query && (
            <button
              type="button"
              aria-label="Clear search"
              style={{
                position: 'absolute',
                right: 10,
                width: 22,
                height: 22,
                borderRadius: 11,
                border: 0,
                background: '#E5E5EA',
                color: '#636366',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              onClick={() => setQuery('')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* When no query entered: Show Recent searches & Browse creators */}
      {!query.trim() && (
        <div style={{ padding: '16px 16px' }}>
          {recent.length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
                  Recent searches
                </span>
                <button
                  type="button"
                  onClick={clearRecent}
                  style={{ border: 0, background: 'transparent', color: '#0A55C4', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  Clear
                </button>
              </div>

              <div style={{ background: '#fff', borderRadius: 20, padding: '0 16px', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)' }}>
                {recent.map((term, i) => (
                  <div
                    key={term}
                    onClick={() => {
                      setQuery(term)
                      saveToRecent(term)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: 48,
                      borderBottom: i === recent.length - 1 ? 0 : '1px solid #ECECF0',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span style={{ fontSize: 15, fontWeight: 600, color: INK }}>{term}</span>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 17L17 7M7 7h10v10" />
                    </svg>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Suggested searches */}
          <section>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
              Suggested
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['Videos', 'Recipes', 'Gaming', 'Articles', 'Watchlist'].map((s) => (
                <button
                  key={s}
                  type="button"
                  style={{
                    height: 38,
                    padding: '0 14px',
                    borderRadius: 19,
                    border: '1px solid #D8D8DE',
                    background: '#fff',
                    color: INK,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setQuery(s)
                    saveToRecent(s)
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* When query entered: Show Results or No-Results empty state */}
      {query.trim() && (
        <div style={{ padding: '16px 16px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
            {results.length} {results.length === 1 ? 'result' : 'results'} for “{query}”
          </div>

          {results.length === 0 ? (
            /* Spec §3.2 No Search Results */
            <div style={{ textAlign: 'center', padding: '48px 16px' }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 32,
                  background: '#E5E5EA',
                  color: '#8E8E93',
                  margin: '0 auto 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: INK }}>
                No results for “{query}”
              </h2>
              <p style={{ margin: '0 auto 20px', maxWidth: 280, fontSize: 15, lineHeight: '21px', color: MUTED }}>
                Check spelling, try different keywords, or broaden your search filter.
              </p>
              <button
                type="button"
                style={{
                  height: 44,
                  padding: '0 20px',
                  borderRadius: 22,
                  border: 0,
                  background: '#0B5FD9',
                  color: '#fff',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
                onClick={() => setQuery('')}
              >
                Clear search
              </button>
            </div>
          ) : (
            results.map((item) => (
              <TimelineCard
                key={item.id}
                item={item}
                onSelect={(it) => {
                  saveToRecent(query)
                  onOpenItem?.(it)
                }}
                onOpenActions={onOpenActions}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
