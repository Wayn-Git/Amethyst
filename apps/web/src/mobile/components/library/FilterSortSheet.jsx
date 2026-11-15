import { useState, useEffect } from 'react'
import { BottomSheet, SectionLabel } from '../libraryUi.jsx'
import { ALL_11_TYPES, INK, MUTED, BLUE, BLUE_SOFT, DEEP_BLUE, CARD_SHADOW } from './tokens.js'
import { api } from '../../../api.js'

const SAVED_RANGES = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
]

const STATUS_OPTIONS = [
  { id: 'wishlist', label: 'Wishlist' },
  { id: 'playing', label: 'Playing' },
  { id: 'played', label: 'Played' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'favorites', label: 'Favorites' },
]

const SORT_OPTIONS = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'a_to_z', label: 'A to Z' },
  { id: 'last_opened', label: 'Last opened' },
]

export default function FilterSortSheet({
  open,
  onClose,
  filters = {},
  onApply,
}) {
  const [selectedTypes, setSelectedTypes] = useState(() => new Set(filters.types || []))
  const [savedRange, setSavedRange] = useState(filters.savedRange || 'any')
  const [status, setStatus] = useState(filters.status || '')
  const [selectedTags, setSelectedTags] = useState(() => new Set(filters.tags || []))
  const [sort, setSort] = useState(filters.sort || 'newest')
  const [availableTags, setAvailableTags] = useState([])
  const [resultCount, setResultCount] = useState(0)

  // Load tags live
  useEffect(() => {
    if (!open) return
    api
      .libraryTags()
      .then((res) => {
        if (res?.tags) setAvailableTags(res.tags.slice(0, 12))
      })
      .catch(() => {})
  }, [open])

  // Compute live match count debounced
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      const typesStr = Array.from(selectedTypes).join(',')
      const tagsStr = Array.from(selectedTags).join(',')
      api
        .library({
          types: typesStr,
          tags: tagsStr,
          status: status,
          sort: sort,
          limit: 1,
        })
        .then((res) => {
          setResultCount(res?.counts?.total ?? res?.items?.length ?? 0)
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [open, selectedTypes, selectedTags, status, sort])

  const toggleType = (typeId) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev)
      if (next.has(typeId)) next.delete(typeId)
      else next.add(typeId)
      return next
    })
  }

  const toggleTag = (tagName) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tagName)) next.delete(tagName)
      else next.add(tagName)
      return next
    })
  }

  const handleReset = () => {
    setSelectedTypes(new Set())
    setSavedRange('any')
    setStatus('')
    setSelectedTags(new Set())
    setSort('newest')
  }

  const handleApply = () => {
    onApply?.({
      types: Array.from(selectedTypes),
      savedRange,
      status,
      tags: Array.from(selectedTags),
      sort,
    })
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} headTitle="Filter and sort">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingBottom: 20 }}>
        {/* Type Section (11 multi-select chips) */}
        <div>
          <SectionLabel text="Type" style={{ margin: '10px 4px 10px' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ALL_11_TYPES.map((t) => {
              const on = selectedTypes.has(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleType(t.id)}
                  style={{
                    height: 40,
                    padding: '0 16px',
                    borderRadius: 20,
                    border: on ? 'none' : '1px solid #D8D8DE',
                    background: on ? BLUE : '#FFFFFF',
                    color: on ? '#FFFFFF' : INK,
                    fontSize: 15,
                    fontWeight: on ? 650 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Saved Date Section */}
        <div>
          <SectionLabel text="Saved" style={{ margin: '14px 4px 10px' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SAVED_RANGES.map((r) => {
              const on = savedRange === r.id
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSavedRange(r.id)}
                  style={{
                    height: 40,
                    padding: '0 16px',
                    borderRadius: 20,
                    border: on ? 'none' : '1px solid #D8D8DE',
                    background: on ? INK : '#FFFFFF',
                    color: on ? '#FFFFFF' : INK,
                    fontSize: 15,
                    fontWeight: on ? 650 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Status Section */}
        <div>
          <SectionLabel text="Status" style={{ margin: '14px 4px 10px' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {STATUS_OPTIONS.map((s) => {
              const on = status === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatus(on ? '' : s.id)}
                  style={{
                    height: 40,
                    padding: '0 16px',
                    borderRadius: 20,
                    border: on ? 'none' : '1px solid #D8D8DE',
                    background: on ? INK : '#FFFFFF',
                    color: on ? '#FFFFFF' : INK,
                    fontSize: 15,
                    fontWeight: on ? 650 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tags Section */}
        {availableTags.length > 0 && (
          <div>
            <SectionLabel text="Tags" style={{ margin: '14px 4px 10px' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {availableTags.map((tg) => {
                const on = selectedTags.has(tg.name)
                return (
                  <button
                    key={tg.name}
                    type="button"
                    onClick={() => toggleTag(tg.name)}
                    style={{
                      height: 40,
                      padding: '0 16px',
                      borderRadius: 20,
                      border: on ? 'none' : '1px solid #D8D8DE',
                      background: on ? BLUE : '#FFFFFF',
                      color: on ? '#FFFFFF' : INK,
                      fontSize: 15,
                      fontWeight: on ? 650 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    #{tg.name} {tg.count > 1 ? `(${tg.count})` : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Sort By Section */}
        <div>
          <SectionLabel text="Sort by" style={{ margin: '14px 4px 10px' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SORT_OPTIONS.map((so) => {
              const on = sort === so.id
              return (
                <button
                  key={so.id}
                  type="button"
                  onClick={() => setSort(so.id)}
                  style={{
                    height: 40,
                    padding: '0 16px',
                    borderRadius: 20,
                    border: on ? 'none' : '1px solid #D8D8DE',
                    background: on ? INK : '#FFFFFF',
                    color: on ? '#FFFFFF' : INK,
                    fontSize: 15,
                    fontWeight: on ? 650 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {so.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Action Buttons: Reset & Show N results */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <button
            type="button"
            onClick={handleReset}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 14,
              border: 0,
              background: 'rgba(118,118,128,.16)',
              color: INK,
              fontSize: 17,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleApply}
            style={{
              flex: 2,
              height: 52,
              borderRadius: 14,
              border: 0,
              background: BLUE,
              color: '#FFFFFF',
              fontSize: 17,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {resultCount > 0 ? `Show ${resultCount} results` : 'Show results'}
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
