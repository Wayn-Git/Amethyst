import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { motion, AnimatePresence } from 'framer-motion'
import { api, getBase } from '../api.js'
import { request } from '../dashboard/api.js'
import RemoteAgent from '../views/remote/RemoteAgent.jsx'
import RemotePC from '../views/remote/RemotePC.jsx'
import RemoteTerminal from '../views/remote/RemoteTerminal.jsx'
import RemoteFiles from '../views/remote/RemoteFiles.jsx'
import RemoteMedia from '../views/remote/RemoteMedia.jsx'
import Icon from '../components/Icon.jsx'
import ConfirmDialogHost from '../components/ui/ConfirmDialog.jsx'
import { identity, replica, sync } from '../lib/sync/client.js'
import { getTransportManager } from '../lib/sync/transportManager.js'
import ConnectionDiagnosticsModal from './ConnectionDiagnosticsModal.jsx'
import { captures, saveCapture, flushCaptures } from './captures.js'
import { putRecord, records } from './storage.js'
import { newerUpdate } from './updates.js'
import Updates from './Updates.jsx'
import './companion.css'

const AppUpdates = registerPlugin('AppUpdates')

const tabs = [
  ['today', 'Home', 'sun'],
  ['library', 'Library', 'book'],
  ['agent', 'Agent', 'chat'],
  ['activity', 'Activity', 'chart-line-up'],
  ['devices', 'Desktop', 'desktop'],
]

export default function Companion({ onUnpair }) {
  const active = useRef(true)
  const [tab, setTab] = useState('today')
  const [deviceView, setDeviceView] = useState('overview')
  const [connection, setConnection] = useState(null)
  const [transportState, setTransportState] = useState(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [library, setLibrary] = useState([])
  const [jobs, setJobs] = useState([])
  const [queue, setQueue] = useState([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState({ title: '', text: '', url: '' })
  const [saving, setSaving] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [settings, setSettings] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState(null)
  const [updatingMobile, setUpdatingMobile] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')

  const checkMobileUpdate = useCallback(async () => {
    if (Capacitor.getPlatform() !== 'android') return null
    try {
      const installed = await App.getInfo().catch(() => null)
      if (!installed?.build) return null
      const latest = await request('/mobile/update').catch(() => null)
      if (latest && newerUpdate(latest, installed.build)) {
        setAvailableUpdate(latest)
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            new Notification('Amethyst Update Available', {
              body: `Version ${latest.version} is ready for your Android phone.`,
              icon: '/icon-192.png',
            })
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[MobileUpdate] Check failed:', err.message)
    }
  }, [])

  useEffect(() => {
    checkMobileUpdate()
    const interval = setInterval(checkMobileUpdate, 15 * 60 * 1000)
    return () => clearInterval(interval)
  }, [checkMobileUpdate])

  const handleInstallMobileUpdate = async () => {
    if (!availableUpdate) return
    setUpdatingMobile(true)
    setUpdateStatus('Downloading & verifying update…')
    try {
      const result = await AppUpdates.install({
        url: `${getBase()}/mobile/update/apk`,
        token: identity()?.token,
        sha256: availableUpdate.sha256,
      })
      if (result.permissionRequired) {
        setUpdateStatus('Allow install permission, then tap Install again.')
      } else {
        setUpdateStatus('Opening Android installer…')
        setTimeout(() => {
          setAvailableUpdate(null)
          setUpdatingMobile(false)
        }, 3000)
      }
    } catch (err) {
      setUpdateStatus(`Install failed: ${err.message}`)
      setTimeout(() => setUpdatingMobile(false), 4000)
    }
  }

  // Initialize Dual-Transport Manager
  useEffect(() => {
    const tm = getTransportManager({
      getHostUrl: () => identity()?.hostUrl,
      getRelayUrl: () => identity()?.relayUrl,
      getToken: () => identity()?.token,
      onStateChange: (state) => setTransportState(state),
    })

    tm.startAutoProbe(15000)
    setTransportState(tm.getState())

    return () => {
      tm.stopAutoProbe()
    }
  }, [])

  const refresh = useCallback(async () => {
    const owner = identity()?.deviceId
    if (!owner) return

    // 1. Run durable sync and captures flush unconditionally
    try {
      await Promise.allSettled([flushCaptures(), sync()])
    } catch {}

    // 2. Probe direct LAN capabilities without blocking if away
    let current = null
    try {
      current = await request('/remote/capabilities', 'GET', undefined, 2500)
      if (active.current && identity()?.deviceId === owner) {
        setConnection(current)
        setNotice('Direct Wi-Fi connected')
      }
    } catch (err) {
      if (active.current && identity()?.deviceId === owner) {
        setConnection(null)
        setNotice('Connected via Cloud Relay')
      }
    }

    if (!active.current || identity()?.deviceId !== owner) return

    // 3. Update library and jobs from direct API if connected, or from replica
    try {
      const next = (await records('snapshot'))[0]?.value || {}
      if (current?.permissions?.library) {
        const libRes = await api.library({ limit: 100 }).catch(() => null)
        if (libRes?.items) {
          next.library = libRes.items.map(({ id, uuid, title, summary, notes, url }) => ({ id, uuid, title, summary, notes, url }))
          setLibrary(next.library)
        }
      } else {
        // Fallback to replica library items
        const replicaLib = Object.values(replica.readAll(replica.load(), 'library') || {})
        if (replicaLib.length > 0) {
          setLibrary(replicaLib)
        }
      }

      if (current?.permissions?.agent) {
        const jobsRes = await api.jobs().catch(() => null)
        if (jobsRes?.jobs) {
          next.jobs = jobsRes.jobs.map(({ id, kind, state, error }) => ({ id, kind, state, error }))
          setJobs(next.jobs)
        }
      }

      if (Object.keys(next).length) {
        next.syncedAt = new Date().toISOString()
        await putRecord('snapshot', next)
        setLastSync(next.syncedAt)
      }
      setQueue(await captures())
    } catch {}
  }, [])

  useEffect(() => {
    active.current = true
    let stopped = false
    let busy = false
    const tick = async () => {
      if (stopped || busy || document.visibilityState === 'hidden') return
      busy = true
      try {
        await refresh()
      } finally {
        busy = false
      }
    }

    ;(async () => {
      try {
        const snapshot = (await records('snapshot'))[0]?.value
        if (stopped) return
        setLibrary(snapshot?.library || Object.values(replica.readAll(replica.load(), 'library') || {}))
        setJobs(snapshot?.jobs || [])
        setLastSync(snapshot?.syncedAt || null)
        setQueue(await captures())
      } catch (error) {
        if (!stopped) setNotice(error.message)
      }
      await tick()
    })()

    const timer = setInterval(tick, 30000)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', tick)

    return () => {
      active.current = false
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', tick)
    }
  }, [refresh])

  async function unpair() {
    active.current = false
    try {
      await onUnpair()
    } catch (error) {
      active.current = true
      setNotice(`Could not remove this device: ${error.message}`)
    }
  }

  async function capture(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await saveCapture(draft)
      setDraft({ title: '', text: '', url: '' })
      setQueue(await captures())
      setNotice('Saved on this device. Waiting for desktop import.')
      await flushCaptures()
      setQueue(await captures())
    } catch (error) {
      setNotice(error.message)
    } finally {
      setSaving(false)
    }
  }

  const permissions = connection?.permissions || {}
  const visibleLibrary = library.filter((item) =>
    `${item.title || ''} ${item.summary || ''} ${item.notes || ''}`.toLowerCase().includes(query.toLowerCase()),
  )

  const currentPath = transportState?.path || (connection ? 'direct' : 'relayed')

  return (
    <div className="companion">
      {/* Header Search Bar & Transport Pill (Klarna Screenshot 1) */}
      <header className="companion-header">
        <div className="companion-search-bar">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Search actions, library, notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="companion-icon-btn"
              style={{ width: 24, height: 24, border: 0, boxShadow: 'none' }}
              onClick={() => setQuery('')}
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        <div className="companion-header-actions">
          <button
            type="button"
            className="transport-pill"
            onClick={() => setDiagnosticsOpen(true)}
            aria-label="Connection Diagnostics"
          >
            <span className={`transport-dot transport-dot--${currentPath}`} />
            <span>
              {currentPath === 'direct' ? 'Direct LAN' : currentPath === 'relayed' ? 'Relay' : 'Offline'}
            </span>
          </button>

          <button
            type="button"
            className="companion-icon-btn"
            onClick={() => setSettings((value) => !value)}
            aria-label="Device settings"
            style={{ position: 'relative' }}
          >
            <Icon name="sliders" size={18} />
            {availableUpdate && (
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#007aff',
                  boxShadow: '0 0 6px #007aff',
                }}
              />
            )}
          </button>
        </div>
      </header>

      {/* Floating Proactive Mobile Update Notification */}
      <AnimatePresence>
        {availableUpdate && (
          <motion.aside
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            className="companion-update-banner"
            role="alert"
          >
            <div className="companion-update-badge-icon">
              <Icon name="sparkle" size={16} />
            </div>
            <div className="companion-update-info">
              <div className="companion-update-title">Update Ready · v{availableUpdate.version}</div>
              <div className="companion-update-desc">
                {updateStatus || 'New update available from your desktop'}
              </div>
            </div>
            <button
              type="button"
              className="companion-update-action-btn"
              disabled={updatingMobile}
              onClick={handleInstallMobileUpdate}
            >
              {updatingMobile ? 'Working…' : 'Install'}
            </button>
            <button
              type="button"
              className="companion-update-close-btn"
              onClick={() => setAvailableUpdate(null)}
              aria-label="Dismiss update notification"
            >
              <Icon name="x" size={14} />
            </button>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Settings Drawer */}
      {settings && (
        <div style={{ padding: '0 16px' }}>
          <section className="companion-card-group" style={{ padding: 16 }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Device Pairing</h2>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-dim)' }}>
              Paired as <strong>{identity()?.name}</strong> · Mode: <em>{currentPath}</em>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="pair-btn-secondary"
                style={{ height: 40, fontSize: 13, flex: 1 }}
                onClick={() => setDiagnosticsOpen(true)}
              >
                Diagnostics
              </button>
              <button
                type="button"
                className="pair-btn-secondary"
                style={{ height: 40, fontSize: 13, flex: 1 }}
                onClick={refresh}
              >
                Sync Now
              </button>
            </div>
            <button
              type="button"
              className="pair-btn-secondary"
              onClick={unpair}
              style={{ marginTop: 10, height: 40, fontSize: 13, color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
            >
              Unpair Phone
            </button>
          </section>
          <Updates />
        </div>
      )}

      {/* Main Touch Content Area */}
      <main className="companion-content">
        {/* TODAY / HOME TAB (Inspired by Klarna Screenshot 1) */}
        {tab === 'today' && (
          <>
            {/* Bento Hero Cards Carousel */}
            <div className="companion-bento-carousel">
              {/* Card 1: Connection Status */}
              <div
                className="companion-bento-hero"
                onClick={() => setDiagnosticsOpen(true)}
              >
                <div>
                  <div className="companion-hero-icon-badge">
                    <Icon name="desktop" size={22} />
                  </div>
                  <span className="companion-hero-overline">Desktop Link</span>
                  <h3 className="companion-hero-title">
                    {connection ? 'Direct LAN' : currentPath === 'relayed' ? 'Cloud Relay' : 'Offline'}
                  </h3>
                </div>
                <div className="companion-hero-tag">
                  <Icon name="check-circle" size={14} />
                  <span>
                    {transportState?.latencyMs ? `${transportState.latencyMs}ms latency` : 'Encrypted'}
                  </span>
                </div>
              </div>

              {/* Card 2: Agent Shortcut */}
              <div
                className="companion-bento-hero"
                onClick={() => setTab('agent')}
              >
                <div>
                  <div className="companion-hero-icon-badge" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(74, 222, 128, 0.2))', color: '#16a34a' }}>
                    <Icon name="chat" size={22} />
                  </div>
                  <span className="companion-hero-overline">Autonomous Agent</span>
                  <h3 className="companion-hero-title">Amethyst</h3>
                </div>
                <div className="companion-hero-tag" style={{ color: 'var(--accent)' }}>
                  <span>Ask anything →</span>
                </div>
              </div>
            </div>

            {/* Quick Actions Section (Screenshot 1 "Stores for you" grid style) */}
            <div className="companion-section-header">
              <h2>Quick Actions</h2>
              <button type="button" className="companion-section-link" onClick={() => setTab('devices')}>
                All controls
              </button>
            </div>

            <div className="companion-actions-grid">
              <div
                className="companion-action-tile"
                onClick={() => { setTab('devices'); setDeviceView('pc') }}
              >
                <div className="companion-action-tile-icon">
                  <Icon name="power" size={18} />
                </div>
                <span className="companion-action-tile-label">PC Control</span>
              </div>

              <div
                className="companion-action-tile"
                onClick={() => { setTab('devices'); setDeviceView('terminal') }}
              >
                <div className="companion-action-tile-icon">
                  <Icon name="terminal" size={18} />
                </div>
                <span className="companion-action-tile-label">Terminal</span>
              </div>

              <div
                className="companion-action-tile"
                onClick={() => { setTab('devices'); setDeviceView('files') }}
              >
                <div className="companion-action-tile-icon">
                  <Icon name="file" size={18} />
                </div>
                <span className="companion-action-tile-label">Files</span>
              </div>

              <div
                className="companion-action-tile"
                onClick={() => { setTab('devices'); setDeviceView('media') }}
              >
                <div className="companion-action-tile-icon">
                  <Icon name="music" size={18} />
                </div>
                <span className="companion-action-tile-label">Media</span>
              </div>

              <div
                className="companion-action-tile"
                onClick={() => setTab('library')}
              >
                <div className="companion-action-tile-icon">
                  <Icon name="book" size={18} />
                </div>
                <span className="companion-action-tile-label">Library</span>
              </div>

              <div
                className="companion-action-tile"
                onClick={() => setDiagnosticsOpen(true)}
              >
                <div className="companion-action-tile-icon">
                  <Icon name="lightning" size={18} />
                </div>
                <span className="companion-action-tile-label">Health</span>
              </div>
            </div>

            {/* Recent Library Items */}
            <div className="companion-section-header">
              <h2>Recent Saves</h2>
              <button type="button" className="companion-section-link" onClick={() => setTab('library')}>
                View all ({library.length})
              </button>
            </div>

            <div className="companion-card-group">
              {library.slice(0, 4).map((item, idx) => (
                <div className="companion-list-row" key={item.uuid || item.id || idx}>
                  <div className="companion-row-thumb">
                    <Icon name="book" size={20} />
                  </div>
                  <div className="companion-row-info">
                    <h3>{item.title || 'Untitled save'}</h3>
                    <p>{item.summary || item.notes || item.url || 'No notes saved'}</p>
                    {item.url && (
                      <span className="companion-row-badge">Link</span>
                    )}
                  </div>
                </div>
              ))}
              {!library.length && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
                  No saved items in library yet.
                </div>
              )}
            </div>
          </>
        )}

        {/* LIBRARY TAB (Klarna Screenshot 2) */}
        {tab === 'library' && (
          <>
            {/* Quick Capture Card */}
            <section className="companion-card-group" style={{ padding: 18 }}>
              <h2 style={{ margin: '0 0 10px', fontSize: 17 }}>Save to Library</h2>
              <form onSubmit={capture} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  className="pair-input-field"
                  placeholder="Title"
                  required
                  maxLength={400}
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
                <input
                  className="pair-input-field"
                  type="url"
                  placeholder="URL link (optional)"
                  maxLength={8192}
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                />
                <textarea
                  className="pair-input-field"
                  style={{ minHeight: 70, resize: 'vertical' }}
                  placeholder="Notes or excerpt…"
                  maxLength={100000}
                  value={draft.text}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                />
                <button
                  type="submit"
                  disabled={saving}
                  className="pair-btn-primary"
                  style={{ height: 44, fontSize: 14 }}
                >
                  {saving ? 'Saving…' : 'Save Capture'}
                </button>
              </form>
            </section>

            {/* Grouped Library Items (Screenshot 2 list style) */}
            <div className="companion-section-header">
              <h2>Saved Items ({visibleLibrary.length})</h2>
            </div>

            <div className="companion-card-group">
              {visibleLibrary.map((item, idx) => (
                <div className="companion-list-row" key={item.uuid || item.id || idx}>
                  <div className="companion-row-thumb">
                    <Icon name="book" size={20} />
                  </div>
                  <div className="companion-row-info">
                    <h3>{item.title}</h3>
                    <p>{item.summary || item.notes || 'No summary saved.'}</p>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="companion-row-badge"
                        style={{ color: 'var(--accent)', textDecoration: 'none' }}
                      >
                        Open source →
                      </a>
                    )}
                  </div>
                </div>
              ))}
              {!visibleLibrary.length && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
                  No matching saved items found.
                </div>
              )}
            </div>
          </>
        )}

        {/* AGENT TAB */}
        {tab === 'agent' && (
          <RemoteAgent onOpenDiagnostics={() => setDiagnosticsOpen(true)} transportState={transportState} />
        )}

        {/* ACTIVITY TAB */}
        {tab === 'activity' && (
          <>
            <div className="companion-section-header">
              <h2>Queued Captures</h2>
            </div>
            <div className="companion-card-group">
              {queue.map((item) => (
                <div className="companion-list-row" key={item.id}>
                  <div className="companion-row-thumb">
                    <Icon name="lightning" size={20} />
                  </div>
                  <div className="companion-row-info">
                    <h3>{item.title}</h3>
                    <p>{item.state === 'accepted' ? 'Accepted by desktop; processing' : item.state}</p>
                    {item.error && <span style={{ color: '#ef4444', fontSize: 12 }}>{item.error}</span>}
                  </div>
                </div>
              ))}
              {!queue.length && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
                  No pending captures queued.
                </div>
              )}
            </div>

            <div className="companion-section-header" style={{ marginTop: 12 }}>
              <h2>Desktop Jobs</h2>
            </div>
            <div className="companion-card-group">
              {jobs.map((job) => (
                <div className="companion-list-row" key={job.id}>
                  <div className="companion-row-thumb">
                    <Icon name="desktop" size={20} />
                  </div>
                  <div className="companion-row-info">
                    <h3>{job.kind}</h3>
                    <p>{job.state}</p>
                    {job.error && <span style={{ color: '#ef4444', fontSize: 12 }}>{job.error}</span>}
                  </div>
                </div>
              ))}
              {!jobs.length && (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-dim)', fontSize: 14 }}>
                  No active desktop jobs.
                </div>
              )}
            </div>
          </>
        )}

        {/* DEVICES TAB */}
        {tab === 'devices' && (
          <>
            <section className="companion-card-group" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div className="companion-hero-icon-badge" style={{ margin: 0, width: 40, height: 40 }}>
                  <Icon name="desktop" size={20} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16 }}>Desktop Machine</h2>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
                    {connection ? 'Connected via Direct LAN' : 'Connected via Encrypted Cloud Relay'}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {[
                  ['overview', 'Overview', null],
                  ['pc', 'PC controls', 'input'],
                  ['terminal', 'Terminal', 'terminal'],
                  ['files', 'Files', 'files'],
                  ['media', 'Media', 'audio'],
                ].map(([id, label, permission]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={permission && (!connection || !permissions[permission])}
                    onClick={() => setDeviceView(id)}
                    className="pair-btn-secondary"
                    style={{
                      height: 36,
                      fontSize: 13,
                      padding: '0 14px',
                      background: deviceView === id ? 'var(--text)' : 'var(--surface-raised)',
                      color: deviceView === id ? 'var(--canvas)' : 'var(--text)',
                      width: 'auto',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            {connection && deviceView === 'pc' && <RemotePC />}
            {connection && deviceView === 'terminal' && permissions.terminal && <RemoteTerminal />}
            {connection && deviceView === 'files' && permissions.files && <RemoteFiles />}
            {connection && deviceView === 'media' && permissions.audio && <RemoteMedia />}
          </>
        )}
      </main>

      {/* Floating Bottom Dock Navigation (Klarna Screenshots 1 & 3) */}
      <nav className="companion-nav" aria-label="Companion navigation">
        {tabs.map(([id, label, icon]) => {
          const isCurrent = tab === id
          return (
            <button
              key={id}
              type="button"
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} size={20} />
              {isCurrent && <span>{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Connection Diagnostics Modal */}
      <ConnectionDiagnosticsModal
        open={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        transportState={transportState}
        lastSync={lastSync}
      />

      <ConfirmDialogHost />
    </div>
  )
}
