import { StateView, Tile } from '../primitives.jsx'
import { useEffect, useId, useRef, useState } from 'react'
import { request } from '../api.js'
import Button from '../../components/ui/AppButton.jsx'
import { Input } from '../../components/ui/input.tsx'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const update = () => setNow(new Date())
    const timer = setInterval(update, 1000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update) }
  }, [])
  return now
}

function canonicalZone(value) {
  try { return new Intl.DateTimeFormat('en', { timeZone: value.trim() }).resolvedOptions().timeZone } catch { return null }
}

function WorldClocks({ now, zones, remove, busy }) {
  return <ul className="world-clocks" aria-label="World clocks">{zones.map((value, index) => {
    const valid = typeof value === 'string' && canonicalZone(value)
    return <li className="world-clock" key={`${value}-${index}`}>
      <span className="world-clock-place">{String(value).replaceAll('_', ' ')}</span>
      {valid ? <div className="world-clock-reading"><time dateTime={now.toISOString()}>{now.toLocaleTimeString([], { timeZone: valid, hour: '2-digit', minute: '2-digit' })}</time><span>{now.toLocaleDateString([], { timeZone: valid, month: 'short', day: 'numeric' })}</span></div> : <span>Timezone unavailable</span>}
      {remove && <Button size="small" disabled={busy} aria-label={`Remove ${value}`} onClick={() => remove(index)}>Remove</Button>}
    </li>
  })}</ul>
}

export function ClockPreview({ data }) {
  const now = useClock()
  const zones = Array.isArray(data?.zones) ? data.zones : []
  return <div className="clock-proof"><ClockFace now={now} />{zones.length > 0 && <WorldClocks now={now} zones={zones} />}</div>
}

export function ClockFace({ now }) {
  const parts = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' }).formatToParts(now)
  const period = parts.find(part => part.type === 'dayPeriod')?.value
  return <Tile className="glance-clock-face">
    <svg className="clock-dial" viewBox="0 0 200 200" aria-hidden="true">
      <rect className="clock-dial-face" x="1" y="1" width="198" height="198" />
      {Array.from({ length: 60 }, (_, i) => <line key={i} className={i % 5 === 0 ? 'clock-tick-major' : 'clock-tick'} x1="100" y1="8" x2="100" y2={i % 5 === 0 ? 17 : 12} transform={`rotate(${i * 6} 100 100)`} />)}
      {Array.from({ length: 12 }, (_, i) => {
        const hour = i + 1, angle = hour * Math.PI / 6
        return <text className="clock-numeral" key={hour} x={100 + 69 * Math.sin(angle)} y={100 - 69 * Math.cos(angle)}>{hour}</text>
      })}
      <text className="clock-dial-day" x="100" y="128">{now.toLocaleDateString([], { weekday: 'short' })}</text>
      <text className="clock-dial-date" x="100" y="144">{now.getDate()}</text>
      <line className="clock-hand clock-hour-hand" x1="100" y1="105" x2="100" y2="55" transform={`rotate(${(now.getHours() % 12) * 30 + now.getMinutes() / 2} 100 100)`} />
      <line className="clock-hand clock-minute-hand" x1="100" y1="108" x2="100" y2="30" transform={`rotate(${now.getMinutes() * 6} 100 100)`} />
      <circle className="clock-pin" cx="100" cy="100" r="4" />
    </svg>
    <span className="clock-date">{now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
    <time className="home-clock" dateTime={now.toISOString()}><span key={parts.filter(part => part.type !== 'second').map(part => part.value).join('')} className="clock-digits pilot-number">{parts.filter(part => part.type !== 'dayPeriod').map(part => part.value).join('').trim()}</span>{period && <small className="clock-period">{period}</small>}</time>
    <span className="clock-zone">{Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}</span>
  </Tile>
}

export default function Clock({ data }) {
  const now = useClock()
  const id = useId()
  const [zone, setZone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [zones, setZones] = useState(() => Array.isArray(data?.zones) ? data.zones : [])
  useEffect(() => {
    // Settings can also change through a manual refresh of this widget.
    // oxlint-disable-next-line react/set-state-in-effect
    setZones(Array.isArray(data?.zones) ? data.zones : [])
  }, [data?.zones])
  async function save(next) {
    if (saving.current) return
    saving.current = true
    setBusy(true); setError('')
    try {
      const saved = await request('/widgets/glance.clock/settings', 'PUT', { zones: next })
      setZones(saved.zones); setZone('')
      window.dispatchEvent(new CustomEvent('dashboard-clock-changed'))
    } catch (err) { setError(err.message) } finally { saving.current = false; setBusy(false) }
  }
  return <div className="clock-proof"><ClockFace now={now} />
    {zones.length > 0 && <WorldClocks now={now} zones={zones} remove={index => save(zones.filter((_, i) => i !== index))} busy={busy} />}
    <p className="clock-limit" role="status">{zones.length} of 4 world clocks</p>
    {zones.length < 4 && <form aria-busy={busy} onSubmit={e => {
      e.preventDefault()
      if (saving.current) return
      const value = canonicalZone(zone)
      if (!value) { setError('Use a timezone such as Europe/London.'); return }
      if (zones.some(saved => typeof saved === 'string' && canonicalZone(saved) === value)) { setError('This timezone is already shown.'); return }
      save([...zones, zone.trim()])
    }}><label htmlFor={id}>World clock timezone<Input id={id} required placeholder="Europe/London" value={zone} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={e => { setZone(e.target.value); setError('') }} /></label><Button size="small" type="submit" loading={busy}>Add clock</Button></form>}{error && <StateView id={`${id}-error`} role="alert">{error}</StateView>}
  </div>
}
