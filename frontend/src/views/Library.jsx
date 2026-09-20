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
  const captureInputRef = useRef(null)
  const { toast } = useApp()
  const [params, setParams] = useSearchParams()

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

  // Debounced search
  useEffect(() => {
    if (!query) {
      load()
      return
    }
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [load, query])

  // Bookmarklet prefill handler (smoke test requirement)
  useEffect(() => {
    const incoming = params.get('url')
    if (!incoming) return
    setQuickCaptureText(incoming)
    params.delete('url')
    setParams(params, { replace: true })
    setTimeout(() => captureInputRef.current?.focus(), 100)
  }, [params, setParams])

  // Keyboard shortcuts (Ctrl+K to Add, Ctrl+/ to Search)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        captureInputRef.current?.focus() || setShowAddModal(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Background poller for enriching items
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

    return () => clearInterval(interval)
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
        const isStillEnriching = !saved.enriched_at && !saved.enrichment_note

        if (isStillEnriching) {
          activeProcessingIds.current.add(saved.id)
          setProcessingTrigger((t) => t + 1)
        }

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
        setItems((prev) => prev.filter((it) => it.id !== tempId))
        toast(err.message, 'bad')
      }
    },
    [query, selectedKind, selectedCategory, selectedTag, order, toast]
  )

  // Omnibar submit
  const handleQuickCaptureSubmit = async (e) => {
    e?.preventDefault()
    const text = quickCaptureText.trim()
    if (!text) return

    setQuickCaptureText('')
    if (/^https?:\/\//i.test(text) || (text.includes('.') && !text.includes(' '))) {
      await handleAddResource({ url: text.startsWith('http') ? text : `https://${text}` })
    } else {
      await handleAddResource({
        title: text.length > 50 ? `${text.slice(0, 48)}...` : text,
        kind: 'note',
        notes: text,
      })
    }
  }

  // Reindex, Enrich, Delete
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
        toast('Synthesized with AI', 'ok')
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
      setExportItems([])
    }
    setShowExportModal(true)
  }

  const isProcessingCount = items.filter((it) => it.isProcessing).length

  return (
    <div className="view lib-view" ref={rootRef}>
      <div className="lib-view-inner">
        {/* Modern Minimalist Page Header */}
        <header className="lib-header" data-enter>
          <div className="lib-header-left">
            <div className="lib-header-title-row">
              <h1 className="lib-header-title">Library</h1>
              <div className="lib-header-badge">
                {isProcessingCount > 0 ? (
                  <>
                    <span className="lib-header-live-dot" />
                    <span>Syncing {isProcessingCount} items</span>
                  </>
                ) : (
                  <span>{total} indexed artifacts</span>
                )}
              </div>
            </div>
            <p className="lib-header-subtitle">
              High-recall knowledge base with automatic AI transcriptions, key entity extraction, and semantic search across all your saved resources.
            </p>
          </div>
        </header>

        {/* Inline Command Capture Omnibar (.lib-capture & .lib-capture-row for smoke tests & instant entry) */}
        <div className="lib-capture" data-enter>
          <form className="lib-capture-row" onSubmit={handleQuickCaptureSubmit}>
            <div className="lib-capture-leading-icon">
              <Icon name="plus" size={16} />
            </div>
            <input
              ref={captureInputRef}
              type="text"
              className="lib-capture-input"
              placeholder="Paste any link, video, podcast, or note to capture instantly (or press ⌘K)..."
              value={quickCaptureText}
              onChange={(e) => setQuickCaptureText(e.target.value)}
              aria-label="Capture URL or note"
            />
            <div className="lib-capture-actions">
              {quickCaptureText ? (
                <button type="submit" className="lib-capture-pill-btn">
                  <span>Save</span>
                  <Icon name="arrow-right" size={12} />
                </button>
              ) : null}
              <button
                type="button"
                className="lib-capture-more-btn"
                title="Open full capture options (Upload, Note, Wiki)"
                onClick={() => {
                  setAddModalMode('url')
                  setShowAddModal(true)
                }}
              >
                <Icon name="more" size={16} />
              </button>
            </div>
          </form>
        </div>

        {/* Modern Command Toolbar */}
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
          onOpenAdd={() => {
            setAddModalMode('url')
            setShowAddModal(true)
          }}
          onToggleShare={() => setShowShare((prev) => !prev)}
          showShare={showShare}
          onOpenExportPlaylist={handleOpenExport}
          hasMusic={hasMusic}
          activeFilterCount={activeFilterCount}
        />

        {/* Active Filter Strip (if any active filters) */}
        {activeFilterCount > 0 && (
          <div className="lib-active-filter-strip" data-enter>
            <span>Active filters:</span>
            {selectedKind && (
              <span className="lib-active-filter-chip">
                <span>Format: {selectedKind}</span>
                <button
                  type="button"
                  className="lib-active-filter-remove"
                  onClick={() => setSelectedKind('')}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            )}
            {selectedCategory && (
              <span className="lib-active-filter-chip">
                <span>Category: {selectedCategory}</span>
                <button
                  type="button"
                  className="lib-active-filter-remove"
                  onClick={() => setSelectedCategory('')}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            )}
            {selectedTag && (
              <span className="lib-active-filter-chip">
                <span>#{selectedTag}</span>
                <button
                  type="button"
                  className="lib-active-filter-remove"
                  onClick={() => setSelectedTag('')}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            )}
            {query && (
              <span className="lib-active-filter-chip">
                <span>"{query}"</span>
                <button
                  type="button"
                  className="lib-active-filter-remove"
                  onClick={() => setQuery('')}
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            )}
            <button
              type="button"
              className="lib-active-filter-clear-all"
              onClick={handleClearFilters}
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* Layout Area: Taxonomy Rail + Content Canvas */}
        <div className="lib-layout">
          {railOpen && (
            <motion.div
              className="lib-rail-wrapper"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
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
            </motion.div>
          )}

          <main className="lib-content-main">
            {!loaded && items.length === 0 ? (
              <SkeletonLibraryGrid cards={8} />
            ) : error ? (
              <ErrorState message={error} onRetry={load} />
            ) : items.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                <EmptyState.Root size="md">
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
                </EmptyState.Root>
              </div>
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
