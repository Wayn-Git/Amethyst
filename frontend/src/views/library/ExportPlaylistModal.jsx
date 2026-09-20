import { useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../../api.js'
import { useModalDismiss, onOverlayMouseDown } from '../../hooks/useModalDismiss.js'

/**
 * ExportPlaylistModal — select library items and push them to a Spotify playlist.
 *
 * Shows the items to export, a name field, progress during export, and results
 * (found/not-found breakdown + Spotify link) when done.
 */
export default function ExportPlaylistModal({ open, items = [], onClose, toast }) {
  const panelRef = useRef(null)
  useModalDismiss(open, onClose)

  const [name, setName] = useState('')
  const [selected, setSelected] = useState(() => new Set(items.map((i) => i.id)))
  const [phase, setPhase] = useState('pick') // 'pick' | 'exporting' | 'done'
  const [result, setResult] = useState(null)

  // Sync selected when items change
  if (phase === 'pick' && items.length > 0 && selected.size === 0) {
    setSelected(new Set(items.map((i) => i.id)))
  }

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set())
    else setSelected(new Set(items.map((i) => i.id)))
  }

  const handleExport = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    setPhase('exporting')
    try {
      const res = await api.exportPlaylist(ids, name)
      setResult(res)
      setPhase('done')
      if (res.ok) {
        toast?.(`Created "${res.playlist_name}" with ${res.found} track(s)`, 'ok')
      }
    } catch (err) {
      const msg = err?.message || String(err)
      setResult({ ok: false, message: msg })
      setPhase('done')
      toast?.(msg, 'bad')
    }
  }

  const handleClose = () => {
    setPhase('pick')
    setResult(null)
    setName('')
    onClose?.()
  }

  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onMouseDown={onOverlayMouseDown(handleClose)}
      >
        <motion.div
          ref={panelRef}
          className="export-playlist-modal"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ type: 'spring', damping: 28, stiffness: 380 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="export-playlist-header">
            <div className="export-playlist-title-row">
              <Icon name="music" size={18} />
              <h3 className="export-playlist-title">Export to Spotify</h3>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={handleClose}
              aria-label="Close"
            >
              <Icon name="x" size={14} />
            </button>
          </div>

          {/* Pick phase */}
          {phase === 'pick' && (
            <div className="export-playlist-body">
              {/* Playlist name */}
              <div className="export-playlist-field">
                <label className="export-playlist-label">Playlist name</label>
                <input
                  className="export-playlist-input"
                  placeholder={`Amethyst — ${new Date().toISOString().slice(0, 10)}`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Item list */}
              <div className="export-playlist-list-header">
                <button
                  type="button"
                  className="export-playlist-select-all"
                  onClick={toggleAll}
                >
                  {selected.size === items.length ? 'Deselect all' : 'Select all'}
                </button>
                <span className="export-playlist-count">
                  {selected.size} of {items.length} selected
                </span>
              </div>

              <div className="export-playlist-list">
                {items.map((item) => {
                  const musicRes = (item.resources || []).find(
                    (r) => r && (r.type === 'music' || r.type === 'song') && r.name
                  )
                  const displayTitle = musicRes ? musicRes.name : item.title || 'Untitled'
                  const displayAuthor = musicRes ? musicRes.detail : item.author
                  const isReelWithMusic = Boolean(musicRes && item.kind === 'video')

                  return (
                    <label key={item.id} className="export-playlist-item">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                      <span className="export-playlist-item-info">
                        <span className="export-playlist-item-title">
                          {isReelWithMusic ? (
                            <>
                              <Icon name="music" size={13} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                              {displayTitle}
                            </>
                          ) : displayTitle}
                        </span>
                        {displayAuthor && (
                          <span className="export-playlist-item-author">
                            {displayAuthor} {isReelWithMusic ? '(from Reel)' : ''}
                          </span>
                        )}
                      </span>
                      {item.app && (
                        <span className="export-playlist-item-app">{item.app}</span>
                      )}
                    </label>
                  )
                })}
                {items.length === 0 && (
                  <div className="export-playlist-empty">
                    No music items to export. Save some songs to your library first!
                  </div>
                )}
              </div>

              {/* Export button */}
              <button
                type="button"
                className="btn export-playlist-btn"
                disabled={selected.size === 0}
                onClick={handleExport}
              >
                <Icon name="music" size={14} />
                <span>Create Spotify Playlist ({selected.size} track{selected.size !== 1 ? 's' : ''})</span>
              </button>
            </div>
          )}

          {/* Exporting phase */}
          {phase === 'exporting' && (
            <div className="export-playlist-body export-playlist-center">
              <div className="export-playlist-spinner" />
              <p className="export-playlist-status">
                Searching Spotify for {selected.size} track{selected.size !== 1 ? 's' : ''}…
              </p>
              <p className="export-playlist-sub">This may take a moment</p>
            </div>
          )}

          {/* Done phase */}
          {phase === 'done' && result && (
            <div className="export-playlist-body">
              <div className={`export-playlist-result ${result.ok ? 'export-playlist-result--ok' : 'export-playlist-result--warn'}`}>
                <Icon name={result.ok ? 'check' : 'alert'} size={20} />
                <p>{result.message}</p>
              </div>

              {result.ok && result.playlist_url && (
                <a
                  href={result.playlist_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn export-playlist-open-btn"
                >
                  <Icon name="play" size={14} />
                  <span>Open in Spotify</span>
                </a>
              )}

              {/* Found tracks */}
              {result.tracks && result.tracks.length > 0 && (
                <div className="export-playlist-section">
                  <div className="export-playlist-section-title">
                    Found ({result.found})
                  </div>
                  <div className="export-playlist-track-list">
                    {result.tracks.map((t, i) => (
                      <div key={i} className="export-playlist-track">
                        <Icon name="check" size={12} />
                        <span>{t.name}</span>
                        {t.artist && <span>— {t.artist}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Not found */}
              {result.missed && result.missed.length > 0 && (
                <div className="export-playlist-section">
                  <div className="export-playlist-section-title">
                    Not Found ({result.not_found})
                  </div>
                  <div className="export-playlist-track-list">
                    {result.missed.map((m, i) => (
                      <div key={i} className="export-playlist-track export-playlist-track--missed">
                        <Icon name="x" size={12} />
                        <span>{m.title || `Item #${m.item_id}`}</span>
                        <span className="export-playlist-reason">{m.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="btn btn--ghost export-playlist-done-btn"
                onClick={handleClose}
              >
                Done
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
