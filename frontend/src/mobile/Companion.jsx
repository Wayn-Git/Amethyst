import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { motion, AnimatePresence } from 'framer-motion'
import { api, getBase } from '../api.js'
import { request } from '../dashboard/api.js'
import Icon from '../components/Icon.jsx'
import ConfirmDialogHost from '../components/ui/ConfirmDialog.jsx'
import { identity, replica, sync } from '../lib/sync/client.js'
import { getTransportManager } from '../lib/sync/transportManager.js'
import ConnectionDiagnosticsModal from './ConnectionDiagnosticsModal.jsx'
import { captures, saveCapture, flushCaptures } from './captures.js'
import { putRecord, records } from './storage.js'
import { newerUpdate } from './updates.js'
import MobileToday from './views/MobileToday.jsx'
import AddWidgetsModal from './views/AddWidgetsModal.jsx'
import MobileTasks from './views/MobileTasks.jsx'
import MobileSettings from './views/MobileSettings.jsx'
import MobileAgentSessions from './views/MobileAgentSessions.jsx'
import MobileAgentChat from './views/MobileAgentChat.jsx'
import MobileLibrary from './views/MobileLibrary.jsx'
import MobileAskLibrary from './views/MobileAskLibrary.jsx'
import MobileLibraryItem from './views/MobileLibraryItem.jsx'
import MobilePC from './views/MobilePC.jsx'
import MobileTerminal from './views/MobileTerminal.jsx'
import MobileQuickCapture from './modals/MobileQuickCapture.jsx'
import './companion.css'

const AppUpdates = registerPlugin('AppUpdates')

export default function Companion({ onUnpair }) {
  const active = useRef(true)
  const [tab, setTab] = useState('today') // 'today' | 'agent' | 'library' | 'tasks' | 'devices'
  const [activeSession, setActiveSession] = useState(null)
  const [librarySubView, setLibrarySubView] = useState(null) // null | 'ask' | 'item'
  const [selectedLibraryItem, setSelectedLibraryItem] = useState(null)
  const [pcSubView, setPcSubView] = useState(null) // null | 'terminal'
  const [deviceView, setDeviceView] = useState('overview')
  const [connection, setConnection] = useState(null)
  const [transportState, setTransportState] = useState(null)
  const [telemetry, setTelemetry] = useState(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addWidgetsOpen, setAddWidgetsOpen] = useState(false)
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [library, setLibrary] = useState([])
  const [jobs, setJobs] = useState([])
  const [queue, setQueue] = useState([])
  const [query, setQuery] = useState('')
  const [lastSync, setLastSync] = useState(null)
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
    } catch {
      if (active.current && identity()?.deviceId === owner) {
        setConnection(null)
        setNotice('Connected via Cloud Relay')
      }
    }

    // 3. Fetch live system telemetry if connected
    try {
      const statusRes = await api.remoteStatus().catch(() => null)
      if (statusRes) {
        setTelemetry(statusRes)
      }
    } catch {}

    if (!active.current || identity()?.deviceId !== owner) return

    // 4. Update library and jobs from direct API if connected, or from replica
    try {
      const next = (await records('snapshot'))[0]?.value || {}
      if (current?.permissions?.library) {
        const libRes = await api.library({ limit: 100 }).catch(() => null)
        if (libRes?.items) {
          next.library = libRes.items.map(({ id, uuid, title, summary, notes, url }) => ({ id, uuid, title, summary, notes, url }))
          setLibrary(next.library)
        }
      } else {
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

  const permissions = connection?.permissions || {}
  const currentPath = transportState?.path || (connection ? 'direct' : 'relayed')

  return (
    <div className="m-shell">
      {/* Top Floating Status Strip */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: 'transparent',
          zIndex: 30,
        }}
      >
        <button
          type="button"
          className="transport-pill"
          onClick={() => setDiagnosticsOpen(true)}
          aria-label="Connection Diagnostics"
          style={{ height: 32, padding: '0 10px', fontSize: 11.5 }}
        >
          <span className={`transport-dot transport-dot--${currentPath}`} />
          <span>
            {currentPath === 'direct' ? 'Direct LAN' : currentPath === 'relayed' ? 'Cloud Relay' : 'Offline'}
          </span>
        </button>

        <button
          type="button"
          className="m-ib"
          style={{ width: 34, height: 34, boxShadow: 'none' }}
          onClick={() => setSettingsOpen(true)}
          aria-label="Device settings"
        >
          <Icon name="sliders" size={17} />
          {availableUpdate && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#007aff',
              }}
            />
          )}
        </button>
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

      {/* Main Tab Views */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'today' && (
          <MobileToday
            onSelectTab={(targetTab, payload) => {
              if (targetTab === 'agent') {
                if (payload) setActiveSession(payload)
                setTab('agent')
              } else if (targetTab === 'library') {
                if (payload) {
                  setSelectedLibraryItem(payload)
                  setLibrarySubView('item')
                }
                setTab('library')
              } else {
                setTab(targetTab)
              }
            }}
            onOpenAddWidgets={() => setAddWidgetsOpen(true)}
            onOpenNotifications={() => setSettingsOpen(true)}
            telemetry={telemetry}
          />
        )}

        {tab === 'tasks' && <MobileTasks />}

        {tab === 'agent' && (
          activeSession ? (
            <MobileAgentChat
              session={activeSession}
              onBack={() => setActiveSession(null)}
            />
          ) : (
            <MobileAgentSessions
              onSelectSession={(sess) => setActiveSession(sess)}
              onCreateSession={(title) => {
                const newSess = { id: `temp-${Date.now()}`, title: title || 'New session' }
                setActiveSession(newSess)
              }}
            />
          )
        )}

        {tab === 'library' && (
          librarySubView === 'ask' ? (
            <MobileAskLibrary
              onBack={() => setLibrarySubView(null)}
              onSelectItem={(item) => {
                setSelectedLibraryItem(item)
                setLibrarySubView('item')
              }}
            />
          ) : librarySubView === 'item' ? (
            <MobileLibraryItem
              item={selectedLibraryItem}
              onBack={() => {
                setLibrarySubView(null)
                setSelectedLibraryItem(null)
              }}
              onAskAgent={(item) => {
                setActiveSession({
                  id: `temp-${Date.now()}`,
                  title: `Discussion: ${item?.title || 'Saved Reel'}`,
                })
                setTab('agent')
              }}
            />
          ) : (
            <MobileLibrary
              onSelectItem={(item) => {
                setSelectedLibraryItem(item)
                setLibrarySubView('item')
              }}
              onOpenAsk={() => setLibrarySubView('ask')}
            />
          )
        )}

        {tab === 'devices' && (
          pcSubView === 'terminal' ? (
            <MobileTerminal
              onBack={() => setPcSubView(null)}
              isOnline={Boolean(connection)}
            />
          ) : (
            <MobilePC
              telemetry={telemetry}
              isOnline={Boolean(connection)}
              onOpenTerminal={() => setPcSubView('terminal')}
            />
          )
        )}
      </main>

      {/* Floating Bottom Navigation Dock (Design Flow Screens 2, 3, 5, 7, 10, 11) */}
      <nav className="m-nav" aria-label="Main navigation">
        <div className="m-pill">
          {/* Today Tab */}
          <button
            type="button"
            aria-label="Today"
            className={tab === 'today' ? 'on' : ''}
            onClick={() => setTab('today')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="7" height="7" x="3" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="3" rx="1" />
              <rect width="7" height="7" x="14" y="14" rx="1" />
              <rect width="7" height="7" x="3" y="14" rx="1" />
            </svg>
            {tab === 'today' && <span>Today</span>}
          </button>

          {/* Agent Tab */}
          <button
            type="button"
            aria-label="Agent"
            className={tab === 'agent' ? 'on' : ''}
            onClick={() => setTab('agent')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              <path d="M20 3v4" />
              <path d="M22 5h-4" />
            </svg>
            {tab === 'agent' && <span>Agent</span>}
          </button>

          {/* Library Tab */}
          <button
            type="button"
            aria-label="Library"
            className={tab === 'library' ? 'on' : ''}
            onClick={() => setTab('library')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 7v14" />
              <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
            </svg>
            {tab === 'library' && <span>Library</span>}
          </button>

          {/* Tasks Tab */}
          <button
            type="button"
            aria-label="Tasks"
            className={tab === 'tasks' ? 'on' : ''}
            onClick={() => setTab('tasks')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            {tab === 'tasks' && <span>Tasks</span>}
          </button>

          {/* PC Tab */}
          <button
            type="button"
            aria-label="PC"
            className={tab === 'devices' ? 'on' : ''}
            onClick={() => setTab('devices')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
            {tab === 'devices' && <span>PC</span>}
          </button>
        </div>

        {/* Floating Action Button (FAB) -> Send to Amethyst */}
        <button
          type="button"
          className="m-fab"
          aria-label="Send to Amethyst"
          onClick={() => setQuickCaptureOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </nav>

      {/* Add Widgets Subview Modal */}
      <AnimatePresence>
        {addWidgetsOpen && (
          <AddWidgetsModal
            onClose={() => setAddWidgetsOpen(false)}
            onAddWidget={() => setAddWidgetsOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Settings Subview Modal */}
      <AnimatePresence>
        {settingsOpen && (
          <MobileSettings
            onClose={() => setSettingsOpen(false)}
            onOpenDiagnostics={() => setDiagnosticsOpen(true)}
            onUnpair={unpair}
            transportMode={currentPath}
          />
        )}
      </AnimatePresence>

      {/* Quick Capture Sheet Modal */}
      <MobileQuickCapture
        open={quickCaptureOpen}
        onClose={() => setQuickCaptureOpen(false)}
        isOnline={Boolean(connection)}
        onSaved={refresh}
      />

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
