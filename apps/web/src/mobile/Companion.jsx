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
import { safeStorage } from '../lib/storage.js'
import { storedIdentity } from '../lib/credentials.js'
import ConnectionDiagnosticsModal from './ConnectionDiagnosticsModal.jsx'
import { DynamicIslandStatus } from '../components/ui/apple/DynamicIslandStatus.jsx'
import { captures, saveCapture, flushCaptures } from './captures.js'
import { putRecord, records, getLocalOwner } from './storage.js'
import { syncCollections, getStoredCollections } from './collectionsSync.js'
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
import MobileSpikeHarness from './views/MobileSpikeHarness.jsx'
import { resumePendingPipelineItems, enqueueSave, loadSavedItems } from './capturePipeline.js'
import { getSecureKey, setSecureKey } from './secureStorage.js'
import { reconcileDriveDuplicates } from './driveSync.js'
import { getBundle, saveBundle, validateBundle } from './bundle.js'
import { loadConnections, saveConnections } from './connectionStatus.js'
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
  const [spikeHarnessOpen, setSpikeHarnessOpen] = useState(false)
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
    window.__openSpikeHarness = () => setSpikeHarnessOpen(true)
    window.__enqueueSave = (url, config) => enqueueSave(url, config)
    window.__resumePipeline = (config) => resumePendingPipelineItems(config)
    window.__loadSavedItems = () => loadSavedItems()
    window.__getSecureKey = (key) => getSecureKey(key)
    window.__setSecureKey = (key, val) => setSecureKey(key, val)
    window.__reconcileDriveDuplicates = (cfg) => reconcileDriveDuplicates(cfg)
    checkMobileUpdate()
    resumePendingPipelineItems()
    const interval = setInterval(checkMobileUpdate, 15 * 60 * 1000)
    return () => {
      clearInterval(interval)
      delete window.__openSpikeHarness
      delete window.__enqueueSave
      delete window.__resumePipeline
      delete window.__loadSavedItems
      delete window.__getSecureKey
      delete window.__setSecureKey
      delete window.__reconcileDriveDuplicates
    }
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
  const syncCredentialsRef = useRef(null)

  useEffect(() => {
    const tm = getTransportManager({
      getHostUrl: () => safeStorage.getItem('amethyst.pc_host') || identity()?.hostUrl || storedIdentity()?.hostUrl || getBase().replace(/\/api$/, ''),
      getRelayUrl: () => identity()?.relayUrl,
      getToken: () => identity()?.token,
      onStateChange: (state) => {
        if (state.path === 'direct' && state.hostUrl) {
          try {
            safeStorage.setItem('amethyst.pc_host', state.hostUrl)
          } catch {}
          syncCredentialsRef.current?.()
        }
        setTransportState(state)
      },
    })

    tm.startAutoProbe(15000)
    setTransportState(tm.getState())

    return () => {
      tm.stopAutoProbe()
    }
  }, [])

  // Android hardware back gesture listener
  const navStateRef = useRef({})
  navStateRef.current = {
    quickCaptureOpen,
    spikeHarnessOpen,
    settingsOpen,
    diagnosticsOpen,
    addWidgetsOpen,
    tab,
    librarySubView,
    activeSession,
    pcSubView,
  }

  useEffect(() => {
    let handle
    const setupBack = async () => {
      try {
        handle = await App.addListener('backButton', () => {
          const s = navStateRef.current
          if (s.quickCaptureOpen) {
            setQuickCaptureOpen(false)
          } else if (s.spikeHarnessOpen) {
            setSpikeHarnessOpen(false)
          } else if (s.settingsOpen) {
            setSettingsOpen(false)
          } else if (s.diagnosticsOpen) {
            setDiagnosticsOpen(false)
          } else if (s.addWidgetsOpen) {
            setAddWidgetsOpen(false)
          } else if (s.tab === 'library' && s.librarySubView) {
            setLibrarySubView(null)
            setSelectedLibraryItem(null)
          } else if (s.tab === 'agent' && s.activeSession) {
            setActiveSession(null)
          } else if (s.tab === 'devices' && s.pcSubView) {
            setPcSubView(null)
          } else if (s.tab !== 'today') {
            setTab('today')
          } else {
            App.minimizeApp().catch(() => App.exitApp?.())
          }
        })
      } catch {}
    }
    setupBack()
    return () => {
      handle?.remove?.()
    }
  }, [])

  const refresh = useCallback(async () => {
    const isPaired = Boolean(identity()?.deviceId)
    const owner = identity()?.deviceId || getLocalOwner()

    // 1. Run durable sync and captures flush
    try {
      const syncTasks = [flushCaptures()]
      if (isPaired) syncTasks.push(sync())
      await Promise.allSettled(syncTasks)
    } catch {}

    // 2. Probe direct LAN capabilities without blocking if away
    let current = null
    if (isPaired) {
      try {
        current = await request('/remote/capabilities', 'GET', undefined, 2500)
        if (active.current) {
          setConnection(current)
          setNotice('Direct Wi-Fi connected')
        }
      } catch {
        if (active.current) {
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
    } else {
      if (active.current) {
        setConnection(null)
        setNotice('Cloud Standalone')
      }
    }

    if (!active.current) return

    // 4. Update library and collections directly from Drive/Composio or API
    try {
      const next = (await records('snapshot'))[0]?.value || {}

      // Load full items from API or Drive/Composio sync without stripping metadata
      let loadedItems = null
      try {
        const libRes = await api.library({ limit: 500 }).catch(() => null)
        if (libRes?.items && libRes.items.length > 0) {
          loadedItems = libRes.items
        }
      } catch {}

      if (!loadedItems || loadedItems.length === 0) {
        try {
          const syncRes = await syncCollections({ apiClient: api })
          if (syncRes?.store?.items?.length) {
            loadedItems = syncRes.store.items
          }
        } catch {}
      }

      if (!loadedItems || loadedItems.length === 0) {
        const stored = getStoredCollections()
        if (stored.items?.length) {
          loadedItems = stored.items
        } else {
          const replicaLib = Object.values(replica.readAll(replica.load(), 'library') || {})
          if (replicaLib.length > 0) {
            loadedItems = replicaLib
          }
        }
      }

      if (loadedItems && loadedItems.length > 0) {
        next.library = loadedItems
        setLibrary(loadedItems)
      }

      // Requirement 1: Leave a clearly marked hook for PC agent's pairing prompt on PC/agent-job features only
      if (current?.permissions?.agent) {
        const jobsRes = await api.jobs().catch(() => null)
        if (jobsRes?.jobs) {
          next.jobs = jobsRes.jobs.map(({ id, kind, state, error }) => ({ id, kind, state, error }))
          setJobs(next.jobs)
        }
      } else if (!isPaired) {
        // [PC Agent Feature Hook]: PC agent and background jobs require pairing with a desktop host.
        // Unpaired devices hook here to trigger PC pairing prompt when accessing PC or agent jobs.
        next.jobs = []
        setJobs([])
      }

      if (Object.keys(next).length) {
        next.syncedAt = new Date().toISOString()
        await putRecord('snapshot', next)
        setLastSync(next.syncedAt)
      }
      setQueue(await captures())
    } catch {}
  }, [])

  const syncCredentials = useCallback(async () => {
    try {
      const id = identity() || storedIdentity()
      if (!id?.token) return
      const fresh = await api.getCredentialsBundle().catch(() => null)
      if (!fresh) return

      const check = validateBundle(fresh)
      if (!check.valid) {
        return
      }

      const currentBundle = await getBundle()
      const llmChanged = JSON.stringify(fresh.llm) !== JSON.stringify(currentBundle?.llm)
      const composioChanged = JSON.stringify(fresh.composio) !== JSON.stringify(currentBundle?.composio)
      const driveChanged = JSON.stringify(fresh.drive) !== JSON.stringify(currentBundle?.drive)
      const msChanged = fresh.microsoft && JSON.stringify(fresh.microsoft) !== JSON.stringify(currentBundle?.microsoft)

      if (llmChanged || composioChanged || driveChanged || msChanged || !currentBundle) {
        await saveBundle(fresh)
        const conns = await loadConnections()
        if (fresh.composio?.api_key && fresh.composio?.user_id) {
          conns.composio = { apiKey: fresh.composio.api_key, userId: fresh.composio.user_id }
        } else {
          conns.composio = null
        }
        if (fresh.drive?.root_folder_id || fresh.drive?.inbox_folder_id) {
          conns.googleDrive = {
            rootFolderId: fresh.drive.root_folder_id,
            inboxFolderId: fresh.drive.inbox_folder_id,
          }
        } else {
          conns.googleDrive = null
        }
        await saveConnections(conns)
      }
    } catch {
      // Non-blocking background credential sync
    }
  }, [])
  syncCredentialsRef.current = syncCredentials

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
        const stored = getStoredCollections()
        if (stopped) return
        const initialLib = snapshot?.library || (stored.items?.length ? stored.items : Object.values(replica.readAll(replica.load(), 'library') || {}))
        setLibrary(initialLib)
        setJobs(snapshot?.jobs || [])
        setLastSync(snapshot?.syncedAt || stored.lastSyncedAt || null)
        setQueue(await captures())
      } catch (error) {
        if (!stopped) setNotice(error.message)
      }
      await tick()
      syncCredentials()
    })()

    const timer = setInterval(tick, 60000)
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        tick()
        syncCredentials()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', tick)

    // Instant event-driven push sync via WebSocket over LAN
    let ws = null
    let reconnectTimer = null

    function connectPushWs() {
      if (stopped) return
      const base = getBase()
      if (!base) return

      const proto = base.startsWith('https') ? 'wss:' : 'ws:'
      const host = base.replace(/^https?:\/\//, '').replace(/\/api\/?$/, '') || window.location.host
      const token = identity()?.token || ''
      const wsUrl = `${proto}//${host}/api/remote/ws?token=${encodeURIComponent(token)}`

      try {
        ws = new WebSocket(wsUrl)
        ws.onopen = () => {
          if (!stopped) setIsOnline(true)
        }
        ws.onmessage = (event) => {
          if (stopped) return
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'sync_event') {
              if (data.event === 'credentials_updated') {
                syncCredentials()
              }
              tick()
            }
          } catch {}
        }
        ws.onclose = () => {
          if (!stopped) {
            reconnectTimer = setTimeout(connectPushWs, 5000)
          }
        }
        ws.onerror = () => {
          ws?.close()
        }
      } catch {
        if (!stopped) {
          reconnectTimer = setTimeout(connectPushWs, 8000)
        }
      }
    }

    connectPushWs()

    return () => {
      active.current = false
      stopped = true
      clearInterval(timer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', tick)
    }
  }, [refresh, syncCredentials])

  async function unpair() {
    active.current = false
    try {
      try {
        await request('/remote/revoke', 'POST').catch(() => {})
      } catch {}
      await onUnpair()
    } catch (error) {
      active.current = true
      setNotice(`Could not remove this device: ${error.message}`)
    }
  }

  const permissions = connection?.permissions || {}
  const currentPath = transportState?.path || (connection ? 'direct' : 'relayed')
  const hideTopStatus =
    tab === 'today' ||
    tab === 'library' ||
    (tab === 'agent' && activeSession) ||
    (tab === 'devices' && pcSubView === 'terminal')

  return (
    <div className="m-shell">
      {/* Top Floating Status Strip (hidden in focused subviews) */}
      {!hideTopStatus && (
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
          <div onClick={() => setDiagnosticsOpen(true)} style={{ cursor: 'pointer' }}>
            <DynamicIslandStatus
              status={currentPath === 'relayed' ? 'standalone' : currentPath}
              latency={transportState?.latency || -1}
              onRetry={async () => {
                const tm = getTransportManager()
                await tm.probe()
              }}
            />
          </div>

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
      )}

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

      {/* Main Tab Views with Smooth View Transitions */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <AnimatePresence mode="wait">
          {tab === 'today' && (
            <MobileToday
              key="today"
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

          {tab === 'tasks' && <MobileTasks key="tasks" />}

          {tab === 'agent' && (
            activeSession ? (
              <MobileAgentChat
                key={`agent-chat-${activeSession.id || 'new'}`}
                session={activeSession}
                onBack={() => setActiveSession(null)}
              />
            ) : (
              <MobileAgentSessions
                key="agent-sessions"
                onSelectSession={(sess) => setActiveSession(sess)}
                onCreateSession={(title) => {
                  const newSess = { id: `temp-${Date.now()}`, title: title || 'New session' }
                  setActiveSession(newSess)
                }}
              />
            )
          )}

          {tab === 'library' && (
            <div style={{ flex: 1, height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
              <MobileLibrary
                onSelectItem={(item) => {
                  setSelectedLibraryItem(item)
                  setLibrarySubView('item')
                }}
                onOpenAsk={() => setLibrarySubView('ask')}
                onOpenCapture={() => setQuickCaptureOpen(true)}
              />

              {librarySubView === 'ask' && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#F2F2F7', display: 'flex', flexDirection: 'column' }}>
                  <MobileAskLibrary
                    key="library-ask"
                    onBack={() => setLibrarySubView(null)}
                    onSelectItem={(item) => {
                      setSelectedLibraryItem(item)
                      setLibrarySubView('item')
                    }}
                  />
                </div>
              )}

              {librarySubView === 'item' && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: '#F2F2F7', display: 'flex', flexDirection: 'column' }}>
                  <MobileLibraryItem
                    key={`library-item-${selectedLibraryItem?.id || 'selected'}`}
                    item={selectedLibraryItem}
                    onBack={() => {
                      setLibrarySubView(null)
                      setSelectedLibraryItem(null)
                    }}
                    onDeleteItem={() => {
                      setLibrarySubView(null)
                      setSelectedLibraryItem(null)
                      refresh()
                    }}
                    onAskAgent={(item) => {
                      setActiveSession({
                        id: `temp-${Date.now()}`,
                        title: `Discussion: ${item?.title || 'Saved Reel'}`,
                      })
                      setTab('agent')
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {tab === 'devices' && (
            pcSubView === 'terminal' ? (
              <MobileTerminal
                key="pc-terminal"
                onBack={() => setPcSubView(null)}
                isOnline={Boolean(connection)}
              />
            ) : (
              <MobilePC
                key="pc-overview"
                telemetry={telemetry}
                isOnline={Boolean(connection)}
                onOpenTerminal={() => setPcSubView('terminal')}
              />
            )
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Gradient Fade to seamlessly blend into phone navigation bar */}
      {!librarySubView && !activeSession && !pcSubView && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            height: 96,
            background: 'linear-gradient(180deg, rgba(242,242,247,0) 0%, rgba(242,242,247,0.85) 50%, #F2F2F7 100%)',
            pointerEvents: 'none',
            zIndex: 90,
          }}
        />
      )}

      {/* Floating Bottom Navigation Dock (Design Flow Screens 2, 3, 5, 7, 10, 11) */}
      {!librarySubView && !activeSession && !pcSubView && (
        <nav className="m-nav" aria-label="Main navigation">
          <div className="m-pill">
            {/* Today Tab */}
            <button
              type="button"
              aria-label="Home"
              className={tab === 'today' ? 'on' : ''}
              onClick={() => {
                setTab('today')
                setLibrarySubView(null)
                setPcSubView(null)
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
                <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
                <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
                <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
              </svg>
              {tab === 'today' && <span>Home</span>}
            </button>

            {/* Agent Tab */}
            <button
              type="button"
              aria-label="Agent"
              className={tab === 'agent' ? 'on' : ''}
              onClick={() => {
                setTab('agent')
                setLibrarySubView(null)
                setPcSubView(null)
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z" />
                <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9z" />
              </svg>
              {tab === 'agent' && <span>Agent</span>}
            </button>

            {/* Library Tab */}
            <button
              type="button"
              aria-label="Library"
              className={tab === 'library' ? 'on' : ''}
              onClick={() => {
                if (tab === 'library' && librarySubView !== null) {
                  setLibrarySubView(null)
                  setSelectedLibraryItem(null)
                } else {
                  setTab('library')
                }
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 6c-2-1.5-5-2-8-2v13c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v13" />
              </svg>
              {tab === 'library' && <span>Library</span>}
            </button>

            {/* Tasks Tab */}
            <button
              type="button"
              aria-label="Tasks"
              className={tab === 'tasks' ? 'on' : ''}
              onClick={() => {
                setTab('tasks')
                setLibrarySubView(null)
                setPcSubView(null)
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.5l3 3 5-6" />
              </svg>
              {tab === 'tasks' && <span>Tasks</span>}
            </button>

            {/* PC Tab */}
            <button
              type="button"
              aria-label="Screen"
              className={tab === 'devices' ? 'on' : ''}
              onClick={() => {
                if (tab === 'devices' && pcSubView !== null) {
                  setPcSubView(null)
                } else {
                  setTab('devices')
                }
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              </svg>
              {tab === 'devices' && <span>Screen</span>}
            </button>
          </div>

          {/* Floating Action Button (FAB) -> Send to Amethyst / Create */}
          <button
            type="button"
            className="m-fab"
            aria-label="Create"
            onClick={() => {
              if (tab === 'library') {
                window.dispatchEvent(new CustomEvent('amethyst:library:create'))
              } else {
                setQuickCaptureOpen(true)
              }
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </nav>
      )}

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
            onOpenSpikes={() => {
              setSettingsOpen(false)
              setSpikeHarnessOpen(true)
            }}
            onUnpair={unpair}
            transportMode={currentPath}
          />
        )}
      </AnimatePresence>

      {/* Spike Harness Debug Screen */}
      <AnimatePresence>
        {spikeHarnessOpen && (
          <MobileSpikeHarness
            onClose={() => setSpikeHarnessOpen(false)}
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
        onOpenSettings={() => setSettingsOpen(true)}
        transportState={transportState}
        lastSync={lastSync}
      />

      <ConfirmDialogHost />
    </div>
  )
}
