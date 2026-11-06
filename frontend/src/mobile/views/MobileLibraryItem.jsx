import { useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

export default function MobileLibraryItem({ item, onBack, onAskAgent }) {
  const [tab, setTab] = useState('summary')
  const [isPlaying, setIsPlaying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [enriching, setEnriching] = useState(false)

  const title = item?.title || 'Untitled Item'
  let source = 'Local note'
  if (item?.url) {
    try {
      source = new URL(item.url).hostname
    } catch {
      source = item.url
    }
  }

  const summary =
    item?.summary ||
    item?.text ||
    item?.content ||
    'No summary generated for this item.'

  const transcript = item?.transcript || 'No transcript generated for this item.'

  const links = Array.isArray(item?.metadata?.links)
    ? item.metadata.links
    : item?.url
      ? [item.url]
      : []

  const isMedia =
    item?.kind === 'reel' ||
    item?.kind === 'video' ||
    item?.kind === 'audio' ||
    Boolean(item?.media_url)

  const handleDelete = async () => {
    if (!item?.id && !item?.uuid) return
    if (!window.confirm('Delete this item from your library?')) return
    setDeleting(true)
    try {
      await api.deleteLibraryItem(item.id || item.uuid)
      onBack()
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
      setDeleting(false)
    }
  }

  const handleEnrich = async () => {
    if (!item?.id && !item?.uuid) return
    setEnriching(true)
    try {
      await api.enrichLibraryItem(item.id || item.uuid)
      alert('Enrichment queued with backend AI.')
    } catch (err) {
      alert(`Enrichment failed: ${err.message}`)
    } finally {
      setEnriching(false)
    }
  }

  return (
    <motion.div
      className="m-shell"
      style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#ECEAE6' }}
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.2 }}
    >
      <div className="m-body" style={{ paddingBottom: 24, gap: 14, overflowY: 'auto' }}>
        {/* Header */}
        <div className="m-r m-sp">
          <button
            type="button"
            className="m-ib"
            aria-label="Back to Library"
            onClick={onBack}
          >
            <Icon name="chevron-left" size={20} />
          </button>
          <div className="m-ttl" style={{ fontSize: 17 }}>
            Item Details
          </div>
          <div className="m-r" style={{ gap: 8 }}>
            <button
              type="button"
              className="m-ib"
              aria-label="Delete item"
              disabled={deleting}
              onClick={handleDelete}
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        </div>

        {/* Media Player Card (only shown for actual media items) */}
        {isMedia && (
          <div
            className="m-blk"
            style={{
              height: 180,
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <button
              type="button"
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                background: '#D6F23E',
                color: '#111113',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 0,
                cursor: 'pointer',
              }}
              onClick={() => setIsPlaying((p) => !p)}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              <Icon name={isPlaying ? 'pause' : 'play'} size={26} />
            </button>

            <div style={{ position: 'absolute', left: 18, right: 18, bottom: 14 }} className="m-col">
              <div className="m-pb">
                <div
                  style={{
                    width: isPlaying ? '60%' : '0%',
                    height: '100%',
                    background: '#D6F23E',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div className="m-r m-sp">
                <span className="m-m">{isPlaying ? 'Playing' : '0:00'}</span>
                <span className="m-m">{item?.kind?.toUpperCase() || 'MEDIA'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Title and metadata */}
        <div>
          <h1 className="m-h" style={{ fontSize: 24 }}>
            {title}
          </h1>
          <div className="m-r" style={{ gap: 6, marginTop: 6 }}>
            <Icon name="link" size={14} style={{ color: '#6E6A64' }} />
            <span className="m-m">
              {source}
              {item?.created_at ? `, ${new Date(item.created_at).toLocaleDateString()}` : ''}
            </span>
          </div>
        </div>

        {/* Segmented Tabs */}
        <div
          className="tabs"
          style={{ display: 'flex', gap: 22, borderBottom: '1px solid #D9D5CE' }}
        >
          {[
            ['summary', 'Summary'],
            ['transcript', 'Transcript'],
            ['links', 'Links'],
            ['notes', 'Notes'],
          ].map(([id, label]) => (
            <span
              key={id}
              className={tab === id ? 'on' : ''}
              style={{
                padding: '8px 0',
                color: tab === id ? '#141414' : '#6E6A64',
                fontWeight: tab === id ? 600 : 400,
                borderBottom: tab === id ? '2px solid #141414' : 'none',
                marginBottom: -1,
                cursor: 'pointer',
              }}
              onClick={() => setTab(id)}
            >
              {label}
            </span>
          ))}
        </div>

        {/* Tab Body */}
        <div className="m-col" style={{ gap: 10, lineHeight: 1.5 }}>
          {tab === 'summary' && (
            <div className="m-c" style={{ padding: 16 }}>
              {summary.split('\n\n').map((para, i) => (
                <p key={i} style={{ margin: '0 0 10px 0', lineHeight: 1.5 }}>
                  {para}
                </p>
              ))}
            </div>
          )}

          {tab === 'transcript' && (
            <div
              className="m-c"
              style={{ padding: 16, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
            >
              {transcript}
            </div>
          )}

          {tab === 'links' && (
            <div className="m-c" style={{ padding: 16 }}>
              {links.length > 0 ? (
                links.map((url, i) => (
                  <div key={i} style={{ margin: '6px 0' }}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#141414', wordBreak: 'break-all', textDecoration: 'underline' }}
                    >
                      {url}
                    </a>
                  </div>
                ))
              ) : (
                <div style={{ color: '#6E6A64' }}>No extracted links for this item.</div>
              )}
            </div>
          )}

          {tab === 'notes' && (
            <div className="m-c" style={{ padding: 16 }}>
              <div style={{ color: '#6E6A64' }}>
                {item?.notes || 'No user notes added to this item.'}
              </div>
            </div>
          )}
        </div>

        {/* Real Tag Pills (only if item has tags) */}
        {Array.isArray(item?.tags) && item.tags.length > 0 && (
          <div className="m-r" style={{ gap: 8, flexWrap: 'wrap' }}>
            {item.tags.map((t, i) => (
              <span key={i} className="m-ch">
                <Icon name="tag" size={14} />
                {t}
              </span>
            ))}
          </div>
        )}

        {/* Model Attribution & Redo */}
        <div className="m-r" style={{ gap: 8, marginTop: 4 }}>
          <Icon name="sparkle" size={16} />
          <span className="m-m" style={{ flex: 1 }}>
            {item?.model || 'Summarised with Local model'}
          </span>
          <button
            type="button"
            className="m-bt g"
            style={{ minHeight: 36, padding: '0 14px', fontSize: 13 }}
            disabled={enriching}
            onClick={handleEnrich}
          >
            {enriching ? 'Summarising…' : 'Re-summarise'}
          </button>
        </div>

        {/* Ask Agent button */}
        <button
          type="button"
          className="m-bt l"
          style={{ width: '100%', minHeight: 48, marginTop: 8 }}
          onClick={() => {
            if (onAskAgent) {
              onAskAgent({
                title: `Discuss: ${title}`,
                initialMessage: `I want to discuss "${title}":\n${summary}`,
              })
            }
          }}
        >
          <Icon name="sparkle" size={16} />
          Ask Agent about this save
        </button>
      </div>
    </motion.div>
  )
}
