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
  const [selectedKind, setSelectedKind] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [selectedRating, setSelectedRating] = useState('')
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
        q: query,
        kind: selectedKind,
        category: selectedCategory,
        tag: selectedTag,
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
  }, [query, selectedKind, selectedCategory, selectedTag, order])

  // Sync params with URL state
  useEffect(() => {
    const q = params.get('q') || ''
    const kind = params.get('kind') || ''
    const cat = params.get('category') || ''
    const tag = params.get('tag') || ''
    const ratingParam = params.get('rating') || ''
    if (q !== query) setQuery(q)
    if (kind !== selectedKind) setSelectedKind(kind)
    if (cat !== selectedCategory) setSelectedCategory(cat)
    if (tag !== selectedTag) setSelectedTag(tag)
    if (ratingParam !== selectedRating) setSelectedRating(ratingParam)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update URL params when filters change
  useEffect(() => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    if (selectedKind) next.set('kind', selectedKind)
    if (selectedCategory) next.set('category', selectedCategory)
    if (selectedTag) next.set('tag', selectedTag)
    if (selectedRating) next.set('rating', selectedRating)
    setParams(next, { replace: true })
  }, [query, selectedKind, selectedCategory, selectedTag, selectedRating, setParams])

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
          const isDone =
            updated.status === 'ready' ||
            updated.status === 'failed' ||
            Boolean(updated.enriched_at || updated.enrichment_note || updated.summary)
          if (isDone) {
            activeProcessingIds.current.delete(id)
            setItems((prev) =>
              prev.map((it) => (it.id === id ? { ...updated, isProcessing: false } : it))
            )
            toast(`Ready: ${updated.title}`, 'ok')
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

    const isUrl = /^https?:\/\//i.test(text)
    if (isUrl) {
      handleAddResource({ url: text })
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
    setSelectedKind('')
    setSelectedCategory('')
    setSelectedTag('')
    setSelectedRating('')
    setQuery('')
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

  // Filter items reactively by selectedRating
  const displayedItems = useMemo(() => {
    if (!selectedRating) return items
    if (selectedRating === '5') return items.filter((it) => it.rating === 5)
    if (selectedRating === '4+') return items.filter((it) => (it.rating || 0) >= 4)
    if (selectedRating === 'rated') return items.filter((it) => (it.rating || 0) > 0)
    return items
  }, [items, selectedRating])

  const appCounts = useMemo(() => {
    const known = ['pinterest', 'youtube', 'instagram', 'x', 'github', 'reddit', 'spotify']
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
    (selectedKind ? 1 : 0) +
    (selectedCategory ? 1 : 0) +
    (selectedTag ? 1 : 0) +
    (selectedRating ? 1 : 0) +
    (query ? 1 : 0)

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
    <div className="view lib-view" ref={rootRef}>
      <div className="lib-view-inner">
        {/* Modern Minimalist Page Header with Unified Action Center */}
        <header className="lib-header" data-enter>
          <div className="lib-header-left">
            <div className="lib-header-title-row">
              <h1 className="lib-header-title">Library</h1>
              <div className="lib-header-badge" role="status" aria-live="polite">
                {isProcessingCount > 0 ? (
                  <>
                    <span className="lib-header-live-dot" />
                    <span>Syncing {isProcessingCount} item{isProcessingCount > 1 ? 's' : ''}</span>
                  </>
                ) : (
                  <span>{total} indexed artifacts</span>
                )}
              </div>
            </div>
            <p className="lib-header-subtitle">
              High-recall knowledge base with automatic AI transcriptions, key entity extraction, and semantic search.
            </p>
          </div>

          <div className="lib-header-actions">
            {/* External Capture & Integrations */}
            <button
              type="button"
              className={`lib-header-action-btn ${showShare ? 'lib-header-action-btn--active' : ''}`}
              onClick={() => setShowShare((prev) => !prev)}
              title="External capture & integrations (browser, phone, relay)"
              aria-expanded={showShare}
            >
              <Icon name="link" size={14} />
              <span>Sync & Capture</span>
            </button>

            {/* Export to Spotify Playlist */}
            {hasMusic && (
              <button
                type="button"
                className="lib-header-action-btn"
                onClick={handleOpenExport}
                title="Export discovered audio to Spotify playlist"
              >
                <Icon name="music" size={14} />
                <span>Playlist</span>
              </button>
            )}

            {/* Segmented Layout Toggle: Grid vs List */}
            <div className="lib-segmented-control" role="group" aria-label="View display">
              <button
                type="button"
                className={`lib-segmented-btn ${layout === 'grid' ? 'lib-segmented-btn--active' : ''}`}
                onClick={() => handleLayoutChange('grid')}
                title="Bento Grid view"
                aria-label="Bento Grid view"
                aria-pressed={layout === 'grid'}
              >
                <Icon name="grid" size={14} />
              </button>
              <button
                type="button"
                className={`lib-segmented-btn ${layout === 'list' ? 'lib-segmented-btn--active' : ''}`}
                onClick={() => handleLayoutChange('list')}
                title="Dense Stream view"
                aria-label="Dense Stream view"
                aria-pressed={layout === 'list'}
              >
                <Icon name="list" size={14} />
              </button>
            </div>

            {/* Primary Add Resource */}
            <button
              type="button"
              className="lib-btn lib-btn--primary"
              onClick={() => {
                setAddModalMode('url')
                setShowAddModal(true)
              }}
              title={`Add resource (${IS_MAC ? '⌘K' : 'Ctrl+K'})`}
            >
              <Icon name="plus" size={14} />
              <span>Add Resource</span>
              <kbd className="lib-kbd lib-kbd--primary">
                {IS_MAC ? '⌘K' : 'Ctrl+K'}
              </kbd>
            </button>
          </div>
        </header>

        {/* Smart Command & Search Omnibar */}
        <LibraryToolbar
          query={query}
          onQueryChange={setQuery}
          searchRef={searchInputRef}
          quickCaptureText={quickCaptureText}
          onQuickCaptureChange={setQuickCaptureText}
          onQuickCaptureSubmit={handleQuickCaptureSubmit}
          captureRef={captureInputRef}
          order={order}
          onOrderChange={setOrder}
          onOpenAddModal={(mode) => {
            setAddModalMode(mode || 'url')
            setShowAddModal(true)
          }}
        />

        {/* Layout Area: Modern Segmented Filter Hub + Full-Width Content Canvas */}
        <div className="lib-layout w-full flex flex-col gap-3">
          <LibraryFilterBar
            total={total}
            counts={counts}
            categoryCounts={categoryCounts}
            tagCounts={tagCounts}
            appCounts={appCounts}
            ratingCounts={ratingCounts}
            selectedKind={selectedKind}
            selectedCategory={selectedCategory}
            selectedTag={selectedTag}
            selectedRating={selectedRating}
            query={query}
            onSelectKind={setSelectedKind}
            onSelectCategory={setSelectedCategory}
            onSelectTag={setSelectedTag}
            onSelectRating={setSelectedRating}
            onClearQuery={() => setQuery('')}
            onClearFilters={handleClearFilters}
            isOpen={railOpen}
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
                onTagClick={(tag) => setSelectedTag(tag)}
              />
            ) : (
              <LibraryListView
                items={displayedItems}
                busyId={busyId}
                onSelect={(item) => setActiveModalItem(item)}
                onReindex={handleReindex}
                onEnrich={handleEnrich}
                onDelete={handleDelete}
                onTagClick={(tag) => setSelectedTag(tag)}
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

        {/* Item Inspection & Reader Modal */}
        <AnimatePresence>
          {activeModalItem && (
            <LibraryDetailModal
              item={activeModalItem}
              onClose={() => setActiveModalItem(null)}
              onUpdate={handleItemUpdate}
              onDelete={handleDelete}
              toast={toast}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
