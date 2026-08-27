import { useRef, useState } from 'react'
import { Button } from '../components/ui/bento/index.jsx'
import { useDashboard } from './context.js'
import LocationSettings from './widgets/LocationSettings.jsx'

import { sourceNames, widgetRequirements, widgetStatus } from './setup.js'

export default function WidgetSetup({ manifest, data, busy, refresh, onConfigure }) {
  const { connections, connectionHealth, connectSource, openWidget } = useDashboard()
  const requirements = widgetRequirements(manifest)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const pending = useRef(false)
  const health = connections?.data || connectionHealth
  const canOpen = onConfigure && !requirements.location && !['loading', 'error', 'not-connected'].includes(data.state) && (!requirements.media || data.payload?.active_player)
  const synced = data.synced_at && new Date(data.synced_at)
  const syncedLabel = synced && Number.isFinite(synced.getTime()) ? synced.toLocaleString() : 'No successful sync recorded'
  async function check() {
    if (pending.current) return
    pending.current = true; setChecking(true); setError('')
    try { await Promise.all([refresh(), connections?.refresh?.()]) }
    catch (cause) { setError(cause.message || 'The source could not be checked.') }
    finally { pending.current = false; setChecking(false) }
  }
  return <section className="widget-setup-screen" aria-label={`${manifest.title} setup and status`}>
    <div className="widget-setup-status" role={data.state === 'error' ? 'alert' : 'status'}><strong>{widgetStatus(manifest, data)}</strong><p>{data.error || (data.state === 'not-connected' ? 'The required source or setting is unavailable. Follow the steps below, then check again.' : data.state === 'empty' ? manifest.empty : 'Status comes from this widget’s data provider.')}</p><small>Last synced: {syncedLabel}</small></div>
    {data.stale && <p>Previously cached data remains available on Home while this source is unavailable.</p>}
    <h3>How to set up</h3>
    <ol>{requirements.steps.map(step => <li key={step}>{step}</li>)}</ol>
    {requirements.connectors.map(id => {
      const account = health?.items?.find(item => item.id === id)
      return <div className="widget-setup-connection" key={id}><span>{sourceNames[id] || id}: {account?.status || 'Status not checked'}</span>{connectSource && <Button onClick={() => connectSource(id)}>{account?.status === 'connected' ? 'Manage' : account?.status === 'needs reconnect' ? 'Reconnect' : 'Connect'} {sourceNames[id] || id}</Button>}</div>
    })}
    {connections?.error && <p role="alert">Connection check failed: {connections.error}</p>}
    {requirements.location && <LocationSettings />}
    <div className="widget-buttons">{requirements.model && openWidget && <Button onClick={() => openWidget('sys.model')}>Open Model settings</Button>}{canOpen && <Button onClick={onConfigure}>Open widget</Button>}<Button loading={checking || busy || data.refreshing} onClick={check}>Check live data</Button></div>
    {error && <p role="alert">{error}</p>}
  </section>
}
