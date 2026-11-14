import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { TimelineCard } from './LibraryListView.jsx'
import { GlassIconButton } from '../libraryUi.jsx'
import { INK, MUTED } from './tokens.js'

export default function CollectionDetailView({
  collection,
  items = [],
  onBack,
  onOpenItem,
  onOpenActions,
  onRemoveItemFromCollection,
  onAddSaves,
}) {
  const [filter, setFilter] = useState('recent') // 'recent' | 'type' | 'alpha' | 'wishlist'

  const collectionItems = useMemo(() => {
    let list = items.filter((it) => it.list_id === collection.id || collection.item_ids?.includes(it.id))
    if (filter === 'wishlist') {
      list = list.filter((it) => it.progress === 'unstarted')
    } else if (filter === 'alpha') {
      list = [...list].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    }
    return list
  }, [items, collection, filter])

  return (
    <div style={{ minHeight: '100vh', background: '#F2F2F7', paddingBottom: 110 }}>
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
          padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px',
          zIndex: 50,
          borderBottom: '1px solid #ECECF0',
        }}
      >
        <GlassIconButton label="Back" width={44} onClick={onBack}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </GlassIconButton>

        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: INK }}>
          {collection.title || collection.name}
        </h2>

        <div style={{ width: 44 }} />
      </div>

      {/* Header Info */}
      <div style={{ padding: '20px 16px 12px' }}>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', color: INK }}>
          {collection.title || collection.name}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: MUTED }}>
          {collectionItems.length} {collectionItems.length === 1 ? 'save' : 'saves'} · Updated today
        </p>

        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
          {[
            { id: 'recent', label: 'Recent' },
            { id: 'alpha', label: 'A to Z' },
            { id: 'wishlist', label: 'Wishlist only' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              style={{
                height: 36,
                padding: '0 14px',
                borderRadius: 18,
                border: filter === f.id ? 0 : '1px solid #D8D8DE',
                background: filter === f.id ? '#151517' : '#fff',
                color: filter === f.id ? '#fff' : '#151517',
                fontSize: 13,
                fontWeight: filter === f.id ? 650 : 500,
                cursor: 'pointer',
              }}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Items list */}
      <div style={{ padding: '8px 16px' }}>
        {collectionItems.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 20, padding: '32px 16px', textAlign: 'center', color: MUTED }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>No items in this collection</p>
            <p style={{ margin: '4px 0 0', fontSize: 13 }}>Add items from your Library list or details</p>
          </div>
        ) : (
          collectionItems.map((item) => (
            <TimelineCard
              key={item.id}
              item={item}
              onSelect={onOpenItem}
              onOpenActions={onOpenActions}
            />
          ))
        )}
      </div>

      {/* Bottom action button */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {onAddSaves && (
          <button
            type="button"
            onClick={onAddSaves}
            style={{
              width: '100%',
              height: 52,
              borderRadius: 14,
              border: 0,
              background: '#0B5FD9',
              color: '#fff',
              fontSize: 17,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Add saves to {collection.title || 'Collection'}
          </button>
        )}
      </div>
    </div>
  )
}
