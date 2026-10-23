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
import { captures, saveCapture, flushCaptures } from './captures.js'
import { putRecord, records } from './storage.js'
import './companion.css'

const tabs = [ ['today', 'Today', 'sun'], ['library', 'Library', 'book'],
  ['agent', 'Agent', 'chat'], ['activity', 'Activity', 'logs'], ['devices', 'Devices', 'monitor'] ]

export default function Companion({ onUnpair }) {
  const active = useRef(true)
  const [tab, setTab] = useState('today')
  const [deviceView, setDeviceView] = useState('overview')
  const [connection, setConnection] = useState(null)
  const [notice, setNotice] = useState('Checking desktop connection…')
  const [library, setLibrary] = useState([])
  const [jobs, setJobs] = useState([])
  const [queue, setQueue] = useState([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState({ title: '', text: '', url: '' })
  const [saving, setSaving] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [settings, setSettings] = useState(false)

  const refresh = useCallback(async () => {
    const owner = identity()?.deviceId
    try {
      const current = await request('/remote/capabilities')
      if (!active.current || identity()?.deviceId !== owner) return
      setConnection(current)
      setNotice('Desktop connected')
      const result = await Promise.allSettled([
        current.permissions.library ? api.library({ limit: 100 }) : Promise.resolve(null),
        current.permissions.agent ? api.jobs() : Promise.resolve(null),
        flushCaptures(), sync(),
      ])
      if (!active.current || identity()?.deviceId !== owner) return
      const next = (await records('snapshot'))[0]?.value || {}
      if (!active.current || identity()?.deviceId !== owner) return
      if (result[0].status === 'fulfilled' && result[0].value) {
        next.library = (result[0].value.items || []).map(({ id, uuid, title, summary, notes, url }) => ({ id, uuid, title, summary, notes, url }))
        setLibrary(next.library)
      }
      if (result[1].status === 'fulfilled' && result[1].value) {
        next.jobs = (result[1].value.jobs || []).map(({ id, kind, state, error }) => ({ id, kind, state, error }))
        setJobs(next.jobs)
      }
      if (Object.keys(next).length) {
        next.syncedAt = new Date().toISOString()
        await putRecord('snapshot', next)
        setLastSync(next.syncedAt)
      }
      setQueue(await captures())
      const failed = result.find(item => item.status === 'rejected')
      if (failed) setNotice(`Some updates failed: ${failed.reason.message}`)
    } catch (error) {
      if (!active.current || identity()?.deviceId !== owner) return
      setConnection(null)
      setNotice(`Desktop unavailable. Saved content remains available. ${error.message}`)
    }
  }, [])

  useEffect(() => {
    active.current = true
    let stopped = false
    let busy = false
    const tick = async () => {
      if (stopped || busy || document.visibilityState === 'hidden') return
      busy = true
      try { await refresh() } finally { busy = false }
    }
    ;(async () => {
      try {
        const snapshot = (await records('snapshot'))[0]?.value
        if (stopped) return
        setLibrary(snapshot?.library || Object.values(replica.readAll(replica.load(), 'library')))
        setJobs(snapshot?.jobs || [])
        setLastSync(snapshot?.syncedAt || null)
        setQueue(await captures())
      } catch (error) { if (!stopped) setNotice(error.message) }
      await tick()
    })()
    const timer = setInterval(tick, 30000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => { active.current = false; stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('online', tick) }
  }, [refresh])

  async function unpair() {
    active.current = false
    try { await onUnpair() }
    catch (error) { active.current = true; setNotice(`Could not remove this device: ${error.message}`) }
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
    } catch (error) { setNotice(error.message) }
    finally { setSaving(false) }
  }

  const permissions = connection?.permissions || {}
  const visibleLibrary = library.filter(item => `${item.title || ''} ${item.summary || ''} ${item.notes || ''}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="companion">
    <header className="companion-header">
      <h1>{tabs.find(item => item[0] === tab)?.[1]}</h1>
      <button type="button" onClick={() => setSettings(value => !value)} aria-label="Device settings"><Icon name="sliders" size={20} /></button>
    </header>
    <div className="companion-status" role="status">{notice}{lastSync && <small>Last saved sync: {new Date(lastSync).toLocaleString()}</small>}</div>
    {settings && <section className="companion-card"><h2>Device settings</h2><p>Paired as {identity()?.name}. Permissions are managed on your desktop. The most recent 100 library items are cached on this device.</p><button type="button" onClick={refresh}>Refresh now</button><button type="button" onClick={unpair}>Unpair and remove cached data</button></section>}
    <main className="companion-content">
      {tab === 'today' && <Home layoutMode="mobile" />}
      {tab === 'library' && <>
        <form className="companion-card" onSubmit={capture}>
          <h2>Save to your library</h2>
          <label>Title<input required maxLength={400} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label>Link<input type="url" maxLength={8192} value={draft.url} onChange={event => setDraft({ ...draft, url: event.target.value })} /></label>
          <label>Text or notes<textarea maxLength={100000} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
          <button disabled={saving} type="submit">{saving ? 'Saving…' : 'Save capture'}</button>
        </form>
        <label className="companion-search">Search saved items<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {!visibleLibrary.length && <p>No matching saved items on this device.</p>}
        {visibleLibrary.map((item, index) => <article className="companion-card" key={item.uuid || item.id || index}><h2>{item.title}</h2><p>{item.summary || item.notes || 'No summary saved.'}</p>{/^https?:\/\//i.test(item.url || '') && <a href={item.url} target="_blank" rel="noopener noreferrer">Open source</a>}</article>)}
      </>}
      {tab === 'agent' && <RemoteAgent />}
      {tab === 'activity' && <>
        <h2>Captures</h2>{!queue.length && <p>No captures queued on this device.</p>}
        {queue.map(item => <article className="companion-card" key={item.id}><h3>{item.title}</h3><p>{item.state === 'accepted' ? 'Accepted by desktop; waiting to run' : item.state}</p>{item.error && <p role="alert">{item.error}</p>}</article>)}
        <h2>Desktop jobs</h2>{!jobs.length && <p>No saved job activity.</p>}
        {jobs.map(job => <article className="companion-card" key={job.id}><h3>{job.kind}</h3><p>{job.state}</p>{job.error && <p>{job.error}</p>}</article>)}
      </>}
      {tab === 'devices' && <>
        <section className="companion-card"><h2>My Desktop</h2><p>{connection ? 'Connected' : 'Unavailable — open Amethyst on your desktop and connect to its network.'}</p><p>Remote wake is not configured. Terminal sessions last while the desktop backend runs.</p>
          <div className="companion-actions">{[['overview', 'Overview', null], ['pc', 'PC controls', 'input'], ['terminal', 'Terminal', 'terminal'], ['files', 'Files', 'files'], ['media', 'Media', 'audio']].map(([id, label, permission]) => <button key={id} type="button" disabled={permission && (!connection || !permissions[permission])} onClick={() => setDeviceView(id)} aria-pressed={deviceView === id}>{label}</button>)}</div>
          {!connection?.screen_available && <p>Screen capture is unavailable on this connection.</p>}
        </section>
        {connection && deviceView === 'pc' && <RemotePC />}
        {connection && deviceView === 'terminal' && permissions.terminal && <RemoteTerminal />}
        {connection && deviceView === 'files' && permissions.files && <RemoteFiles />}
        {connection && deviceView === 'media' && permissions.audio && <RemoteMedia />}
      </>}
    </main>
    <nav className="companion-nav" aria-label="Companion navigation">{tabs.map(([id, label, icon]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon name={icon} size={20} /><span>{label}</span></button>)}</nav>
    <ConfirmDialogHost />
  </div>
}
