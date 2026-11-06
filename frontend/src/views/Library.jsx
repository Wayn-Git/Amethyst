import { Button as HouseButton } from '../components/ui/bento/index.jsx'
import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
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
import LibraryListsShelf from './library/LibraryListsShelf.jsx'
import LibraryTagRail from './library/LibraryTagRail.jsx'
import LibraryGrid from './library/LibraryGrid.jsx'
import LibraryListView from './library/LibraryListView.jsx'
import LibraryDetailModal from './library/LibraryDetailModal.jsx'
import AddContentModal from './library/AddContentModal.jsx'
import ExportPlaylistModal from './library/ExportPlaylistModal.jsx'
import MergeListsModal from './library/MergeListsModal.jsx'
import CreateListModal from './library/CreateListModal.jsx'
import ManageListsModal from './library/ManageListsModal.jsx'
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
  const [selectedProgress, setSelectedProgress] = useState('all')
  const [order, setOrder] = useState('desc')
  const [layout, setLayout] = useState(() => safeStorage.getItem('amethyst_lib_layout', 'grid'))
  const [railOpen, setRailOpen] = useState(() => safeStorage.getItem('amethyst_lib_rail') !== 'false')

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [addModalMode, setAddModalMode] = useState('anything')
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportItems, setExportItems] = useState([])
  const [activeModalItem, setActiveModalItem] = useState(null)
  const [busyId, setBusyId] = useState(null)

  // Smart & Curated Lists state
  const [lists, setLists] = useState([])
  const [selectedListId, setSelectedListId] = useState(null)
  const [selectedListDetail, setSelectedListDetail] = useState(null)
  const [showCreateListModal, setShowCreateListModal] = useState(false)
  const [showManageListsModal, setShowManageListsModal] = useState(false)
  const [isClustering, setIsClustering] = useState(false)

  // Quick Filters state matching toolbar dropdown
  const [quickFilters, setQuickFilters] = useState({
    addedThisWeek: false,
    unreadOnly: false,
    hasNotes: false,
  })
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)

  // Polling tracking refs
  const loadToken = useRef(0)
  const activeProcessingIds = useRef(new Set())
  const loadAbortRef = useRef(null)
  const [processingTrigger, setProcessingTrigger] = useState(0)

  useViewEntrance(rootRef, [])

  useEffect(() => {
    return () => {
      if (loadAbortRef.current) {
        loadAbortRef.current.abort()
      }
    }
  }, [])

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
    if (loadAbortRef.current) {
      loadAbortRef.current.abort()
    }
    const controller = new AbortController()
    loadAbortRef.current = controller

    try {
      const data = await api.library({
        q: debouncedQuery,
        kind: selectedKinds.join(','),
        category: selectedCategories.join(','),
        tag: selectedTags.join(','),
        order,
        limit: 500,
        signal: controller.signal,
      })
      if (loadToken.current !== token) return

      setItems((currentItems) => {
        const currentById = new Map(currentItems.map((it) => [it.id, it]))
        const incomingIds = new Set(data.items.map((it) => it.id))
        const remainingOptimistic = currentItems.filter((it) => it.isOptimistic && !incomingIds.has(it.id))

        let hasNewProcessing = false
        let hasChanges = remainingOptimistic.length !== currentItems.filter((it) => it.isOptimistic).length
        if (!hasChanges && currentItems.length !== (remainingOptimistic.length + data.items.length)) {
          hasChanges = true
        }

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

          const prev = currentById.get(it.id)
          if (
            prev &&
            !prev.isOptimistic &&
            Boolean(prev.isProcessing) === isProcessing &&
            prev.status === it.status &&
            prev.title === it.title &&
            prev.summary === it.summary &&
            prev.rating === it.rating &&
            prev.thumbnail_path === it.thumbnail_path &&
            prev.notes === it.notes &&
            prev.url === it.url
          ) {
            return prev
          }

          hasChanges = true
          return isProcessing ? { ...it, isProcessing: true } : { ...it, isProcessing: false }
        })

        if (hasNewProcessing) {
          setProcessingTrigger((t) => t + 1)
        }

        if (!hasChanges && merged.length === currentItems.length) {
          let allSame = true
          for (let i = 0; i < merged.length; i++) {
            if (merged[i] !== currentItems[i]) {
              allSame = false
              break
            }
          }
          if (allSame) return currentItems
        }

        return [...remainingOptimistic, ...merged]
      })

      startTransition(() => {
        setCounts(data.counts || {})
        setCategoryCounts(data.category_counts || {})
        setTagCounts(data.tag_counts || {})
        setError(null)
        setLoaded(true)
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      if (loadToken.current !== token) return
      startTransition(() => {
        setError(err.message)
        setLoaded(true)
      })
    }
  }, [debouncedQuery, selectedKinds, selectedCategories, selectedTags, order])

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    try {
      await api.librarySyncStart()
      toast('Two-way sync started with Google Drive', 'ok')
      let attempts = 0
      const poll = setInterval(async () => {
        attempts += 1
        try {
          const st = await api.librarySyncStatus()
          if (!st.is_running || attempts > 40) {
            clearInterval(poll)
            setIsSyncing(false)
            if (st.stage === 'failed') {
              toast(`Sync failed: ${st.last_error || 'Unknown error'}`, 'bad')
            } else if (st.inbound_imported > 0) {
              toast(`Sync complete: ${st.inbound_imported} items imported from Drive`, 'ok')
            } else {
              toast('Sync complete: library is up to date', 'ok')
            }
            load()
          }
        } catch {
          clearInterval(poll)
          setIsSyncing(false)
        }
      }, 1500)
    } catch (err) {
      setIsSyncing(false)
      toast(err.message || 'Sync failed', 'bad')
    }
  }, [load, toast])

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

  // Fetch lists
  const loadLists = useCallback(async () => {
    try {
      const data = await api.getLibraryLists()
      const listItems = Array.isArray(data) ? data : (data?.lists || [])
      setLists(listItems)
    } catch {
      // keep existing
    }
  }, [])

  const handleAutoCluster = useCallback(async () => {
    if (isClustering) return
    setIsClustering(true)
    try {
      const res = await api.autoClusterLibraryLists()
      const count = res.clusters_created !== undefined ? res.clusters_created : res.created_or_updated || 0
      toast?.(
        count > 0
          ? `Auto-grouped library into ${count} smart collections`
          : 'Smart lists are already up to date',
        'ok'
      )
      await loadLists()
    } catch (err) {
      toast?.(err.message || 'Auto-grouping failed', 'bad')
    } finally {
      setIsClustering(false)
    }
  }, [isClustering, loadLists, toast])

  const handleCreateList = useCallback(async () => {
    const title = window.prompt('Enter new list name:')
    if (!title || !title.trim()) return
    try {
      const res = await api.createLibraryList({ title: title.trim() })
      toast?.(`Created list "${title.trim()}"`, 'ok')
      await loadLists()
      if (res?.id) {
        setSelectedListId(res.id)
      }
    } catch (err) {
      toast?.(err.message || 'Failed to create list', 'bad')
    }
  }, [loadLists, toast])

  useEffect(() => {
    loadLists()
  }, [loadLists])

  // Fetch selected list details and member items/links
  useEffect(() => {
    if (!selectedListId) {
      setSelectedListDetail(null)
      return
    }
    let cancelled = false
    api.getLibraryListDetail(selectedListId)
      .then((detail) => {
        if (!cancelled) setSelectedListDetail(detail)
      })
      .catch((err) => {
        toast?.(err.message || 'Failed to load list details', 'bad')
      })
    return () => {
      cancelled = true
    }
  }, [selectedListId, toast])

  // Global keyboard shortcuts (Cmd+K / Ctrl+K for search, Cmd+N / Cmd+E for add resource)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select?.()
      }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'e')) {
        e.preventDefault()
        setAddModalMode('anything')
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
            setActiveModalItem((curr) =>
              curr?.id === id ? { ...updated, isProcessing: false } : curr
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
            setActiveModalItem((curr) =>
              curr?.id === id ? { ...updated, isProcessing: true } : curr
            )
          }
        } catch {
          activeProcessingIds.current.delete(id)
        }
      }
    }, 1000)

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
      const match = text.match(/^(book|place|idea|note):\s*(.+)$/i)
      if (match) {
        const kind = match[1].toLowerCase()
        const title = match[2].trim()
        handleAddResource({
          title,
          kind,
          category: kind === 'place' ? 'travel' : kind === 'book' ? 'books' : kind === 'idea' ? 'ideas' : 'general',
          notes: text,
        })
      } else {
        handleAddResource({ notes: text, title: text.slice(0, 48) })
      }
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

  const handleTogglePin = useCallback(
    async (item) => {
      const nextPinned = !item.is_pinned
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, is_pinned: nextPinned } : it))
      )
      toast(nextPinned ? 'Pinned to top' : 'Unpinned', 'ok')
      try {
        await api.updateLibraryItem(item.id, { is_pinned: nextPinned })
      } catch (err) {
        toast(err.message, 'bad')
        load()
      }
    },
    [toast, load]
  )

  const handleProgressChange = useCallback(
    async (item, nextProgress) => {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, progress: nextProgress } : it))
      )
      try {
        await api.updateLibraryItem(item.id, { progress: nextProgress })
      } catch (err) {
        toast(err.message, 'bad')
        load()
      }
    },
    [toast, load]
  )

  const handleSaveReminder = useCallback(
    async (item, patch) => {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, ...patch } : it))
      )
      toast('Reminder set', 'ok')
      try {
        await api.updateLibraryItem(item.id, patch)
      } catch (err) {
        toast(err.message, 'bad')
        load()
      }
    },
    [toast, load]
  )

  const handleClearReminder = useCallback(
    async (item) => {
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, remind_at: null, reminded_at: null } : it))
      )
      toast('Reminder cleared', 'ok')
      try {
        await api.updateLibraryItem(item.id, { remind_at: null, reminded_at: null })
      } catch (err) {
        toast(err.message, 'bad')
        load()
      }
    },
    [toast, load]
  )

  const handleReorder = useCallback(
    async (newItems) => {
      const withPositions = newItems.map((item, idx) => ({ ...item, position: idx }))
      setItems(withPositions)
      setOrder('manual')
      try {
        await api.reorderLibrary(newItems.map((it) => it.id))
        toast('Rearranged items', 'ok')
      } catch (err) {
        toast(err.message || 'Failed to persist order', 'bad')
        load()
      }
    },
    [toast, load]
  )

  const handleSelectKinds = useCallback((kinds) => {
    setSelectedKinds(kinds)
    setSelectedProgress('all')
  }, [])

  const handleClearFilters = useCallback(() => {
    setSelectedKinds([])
    setSelectedCategories([])
    setSelectedTags([])
    setSelectedRatings([])
    setSelectedProgress('all')
    setSelectedListId(null)
    setQuery('')
    setDebouncedQuery('')
  }, [])

  const handleSelectCard = useCallback((item) => {
    setActiveModalItem(item)
  }, [])

  const handleTagFilterClick = useCallback((tag) => {
    setSelectedTags([tag])
  }, [])

  const total = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + n, 0),
    [counts]
  )

  // Compute live shelf progress statistics for media types (Movies & Video / Books / Places)
  const shelfCounts = useMemo(() => {
    const counts = { all: items.length, unstarted: 0, in_progress: 0, completed: 0 }
    for (const it of items) {
      const p = it.progress || 'unstarted'
      counts[p] = (counts[p] || 0) + 1
    }
    return counts
  }, [items])

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

  // Filter items reactively by selectedProgress, selectedRating, quickFilters and order
  const displayedItems = useMemo(() => {
    let result = (selectedListId && Array.isArray(selectedListDetail?.items))
      ? selectedListDetail.items
      : items

    if (selectedListId && Array.isArray(selectedListDetail?.items)) {
      if (selectedKinds.length > 0) {
        result = result.filter((it) => selectedKinds.includes(it.kind))
      }
      if (debouncedQuery && debouncedQuery.trim()) {
        const q = debouncedQuery.toLowerCase()
        result = result.filter(
          (it) =>
            (it.title || '').toLowerCase().includes(q) ||
            (it.notes || '').toLowerCase().includes(q) ||
            (it.url || '').toLowerCase().includes(q) ||
            (it.author || '').toLowerCase().includes(q)
        )
      }
    }
    if (quickFilters.addedThisWeek) {
      const oneWeekAgo = new Date()
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)
      result = result.filter((it) => {
        const itemDate = new Date(it.created_at || it.consumed_on || 0)
        return itemDate >= oneWeekAgo
      })
    }
    if (quickFilters.unreadOnly) {
      result = result.filter((it) => !it.progress || it.progress === 'unstarted')
    }
    if (quickFilters.hasNotes) {
      result = result.filter((it) => Boolean(it.notes && it.notes.trim()))
    }
    if (selectedProgress && selectedProgress !== 'all') {
      result = result.filter((it) => (it.progress || 'unstarted') === selectedProgress)
    }
    if (selectedRatings.length) {
      result = result.filter((it) => selectedRatings.some((rating) =>
        rating === '5' ? it.rating === 5 : rating === '4+' ? (it.rating || 0) >= 4 : (it.rating || 0) > 0
      ))
    }
    if (order === 'rating') {
      result = [...result].sort((a, b) => (b.rating || 0) - (a.rating || 0))
    } else if (order === 'manual') {
      result = [...result].sort((a, b) => (a.position || 0) - (b.position || 0))
    }
    // Always prioritize pinned items on top
    result = [...result].sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0))
    return result
  }, [items, selectedListId, selectedListDetail, selectedProgress, selectedRatings, quickFilters, order])

  // Progressive item rendering: render initial batch first to eliminate main-thread freeze
  const PAGE_SIZE = 30
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Reset pagination when active query/filters/sorting change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [
    debouncedQuery,
    selectedKinds,
    selectedCategories,
    selectedTags,
    selectedRatings,
    selectedProgress,
    quickFilters,
    order,
    selectedListId,
  ])

  const visibleItems = useMemo(() => {
    return displayedItems.slice(0, visibleCount)
  }, [displayedItems, visibleCount])

  const hasMoreItems = visibleCount < displayedItems.length

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, displayedItems.length))
  }, [displayedItems.length])

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
                setAddModalMode(mode || 'anything')
                setShowAddModal(true)
              }}
              onOpenMergeModal={() => setShowMergeModal(true)}
              counts={counts}
              selectedKinds={selectedKinds}
              onSelectKinds={handleSelectKinds}
              lists={lists}
              selectedListId={selectedListId}
              onSelectList={setSelectedListId}
              onOpenCreateList={() => setShowCreateListModal(true)}
              onOpenManageLists={() => setShowManageListsModal(true)}
              onAutoCluster={handleAutoCluster}
              isClustering={isClustering}
              quickFilters={quickFilters}
              onQuickFiltersChange={setQuickFilters}
              isSelectMode={isSelectMode}
              onToggleSelectMode={() => setIsSelectMode((v) => !v)}
              onSync={handleSync}
              isSyncing={isSyncing}
            />

            {/* Selected List Banner */}
            {selectedListDetail && (
              <div className="lib-selected-list-banner">
                <div className="lib-selected-list-info">
                  <div className="lib-selected-list-title-row">
                    <Icon
                      name={(selectedListDetail.is_smart || selectedListDetail.list?.is_smart) ? 'spark' : 'folder'}
                      size={16}
                      className={(selectedListDetail.is_smart || selectedListDetail.list?.is_smart) ? 'text-amber-400' : ''}
                    />
                    <h2 className="lib-selected-list-title">
                      {selectedListDetail.title || selectedListDetail.list?.title || 'Selected List'}
                    </h2>
                    {Boolean(selectedListDetail.is_smart || selectedListDetail.list?.is_smart) && (
                      <span className="lib-smart-badge">Smart Clustered</span>
                    )}
                  </div>
                  {(selectedListDetail.description || selectedListDetail.list?.description) && (
                    <p className="lib-selected-list-desc">
                      {selectedListDetail.description || selectedListDetail.list?.description}
                    </p>
                  )}
                </div>
                <div className="lib-selected-list-stats">
                  <span>{selectedListDetail.items?.length || 0} items</span>
                  <span>•</span>
                  <span>{selectedListDetail.links?.length || 0} links</span>
                  <button
                    type="button"
                    className="lib-selected-list-clear-btn"
                    onClick={() => setSelectedListId(null)}
                  >
                    View all items
                  </button>
                </div>
              </div>
            )}

            {/* Extracted Outbound Links within Selected List */}
            {selectedListDetail?.links?.length > 0 && (
              <div className="lib-list-links-shelf">
                <div className="lib-list-links-shelf-title">
                  <Icon name="link" size={12} />
                  <span>Harvested Outbound Links in List ({selectedListDetail.links.length})</span>
                </div>
                <div className="lib-list-links-shelf-scroll">
                  {selectedListDetail.links.map((link) => (
                    <a
                      key={link.id}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="lib-list-link-pill"
                      title={link.url}
                    >
                      <span className="lib-list-link-domain">{link.domain}</span>
                      <span className="lib-list-link-text">{link.title || link.url}</span>
                      <Icon name="external-link" size={11} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Layout Area: Active Filter Strip (when active) + Content Canvas */}
            <div className="lib-layout w-full flex flex-col gap-4">
              {hasFilter && (
                <LibraryFilterBar
                  selectedKinds={selectedKinds}
                  selectedCategories={selectedCategories}
                  selectedTags={selectedTags}
                  selectedRatings={selectedRatings}
                  query={query}
                  onSelectKinds={handleSelectKinds}
                  onSelectCategories={setSelectedCategories}
                  onSelectTags={setSelectedTags}
                  onSelectRatings={setSelectedRatings}
                  onClearQuery={() => setQuery('')}
                  onClearFilters={handleClearFilters}
                />
              )}

              <main className="lib-content-main w-full">
                {!loaded && items.length === 0 ? (
                  <SkeletonLibraryGrid cards={9} />
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
                          <HouseButton
                            type="button"
                            className="lib-btn"
                            onClick={handleClearFilters}
                          >
                            Reset filters
                          </HouseButton>
                        ) : (
                          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                            <HouseButton
                              type="button"
                              className="lib-btn lib-btn--primary"
                              onClick={() => {
                                setAddModalMode('url')
                                setShowAddModal(true)
                              }}
                            >
                              <Icon name="plus" size={14} />
                              <span>Add first resource</span>
                            </HouseButton>
                            <HouseButton
                              type="button"
                              className="lib-btn"
                              onClick={handleSync}
                              disabled={isSyncing}
                            >
                              <Icon name="refresh" size={13} className={isSyncing ? 'animate-spin text-accent' : ''} style={{ marginRight: 6 }} />
                              <span>{isSyncing ? 'Syncing Drive…' : 'Sync from Google Drive'}</span>
                            </HouseButton>
                          </div>
                        )}
                      </EmptyState.Footer>
                    </EmptyState>
                  </div>
                ) : layout === 'grid' ? (
                  <LibraryGrid
                    items={visibleItems}
                    total={total}
                    showing={visibleItems.length}
                    totalShowing={displayedItems.length}
                    hasMore={hasMoreItems}
                    onLoadMore={handleLoadMore}
                    busyId={busyId}
                    onSelect={handleSelectCard}
                    onReindex={handleReindex}
                    onEnrich={handleEnrich}
                    onDelete={handleDelete}
                    onTagClick={handleTagFilterClick}
                    onTogglePin={handleTogglePin}
                    onProgressChange={handleProgressChange}
                    onSaveReminder={handleSaveReminder}
                    onClearReminder={handleClearReminder}
                    onReorder={handleReorder}
                  />
                ) : (
                  <LibraryListView
                    items={visibleItems}
                    totalShowing={displayedItems.length}
                    hasMore={hasMoreItems}
                    onLoadMore={handleLoadMore}
                    busyId={busyId}
                    onSelect={handleSelectCard}
                    onReindex={handleReindex}
                    onEnrich={handleEnrich}
                    onDelete={handleDelete}
                    onTagClick={handleTagFilterClick}
                    onTogglePin={handleTogglePin}
                    onProgressChange={handleProgressChange}
                    onSaveReminder={handleSaveReminder}
                    onClearReminder={handleClearReminder}
                    onReorder={handleReorder}
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

        {/* Merge Lists Modal */}
        <MergeListsModal
          open={showMergeModal}
          onClose={() => setShowMergeModal(false)}
          tagCounts={tagCounts}
          categoryCounts={categoryCounts}
          onMerged={load}
          toast={toast}
        />

        {/* Create List Modal */}
        <CreateListModal
          open={showCreateListModal}
          onClose={() => setShowCreateListModal(false)}
          onCreated={(newList) => {
            loadLists()
            if (newList?.id) setSelectedListId(newList.id)
          }}
          toast={toast}
        />

        {/* Manage Lists Modal */}
        <ManageListsModal
          open={showManageListsModal}
          onClose={() => setShowManageListsModal(false)}
          lists={lists}
          selectedListId={selectedListId}
          onSelectList={setSelectedListId}
          onRefreshLists={loadLists}
          onOpenCreateModal={() => {
            setShowManageListsModal(false)
            setShowCreateListModal(true)
          }}
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
