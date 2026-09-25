import { StateView } from '../primitives.jsx'
import { useEffect, useState } from 'react'
import { request } from '../api.js'

export default function Clock({ data, refresh }) {
  const [now, setNow] = useState(new Date())
  const [zone, setZone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer) }, [])
  const zones = data?.zones || []
  async function save(next) {
    setBusy(true); setError('')
    try { await request('/widgets/glance.clock/settings', 'PUT', { zones: next }); setZone(''); refresh() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return <div className="clock-proof"><time className="home-clock" dateTime={now.toISOString()}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><p>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
    {zones.map(value => <div className="world-clock" key={value}><span>{value}</span><time>{now.toLocaleTimeString([], { timeZone: value, hour: '2-digit', minute: '2-digit' })}</time><button disabled={busy} aria-label={`Remove ${value}`} onClick={() => save(zones.filter(z => z !== value))}>Remove</button></div>)}
    {zones.length < 4 && <form onSubmit={e => { e.preventDefault(); try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); if (!zones.includes(zone)) save([...zones, zone]); else setError('This timezone is already shown.') } catch { setError('Use a timezone such as Europe/London.') } }}><label>World clock timezone<input required aria-label="World clock timezone" placeholder="Europe/London" value={zone} onChange={e => setZone(e.target.value)} /></label><button disabled={busy}>Add clock</button></form>}{error && <StateView role="alert">{error}</StateView>}
  </div>
}
