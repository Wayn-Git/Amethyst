import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SectionLabel, Skeleton, BottomSheet } from '../libraryUi.jsx'
import { INK, MUTED, BLUE, BLUE_SOFT, DEEP_BLUE, CARD_SHADOW, LINE } from './tokens.js'
import { api } from '../../../api.js'

/* Page 18: Empty collections state */
export function EmptyCollectionsState({ onNewCollection }) {
  return (
    <div style={{ padding: '0 16px 40px', boxSizing: 'border-box' }}>
      <div style={{ position: 'relative', width: 180, height: 120, margin: '40px auto 0' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 14,
            width: 104,
            height: 92,
            borderRadius: 20,
            background: '#D6E4FB',
            transform: 'rotate(-6deg)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 14,
            width: 104,
            height: 92,
            borderRadius: 20,
            background: '#E5E5EA',
            transform: 'rotate(6deg)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 38,
            top: 0,
            width: 104,
            height: 104,
            borderRadius: 24,
            background: '#FFFFFF',
            boxShadow: '0 8px 24px rgba(0,0,0,.10)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: DEEP_BLUE,
          }}
        >
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '0 24px' }}>
        <h2 style={{ margin: '20px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.025em', color: INK }}>
          Group your saves
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: 16, lineHeight: '25px', color: MUTED }}>
          Collections keep related saves together, like a trip, a project or a watch list.
        </p>
      </div>

      <div style={{ margin: '24px 0 0' }}>
        <button
          type="button"
          onClick={onNewCollection}
          style={{
            width: '100%',
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
          New collection
        </button>
      </div>
    </div>
  )
}

/* 2x2 Mosaic Thumbnail Cover */
function CollectionCover({ collection, items = [] }) {
  const sampleThumbs = (collection?.sample_thumbnails || [])
    .map((s) => s.thumbnail_url || (s.item_id ? `/api/library/${s.item_id}/thumbnail` : null))
    .filter(Boolean)
  const itemThumbs = (items || []).map((it) => it.thumbnail_url).filter(Boolean)
  const allThumbs = Array.from(new Set([...sampleThumbs, ...itemThumbs]))

  if (allThumbs.length >= 4) {
    return (
      <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 18, overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, background: '#E5E5EA' }}>
        {allThumbs.slice(0, 4).map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        ))}
      </div>
    )
  }

  const singleThumb = allThumbs[0] || collection?.thumbnail_url
  if (singleThumb) {
    return (
      <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 18, overflow: 'hidden', background: '#2B3040' }}>
        <img
          src={singleThumb}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        aspectRatio: '1 / 1',
        borderRadius: 18,
        background: '#E4EDFC',
        color: DEEP_BLUE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      </svg>
    </div>
  )
}

export default function LibraryCollectionsView({
  collections = [],
  items = [],
  loading = false,
  onSelectCollection,
  onOpenCollection,
  onSelectSmartGroup,
  onOpenSmartGroup,
  onNewCollection,
  onCreateCollection,
  onOpenItem,
  onOpenActions,
  showToast,
}) {
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)

  const handleOpenCol = onSelectCollection || onOpenCollection
  const handleSmartGroup = onSelectSmartGroup || onOpenSmartGroup

  const safeCollections = Array.isArray(collections)
    ? collections
    : Array.isArray(collections?.lists)
    ? collections.lists
    : []

  const handleTriggerNewCol = () => {
    setNewTitle('')
    setCreateModalOpen(true)
  }

  const handleCreateSubmit = async (e) => {
    e?.preventDefault()
    const clean = newTitle.trim()
    if (!clean || creating) return
    setCreating(true)
    try {
      if (onCreateCollection) {
        await onCreateCollection(clean)
      } else {
        const res = await api.createLibraryList({ title: clean })
        if (res?.id) {
          showToast?.(`Created "${clean}"`, 'success')
          handleOpenCol?.({ id: res.id, title: clean, item_count: 0 })
        }
      }
      setCreateModalOpen(false)
      setNewTitle('')
    } catch (err) {
      showToast?.(`Could not create collection: ${err.message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  if (loading && safeCollections.length === 0) {
    return (
      <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <Skeleton height={180} radius={22} />
        <Skeleton height={180} radius={22} />
      </div>
    )
  }

  if (!loading && safeCollections.length === 0) {
    return (
      <>
        <EmptyCollectionsState onNewCollection={handleTriggerNewCol} />
        <BottomSheet open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="New collection">
          <form onSubmit={handleCreateSubmit} style={{ padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Collection Name
              </label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Design Inspiration, Trip to Japan…"
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
            </div>
            <button
              type="submit"
              disabled={!newTitle.trim() || creating}
              style={{
                width: '100%',
                height: 50,
                borderRadius: 14,
                border: 0,
                background: newTitle.trim() && !creating ? BLUE : '#C7C7CC',
                color: '#FFFFFF',
                fontSize: 16,
                fontWeight: 700,
                cursor: newTitle.trim() && !creating ? 'pointer' : 'default',
              }}
            >
              {creating ? 'Creating…' : 'Create Collection'}
            </button>
          </form>
        </BottomSheet>
      </>
    )
  }

  return (
    <div style={{ padding: '0 16px 20px', boxSizing: 'border-box' }}>
      {/* Dashed "New collection" button */}
      <button
        type="button"
        onClick={handleTriggerNewCol}
        style={{
          width: '100%',
          height: 56,
          borderRadius: 16,
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
          marginTop: 10,
          marginBottom: 20,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>New collection</span>
      </button>

      {/* Two-Column Collections Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 14,
          marginBottom: 28,
        }}
      >
        {safeCollections.map((col) => (
          <motion.div
            key={col.id}
            whileTap={{ scale: 0.96 }}
            onClick={() => handleOpenCol?.(col)}
            style={{
              padding: 12,
              borderRadius: 22,
              background: '#FFFFFF',
              boxShadow: CARD_SHADOW,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <CollectionCover collection={col} items={col.items || []} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col.title || 'Untitled collection'}
              </div>
              <div style={{ fontSize: 13, color: MUTED }}>
                {col.item_count ?? col.items?.length ?? 0} saves
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Smart Groups (Page 7) */}
      <div style={{ marginBottom: 28 }}>
        <SectionLabel text="Smart groups" style={{ margin: '14px 4px 10px' }} />
        <div style={{ borderRadius: 22, background: '#FFFFFF', boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
          {[
            { id: 'favorites', label: 'Favorites', icon: '★', color: '#F5A524' },
            { id: 'wishlist', label: 'Wishlist and watchlist', icon: '🔖', color: '#0A55C4' },
            { id: 'unopened', label: 'Not opened yet', icon: '⏱', color: '#636366' },
          ].map((sg, i, arr) => (
            <button
              key={sg.id}
              type="button"
              onClick={() => handleSmartGroup?.(sg.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                minHeight: 56,
                padding: '0 16px',
                border: 0,
                borderBottom: i === arr.length - 1 ? 'none' : `1px solid ${LINE}`,
                background: 'transparent',
                color: INK,
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 18, color: sg.color }}>{sg.icon}</span>
              <span style={{ flex: 1 }}>{sg.label}</span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* Create Collection BottomSheet */}
      <BottomSheet open={createModalOpen} onClose={() => setCreateModalOpen(false)} title="New collection">
        <form onSubmit={handleCreateSubmit} style={{ padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: MUTED, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Collection Name
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Design Inspiration, Trip to Japan…"
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
          </div>
          <button
            type="submit"
            disabled={!newTitle.trim() || creating}
            style={{
              width: '100%',
              height: 50,
              borderRadius: 14,
              border: 0,
              background: newTitle.trim() && !creating ? BLUE : '#C7C7CC',
              color: '#FFFFFF',
              fontSize: 16,
              fontWeight: 700,
              cursor: newTitle.trim() && !creating ? 'pointer' : 'default',
            }}
          >
            {creating ? 'Creating…' : 'Create Collection'}
          </button>
        </form>
      </BottomSheet>
    </div>
  )
}
