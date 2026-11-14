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
import { INK, MUTED } from '../components/library/tokens.js'

// Global Modular Subviews
import LibraryListView from '../components/library/LibraryListView.jsx'
import LibraryGridView from '../components/library/LibraryGridView.jsx'
import LibraryCollectionsView from '../components/library/LibraryCollectionsView.jsx'
import CollectionDetailView from '../components/library/CollectionDetailView.jsx'
import LibrarySearchScreen from '../components/library/LibrarySearchScreen.jsx'
import LibrarySettingsScreen from '../components/library/LibrarySettingsScreen.jsx'

// Global Sheets & Modals
import CreateItemSheet from '../components/library/CreateItemSheet.jsx'
import FilterSortSheet from '../components/library/FilterSortSheet.jsx'
import ItemActionSheet from '../components/library/ItemActionSheet.jsx'
import ConfirmDeleteModal from '../components/library/ConfirmDeleteModal.jsx'
import TagManagerSheet from '../components/library/TagManagerSheet.jsx'
import MultiSelectBar from '../components/library/MultiSelectBar.jsx'
import SavingToast from '../components/library/SavingToast.jsx'
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

export default function MobileLibrary({ onSelectItem, onOpenAsk }) {
  // Navigation & View Mode State
  const [mainTab, setMainTab] = useState('library') // 'library' | 'collections'
  const [viewMode, setViewMode] = useState('list') // 'list' | 'grid'
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
  const [filterOpen, setFilterOpen] = useState(false)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [actionItem, setActionItem] = useState(null)
  const [collectionSheetItem, setCollectionSheetItem] = useState(null)
  const [deleteModal, setDeleteModal] = useState({ open: false, item: null, count: 1 })

  // Multi-Select
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  // Data & Toast
  const [items, setItems] = useState([])
  const [collections, setCollections] = useState(() => getStoredCollections())
  const [loading, setLoading] = useState(true)
  const [lastSynced, setLastSynced] = useState(() => formatLastSyncedTime(getLastSyncedTime()))
  const [toast, setToast] = useState({ visible: false, status: 'success', message: '', actionLabel: null, onAction: null })

  const showToast = useCallback((message, status = 'success', actionLabel = null, onAction = null) => {
    setToast({ visible: true, status, message, actionLabel, onAction })
    setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }))
    }, 3200)
  }, [])

  // 1. Initial Load & Background Refresh from API
  const loadData = useCallback(async () => {
    try {
      const res = await api.library({ limit: 500 }).catch(() => null)
      if (res?.items) {
        setItems((prev) => mergeOptimisticItems(prev, res.items))
      }
      const lists = await api.getLibraryLists().catch(() => null)
      if (Array.isArray(lists)) {
        setCollections(lists)
        saveCollectionsToStore(lists)
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
      if (Array.isArray(cols)) setCollections(cols)
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
  }, [items, selectedTag, statusFilter, sortOrder])

  // Jump items (in-progress items)
  const jumpItems = useMemo(() => {
    return items.filter((it) => it.progress === 'in_progress').slice(0, 6)
  }, [items])

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
    // Optimistic insert
    const tempId = `optimistic-${Date.now()}`
    const optItem = {
      id: tempId,
      ...payload,
      created_at: new Date().toISOString(),
      status: 'received',
      is_optimistic: true,
    }
    setItems((prev) => [optItem, ...prev])
    showToast('Saving to Library…', 'saving')

    try {
      const created = await api.addLibraryItem(payload)
      setItems((prev) =>
        prev.map((it) => (it.id === tempId ? { ...created, status: created.status || 'ready' } : it))
      )
      showToast('Saved to Library', 'success')
    } catch (err) {
      setItems((prev) => prev.filter((it) => it.id !== tempId))
      showToast(err?.message || 'Failed to save', 'error', 'Retry', () => handleSaveItem(payload))
    }
  }

  const handleDeleteConfirmed = async () => {
    const { item, count } = deleteModal
    setDeleteModal({ open: false, item: null, count: 1 })

    if (count > 1 && selectedIds.size > 0) {
      const idsToDelete = Array.from(selectedIds)
      setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)))
      setSelectedIds(new Set())
      setSelectMode(false)
      showToast(`Deleted ${idsToDelete.length} items`)

      try {
        await Promise.all(idsToDelete.map((id) => api.deleteLibraryItem(id).catch(() => null)))
      } catch {
        showToast('Some items could not be deleted', 'error')
      }
    } else if (item) {
      setItems((prev) => prev.filter((it) => it.id !== item.id))
      showToast('Item deleted')

      try {
        await api.deleteLibraryItem(item.id)
      } catch {
        showToast('Could not delete item', 'error')
      }
    }
  }

  const handleToggleFavorite = async (item) => {
    const nextFav = !(item.is_favorite || item.favorite)
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, is_favorite: nextFav, favorite: nextFav } : it))
    )
    showToast(nextFav ? 'Added to favorites' : 'Removed from favorites')
    try {
      await api.updateLibraryItem(item.id, { is_favorite: nextFav })
    } catch {}
  }

  // Render Subviews or Overlays
  if (searchOpen) {
    return (
      <LibrarySearchScreen
        items={items}
        onBack={() => setSearchOpen(false)}
        onOpenItem={onSelectItem}
        onOpenActions={(it) => setActionItem(it)}
      />
    )
  }

  if (settingsOpen) {
    return (
      <LibrarySettingsScreen
        onBack={() => setSettingsOpen(false)}
        showToast={showToast}
      />
    )
  }

  if (activeCollection) {
    return (
      <CollectionDetailView
        collection={activeCollection}
        items={items}
        onBack={() => setActiveCollection(null)}
        onOpenItem={onSelectItem}
        onOpenActions={(it) => setActionItem(it)}
        onAddSaves={() => {
          setMainTab('library')
          setActiveCollection(null)
          showToast(`Select items to add to ${activeCollection.title || 'collection'}`)
        }}
      />
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F2F2F7', color: INK }}>
      {/* Top Main Header */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          background: 'rgba(242,242,247,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px',
          zIndex: 40,
          borderBottom: '1px solid #ECECF0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 36, fontWeight: 800, letterSpacing: '-0.035em', color: INK }}>
              Library
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 13, color: MUTED }}>Synced {lastSynced}</span>
              <span style={{ width: 3, height: 3, borderRadius: 1.5, background: '#C7C7CC' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0A55C4' }}>
                Saved {items.length}
              </span>
              <span style={{ width: 3, height: 3, borderRadius: 1.5, background: '#C7C7CC' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0A55C4' }}>
                Collections {collections.length}
              </span>
            </div>
          </div>

          {/* Quick Header Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GlassIconButton label="Search" width={44} onClick={() => setSearchOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </GlassIconButton>

            <GlassIconButton
              label="Select mode"
              width={44}
              onClick={() => {
                setSelectMode(!selectMode)
                setSelectedIds(new Set())
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={selectMode ? '#0B5FD9' : 'currentColor'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </GlassIconButton>

            <GlassIconButton label="Filter & sort" width={44} onClick={() => setFilterOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="10" y1="18" x2="14" y2="18" />
              </svg>
            </GlassIconButton>

            {mainTab === 'library' && (
              <GlassIconButton
                label="Toggle view"
                width={44}
                onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
              >
                {viewMode === 'list' ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    <rect x="3" y="14" width="7" height="7" rx="1.5" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                )}
              </GlassIconButton>
            )}

            <GlassIconButton label="Settings" width={44} onClick={() => setSettingsOpen(true)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </GlassIconButton>
          </div>
        </div>

        {/* Segmented Switch: Library vs Collections */}
        <Segmented
          segments={[
            { value: 'library', label: 'Library', count: items.length },
            { value: 'collections', label: 'Collections', count: collections.length },
          ]}
          value={mainTab}
          onChange={setMainTab}
        />
      </header>

      {/* Main Content Area */}
      <main>
        {mainTab === 'collections' ? (
          <LibraryCollectionsView
            collections={collections}
            items={items}
            onOpenCollection={setActiveCollection}
            onCreateCollection={() => setCreateOpen(true)}
            onOpenSmartGroup={(group) => {
              setMainTab('library')
              setStatusFilter(group)
            }}
            onOpenItem={onSelectItem}
            onOpenActions={(it) => setActionItem(it)}
          />
        ) : viewMode === 'grid' ? (
          <LibraryGridView
            items={processedItems}
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
