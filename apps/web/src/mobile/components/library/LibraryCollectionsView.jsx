import { motion } from 'framer-motion'
import { TimelineCard } from './LibraryListView.jsx'
import { LibraryThumbnail } from '../../thumbnailLoader.jsx'
import { INK, MUTED } from './tokens.js'

export function CollectionCard({ collection, items = [], onClick }) {
  // Find up to 4 items belonging to this collection
  const memberItems = items.slice(0, 4)

  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      onClick={() => onClick?.(collection)}
      style={{
        borderRadius: 22,
        background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 6px 18px rgba(0,0,0,.06)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        cursor: 'pointer',
      }}
    >
      {/* 2x2 collage preview */}
      <div
        style={{
          width: '100%',
          paddingTop: '68%',
          position: 'relative',
          borderRadius: 16,
          overflow: 'hidden',
          background: '#E5E5EA',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gridTemplateRows: 'repeat(2, 1fr)',
            gap: 2,
          }}
        >
          {memberItems.map((item, i) => (
            <div key={item.id || i} style={{ position: 'relative', overflow: 'hidden', background: '#3A3A3C' }}>
              <LibraryThumbnail item={item} />
            </div>
          ))}
          {memberItems.length === 0 && (
            <div style={{ gridColumn: 'span 2', gridRow: 'span 2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8E8E93' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: INK }}>
          {collection.title || collection.name || 'Untitled collection'}
        </h3>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: MUTED }}>
          {collection.count ?? memberItems.length} {(collection.count ?? memberItems.length) === 1 ? 'save' : 'saves'}
        </p>
      </div>
    </motion.div>
  )
}

export default function LibraryCollectionsView({
  collections = [],
  items = [],
  onOpenCollection,
  onCreateCollection,
  onOpenSmartGroup,
  onOpenItem,
  onOpenActions,
}) {
  const recentItems = items.slice(0, 5)

  return (
    <div style={{ padding: '16px 16px 110px' }}>
      {/* Action button */}
      <div style={{ marginBottom: 20 }}>
        <button
          type="button"
          onClick={onCreateCollection}
          style={{
            width: '100%',
            height: 50,
            borderRadius: 14,
            border: '1.5px dashed #AEAEB8',
            background: 'rgba(255,255,255,.55)',
            color: '#0A55C4',
            fontSize: 16,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New collection
        </button>
      </div>

      {/* Your collections grid */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
          Your collections
        </div>
        {collections.length === 0 ? (
          <div style={{ background: '#fff', borderRadius: 20, padding: '24px 16px', textAlign: 'center', color: MUTED }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>No custom collections yet</p>
            <p style={{ margin: '4px 0 0', fontSize: 13 }}>Create your first collection to group saves</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {collections.map((col) => (
              <CollectionCard
                key={col.id}
                collection={col}
                items={items.filter((it) => it.list_id === col.id || col.item_ids?.includes(it.id))}
                onClick={onOpenCollection}
              />
            ))}
          </div>
        )}
      </section>

      {/* Smart groups */}
      <section style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
          Smart groups
        </div>
        <div style={{ background: '#fff', borderRadius: 22, padding: '0 16px', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)' }}>
          <div
            onClick={() => onOpenSmartGroup?.('favorites')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 54, borderBottom: '1px solid #ECECF0', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: '#FBEBC8', color: '#6B4300', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#F5A524" stroke="#F5A524" strokeWidth="2" strokeLinejoin="round">
                  <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z" />
                </svg>
              </div>
              <span style={{ fontSize: 16, fontWeight: 600, color: INK }}>Favorites</span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </div>

          <div
            onClick={() => onOpenSmartGroup?.('wishlist')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 54, borderBottom: '1px solid #ECECF0', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: '#E4EDFC', color: '#0A55C4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <span style={{ fontSize: 16, fontWeight: 600, color: INK }}>Wishlist & watchlist</span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </div>

          <div
            onClick={() => onOpenSmartGroup?.('unopened')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 54, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: '#E4F5EA', color: '#14703A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                  <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                </svg>
              </div>
              <span style={{ fontSize: 16, fontWeight: 600, color: INK }}>Not opened yet</span>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </div>
        </div>
      </section>

      {/* Recently added */}
      {recentItems.length > 0 && (
        <section>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 12 }}>
            Recently added
          </div>
          {recentItems.map((item) => (
            <TimelineCard
              key={item.id}
              item={item}
              onSelect={onOpenItem}
              onOpenActions={onOpenActions}
            />
          ))}
        </section>
      )}
    </div>
  )
}
