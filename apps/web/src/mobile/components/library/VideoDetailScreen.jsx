import { useState } from 'react'
import { motion } from 'framer-motion'
import { LibraryThumbnail } from '../../thumbnailLoader.jsx'
import { INK, MUTED, BLUE, DEEP_BLUE, CARD_SHADOW } from './tokens.js'

export default function VideoDetailScreen({
  item,
  resources = [],
  onUpdate,
  onOpenLink,
  onReEnrich,
  showToast,
}) {
  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'links' | 'notes'
  const [userNote, setUserNote] = useState(item.notes || '')
  const [savingNote, setSavingNote] = useState(false)

  const summary = item.summary || item.executive_summary || ''
  const takeaways = Array.isArray(item.takeaways)
    ? item.takeaways
    : typeof item.takeaways === 'string'
    ? item.takeaways.split('\n').filter(Boolean)
    : []

  const linksCount = resources.length + (item.url ? 1 : 0)

  const handleSaveNotes = async () => {
    setSavingNote(true)
    try {
      await onUpdate?.(item.id, { notes: userNote })
      showToast?.('Notes saved')
    } catch {
      showToast?.('Could not save notes')
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Video Player / Thumbnail Banner */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          paddingTop: '56.25%', // 16:9
          borderRadius: 22,
          overflow: 'hidden',
          background: '#151517',
          boxShadow: CARD_SHADOW,
        }}
      >
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LibraryThumbnail item={item} />
        </div>

        {/* Video Duration */}
        {item.duration && (
          <span
            className="glass-dark"
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              padding: '3px 8px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              color: '#fff',
            }}
          >
            {item.duration}
          </span>
        )}
      </div>

      {/* Title & Author Info */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: '30px', fontWeight: 800, letterSpacing: '-0.025em', color: INK }}>
          {item.title || item.url || 'Untitled video'}
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                background: '#E4EDFC',
                color: DEEP_BLUE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              {(item.author || 'V')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 650, color: INK }}>{item.author || 'Video creator'}</div>
              <div style={{ fontSize: 13, color: MUTED }}>
                {item.platform || 'YouTube'} {item.published_at && `· ${item.published_at}`}
              </div>
            </div>
          </div>

          {item.url && (
            <button
              type="button"
              style={{
                height: 38,
                padding: '0 16px',
                borderRadius: 19,
                border: 0,
                background: '#E4EDFC',
                color: DEEP_BLUE,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => onOpenLink?.(item.url)}
            >
              Open
            </button>
          )}
        </div>
      </div>

      {/* Tabs Row: Overview, Links, Notes */}
      <div
        style={{
          display: 'flex',
          background: 'rgba(118,118,128,.12)',
          padding: 3,
          borderRadius: 16,
          marginTop: 6,
        }}
      >
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'links', label: `Links (${linksCount})` },
          { id: 'notes', label: 'Notes' },
        ].map((tab) => {
          const selected = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              style={{
                flex: 1,
                height: 40,
                borderRadius: 13,
                border: 0,
                background: selected ? '#fff' : 'transparent',
                boxShadow: selected ? '0 2px 8px rgba(0,0,0,.12)' : 'none',
                color: selected ? INK : MUTED,
                fontSize: 14,
                fontWeight: selected ? 700 : 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Executive Overview */}
          {summary && (
            <div style={{ background: '#fff', borderRadius: 22, padding: 16, boxShadow: CARD_SHADOW }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
                Executive Overview
              </div>
              <p style={{ margin: 0, fontSize: 15, lineHeight: '23px', color: '#2C2C2E' }}>
                {summary}
              </p>
            </div>
          )}

          {/* Key Takeaways */}
          {takeaways.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 22, padding: 16, boxShadow: CARD_SHADOW }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED }}>
                  Key Takeaways
                </span>
                {onReEnrich && (
                  <button
                    type="button"
                    style={{ border: 0, background: 'transparent', color: DEEP_BLUE, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    onClick={onReEnrich}
                  >
                    Re-enrich
                  </button>
                )}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {takeaways.map((point, i) => (
                  <li key={i} style={{ fontSize: 15, lineHeight: '22px', color: '#2C2C2E' }}>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Details Table */}
          <div style={{ background: '#fff', borderRadius: 22, padding: '0 16px', boxShadow: CARD_SHADOW }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: 48, alignItems: 'center', borderBottom: '1px solid #ECECF0' }}>
              <span style={{ fontSize: 14, color: MUTED }}>Source</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{item.platform || 'Web Video'}</span>
            </div>
            {item.author && (
              <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: 48, alignItems: 'center', borderBottom: '1px solid #ECECF0' }}>
                <span style={{ fontSize: 14, color: MUTED }}>Creator</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{item.author}</span>
              </div>
            )}
            {item.duration && (
              <div style={{ display: 'flex', justifyContent: 'space-between', minHeight: 48, alignItems: 'center' }}>
                <span style={{ fontSize: 14, color: MUTED }}>Length</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: INK }}>{item.duration}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Links */}
      {activeTab === 'links' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {item.url && (
            <div
              style={{
                background: '#fff',
                borderRadius: 20,
                padding: 14,
                boxShadow: CARD_SHADOW,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
              onClick={() => onOpenLink?.(item.url)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: '#E4EDFC', color: DEEP_BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 650, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Original Video Source
                  </div>
                  <div style={{ fontSize: 13, color: MUTED }}>{item.url}</div>
                </div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          )}

          {resources.map((res, i) => (
            <div
              key={res.id || i}
              style={{
                background: '#fff',
                borderRadius: 20,
                padding: 14,
                boxShadow: CARD_SHADOW,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
              onClick={() => onOpenLink?.(res.url)}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 650, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {res.title || res.name || res.url}
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>{res.url || res.description}</div>
              </div>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          ))}

          {resources.length === 0 && !item.url && (
            <div style={{ background: '#fff', borderRadius: 20, padding: '32px 16px', textAlign: 'center', color: MUTED }}>
              No links referenced in this video
            </div>
          )}
        </div>
      )}

      {/* Tab: Notes */}
      {activeTab === 'notes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: '#fff', borderRadius: 22, padding: 16, boxShadow: CARD_SHADOW }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
              Personal Notes
            </div>
            <textarea
              rows={6}
              placeholder="Add key takeaways, timestamps, or ideas from this video…"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              style={{
                width: '100%',
                border: '1px solid #D8D8DE',
                borderRadius: 14,
                padding: '12px 14px',
                fontSize: 15,
                color: INK,
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'none',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                type="button"
                disabled={savingNote}
                onClick={handleSaveNotes}
                style={{
                  height: 38,
                  padding: '0 18px',
                  borderRadius: 19,
                  border: 0,
                  background: '#0B5FD9',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: savingNote ? 'default' : 'pointer',
                  opacity: savingNote ? 0.6 : 1,
                }}
              >
                {savingNote ? 'Saving…' : 'Save notes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
