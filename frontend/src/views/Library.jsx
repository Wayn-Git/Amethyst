import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api } from '../api.js'
import { SkeletonLibraryGrid } from '../components/Skeleton.jsx'
import { EmptyState } from '../components/application/empty-state/empty-state.tsx'
import ErrorState from '../components/ui/ErrorState.jsx'

import LibraryToolbar from './library/LibraryToolbar.jsx'
import LibraryFilterBar from './library/LibraryFilterBar.jsx'
import LibraryTagRail from './library/LibraryTagRail.jsx'
import LibraryGrid from './library/LibraryGrid.jsx'
import LibraryListView from './library/LibraryListView.jsx'
import LibraryDetailModal from './library/LibraryDetailModal.jsx'
import AddContentModal from './library/AddContentModal.jsx'
import ExportPlaylistModal from './library/ExportPlaylistModal.jsx'
import { CaptureIntegrationsModal } from './library/SharePanels.jsx'
import { getDomain } from './library/LibraryCard.jsx'
import { AnimatePresence, motion } from 'framer-motion'
import { safeStorage } from '../lib/storage.js'
import { IS_MAC } from '../keys.js'

export default function Library() {
  const rootRef = useRef(null)
  const searchInputRef = useRef(null)
  const captureInputRef = useRef(null)
  const { toast } = useApp()
  const [params, setParams] = useSearchParams()

  // Where the bookmarklet sends a link: /library?url=…. Read on the first
  // render rather than in an effect, because the filter-sync effect below
  // rewrites the query string on mount and would have dropped it first.
  const incomingUrl = useRef(params.get('url') || null)

  // Data state
  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({})
  const [categoryCounts, setCategoryCounts] = useState({})
  const [tagCounts, setTagCounts] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  // Omnibar quick-capture text state
  const [quickCaptureText, setQuickCaptureText] = useState('')

  // Filter & layout state
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedKinds, setSelectedKinds] = useState([])
  const [selectedCategories, setSelectedCategories] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedRatings, setSelectedRatings] = useState([])
  const [order, setOrder] = useState('desc')
  const [layout, setLayout] = useState(() => safeStorage.getItem('amethyst_lib_layout', 'grid'))
  const [railOpen, setRailOpen] = useState(() => safeStorage.getItem('amethyst_lib_rail') !== 'false')

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalMode, setAddModalMode] = useState('url')
  const [showShare, setShowShare] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportItems, setExportItems] = useState([])
  const [activeModalItem, setActiveModalItem] = useState(null)
  const [busyId, setBusyId] = useState(null)

  // Polling tracking refs
  const loadToken = useRef(0)
  const activeProcessingIds = useRef(new Set())
  const [processingTrigger, setProcessingTrigger] = useState(0)

  useViewEntrance(rootRef, [])

  const handleLayoutChange = (nextLayout) => {
    setLayout(nextLayout)
    safeStorage.setItem('amethyst_lib_layout', nextLayout)
  }

  const handleToggleRail = () => {
    setRailOpen((prev) => {
      const next = !prev
      safeStorage.setItem('amethyst_lib_rail', String(next))
      return next
    })
  }

  // Load items from backend
  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const data = await api.library({
        q: debouncedQuery,
        kind: selectedKinds.join(','),
        category: selectedCategories.join(','),
        tag: selectedTags.join(','),
        order,
      })
      if (loadToken.current !== token) return

      setItems((currentItems) => {
        const optimistic = currentItems.filter((it) => it.isOptimistic)
        const incomingIds = new Set(data.items.map((it) => it.id))
        const remainingOptimistic = optimistic.filter((it) => !incomingIds.has(it.id))

        let hasNewProcessing = false
        const merged = data.items.map((it) => {
          const isProcessing =
            it.status === 'received' ||
            it.status === 'processing' ||
            it.status === 'enriching'
          if (isProcessing) {
            if (!activeProcessingIds.current.has(it.id)) {
              activeProcessingIds.current.add(it.id)
              hasNewProcessing = true
            }
          } else {
            activeProcessingIds.current.delete(it.id)
          }
          return isProcessing ? { ...it, isProcessing: true } : { ...it, isProcessing: false }
        })

        if (hasNewProcessing) {
          setProcessingTrigger((t) => t + 1)
        }

        return [...remainingOptimistic, ...merged]
      })

      setCounts(data.counts || {})
      setCategoryCounts(data.category_counts || {})
      setTagCounts(data.tag_counts || {})
      setError(null)
      setLoaded(true)
    } catch (err) {
      if (loadToken.current !== token) return
      setError(err.message)
      setLoaded(true)
    }
  }, [debouncedQuery, selectedKinds, selectedCategories, selectedTags, order])

  // Debounce search query to eliminate typing stutter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 180)
    return () => clearTimeout(timer)
  }, [query])

  // Sync params with URL state
  useEffect(() => {
    const q = params.get('q') || ''
    const kind = params.get('kind') || ''
    const cat = params.get('category') || ''
    const tag = params.get('tag') || ''
    const ratingParam = params.get('rating') || ''
    if (q !== query) setQuery(q)
    if (kind) setSelectedKinds(kind.split(',').filter(Boolean))
    if (cat) setSelectedCategories(cat.split(',').filter(Boolean))
    if (tag) setSelectedTags(tag.split(',').filter(Boolean))
    if (ratingParam) setSelectedRatings(ratingParam.split(',').filter(Boolean))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update URL params when filters change
  useEffect(() => {
    const next = new URLSearchParams()
    if (debouncedQuery) next.set('q', debouncedQuery)
    if (selectedKinds.length) next.set('kind', selectedKinds.join(','))
    if (selectedCategories.length) next.set('category', selectedCategories.join(','))
    if (selectedTags.length) next.set('tag', selectedTags.join(','))
    if (selectedRatings.length) next.set('rating', selectedRatings.join(','))
    setParams(next, { replace: true })
  }, [debouncedQuery, selectedKinds, selectedCategories, selectedTags, selectedRatings, setParams])

  // Trigger data load
  useEffect(() => {
    load()
  }, [load])

  // Global keyboard shortcuts (Cmd+K / Ctrl+K to open add modal, Cmd+/ for search)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAddModalMode('url')
        setShowAddModal(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Poll active processing items
  useEffect(() => {
    if (activeProcessingIds.current.size === 0) return

    let cancelled = false
    const interval = setInterval(async () => {
      const ids = Array.from(activeProcessingIds.current)
      if (ids.length === 0) {
        clearInterval(interval)
        return
      }
      for (const id of ids) {
        if (cancelled) break
        try {
          const updated = await api.libraryItem(id)
          const isStillBusy =
            updated.status === 'received' ||
            updated.status === 'processing' ||
            updated.status === 'enriching'

          const isDone =
            updated.status === 'failed' ||
            (updated.status === 'ready' && !isStillBusy)

          if (isDone) {
            activeProcessingIds.current.delete(id)
            setItems((prev) =>
              prev.map((it) => (it.id === id ? { ...updated, isProcessing: false } : it))
            )
            if (updated.status !== 'failed') {
              toast(`Ready: ${updated.title}`, 'ok')
            }
            api.library().then((res) => {
              setCounts(res.counts || {})
              setCategoryCounts(res.category_counts || {})
              setTagCounts(res.tag_counts || {})
            }).catch(() => {})
          } else {
            setItems((prev) =>
              prev.map((it) => (it.id === id ? { ...updated, isProcessing: true } : it))
            )
          }
        } catch {
          activeProcessingIds.current.delete(id)
        }
      }
    }, 1800)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [processingTrigger, toast])

  // General background sync poll (every 10s)
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (!cancelled) load()
    }
    let timer = null
    const start = () => {
      if (timer === null) timer = setInterval(tick, 10000)
    }
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop()
      else start()
    }
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load])

  // Instant optimistic add
  const handleAddResource = useCallback(
    async (body) => {
      const tempId = `opt-${Date.now()}`
      const domain = body.url ? getDomain(body.url) : null

      const optimisticItem = {
        id: tempId,
        url: body.url || null,
        title: body.title || (domain ? `Capturing ${domain}...` : 'Saving note...'),
        site: domain,
        kind: body.kind || (body.url ? 'article' : 'note'),
        category: 'general',
        consumed_on: new Date().toISOString().slice(0, 10),
        author: body.author || null,
        notes: body.notes || null,
        tags: [],
        summary: null,
        isOptimistic: true,
        isProcessing: true,
        created_at: new Date().toISOString(),
      }

      setItems((prev) => [optimisticItem, ...prev])
      setShowAddModal(false)

      try {
        const saved = await api.addLibraryItem(body)
        const isStillProcessing =
          saved.status === 'enriching' ||
          saved.status === 'processing' ||
          saved.status === 'received'

        if (isStillProcessing) {
          activeProcessingIds.current.add(saved.id)
          setProcessingTrigger((t) => t + 1)
        }

        setItems((prev) =>
          prev.map((it) =>
            it.id === tempId ? { ...saved, isProcessing: isStillProcessing } : it
          )
        )

        toast(isStillProcessing ? 'Saved! AI analysis in background...' : 'Saved to library', 'ok')

        // Refresh counts
        const meta = await api.library()
        setCounts(meta.counts || {})
        setCategoryCounts(meta.category_counts || {})
        setTagCounts(meta.tag_counts || {})
      } catch (err) {
        setItems((prev) => prev.filter((it) => it.id !== tempId))
        toast(err.message, 'bad')
      }
    },
    [toast]
  )

  // Omnibar submit handler
  const handleQuickCaptureSubmit = (e) => {
    e.preventDefault()
    const text = quickCaptureText.trim()
    if (!text) return

    const isExplicitUrl = /^https?:\/\//i.test(text)
    const isBareDomain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/.*)?$/i.test(text)
    if (isExplicitUrl) {
      handleAddResource({ url: text })
    } else if (isBareDomain) {
      handleAddResource({ url: `https://${text}` })
    } else {
      handleAddResource({ notes: text, title: text.slice(0, 48) })
    }
    setQuickCaptureText('')
  }

  // Capture what the bookmarklet brought, once. The bar keeps no memory of it,
  // so reloading the page does not log the same link twice.
  useEffect(() => {
    if (!incomingUrl.current) return
    const url = incomingUrl.current
    incomingUrl.current = null
    handleAddResource({ url })
  }, [handleAddResource])

  const handleEnrich = useCallback(
    async (item) => {
      setBusyId(item.id)
      try {
        const updated = await api.enrichLibraryItem(item.id)
        activeProcessingIds.current.delete(item.id)
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...updated, isProcessing: false } : it))
        )
        toast('Enriched with AI', 'ok')
      } catch (err) {
        toast(err.message, 'bad')
      } finally {
        setBusyId(null)
      }
    },
    [toast]
  )

  const handleReindex = useCallback(
    async (item) => {
      setBusyId(item.id)
      try {
        const updated = await api.reindexLibraryItem(item.id)
        setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)))
        toast('Re-indexed embeddings', 'ok')
      } catch (err) {
        toast(err.message, 'bad')
      } finally {
        setBusyId(null)
      }
    },
    [toast]
  )

  const handleDelete = useCallback(
    async (item) => {
      setBusyId(item.id)
      try {
        await api.deleteLibraryItem(item.id)
        activeProcessingIds.current.delete(item.id)
        setItems((prev) => prev.filter((it) => it.id !== item.id))
        toast('Removed from library', 'ok')
        const meta = await api.library()
        setCounts(meta.counts || {})
        setCategoryCounts(meta.category_counts || {})
        setTagCounts(meta.tag_counts || {})
      } catch (err) {
        toast(err.message, 'bad')
      } finally {
        setBusyId(null)
      }
    },
    [toast]
  )

  const handleItemUpdate = useCallback((updated) => {
    activeProcessingIds.current.delete(updated.id)
    setItems((prev) =>
      prev.map((it) => (it.id === updated.id ? { ...updated, isProcessing: false } : it))
    )
    setActiveModalItem((curr) =>
      curr?.id === updated.id ? { ...updated, isProcessing: false } : curr
    )
  }, [])

  const handleClearFilters = useCallback(() => {
    setSelectedKinds([])
    setSelectedCategories([])
    setSelectedTags([])
    setSelectedRatings([])
    setQuery('')
    setDebouncedQuery('')
  }, [])

  const total = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts]
  )

  // Compute live rating statistics from items
  const ratingCounts = useMemo(() => {
    let count5 = 0
    let count4plus = 0
    let countRated = 0
    for (const it of items) {
      const r = it.rating || 0
      if (r === 5) count5++
      if (r >= 4) count4plus++
      if (r > 0) countRated++
    }
    return { '5': count5, '4+': count4plus, 'rated': countRated }
  }, [items])

  // Filter items reactively by selectedRating and order
  const displayedItems = useMemo(() => {
    let result = items
    if (selectedRatings.length) {
      result = result.filter((it) => selectedRatings.some((rating) =>
        rating === '5' ? it.rating === 5 : rating === '4+' ? (it.rating || 0) >= 4 : (it.rating || 0) > 0
      ))
    }
    if (order === 'rating') {
      result = [...result].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    }
    return result
  }, [items, selectedRatings, order])

  const appCounts = useMemo(() => {
    const known = ['pinterest', 'youtube', 'instagram', 'x', 'github', 'reddit', 'spotify', 'threads']
    const countsMap = {}
    for (const app of known) {
      if (tagCounts[app]) countsMap[app] = tagCounts[app]
    }
    for (const it of items) {
      if (it.app && !countsMap[it.app]) {
        countsMap[it.app] = (countsMap[it.app] || 0) + 1
      }
    }
    return countsMap
  }, [tagCounts, items])

  const activeFilterCount =
    selectedKinds.length +
    selectedCategories.length +
    selectedTags.length +
    selectedRatings.length +
    (query ? 1 : 0)

  const hasFilter = Boolean(activeFilterCount > 0)

  const hasMusic = Boolean(
    counts?.music ||
    categoryCounts?.music ||
    items.some(
      (it) =>
        it.kind === 'music' ||
        it.category === 'music' ||
        ['spotify', 'apple-music', 'soundcloud', 'bandcamp'].includes(it.app) ||
        (it.resources || []).some((r) => r && (r.type === 'music' || r.type === 'song'))
    )
  )

  const handleOpenExport = async () => {
    try {
      const data = await api.library({ kind: 'music', limit: 100 })
      const existing = data.items || []
      const existingIds = new Set(existing.map((i) => i.id))
      const extra = items.filter(
        (it) =>
          !existingIds.has(it.id) &&
          (it.kind === 'music' ||
            it.category === 'music' ||
            ['spotify', 'apple-music', 'soundcloud', 'bandcamp'].includes(it.app) ||
            (it.resources || []).some((r) => r && (r.type === 'music' || r.type === 'song')))
      )
      setExportItems([...existing, ...extra])
    } catch {
      setExportItems([])
    }
    setShowExportModal(true)
  }

  const isProcessingCount = items.filter((it) => it.isProcessing).length

  return (
    <div className={`view lib-view ${activeModalItem ? 'lib-view--detail-open' : ''}`} ref={rootRef}>
      <AnimatePresence mode="wait">
        {activeModalItem ? (
          <LibraryDetailModal
            key="detail-studio"
            item={activeModalItem}
            items={displayedItems}
            onNavigate={(nextItem) => setActiveModalItem(nextItem)}
            onClose={() => setActiveModalItem(null)}
            onUpdate={handleItemUpdate}
            onDelete={handleDelete}
            toast={toast}
            onExportPlaylist={(playlistItems) => {
              setExportItems(playlistItems)
              setShowExportModal(true)
            }}
          />
        ) : (
          <motion.div
            key="grid-canvas"
            className="view-inner view-inner--wide lib-view-inner"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            {/* Unified Studio Command Deck */}
            <LibraryToolbar
              total={total}
              showing={displayedItems.length}
              isProcessingCount={isProcessingCount}
              query={query}
              onQueryChange={setQuery}
              searchRef={searchInputRef}
              quickCaptureText={quickCaptureText}
              onQuickCaptureChange={setQuickCaptureText}
              onQuickCaptureSubmit={handleQuickCaptureSubmit}
              captureRef={captureInputRef}
              order={order}
              onOrderChange={setOrder}
              layout={layout}
              onLayoutChange={handleLayoutChange}
              showShare={showShare}
              onToggleShare={() => setShowShare((prev) => !prev)}
              hasMusic={hasMusic}
              onOpenExport={handleOpenExport}
              onOpenAddModal={(mode) => {
                setAddModalMode(mode || 'url')
                setShowAddModal(true)
              }}
              counts={counts}
              categoryCounts={categoryCounts}
              tagCounts={tagCounts}
              appCounts={appCounts}
              ratingCounts={ratingCounts}
              selectedKinds={selectedKinds}
              selectedCategories={selectedCategories}
              selectedTags={selectedTags}
              selectedRatings={selectedRatings}
              onSelectKinds={setSelectedKinds}
              onSelectCategories={setSelectedCategories}
              onSelectTags={setSelectedTags}
              onSelectRatings={setSelectedRatings}
              onClearFilters={handleClearFilters}
            />

            {/* Layout Area: Active Filter Strip (when active) + Content Canvas */}
            <div className="lib-layout w-full flex flex-col gap-4">
              <LibraryFilterBar
                selectedKinds={selectedKinds}
                selectedCategories={selectedCategories}
                selectedTags={selectedTags}
                selectedRatings={selectedRatings}
                query={query}
                onSelectKinds={setSelectedKinds}
                onSelectCategories={setSelectedCategories}
                onSelectTags={setSelectedTags}
                onSelectRatings={setSelectedRatings}
                onClearQuery={() => setQuery('')}
                onClearFilters={handleClearFilters}
              />

              <main className="lib-content-main w-full">
                {!loaded && items.length === 0 ? (
                  <SkeletonLibraryGrid cards={8} />
                ) : error ? (
                  <ErrorState message={error} onRetry={load} />
                ) : displayedItems.length === 0 ? (
                  <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                    <EmptyState size="md">
                      <EmptyState.Header>
                        <EmptyState.Title>
                          {activeFilterCount > 0 ? 'No matching knowledge found' : 'Your library is empty'}
                        </EmptyState.Title>
                        <EmptyState.Description>
                          {activeFilterCount > 0
                            ? 'Try modifying your search or clearing active filters to see all resources.'
                            : 'Paste an article, YouTube video, PDF, or note above to start building your personal library.'}
                        </EmptyState.Description>
                      </EmptyState.Header>
                      <EmptyState.Footer>
                        {activeFilterCount > 0 ? (
                          <button
                            type="button"
                            className="lib-btn"
                            onClick={handleClearFilters}
                          >
                            Reset filters
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="lib-btn lib-btn--primary"
                            onClick={() => {
                              setAddModalMode('url')
                              setShowAddModal(true)
                            }}
                          >
                            <Icon name="plus" size={14} />
                            <span>Add first resource</span>
                          </button>
                        )}
                      </EmptyState.Footer>
                    </EmptyState>
                  </div>
                ) : layout === 'grid' ? (
                  <LibraryGrid
                    items={displayedItems}
                    busyId={busyId}
                    onSelect={(item) => setActiveModalItem(item)}
                    onReindex={handleReindex}
                    onEnrich={handleEnrich}
                    onDelete={handleDelete}
                    onTagClick={(tag) => setSelectedTags([tag])}
                  />
                ) : (
                  <LibraryListView
                    items={displayedItems}
                    busyId={busyId}
                    onSelect={(item) => setActiveModalItem(item)}
                    onReindex={handleReindex}
                    onEnrich={handleEnrich}
                    onDelete={handleDelete}
                    onTagClick={(tag) => setSelectedTags([tag])}
                  />
                )}
              </main>
            </div>

        {/* Add Content Modal */}
        <AddContentModal
          open={showAddModal}
          initialMode={addModalMode}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddResource}
          toast={toast}
        />

        {/* Capture & Sync Integrations Modal */}
        <CaptureIntegrationsModal
          open={showShare}
          onClose={() => setShowShare(false)}
          toast={toast}
        />

            {/* Export to Spotify Playlist Modal */}
            <ExportPlaylistModal
              open={showExportModal}
              items={exportItems}
              onClose={() => setShowExportModal(false)}
              toast={toast}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
