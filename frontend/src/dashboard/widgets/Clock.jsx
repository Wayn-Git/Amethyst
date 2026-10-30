import { useEffect, useId, useRef, useState } from 'react'
import Button from '../../components/ui/AppButton.jsx'
import { Input } from '../../components/ui/input.tsx'
import { request } from '../api.js'
import ClockFace from './clock/ClockFace.jsx'
import WorldClocks from './clock/WorldClocks.jsx'
import { clockFace, DEFAULT_CLOCK_FACE, showSeconds, worldLimit } from './clock/faces.js'
import { canonicalZone, cityName, formatTime, timeLabel, useClock, useReducedMotion } from './clock/helpers.js'
import './clock/clock.css'

function WorldSettings({ now, zones, busy, error, zone, setZone, setError, remove, add, id }) {
  return <section className="clock-world-settings" aria-label="World clocks">
    <p className="clock-limit" role="status">{zones.length} of 4 world clocks saved</p>
    {zones.length ? <WorldClocks now={now} zones={zones} variant="settings" remove={remove} busy={busy} /> : <p>No world clocks saved.</p>}
    {zones.length < 4 && <form className="clock-add" aria-busy={busy} onSubmit={add}>
      <label htmlFor={id}>World clock timezone
        <Input id={id} required placeholder="Europe/London" value={zone} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setZone(event.target.value); setError('') }} />
      </label>
      <Button size="small" type="submit" loading={busy}>Add clock</Button>
    </form>}
    {error && <p className="clock-error" id={`${id}-error`} role="alert">{error}</p>}
  </section>
}

export default function Clock({ data, full = false, size = 's', design = DEFAULT_CLOCK_FACE, onOpen, refresh }) {
  const face = clockFace(design)
  const reducedMotion = useReducedMotion()
  const seconds = showSeconds(face, size)
  const now = useClock(size === 'l' || seconds)
  const id = useId()
  const [zone, setZone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [zones, setZones] = useState(() => Array.isArray(data?.zones) ? data.zones : [])
  const saving = useRef(false)

  useEffect(() => {
    // Keep settings in sync when another refresh returns the saved zone list.
    // oxlint-disable-next-line react/set-state-in-effect
    setZones(Array.isArray(data?.zones) ? data.zones : [])
  }, [data?.zones])

  const saved = zones.length > 0
  const limit = worldLimit(face, size)
  const shownZones = (saved ? zones : []).slice(0, limit)
  const city = cityName(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const time = formatTime(now)
  const label = `Clock, ${city}, ${timeLabel(time)}${size === 's' ? '' : ', world clocks'}`

  async function save(next) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const result = await request('/widgets/glance.clock/settings', 'PUT', { zones: next })
      setZones(Array.isArray(result?.zones) ? result.zones : next)
      setZone('')
      window.dispatchEvent(new CustomEvent('dashboard-clock-changed'))
      await refresh?.()
    } catch (cause) {
      setError(cause.message || 'Could not save clock settings.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  function add(event) {
    event.preventDefault()
    if (saving.current) return
    const value = canonicalZone(zone)
    if (!value) { setError('Use a timezone such as Europe/London.'); return }
    if (zones.some(item => canonicalZone(item) === value)) { setError('This timezone is already saved.'); return }
    save([...zones, value])
  }

  if (full) return <div className="clock-widget clock-widget--settings">
    <WorldSettings now={now} zones={zones} busy={busy} error={error} zone={zone} setZone={setZone} setError={setError} remove={index => save(zones.filter((_, position) => position !== index))} add={add} id={`${id}-zone`} />
  </div>

  const body = <div className={`clock-widget clock-widget--${face.family}`} data-clock-size={size} data-clock-design={face.id} data-variation={face.number}>
    <ClockFace now={now} face={face} size={size} city={city} zones={shownZones} reducedMotion={reducedMotion} seconds={seconds} />
  </div>
  return onOpen ? <Button type="button" className="clock-card" aria-label={label} onClick={onOpen}>{body}</Button> : body
}
