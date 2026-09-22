import { StateView, Tile } from '../primitives.jsx'
import { useEffect, useState } from 'react'
import { request } from '../api.js'
import Button from '../../components/ui/AppButton.jsx'
import { Input } from '../../components/ui/input.tsx'

export function ClockFace({ now }) {
  const parts = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).formatToParts(now)
  const period = parts.find(part => part.type === 'dayPeriod')?.value
  return <Tile className="glance-clock-face">
    <span className="clock-date">{now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
    <time className="home-clock" dateTime={now.toISOString()}><span className="clock-digits">{parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim()}</span>{period && <small className="clock-period">{period}</small>}</time>
    <span className="clock-zone">{Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}</span>
  </Tile>
}

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
  return <div className="clock-proof"><ClockFace now={now} />
    {zones.map(value => <div className="world-clock" key={value}><span>{value}</span><time>{now.toLocaleTimeString([], { timeZone: value, hour: '2-digit', minute: '2-digit' })}</time><Button size="small" disabled={busy} aria-label={`Remove ${value}`} onClick={() => save(zones.filter(z => z !== value))}>Remove</Button></div>)}
    {zones.length < 4 && <form onSubmit={e => { e.preventDefault(); try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); if (!zones.includes(zone)) save([...zones, zone]); else setError('This timezone is already shown.') } catch { setError('Use a timezone such as Europe/London.') } }}><label>World clock timezone<Input required aria-label="World clock timezone" placeholder="Europe/London" value={zone} onChange={e => setZone(e.target.value)} /></label><Button size="small" type="submit" loading={busy}>Add clock</Button></form>}{error && <StateView role="alert">{error}</StateView>}
  </div>
}
