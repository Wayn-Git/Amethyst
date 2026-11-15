import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HeaderCircleButton, ListRowCard, SectionLabel, ItemActionBar, BottomSheet, Skeleton } from '../libraryUi.jsx'
import { INK, MUTED, BLUE, BLUE_SOFT, DEEP_BLUE, CARD_SHADOW, LINE, DANGER_RED } from './tokens.js'
import { api } from '../../../api.js'
import ConfirmDeleteModal from './ConfirmDeleteModal.jsx'

const SORT_CHIPS = [
  { id: 'recent', label: 'Recent' },
  { id: 'type', label: 'Type' },
  { id: 'a_to_z', label: 'A to Z' },
  { id: 'wishlist', label: 'Wishlist only' },
]

export default function CollectionDetailView({
  collection,
  items = [],
  allLibraryItems = [],
  onBack,
  onSelectItem,
  onOpenItem,
  onAddSaves,
  onShare,
  onMore,
  onDiscussWithAgent,
  onUpdateCollection,
  onDeleteCollection,
  showToast,
}) {
  const handleSelect = onSelectItem || onOpenItem
  const [activeSort, setActiveSort] = useState('recent')

  // Live collection state
  const [collectionDetail, setCollectionDetail] = useState(collection || {})
  const [collectionItems, setCollectionItems] = useState(items || [])
  const [loading, setLoading] = useState(true)

  // Modals & Sheets
  const [addSavesOpen, setAddSavesOpen] = useState(false)
  const [moreSheetOpen, setMoreSheetOpen] = useState(false)
  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState(collection?.title || '')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [savingAction, setSavingAction] = useState(false)

  // Fetch full collection details & members
  useEffect(() => {
    if (!collection?.id) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .getLibraryListDetail(collection.id)
      .then((res) => {
        if (!cancelled && res) {
          setCollectionDetail((prev) => ({ ...prev, ...res }))
          if (Array.isArray(res.items)) {
            setCollectionItems(res.items)
          }
        }
      })
      .catch((err) => {
        console.warn('Could not load collection details:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [collection?.id])

  const filteredItems = useMemo(() => {
    let list = [...collectionItems]
    if (activeSort === 'wishlist') {
      list = list.filter((it) => it.progress === 'unstarted' || it.progress === 'wishlist')
    } else if (activeSort === 'a_to_z') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else if (activeSort === 'type') {
      list.sort((a, b) => (a.kind || '').localeCompare(b.kind || ''))
    }
    return list
  }, [collectionItems, activeSort])

  // Items in user's library that are NOT yet in this collection
  const availableToAdd = useMemo(() => {
    const existingIds = new Set(collectionItems.map((it) => it.id))
    return allLibraryItems.filter((it) => !existingIds.has(it.id))
  }, [allLibraryItems, collectionItems])

  const handleAddItem = async (item) => {
    if (!collection?.id || !item?.id) return
    setCollectionItems((prev) => [item, ...prev])
    showToast?.(`Added "${item.title || 'item'}" to collection`, 'success')
    try {
      await api.addLibraryListMember(collection.id, { item_id: item.id })
    } catch (err) {
      setCollectionItems((prev) => prev.filter((it) => it.id !== item.id))
      showToast?.(`Could not add item: ${err.message}`, 'error')
    }
  }

  const handleRemoveItem = async (itemId) => {
    if (!collection?.id || !itemId) return
    const removed = collectionItems.find((it) => it.id === itemId)
    setCollectionItems((prev) => prev.filter((it) => it.id !== itemId))
    showToast?.('Removed from collection', 'success', 'Undo', async () => {
      if (removed) {
        setCollectionItems((prev) => [removed, ...prev])
        try {
          await api.addLibraryListMember(collection.id, { item_id: itemId })
        } catch {}
      }
    })
    try {
      await api.removeLibraryListMember(collection.id, { item_id: itemId })
    } catch (err) {
      if (removed) setCollectionItems((prev) => [removed, ...prev])
      showToast?.(`Could not remove item: ${err.message}`, 'error')
    }
  }

  const handleShareCollection = () => {
    if (onShare) {
      onShare()
      return
    }
    const shareTitle = collectionDetail?.title || 'Collection'
    if (navigator.share) {
      navigator.share({ title: shareTitle, text: `Collection: ${shareTitle}` }).catch(() => {})
    } else {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).catch(() => {})
      }
      showToast?.('Collection link copied to clipboard', 'success')
    }
  }

  const handleRenameSubmit = async (e) => {
    e?.preventDefault()
    const clean = renameTitle.trim()
    if (!clean || savingAction || !collection?.id) return
    setSavingAction(true)
    try {
      await api.updateLibraryList(collection.id, { title: clean })
      setCollectionDetail((prev) => ({ ...prev, title: clean }))
      onUpdateCollection?.({ ...collectionDetail, title: clean })
      showToast?.(`Renamed to "${clean}"`, 'success')
      setRenameModalOpen(false)
    } catch (err) {
      showToast?.(`Could not rename: ${err.message}`, 'error')
    } finally {
      setSavingAction(false)
    }
  }

  const handleDeleteCollection = async () => {
    if (!collection?.id || savingAction) return
    setSavingAction(true)
    try {
      await api.deleteLibraryList(collection.id)
      setDeleteModalOpen(false)
      onDeleteCollection?.(collection.id)
      onBack?.()
    } catch (err) {
      showToast?.(`Could not delete collection: ${err.message}`, 'error')
    } finally {
      setSavingAction(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#F2F2F7',
        zIndex: 120,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingTop: 'max(52px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header Buttons */}
      <div
        style={{
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <HeaderCircleButton label="Back" size={44} onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </HeaderCircleButton>

        <div style={{ display: 'flex', gap: 10 }}>
          <HeaderCircleButton label="Share collection" size={44} onClick={handleShareCollection}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
          </HeaderCircleButton>

          <HeaderCircleButton label="More options" size={44} onClick={() => setMoreSheetOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </HeaderCircleButton>
        </div>
      </div>

      {/* Collection Hero Header: 68pt cover mosaic + 32/800 title */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: 20,
              background: '#2B3040',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              flex: 'none',
              boxShadow: CARD_SHADOW,
            }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 30,
                lineHeight: '36px',
                fontWeight: 800,
                color: INK,
                letterSpacing: '-0.03em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {collectionDetail?.title || 'Collection'}
            </h1>
            <div style={{ fontSize: 14, color: MUTED, marginTop: 4 }}>
              {collectionItems.length} {collectionItems.length === 1 ? 'save' : 'saves'} · Updated today
            </div>
          </div>
        </div>

        {/* Filter / Sort chips row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {SORT_CHIPS.map((chip) => {
            const on = activeSort === chip.id
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setActiveSort(chip.id)}
                style={{
                  height: 38,
                  padding: '0 16px',
                  borderRadius: 19,
                  border: on ? 'none' : '1px solid #D8D8DE',
                  background: on ? INK : '#FFFFFF',
                  color: on ? '#FFFFFF' : INK,
                  fontSize: 14,
                  fontWeight: on ? 650 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Items list */}
      <div style={{ padding: '10px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && collectionItems.length === 0 ? (
          <>
            <Skeleton height={88} radius={22} />
            <Skeleton height={88} radius={22} />
            <Skeleton height={88} radius={22} />
          </>
        ) : filteredItems.length > 0 ? (
          filteredItems.map((item) => (
            <div key={item.id} style={{ position: 'relative' }}>
              <ListRowCard
                item={item}
                onClick={() => handleSelect?.(item)}
              />
            </div>
          ))
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 16px', background: '#FFFFFF', borderRadius: 22, boxShadow: CARD_SHADOW }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📁</div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: INK }}>No saves in this collection</h3>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: MUTED }}>Add articles, videos, recipes or notes below.</p>
          </div>
        )}

        {/* Dashed "Add saves to <name>" button */}
        <button
          type="button"
          onClick={() => setAddSavesOpen(true)}
          style={{
            width: '100%',
            height: 56,
            borderRadius: 18,
            border: `1.5px dashed ${BLUE}`,
            background: BLUE_SOFT,
            color: DEEP_BLUE,
            fontSize: 16,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            marginTop: 8,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Add saves to {collectionDetail?.title || 'collection'}</span>
        </button>
      </div>

      {/* Floating Bottom Item Action Bar */}
      <ItemActionBar
        onDiscussWithAgent={() => onDiscussWithAgent?.(collectionDetail)}
      />

      {/* Add Saves Picker BottomSheet */}
      <BottomSheet open={addSavesOpen} onClose={() => setAddSavesOpen(false)} title={`Add saves to ${collectionDetail?.title || 'collection'}`}>
        <div style={{ padding: '0 16px 24px', maxHeight: '60vh', overflowY: 'auto' }}>
          {availableToAdd.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: MUTED }}>
              All your library saves are already in this collection.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {availableToAdd.slice(0, 50).map((it) => (
                <div
                  key={it.id}
                  onClick={() => handleAddItem(it)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderRadius: 18,
                    background: '#FFFFFF',
                    border: '1px solid #ECECF0',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 650, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.title || 'Untitled save'}
                    </div>
                    <div style={{ fontSize: 13, color: MUTED }}>
                      {it.kind} · {it.site || 'Saved'}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{
                      height: 34,
                      padding: '0 14px',
                      borderRadius: 17,
                      border: 0,
                      background: BLUE_SOFT,
                      color: DEEP_BLUE,
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    + Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </BottomSheet>

      {/* More Options Sheet */}
      <BottomSheet open={moreSheetOpen} onClose={() => setMoreSheetOpen(false)} title="Collection options">
        <div style={{ padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            type="button"
            onClick={() => {
              setMoreSheetOpen(false)
              setRenameTitle(collectionDetail?.title || '')
              setRenameModalOpen(true)
            }}
            style={{
              width: '100%',
              height: 52,
              borderRadius: 16,
              border: '1px solid #ECECF0',
              background: '#FFFFFF',
              color: INK,
              fontSize: 16,
              fontWeight: 650,
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              gap: 12,
              cursor: 'pointer',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            <span>Rename collection</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setMoreSheetOpen(false)
              setDeleteModalOpen(true)
            }}
            style={{
              width: '100%',
              height: 52,
              borderRadius: 16,
              border: 0,
              background: '#FDECEA',
              color: DANGER_RED,
              fontSize: 16,
              fontWeight: 650,
              display: 'flex',
              alignItems: 'center',
              padding: '0 16px',
              gap: 12,
              cursor: 'pointer',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>Delete collection</span>
          </button>
        </div>
      </BottomSheet>

      {/* Rename Collection Modal */}
      <BottomSheet open={renameModalOpen} onClose={() => setRenameModalOpen(false)} title="Rename collection">
        <form onSubmit={handleRenameSubmit} style={{ padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            type="text"
            value={renameTitle}
            onChange={(e) => setRenameTitle(e.target.value)}
            placeholder="Collection name"
            autoFocus
            style={{
              width: '100%',
              height: 48,
              borderRadius: 14,
              border: '1px solid #D8D8DE',
              background: '#FFFFFF',
              padding: '0 14px',
              fontSize: 16,
              color: INK,
              boxSizing: 'border-box',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={!renameTitle.trim() || savingAction}
            style={{
              width: '100%',
              height: 50,
              borderRadius: 14,
              border: 0,
              background: renameTitle.trim() && !savingAction ? BLUE : '#C7C7CC',
              color: '#FFFFFF',
              fontSize: 16,
              fontWeight: 700,
              cursor: renameTitle.trim() && !savingAction ? 'pointer' : 'default',
            }}
          >
            {savingAction ? 'Saving…' : 'Save'}
          </button>
        </form>
      </BottomSheet>

      {/* Confirm Delete Collection Modal */}
      <ConfirmDeleteModal
        isOpen={deleteModalOpen}
        title={`Delete "${collectionDetail?.title || 'Collection'}"?`}
        itemName={collectionDetail?.title}
        count={1}
        onConfirm={handleDeleteCollection}
        onCancel={() => setDeleteModalOpen(false)}
      />
    </div>
  )
}
