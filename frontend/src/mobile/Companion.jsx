import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { request } from '../dashboard/api.js'
import Home from '../dashboard/Home.jsx'
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
import Updates from './Updates.jsx'
import './companion.css'

const tabs = [
  ['today', 'Today', 'sun'],
  ['library', 'Library', 'book'],
  ['agent', 'Agent', 'chat'],
  ['activity', 'Activity', 'logs'],
  ['devices', 'Devices', 'monitor'],
]

export default function Companion({ onUnpair }) {
  const active = useRef(true)
  const [tab, setTab] = useState('today')
  const [deviceView, setDeviceView] = useState('overview')
  const [connection, setConnection] = useState(null)
  const [transportState, setTransportState] = useState(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const [notice, setNotice] = useState('Connecting to desktop…')
  const [library, setLibrary] = useState([])
  const [jobs, setJobs] = useState([])
  const [queue, setQueue] = useState([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState({ title: '', text: '', url: '' })
  const [saving, setSaving] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [settings, setSettings] = useState(false)

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
        setNotice('Desktop connected via Direct LAN')
      }
    } catch (err) {
      if (active.current && identity()?.deviceId === owner) {
        setConnection(null)
        setNotice('Synced via Cloud Relay. Saved content available.')
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
      <header className="companion-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h1>{tabs.find((item) => item[0] === tab)?.[1]}</h1>
          <button
            type="button"
            className="transport-pill"
            onClick={() => setDiagnosticsOpen(true)}
            aria-label="Connection Diagnostics"
          >
            <span className={`transport-dot transport-dot--${currentPath}`} />
            <span>
              {currentPath === 'direct' ? 'Direct LAN' : currentPath === 'relayed' ? 'Cloud Relay' : 'Offline'}
            </span>
          </button>
        </div>
        <button type="button" onClick={() => setSettings((value) => !value)} aria-label="Device settings">
          <Icon name="sliders" size={20} />
        </button>
      </header>

      <div className="companion-status" role="status">
        {notice}
        {lastSync && <small>Last saved sync: {new Date(lastSync).toLocaleTimeString()}</small>}
      </div>

      {settings && (
        <section className="companion-card">
          <h2>Device Settings</h2>
          <p>
            Paired as <strong>{identity()?.name}</strong>. Transport: <em>{currentPath}</em>.
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={() => setDiagnosticsOpen(true)}>
              View Diagnostics
            </button>
            <button type="button" onClick={refresh}>
              Sync Now
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={unpair} style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' }}>
              Unpair Device
            </button>
          </div>
        </section>
      )}

      {settings && <Updates />}

      <main className="companion-content">
        {tab === 'today' && <Home layoutMode="mobile" />}

        {tab === 'library' && (
          <>
            <form className="companion-card" onSubmit={capture}>
              <h2>Save to your library</h2>
              <label>
                Title
                <input
                  required
                  maxLength={400}
                  value={draft.title}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                />
              </label>
              <label>
                Link
                <input
                  type="url"
                  maxLength={8192}
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </label>
              <label>
                Text or notes
                <textarea
                  maxLength={100000}
                  value={draft.text}
                  onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                />
              </label>
              <button disabled={saving} type="submit">
                {saving ? 'Saving…' : 'Save capture'}
              </button>
            </form>
            <label className="companion-search">
              Search saved items
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            {!visibleLibrary.length && <p>No matching saved items on this device.</p>}
            {visibleLibrary.map((item, index) => (
              <article className="companion-card" key={item.uuid || item.id || index}>
                <h2>{item.title}</h2>
                <p>{item.summary || item.notes || 'No summary saved.'}</p>
                {/^https?:\/\//i.test(item.url || '') && (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    Open source
                  </a>
                )}
              </article>
            ))}
          </>
        )}

        {tab === 'agent' && (
          <RemoteAgent onOpenDiagnostics={() => setDiagnosticsOpen(true)} transportState={transportState} />
        )}

        {tab === 'activity' && (
          <>
            <h2>Captures</h2>
            {!queue.length && <p>No captures queued on this device.</p>}
            {queue.map((item) => (
              <article className="companion-card" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.state === 'accepted' ? 'Accepted by desktop; waiting to run' : item.state}</p>
                {item.error && <p role="alert">{item.error}</p>}
              </article>
            ))}
            <h2>Desktop jobs</h2>
            {!jobs.length && <p>No saved job activity.</p>}
            {jobs.map((job) => (
              <article className="companion-card" key={job.id}>
                <h3>{job.kind}</h3>
                <p>{job.state}</p>
                {job.error && <p>{job.error}</p>}
              </article>
            ))}
          </>
        )}

        {tab === 'devices' && (
          <>
            <section className="companion-card">
              <h2>My Desktop</h2>
              <p>
                {connection
                  ? 'Connected via Direct LAN'
                  : 'Connected via Encrypted Cloudflare Relay (saved content available)'}
              </p>
              <div className="companion-actions">
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
                    aria-pressed={deviceView === id}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!connection?.screen_available && <p>Screen capture is unavailable on this connection.</p>}
            </section>
            {connection && deviceView === 'pc' && <RemotePC />}
            {connection && deviceView === 'terminal' && permissions.terminal && <RemoteTerminal />}
            {connection && deviceView === 'files' && permissions.files && <RemoteFiles />}
            {connection && deviceView === 'media' && permissions.audio && <RemoteMedia />}
          </>
        )}
      </main>

      <nav className="companion-nav" aria-label="Companion navigation">
        {tabs.map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
          >
            <Icon name={icon} size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

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
