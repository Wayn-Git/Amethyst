import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api } from '../api.js'
import { SkeletonLibraryGrid } from '../components/Skeleton.jsx'
import EmptyState from '../components/ui/EmptyState.jsx'
import ErrorState from '../components/ui/ErrorState.jsx'

import LibraryToolbar from './library/LibraryToolbar.jsx'
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

export default function Library() {
  const rootRef = useRef(null)
  const searchInputRef = useRef(null)
  const { toast } = useApp()
  const [params, setParams] = useSearchParams()

  // Data state
  const [items, setItems] = useState([])
  const [counts, setCounts] = useState({})
  const [categoryCounts, setCategoryCounts] = useState({})
  const [tagCounts, setTagCounts] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  // Filter & layout state
  const [query, setQuery] = useState('')
  const [selectedKind, setSelectedKind] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [order, setOrder] = useState('desc')
  const [layout, setLayout] = useState(() => safeStorage.getItem('amethyst_lib_layout', 'grid'))
  const [railOpen, setRailOpen] = useState(() => safeStorage.getItem('amethyst_lib_rail') !== 'false')

  // Modal states (Screenshot 3 & 4)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalMode, setAddModalMode] = useState('url')

  const openAddModal = useCallback((mode = 'url') => {
    setAddModalMode(mode)
    setShowAddModal(true)
  }, [])
  const [showShare, setShowShare] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportItems, setExportItems] = useState([])
  const [activeModalItem, setActiveModalItem] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [_saving, setSaving] = useState(false)

  // Token and tracking refs
  const loadToken = useRef(0)
  const activeProcessingIds = useRef(new Set())
  const [processingTrigger, setProcessingTrigger] = useState(0)

  useViewEntrance(rootRef, [])

  // Persist layout choice
  const handleLayoutChange = (nextLayout) => {
    setLayout(nextLayout)
    safeStorage.setItem('amethyst_lib_layout', nextLayout)
  }

  // Persist rail visibility
  const handleToggleRail = () => {
    setRailOpen((prev) => {
      const next = !prev
      safeStorage.setItem('amethyst_lib_rail', String(next))
      return next
    })
  }

  // Load library items from backend
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

      // Preserve any local optimistic items that are still saving
      setItems((currentItems) => {
        const optimistic = currentItems.filter((it) => it.isOptimistic)
        const incomingIds = new Set(data.items.map((it) => it.id))
        const remainingOptimistic = optimistic.filter((it) => !incomingIds.has(it.id))

        // Mark items that are still processing in background
        const merged = data.items.map((it) => {
          const isProcessing =
            it.status === 'received' ||
            it.status === 'processing' ||
            it.status === 'enriching' ||
            (!it.enriched_at &&
              !it.enrichment_note &&
              (it.kind === 'video' || it.text_source !== 'none') &&
              activeProcessingIds.current.has(it.id))
          if (isProcessing) {
            activeProcessingIds.current.add(it.id)
          }
          return isProcessing ? { ...it, isProcessing: true } : it
        })

        return [...remainingOptimistic, ...merged]
      })

      setCounts(data.counts || {})
      setCategoryCounts(data.category_counts || {})
      setTagCounts(data.tag_counts || {})
      setError(null)
    } catch (err) {
      if (loadToken.current === token) setError(err.message)
    } finally {
      setLoaded(true)
    }
  }, [query, selectedKind, selectedCategory, selectedTag, order])

  // Debounced search query & filter reload
  useEffect(() => {
    if (!query) {
      load()
      return
    }
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [load, query])

  // Keyboard shortcuts (Ctrl+K to Add, Ctrl+/ to Search)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openAddModal('url')
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openAddModal])

  // Bookmarklet prefill handler
  useEffect(() => {
    const incoming = params.get('url')
    if (!incoming) return
    openAddModal('url')
    params.delete('url')
    setParams(params, { replace: true })
  }, [params, setParams, openAddModal])

  // Active poller for items whose background enrichment or processing is running
  useEffect(() => {
    if (activeProcessingIds.current.size === 0) return

    const interval = setInterval(async () => {
      const ids = Array.from(activeProcessingIds.current)
      if (ids.length === 0) {
        clearInterval(interval)
        return
      }

      for (const id of ids) {
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
            // Refresh counts & tag index
            api.library().then((res) => {
              setCounts(res.counts || {})
              setCategoryCounts(res.category_counts || {})
              setTagCounts(res.tag_counts || {})
            }).catch(() => {})
          } else {
            // Update in place to display progressive metadata and status updates
            setItems((prev) =>
              prev.map((it) => (it.id === id ? { ...updated, isProcessing: true } : it))
            )
          }
        } catch {
          activeProcessingIds.current.delete(id)
        }
      }
    }, 1800)

    return () => clearInterval(interval)
  }, [processingTrigger, toast])

  // General background sync poll (every 10s, visibility-gated)
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

  // Instant optimistic add resource
  const handleAddResource = useCallback(
    async (body) => {
      const tempId = `opt-${Date.now()}`
      const domain = body.url ? getDomain(body.url) : null

      const optimisticItem = {
        id: tempId,
        url: body.url || null,
        title: body.title || (domain ? `Saving ${domain}...` : 'Saving note...'),
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

      // 1. Immediately insert optimistic item at the top!
      setItems((prev) => [optimisticItem, ...prev])
      setShowAddModal(false)
      setSaving(true)

      try {
        const saved = await api.addLibraryItem(body)
        const isStillEnriching = !saved.enriched_at && !saved.enrichment_note

        if (isStillEnriching) {
          activeProcessingIds.current.add(saved.id)
          setProcessingTrigger((t) => t + 1)
        }

        // 2. Seamlessly upgrade the optimistic item to real item
        setItems((prev) =>
          prev.map((it) =>
            it.id === tempId ? { ...saved, isProcessing: isStillEnriching } : it
          )
        )

        toast(
          saved.already_logged
            ? `Already in library: ${saved.title}`
            : `Added: ${saved.title}`,
          'ok'
        )

        // Reload counts
        const meta = await api.library({
          q: query,
          kind: selectedKind,
          category: selectedCategory,
          tag: selectedTag,
          order,
        })
        setCounts(meta.counts || {})
        setCategoryCounts(meta.category_counts || {})
        setTagCounts(meta.tag_counts || {})
      } catch (err) {
        // Remove failed optimistic item
        setItems((prev) => prev.filter((it) => it.id !== tempId))
        toast(err.message, 'bad')
      } finally {
        setSaving(false)
      }
    },
    [query, selectedKind, selectedCategory, selectedTag, order, toast]
  )

  // Actions on existing items
  const handleReindex = useCallback(
    async (item) => {
      setBusyId(item.id)
      try {
        const updated = await api.reindexLibraryItem(item.id)
        setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)))
        toast('Indexed again for search', 'ok')
      } catch (err) {
        toast(err.message, 'bad')
      } finally {
        setBusyId(null)
      }
    },
    [toast]
  )

  const handleEnrich = useCallback(
    async (item) => {
      setBusyId(item.id)
      try {
        const updated = await api.enrichLibraryItem(item.id)
        setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)))
        toast('Read and summarised with AI', 'ok')
        // Refresh tags
        const meta = await api.library()
        setTagCounts(meta.tag_counts || {})
        setCategoryCounts(meta.category_counts || {})
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
        setItems((prev) => prev.filter((it) => it.id !== item.id))
        toast('Removed from library', 'ok')
        // Update counts
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
    setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
    setActiveModalItem((curr) => (curr?.id === updated.id ? updated : curr))
  }, [])

  const handleClearFilters = useCallback(() => {
    setSelectedKind('')
    setSelectedCategory('')
    setSelectedTag('')
    setQuery('')
  }, [])

  const total = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts]
  )

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
      const local = items.filter(
        (it) =>
          it.kind === 'music' ||
          it.category === 'music' ||
          ['spotify', 'apple-music', 'soundcloud', 'bandcamp'].includes(it.app) ||
          (it.resources || []).some((r) => r && (r.type === 'music' || r.type === 'song'))
      )
      setExportItems(local)
    }
    setShowExportModal(true)
  }

  return (
    <div className="view lib-view" ref={rootRef}>
      <div className="view-inner view-inner--wide lib-view-inner">
        {/* Main Header (Clean, unslop, zero duplicate buttons) */}
        <header className="vheader lib-main-header" data-enter>
          <div>
            <div className="lib-header-eyebrow mono">
              <Icon name="book" size={13} />
              <span>Personal Knowledge Base</span>
            </div>
            <h1 className="lib-page-title">Library</h1>
            <div className="vheader-sub">
              Organized knowledge, articles, videos, books, and references. Everything
              captured is indexed for hybrid semantic search.
            </div>
          </div>
        </header>

        {/* Add Content Modal (Recall-style from Screenshot 3) */}
        <AddContentModal
          open={showAddModal}
          initialMode={addModalMode}
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddResource}
          toast={toast}
        />

        {/* External Capture & Integrations Modal */}
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

        {/* Toolbar: Search (Ctrl+/), Ask Chat, View & Sort Switchers, + Add (Ctrl+K) */}
        <LibraryToolbar
          query={query}
          onQueryChange={setQuery}
          searchRef={searchInputRef}
          order={order}
          onOrderChange={setOrder}
          layout={layout}
          onLayoutChange={handleLayoutChange}
          railOpen={railOpen}
          onToggleRail={handleToggleRail}
          onOpenAdd={() => openAddModal('url')}
          onToggleShare={() => setShowShare((prev) => !prev)}
          showShare={showShare}
          onOpenExportPlaylist={handleOpenExport}
          hasMusic={hasMusic}
          activeFilterCount={activeFilterCount}
        />

        {/* Two-Column Knowledge Layout: Tag Sidebar + Content */}
        <div className={`lib-container ${railOpen ? 'lib-container--with-rail' : ''}`}>
          <AnimatePresence>
            {railOpen && (
              <motion.aside
                key="tag-rail-wrapper"
                className="lib-rail-wrapper"
                initial={{ width: 0, opacity: 0, marginRight: 0 }}
                animate={{ width: 252, opacity: 1, marginRight: 20 }}
                exit={{ width: 0, opacity: 0, marginRight: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                style={{ flexShrink: 0 }}
              >
                <LibraryTagRail
                  total={total}
                  counts={counts}
                  categoryCounts={categoryCounts}
                  tagCounts={tagCounts}
                  appCounts={appCounts}
                  selectedKind={selectedKind}
                  selectedCategory={selectedCategory}
                  selectedTag={selectedTag}
                  onSelectKind={setSelectedKind}
                  onSelectCategory={setSelectedCategory}
                  onSelectTag={setSelectedTag}
                  onClearFilters={handleClearFilters}
                  isOpen={railOpen}
                  onClose={() => setRailOpen(false)}
                />
              </motion.aside>
            )}
          </AnimatePresence>

          <main className="lib-main-content">
            {!loaded && items.length === 0 ? (
              <div className="lib-loading-skeleton">
                <SkeletonLibraryGrid cards={9} />
              </div>
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : items.length === 0 ? (
              <EmptyState
                icon="book"
                message={
                  query || selectedTag || selectedKind || selectedCategory
                    ? `No resources matched the current filter. Try clearing filters or changing your search.`
                    : 'Your library is empty. Add a link, video, book, or note above to start building your knowledge base.'
                }
                action={
                  activeFilterCount > 0 ? (
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={handleClearFilters}
                    >
                      Clear all filters
                    </button>
                  ) : null
                }
              />
            ) : layout === 'grid' ? (
              <LibraryGrid
                items={items}
                busyId={busyId}
                onSelect={(item) => setActiveModalItem(item)}
                onReindex={handleReindex}
                onEnrich={handleEnrich}
                onDelete={handleDelete}
                onTagClick={(tag) => setSelectedTag(tag)}
              />
            ) : (
              <LibraryListView
                items={items}
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

        {/* Item Inspection & Edit Modal */}
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
