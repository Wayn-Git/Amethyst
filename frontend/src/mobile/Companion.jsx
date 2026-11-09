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
import { resumePendingPipelineItems } from './capturePipeline.js'
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
    checkMobileUpdate()
    resumePendingPipelineItems()
    const interval = setInterval(checkMobileUpdate, 15 * 60 * 1000)
    return () => {
      clearInterval(interval)
      delete window.__openSpikeHarness
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
          {currentPath !== 'offline' ? (
            <button
              type="button"
              className="transport-pill"
              onClick={() => setDiagnosticsOpen(true)}
              aria-label="Connection Diagnostics"
              style={{ height: 32, padding: '0 10px', fontSize: 11.5 }}
            >
              <span className={`transport-dot transport-dot--${currentPath}`} />
              <span>
                {currentPath === 'direct' ? 'Direct LAN' : 'Cloud Relay'}
              </span>
            </button>
          ) : <div />}

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
            librarySubView === 'ask' ? (
              <MobileAskLibrary
                key="library-ask"
                onBack={() => setLibrarySubView(null)}
                onSelectItem={(item) => {
                  setSelectedLibraryItem(item)
                  setLibrarySubView('item')
                }}
              />
            ) : librarySubView === 'item' ? (
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
            ) : (
              <MobileLibrary
                key="library-list"
                onSelectItem={(item) => {
                  setSelectedLibraryItem(item)
                  setLibrarySubView('item')
                }}
                onOpenAsk={() => setLibrarySubView('ask')}
                onOpenCapture={() => setQuickCaptureOpen(true)}
              />
            )
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

      {/* Floating Bottom Navigation Dock (Design Flow Screens 2, 3, 5, 7, 10, 11) */}
      {!librarySubView && !activeSession && !pcSubView && (
        <nav className="m-nav" aria-label="Main navigation">
          <div className="m-pill">
          {/* Today Tab */}
          <button
            type="button"
            aria-label="Today"
            className={tab === 'today' ? 'on' : ''}
            onClick={() => {
              setTab('today')
              setLibrarySubView(null)
              setPcSubView(null)
            }}
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
            onClick={() => {
              setTab('agent')
              setLibrarySubView(null)
              setPcSubView(null)
            }}
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
            onClick={() => {
              if (tab === 'library' && librarySubView !== null) {
                setLibrarySubView(null)
                setSelectedLibraryItem(null)
              } else {
                setTab('library')
              }
            }}
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
            onClick={() => {
              setTab('tasks')
              setLibrarySubView(null)
              setPcSubView(null)
            }}
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
            onClick={() => {
              if (tab === 'devices' && pcSubView !== null) {
                setPcSubView(null)
              } else {
                setTab('devices')
              }
            }}
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
