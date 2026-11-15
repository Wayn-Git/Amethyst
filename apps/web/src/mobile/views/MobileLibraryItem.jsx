import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { GlassIconButton } from '../components/libraryUi.jsx'
import { getLibraryDetailScreen } from './libraryPresentation.js'
import LibraryTypeDetails from './LibraryTypeDetails.jsx'
import ItemActionSheet from '../components/library/ItemActionSheet.jsx'
import ConfirmDeleteModal from '../components/library/ConfirmDeleteModal.jsx'
import SavingToast from '../components/library/SavingToast.jsx'
import { AddToCollectionSheet } from '../components/libraryUi.jsx'
import { INK, MUTED } from '../components/library/tokens.js'

import './libraryItem.css'

export default function MobileLibraryItem({ item: initialItem, onBack, onAskAgent, onDeleteItem }) {
  const [item, setItem] = useState(initialItem)
  const [resources, setResources] = useState(initialItem?.resources || [])
  const [actionMenuOpen, setActionMenuOpen] = useState(false)
  const [collectionSheetOpen, setCollectionSheetOpen] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [toast, setToast] = useState({ visible: false, status: 'success', message: '' })

  const showToast = (message, status = 'success') => {
    setToast({ visible: true, status, message })
    setTimeout(() => setToast((prev) => ({ ...prev, visible: false })), 3000)
  }

  // Load latest enriched item details & links if id exists
  useEffect(() => {
    if (!initialItem?.id || initialItem.is_optimistic) return
    let cancelled = false

    api.libraryItem(initialItem.id)
      .then((fullItem) => {
        if (cancelled || !fullItem) return
        setItem(fullItem)
        if (Array.isArray(fullItem.resources)) {
          setResources(fullItem.resources)
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [initialItem?.id, initialItem?.is_optimistic])

  // Screen kind router
  const screen = useMemo(() => {
    return getLibraryDetailScreen(item, resources)
  }, [item, resources])

  const isFavorite = item.is_favorite || item.favorite

  const handleUpdate = async (id, patch) => {
    setItem((prev) => ({ ...prev, ...patch }))
    try {
      await api.updateLibraryItem(id, patch)
    } catch (err) {
      showToast('Could not save changes', 'error')
      throw err
    }
  }

  const handleToggleFavorite = async () => {
    const nextFav = !isFavorite
    handleUpdate(item.id, { is_favorite: nextFav, favorite: nextFav })
    showToast(nextFav ? 'Added to favorites' : 'Removed from favorites')
  }

  const handleDelete = async () => {
    setDeleteModalOpen(false)
    try {
      await api.deleteLibraryItem(item.id)
      onDeleteItem?.(item.id)
      onBack?.()
    } catch {
      showToast('Could not delete item', 'error')
    }
  }

  const handleOpenLink = (url) => {
    if (!url) return
    window.open(url, '_blank')
  }

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({ title: item.title, url: item.url }).catch(() => {})
    } else {
      showToast('Link copied to clipboard')
    }
  }

  const handleReEnrich = async () => {
    showToast('Enriching in background…')
    try {
      await api.enrichLibraryItem?.(item.id)
    } catch {}
  }

  return (
    <div style={{ flex: 1, height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#F2F2F7', color: INK, position: 'relative', paddingBottom: 100 }}>
      {/* Pinned Top Bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          background: 'rgba(242,242,247,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px',
          zIndex: 50,
          borderBottom: '1px solid #ECECF0',
        }}
      >
        <GlassIconButton label="Back" width={44} onClick={onBack}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </GlassIconButton>

        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: MUTED,
          }}
        >
          {screen}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GlassIconButton label="Share" width={44} onClick={handleShare}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
            </svg>
          </GlassIconButton>

          <GlassIconButton label="More actions" width={44} onClick={() => setActionMenuOpen(true)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </GlassIconButton>
        </div>
      </div>

      {/* Main Content Area */}
      <main style={{ padding: '16px 16px 110px' }}>
        <LibraryTypeDetails
          item={item}
          screen={screen}
          resources={resources}
          sourceText={item.text_content || item.notes || ''}
          onUpdate={handleUpdate}
          onOpenLink={handleOpenLink}
          onReEnrich={handleReEnrich}
          showToast={showToast}
        />
      </main>

      {/* Pinned Bottom Bar (Spec §1.9) */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 'calc(env(safe-area-inset-bottom, 0px) + 68px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(28px) saturate(200%)',
          WebkitBackdropFilter: 'blur(28px) saturate(200%)',
          borderTop: '1px solid #ECECF0',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingLeft: 16,
          paddingRight: 16,
          zIndex: 40,
        }}
      >
        <button
          type="button"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={handleToggleFavorite}
          style={{
            width: 50,
            height: 50,
            borderRadius: 25,
            border: '1px solid #D8D8DE',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill={isFavorite ? '#F5A524' : 'none'} stroke={isFavorite ? '#F5A524' : '#151517'} strokeWidth="2" strokeLinejoin="round">
            <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => {
            if (onAskAgent) {
              onAskAgent(item)
            } else if (item.url) {
              handleOpenLink(item.url)
            } else {
              showToast('Ready for agent analysis')
            }
          }}
          style={{
            flex: 1,
            height: 50,
            borderRadius: 14,
            border: 0,
            background: '#0B5FD9',
            color: '#fff',
            fontSize: 16,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(11,95,217,0.3)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          Discuss with Agent
        </button>
      </div>

      {/* Sheets & Dialogs */}
      <ItemActionSheet
        isOpen={actionMenuOpen}
        item={item}
        onClose={() => setActionMenuOpen(false)}
        onShare={handleShare}
        onAddToCollection={() => setCollectionSheetOpen(true)}
        onToggleFavorite={handleToggleFavorite}
        onReEnrich={handleReEnrich}
        onOpenOriginal={() => handleOpenLink(item.url)}
        onDelete={() => setDeleteModalOpen(true)}
      />

      <ConfirmDeleteModal
        isOpen={deleteModalOpen}
        title="Delete this save?"
        itemName={item.title}
        onConfirm={handleDelete}
        onCancel={() => setDeleteModalOpen(false)}
      />

      <AddToCollectionSheet
        open={collectionSheetOpen}
        item={item}
        onClose={() => setCollectionSheetOpen(false)}
        showToast={showToast}
      />

      <SavingToast
        visible={toast.visible}
        status={toast.status}
        message={toast.message}
      />
    </div>
  )
}
