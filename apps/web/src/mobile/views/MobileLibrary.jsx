import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { safeStorage } from '../../lib/storage.js'
import { storedIdentity } from '../../lib/credentials.js'
import { getTransportManager } from '../../lib/sync/transportManager.js'
import {
  getStoredCollections,
  loadCollectionsFromStore,
  saveCollectionsToStore,
  syncCollections,
  getCollectionsDisplayState,
  getLastSyncedTime,
  formatLastSyncedTime,
  subscribeCollections,
} from '../collectionsSync.js'
import { mergeOptimisticItems } from '../libraryMerge.js'
import { GlassIconButton, Segmented } from '../components/libraryUi.jsx'
import { INK, MUTED, BLUE, BLUE_SOFT, ALL_11_TYPES, GLASS_STYLE } from '../components/library/tokens.js'

// Global Modular Subviews
import LibraryListView from '../components/library/LibraryListView.jsx'
import LibraryGridView from '../components/library/LibraryGridView.jsx'
import LibraryCollectionsView from '../components/library/LibraryCollectionsView.jsx'
import CollectionDetailView from '../components/library/CollectionDetailView.jsx'
import LibrarySearchScreen from '../components/library/LibrarySearchScreen.jsx'
import LibrarySettingsScreen from '../components/library/LibrarySettingsScreen.jsx'

// Global Sheets & Modals
import CreateItemSheet from '../components/library/CreateItemSheet.jsx'
import ShareExtensionSheet from '../components/library/ShareExtensionSheet.jsx'
import FilterSortSheet from '../components/library/FilterSortSheet.jsx'
import ItemActionSheet from '../components/library/ItemActionSheet.jsx'
import ConfirmDeleteModal from '../components/library/ConfirmDeleteModal.jsx'
import TagManagerSheet from '../components/library/TagManagerSheet.jsx'
import MultiSelectBar from '../components/library/MultiSelectBar.jsx'
import SavingToast from '../components/library/SavingToast.jsx'
import SavingBanners from '../components/library/SavingBanners.jsx'
import { AddToCollectionSheet } from '../components/libraryUi.jsx'

import './libraryList.css'

export function getResolvedBase() {
  const tm = getTransportManager?.()
  const tmHost = tm?.getState?.()?.hostUrl
  if (tmHost && !tmHost.includes('localhost') && !tmHost.includes('127.0.0.1')) {
    return tmHost.replace(/\/+$/, '')
  }
  const id = storedIdentity()
  if (id?.hostUrl && !id.hostUrl.includes('localhost') && !id.hostUrl.includes('127.0.0.1')) {
    return id.hostUrl.replace(/\/+$/, '')
  }
  const base = api.getBase?.()?.replace?.(/\/api$/, '') || ''
  if (base && !base.includes('localhost') && !base.includes('127.0.0.1')) return base
  try {
    const pcHost = safeStorage.getItem('amethyst.pc_host')
    if (pcHost && !pcHost.includes('localhost')) {
      return pcHost.replace(/\/+$/, '')
    }
  } catch {}
  return base || 'http://localhost:8000'
}

export default function MobileLibrary({ onSelectItem, onOpenAsk, onOpenCapture }) {
  // Navigation & View Mode State
  const [mainTab, setMainTab] = useState('library') // 'library' | 'collections'
  const [viewMode, setViewMode] = useState(() => safeStorage.getItem('amethyst.default_view') || 'list') // 'list' | 'grid'
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('new')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedTag, setSelectedTag] = useState(null)

  // Subview overlays
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeCollection, setActiveCollection] = useState(null)

  // Sheets & Modals
  const [createOpen, setCreateOpen] = useState(false)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [shareSheetData, setShareSheetData] = useState(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [actionItem, setActionItem] = useState(null)
  const [collectionSheetItem, setCollectionSheetItem] = useState(null)
  const [deleteModal, setDeleteModal] = useState({ open: false, item: null, count: 1 })

  // Multi-Select
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  // Data & Toast
  const [items, setItems] = useState(() => {
    try {
      const cached = safeStorage.getItem('amethyst.cached_library')
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return []
  })
  const [resumeItems, setResumeItems] = useState([])
  const [collections, setCollections] = useState(() => {
    const store = getStoredCollections()
    if (Array.isArray(store)) return store
    if (Array.isArray(store?.lists)) return store.lists
    return []
  })
  const [loading, setLoading] = useState(true)
  const [lastSynced, setLastSynced] = useState(() => formatLastSyncedTime(getLastSyncedTime()))
  const [toast, setToast] = useState({ visible: false, status: 'success', message: '', actionLabel: null, onAction: null })
  const scrollContainerRef = useRef(null)

  // Restore scroll position on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('amethyst.library_scroll_top')
      if (saved && scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = Number(saved)
      }
    } catch {}
  }, [])

  const handleScroll = useCallback((e) => {
    try {
      sessionStorage.setItem('amethyst.library_scroll_top', String(e.currentTarget.scrollTop))
    } catch {}
  }, [])

  const showToast = useCallback((message, status = 'success', actionLabel = null, onAction = null) => {
    setToast({ visible: true, status, message, actionLabel, onAction })
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }))
    }, 3200)
  }, [])

  // 1. Initial Load & Background Refresh from API
  const loadData = useCallback(async () => {
    try {
      const [libRes, resumeRes, listsRes] = await Promise.allSettled([
        api.library({ limit: 500 }),
        api.libraryResume(),
        api.getLibraryLists(),
      ])

      if (libRes.status === 'fulfilled' && libRes.value?.items) {
        const fresh = libRes.value.items
        setItems((prev) => mergeOptimisticItems(prev, fresh))
        try {
          safeStorage.setItem('amethyst.cached_library', JSON.stringify(fresh.slice(0, 200)))
        } catch {}
      }

      if (resumeRes.status === 'fulfilled' && Array.isArray(resumeRes.value?.items)) {
        setResumeItems(resumeRes.value.items)
      }

      if (listsRes.status === 'fulfilled' && Array.isArray(listsRes.value)) {
        setCollections(listsRes.value)
        saveCollectionsToStore({ lists: listsRes.value })
      }
    } catch (err) {
      console.warn('Library load notice:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
    const unsub = subscribeCollections((cols) => {
      if (Array.isArray(cols)) {
        setCollections(cols)
      } else if (Array.isArray(cols?.lists)) {
        setCollections(cols.lists)
      }
    })
    return () => unsub?.()
  }, [loadData])

  // Periodic last-synced display refresh
  useEffect(() => {
    const timer = setInterval(() => {
      setLastSynced(formatLastSyncedTime(getLastSyncedTime()))
    }, 15000)
    return () => clearInterval(timer)
  }, [])

  // Listen for global create or share events
  useEffect(() => {
    const handleOpenCreate = () => setCreateOpen(true)
    const handleShareReceived = (e) => {
      if (e.detail) setShareSheetData(e.detail)
    }
    window.addEventListener('amethyst:library:create', handleOpenCreate)
    window.addEventListener('amethyst:library:share', handleShareReceived)
    return () => {
      window.removeEventListener('amethyst:library:create', handleOpenCreate)
      window.removeEventListener('amethyst:library:share', handleShareReceived)
    }
  }, [])

  // Collect all unique tags for filter sheet
  const allTags = useMemo(() => {
    const set = new Set()
    for (const it of items) {
      const tags = Array.isArray(it.tags)
        ? it.tags
        : typeof it.tags === 'string'
        ? it.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : []
      for (const t of tags) set.add(t.replace(/^#/, '').toLowerCase())
    }
    return Array.from(set).sort()
  }, [items])

  // Processed Items (filtered & sorted)
  const processedItems = useMemo(() => {
    let list = [...items]

    // Type filter
    if (activeFilter !== 'all') {
      list = list.filter((it) => it.kind === activeFilter)
    }

    // Tag filter
    if (selectedTag) {
      list = list.filter((it) => {
        const tags = Array.isArray(it.tags) ? it.tags.join(' ') : String(it.tags || '')
        return tags.toLowerCase().includes(selectedTag.toLowerCase())
      })
    }

    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'favorites') {
        list = list.filter((it) => it.is_favorite || it.favorite)
      } else {
        list = list.filter((it) => it.progress === statusFilter)
      }
    }

    // Sort order
    if (sortOrder === 'old') {
      list.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    } else if (sortOrder === 'alpha') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else {
      list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    }

    return list
  }, [items, activeFilter, selectedTag, statusFilter, sortOrder])

  // Jump items (in-progress items)
  const jumpItems = useMemo(() => {
    if (resumeItems.length > 0) return resumeItems.slice(0, 6)
    return items.filter((it) => it.progress === 'in_progress' || it.progress === 'watching' || it.progress === 'reading' || it.progress === 'playing').slice(0, 6)
  }, [resumeItems, items])

  // Multi-Select Handlers
  const handleToggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === processedItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(processedItems.map((it) => it.id)))
    }
  }, [selectedIds, processedItems])

  // CRUD Actions
  const handleSaveItem = async (payload) => {
    const tempId = `optimistic-${Date.now()}`
    const optItem = {
      id: tempId,
      ...payload,
      created_at: new Date().toISOString(),
      status: 'ready',
      is_optimistic: true,
    }
    setItems((prev) => [optItem, ...prev])
    showToast('Saved to Library', 'success')
    loadData()
  }

  const handleToggleFavorite = async (item) => {
    const nextFav = !(item.is_favorite || item.favorite)
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, is_favorite: nextFav, favorite: nextFav } : it))
    )
    showToast(nextFav ? 'Added to favorites' : 'Removed from favorites')
    try {
      await api.updateLibraryItem(item.id, { is_favorite: nextFav, favorite: nextFav })
    } catch {
      showToast('Could not update favorite', 'error')
    }
  }

  const handleDeleteConfirmed = async () => {
    const itemToDelete = deleteModal.item
    setDeleteModal({ open: false, item: null, count: 1 })

    if (itemToDelete) {
      // Soft delete single item
      setItems((prev) => prev.filter((it) => it.id !== itemToDelete.id))
      showToast('Item deleted', 'success', 'Undo', async () => {
        try {
          await api.restoreLibraryItem(itemToDelete.id)
          setItems((prev) => [itemToDelete, ...prev])
          showToast('Item restored')
        } catch {
          showToast('Could not restore item', 'error')
        }
      })
      try {
        await api.deleteLibraryItem(itemToDelete.id, true)
      } catch {
        showToast('Could not delete item', 'error')
      }
    } else if (selectMode && selectedIds.size > 0) {
      // Bulk delete
      const ids = Array.from(selectedIds)
      const removedItems = items.filter((it) => selectedIds.has(it.id))
      setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)))
      setSelectedIds(new Set())
      setSelectMode(false)

      showToast(`Deleted ${ids.length} items`, 'success', 'Undo', async () => {
        try {
          await api.libraryBulkRestore(ids)
          setItems((prev) => [...removedItems, ...prev])
          showToast('Items restored')
        } catch {
          showToast('Could not restore items', 'error')
        }
      })
      try {
        await api.libraryBulkDelete(ids)
      } catch {
        showToast('Could not delete items', 'error')
      }
    }
  }

  const handleToggleView = () => {
    const next = viewMode === 'list' ? 'grid' : 'list'
    setViewMode(next)
    safeStorage.setItem('amethyst.default_view', next)
  }

  // Subview: Search
  if (searchOpen) {
    return (
      <LibrarySearchScreen
        open={true}
        items={items}
        onClose={() => setSearchOpen(false)}
        onSelectItem={(it) => {
          setSearchOpen(false)
          onSelectItem?.(it)
        }}
        onOpenActions={(it) => setActionItem(it)}
      />
    )
  }

  // Subview: Settings
  if (settingsOpen) {
    return (
      <LibrarySettingsScreen
        open={true}
        onClose={() => setSettingsOpen(false)}
        onOpenTags={() => {
          setSettingsOpen(false)
          setTagManagerOpen(true)
        }}
        showToast={showToast}
      />
    )
  }

  // Subview: Collection Detail
  if (activeCollection) {
    return (
      <CollectionDetailView
        collection={activeCollection}
        allLibraryItems={items}
        onBack={() => setActiveCollection(null)}
        onOpenItem={onSelectItem}
        onOpenActions={(it) => setActionItem(it)}
        onDiscussWithAgent={(col) => onOpenAsk?.({ type: 'collection', ...col })}
        onUpdateCollection={(updated) => {
          setCollections((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
          setActiveCollection((prev) => ({ ...prev, ...updated }))
        }}
        onDeleteCollection={(colId) => {
          setCollections((prev) => prev.filter((c) => c.id !== colId))
          setActiveCollection(null)
          showToast('Collection deleted')
        }}
        showToast={showToast}
      />
    )
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="lb"
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        position: 'relative',
        background: '#F2F2F7',
        color: INK,
        paddingBottom: 110,
        boxSizing: 'border-box',
      }}
    >
      {/* Top Main Header matching Main.dc.html */}
      <header
        style={{
          position: 'relative',
          padding: 'calc(env(safe-area-inset-top, 0px) + 38px) 16px 12px',
          zIndex: 10,
        }}
      >
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 40, lineHeight: '44px', fontWeight: 800, letterSpacing: '-0.035em', color: INK }}>
              Library
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 14, color: MUTED }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 12a8 8 0 11-2.6-5.9M20 4v5h-5" />
              </svg>
              Synced {lastSynced}
            </div>
          </div>

          {/* Top-Right Circular Glass Buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
            <GlassIconButton label="Search" width={46} height={46} onClick={() => setSearchOpen(true)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-4-4" />
              </svg>
            </GlassIconButton>

            <GlassIconButton label="Sort and filter" width={46} height={46} onClick={() => setFilterOpen(true)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="8" cy="17" r="2" />
              </svg>
            </GlassIconButton>

            <GlassIconButton label="Settings" width={46} height={46} onClick={() => setSettingsOpen(true)}>
              <span style={{ fontSize: 16, fontWeight: 800 }}>A</span>
            </GlassIconButton>
          </div>
        </div>

        {/* Segmented Control: Saved vs Collections */}
        <div style={{ marginTop: 12, display: 'flex', padding: 3, borderRadius: 20, background: 'rgba(118,118,128,.12)' }}>
          <button
            type="button"
            onClick={() => setMainTab('library')}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 16,
              border: 0,
              background: mainTab === 'library' ? '#fff' : 'transparent',
              boxShadow: mainTab === 'library' ? '0 2px 8px rgba(0,0,0,.14), inset 0 0 0 1px rgba(255,255,255,.9)' : 'none',
              fontSize: 16,
              fontWeight: mainTab === 'library' ? 700 : 500,
              color: mainTab === 'library' ? INK : '#48484A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Saved{' '}
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: '2px 9px',
                borderRadius: 10,
                background: mainTab === 'library' ? '#E5E5EA' : 'rgba(118,118,128,.16)',
                color: '#3A3A3C',
              }}
            >
              {items.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab('collections')}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 16,
              border: 0,
              background: mainTab === 'collections' ? '#fff' : 'transparent',
              boxShadow: mainTab === 'collections' ? '0 2px 8px rgba(0,0,0,.14), inset 0 0 0 1px rgba(255,255,255,.9)' : 'none',
              fontSize: 16,
              fontWeight: mainTab === 'collections' ? 700 : 500,
              color: mainTab === 'collections' ? INK : '#48484A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            Collections{' '}
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: '2px 9px',
                borderRadius: 10,
                background: mainTab === 'collections' ? '#E5E5EA' : 'rgba(118,118,128,.16)',
                color: '#3A3A3C',
              }}
            >
              {collections.length}
            </span>
          </button>
        </div>

        {/* Calm Control Row: Type Filter Pill + View Switcher */}
        {mainTab === 'library' && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'relative' }}>
            <button
              type="button"
              onClick={() => setTypeMenuOpen((prev) => !prev)}
              style={{
                height: 48,
                padding: '0 18px',
                borderRadius: 24,
                border: '1px solid #D8D8DE',
                background: '#fff',
                color: INK,
                fontSize: 16,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
              }}
            >
              {activeFilter === 'all'
                ? 'All types'
                : (ALL_11_TYPES.find((t) => t.id === activeFilter)?.label || 'All types')}
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{
                  transform: typeMenuOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease',
                }}
              >
                <path d="M7 10l5 5 5-5" />
              </svg>
            </button>

            {/* View Switcher */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                aria-label="List view"
                onClick={() => {
                  setViewMode('list')
                  safeStorage.setItem('amethyst.default_view', 'list')
                }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  border: 0,
                  background: viewMode === 'list' ? '#E4EDFC' : 'transparent',
                  color: viewMode === 'list' ? '#0A55C4' : '#636366',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Grid view"
                onClick={() => {
                  setViewMode('grid')
                  safeStorage.setItem('amethyst.default_view', 'grid')
                }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  border: 0,
                  background: viewMode === 'grid' ? '#E4EDFC' : 'transparent',
                  color: viewMode === 'grid' ? '#0A55C4' : '#636366',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
                  <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
                  <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
                  <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
                </svg>
              </button>
            </div>

            {/* Floating Type Filter Dropdown Menu */}
            {typeMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 54,
                  left: 0,
                  zIndex: 50,
                  minWidth: 180,
                  background: '#FFFFFF',
                  borderRadius: 18,
                  padding: '6px',
                  boxShadow: '0 12px 36px rgba(0,0,0,.16), 0 0 0 1px rgba(0,0,0,.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('all')
                    setTypeMenuOpen(false)
                  }}
                  style={{
                    height: 38,
                    padding: '0 14px',
                    borderRadius: 12,
                    border: 0,
                    background: activeFilter === 'all' ? '#E4EDFC' : 'transparent',
                    color: activeFilter === 'all' ? '#0A55C4' : INK,
                    fontSize: 14,
                    fontWeight: activeFilter === 'all' ? 700 : 500,
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  All types
                </button>
                {ALL_11_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setActiveFilter(t.id)
                      setTypeMenuOpen(false)
                    }}
                    style={{
                      height: 38,
                      padding: '0 14px',
                      borderRadius: 12,
                      border: 0,
                      background: activeFilter === t.id ? '#E4EDFC' : 'transparent',
                      color: activeFilter === t.id ? '#0A55C4' : INK,
                      fontSize: 14,
                      fontWeight: activeFilter === t.id ? 700 : 500,
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main style={{ padding: '4px 16px 0' }}>
        {/* Real Active Saving & Attention Banners (§5.3) */}
        {mainTab === 'library' && <SavingBanners onRefresh={loadData} />}

        {mainTab === 'collections' ? (
          <LibraryCollectionsView
            collections={collections}
            items={items}
            onOpenCollection={setActiveCollection}
            onCreateCollection={async (title) => {
              const res = await api.createLibraryList({ title })
              if (res?.id) {
                const newCol = { id: res.id, title, item_count: 0 }
                setCollections((prev) => [newCol, ...prev])
                showToast(`Created "${title}"`, 'success')
                setActiveCollection(newCol)
              }
            }}
            onOpenSmartGroup={(group) => {
              setMainTab('library')
              setStatusFilter(group)
            }}
            onOpenItem={onSelectItem}
            onOpenActions={(it) => setActionItem(it)}
            showToast={showToast}
          />
        ) : viewMode === 'grid' ? (
          <LibraryGridView
            items={processedItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onOpenItem={onSelectItem}
            onOpenActions={(it) => setActionItem(it)}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        ) : (
          <LibraryListView
            items={processedItems}
            jumpItems={jumpItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onRefresh={loadData}
            onOpenItem={onSelectItem}
            onOpenActions={(it) => setActionItem(it)}
            onOpenCreate={() => setCreateOpen(true)}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
          />
        )}
      </main>

      {/* Modals & Action Sheets */}
      <CreateItemSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleSaveItem}
        onSavedOpen={(it) => onSelectItem?.(it)}
        showToast={showToast}
      />

      <ShareExtensionSheet
        open={Boolean(shareSheetData)}
        shareData={shareSheetData}
        onClose={() => setShareSheetData(null)}
        onOpenItem={(it) => onSelectItem?.(it)}
        onUndo={(id) => {
          setItems((prev) => prev.filter((it) => it.id !== id))
        }}
        showToast={showToast}
      />

      <FilterSortSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        activeType={activeFilter}
        onTypeChange={setActiveFilter}
        sortOrder={sortOrder}
        onSortChange={setSortOrder}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        allTags={allTags}
        selectedTag={selectedTag}
        onTagChange={setSelectedTag}
        resultCount={processedItems.length}
        onReset={() => {
          setActiveFilter('all')
          setSortOrder('new')
          setStatusFilter('all')
          setSelectedTag(null)
        }}
      />

      <ItemActionSheet
        isOpen={Boolean(actionItem)}
        item={actionItem}
        onClose={() => setActionItem(null)}
        onShare={(it) => {
          if (navigator.share) {
            navigator.share({ title: it.title, url: it.url }).catch(() => {})
          } else {
            showToast('Link copied to clipboard')
          }
        }}
        onAddToCollection={(it) => setCollectionSheetItem(it)}
        onToggleFavorite={handleToggleFavorite}
        onEditTags={() => setTagManagerOpen(true)}
        onReEnrich={(it) => {
          showToast('Enriching in background…')
          api.enrichLibraryItem?.(it.id).catch(() => {})
        }}
        onOpenOriginal={(it) => {
          if (it.url) window.open(it.url, '_blank')
        }}
        onDelete={(it) => setDeleteModal({ open: true, item: it, count: 1 })}
      />

      <ConfirmDeleteModal
        isOpen={deleteModal.open}
        count={deleteModal.count}
        itemName={deleteModal.item?.title}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setDeleteModal({ open: false, item: null, count: 1 })}
      />

      <TagManagerSheet
        open={tagManagerOpen}
        onClose={() => setTagManagerOpen(false)}
        items={items}
        showToast={showToast}
      />

      <AddToCollectionSheet
        open={Boolean(collectionSheetItem)}
        item={collectionSheetItem}
        onClose={() => setCollectionSheetItem(null)}
        showToast={showToast}
      />

      <MultiSelectBar
        visible={selectMode}
        selectedCount={selectedIds.size}
        isAllSelected={selectedIds.size === processedItems.length && processedItems.length > 0}
        onSelectAll={handleSelectAll}
        onCancel={() => {
          setSelectMode(false)
          setSelectedIds(new Set())
        }}
        onCollect={() => {
          showToast('Add to collection ready')
        }}
        onTag={() => setTagManagerOpen(true)}
        onShare={() => showToast('Sharing selected items')}
        onDelete={() => setDeleteModal({ open: true, item: null, count: selectedIds.size })}
      />

      <SavingToast
        visible={toast.visible}
        status={toast.status}
        message={toast.message}
        actionLabel={toast.actionLabel}
        onAction={toast.onAction}
      />
    </div>
  )
}
