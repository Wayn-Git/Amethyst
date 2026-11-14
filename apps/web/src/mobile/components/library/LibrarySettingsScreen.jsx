import { useState, useEffect } from 'react'
import { api } from '../../../api.js'
import { GlassIconButton } from '../libraryUi.jsx'
import { INK, MUTED } from './tokens.js'

export default function LibrarySettingsScreen({ onBack, showToast }) {
  const [syncStatus, setSyncStatus] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [autoEnrich, setAutoEnrich] = useState(true)
  const [videoTranscription, setVideoTranscription] = useState(true)

  useEffect(() => {
    api.librarySyncStatus?.()
      .then((res) => setSyncStatus(res))
      .catch(() => {})
  }, [])

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      await api.librarySyncStart?.()
      showToast?.('Sync started in background')
      const updated = await api.librarySyncStatus?.()
      setSyncStatus(updated)
    } catch (err) {
      showToast?.(err?.message || 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const handlePurgeMedia = async () => {
    try {
      const res = await api.purgeMedia?.()
      showToast?.(res?.message || 'Legacy media purged')
    } catch {
      showToast?.('Could not purge media')
    }
  }

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
          Library Settings
        </h2>

        <div style={{ width: 44 }} />
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Sync & Cloud Section */}
        <section>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
            Cloud Storage & Sync
          </div>
          <div style={{ background: '#fff', borderRadius: 22, padding: '0 16px', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, borderBottom: '1px solid #ECECF0' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Google Drive Sync</div>
                <div style={{ fontSize: 13, color: MUTED }}>
                  {syncStatus?.provider === 'google_drive' ? 'Connected' : 'Local SQLite Storage'}
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0A55C4' }}>Active</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Run Catalog Sync</div>
                <div style={{ fontSize: 13, color: MUTED }}>
                  {syncStatus?.last_sync ? `Last synced ${syncStatus.last_sync}` : 'Sync local files and database'}
                </div>
              </div>
              <button
                type="button"
                disabled={syncing}
                onClick={handleSyncNow}
                style={{
                  height: 36,
                  padding: '0 16px',
                  borderRadius: 18,
                  border: 0,
                  background: '#E4EDFC',
                  color: '#0A55C4',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: syncing ? 'default' : 'pointer',
                  opacity: syncing ? 0.6 : 1,
                }}
              >
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
          </div>
        </section>

        {/* AI Processing Section */}
        <section>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
            AI & Enrichment
          </div>
          <div style={{ background: '#fff', borderRadius: 22, padding: '0 16px', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, borderBottom: '1px solid #ECECF0' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Auto-generate summaries</div>
                <div style={{ fontSize: 13, color: MUTED }}>Synthesize key takeaways & tags on save</div>
              </div>
              <button
                type="button"
                onClick={() => setAutoEnrich(!autoEnrich)}
                style={{
                  width: 52,
                  height: 32,
                  borderRadius: 16,
                  border: 0,
                  background: autoEnrich ? '#34C759' : '#D1D1D6',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    background: '#fff',
                    position: 'absolute',
                    top: 3,
                    left: autoEnrich ? 23 : 3,
                    boxShadow: '0 2px 5px rgba(0,0,0,.25)',
                    transition: 'left 0.2s',
                  }}
                />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Ephemeral Audio Transcription</div>
                <div style={{ fontSize: 13, color: MUTED }}>Zero video download; transcribe audio stream</div>
              </div>
              <button
                type="button"
                onClick={() => setVideoTranscription(!videoTranscription)}
                style={{
                  width: 52,
                  height: 32,
                  borderRadius: 16,
                  border: 0,
                  background: videoTranscription ? '#34C759' : '#D1D1D6',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    background: '#fff',
                    position: 'absolute',
                    top: 3,
                    left: videoTranscription ? 23 : 3,
                    boxShadow: '0 2px 5px rgba(0,0,0,.25)',
                    transition: 'left 0.2s',
                  }}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Media & Storage Section */}
        <section>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>
            Storage Maintenance
          </div>
          <div style={{ background: '#fff', borderRadius: 22, padding: '0 16px', boxShadow: '0 1px 2px rgba(0,0,0,.05), 0 4px 14px rgba(0,0,0,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>Purge legacy video files</div>
                <div style={{ fontSize: 13, color: MUTED }}>Free device storage from cached offline videos</div>
              </div>
              <button
                type="button"
                onClick={handlePurgeMedia}
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 18,
                  border: 0,
                  background: '#FDECEA',
                  color: '#B3261E',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Purge
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
