import { RadioGroup } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { useEffect, useId, useRef, useState } from 'react'
import Button from '../../components/ui/AppButton.jsx'
import { Input } from '../../components/ui/input.tsx'
import { request } from '../api.js'
import { useDashboard } from '../context.js'
import ClockFace from './clock/ClockFace.jsx'
import WorldClocks from './clock/WorldClocks.jsx'
import { CLOCK_FACES, clockFace, DEFAULT_CLOCK_FACE, showSeconds, worldLimit } from './clock/faces.js'
import { canonicalZone, cityName, DEFAULT_WORLD_ZONES, formatTime, timeLabel, useClock, useReducedMotion } from './clock/helpers.js'
import './clock/clock.css'

function FacePicker({ design, changeDesign }) {
  return <fieldset className="clock-picker">
    <legend>Clock face</legend>
    <RadioGroup className="clock-picker-grid" value={design} onValueChange={value => changeDesign?.('glance.clock', value)}>
      {CLOCK_FACES.map(face => <Radio.Root className="clock-picker-option" key={face.id} value={face.id}>
        <span className="clock-picker-mark" aria-hidden="true" />
        <span className="clock-picker-index" aria-hidden="true">{String(face.number).padStart(2, '0')}</span>
        <span className="clock-picker-copy"><strong>{face.name}</strong><small>{face.caption}</small></span>
      </Radio.Root>)}
    </RadioGroup>
  </fieldset>
}

function WorldSettings({ now, zones, busy, error, zone, setZone, setError, remove, add, id }) {
  const custom = zones.length > 0
  const shown = custom ? zones : DEFAULT_WORLD_ZONES
  return <section className="clock-world-settings" aria-label="World clocks">
    <p className="clock-limit" role="status">{custom ? `${zones.length} of 4 world clocks` : 'London, New York and Tokyo are shown by default.'}</p>
    <WorldClocks now={now} zones={shown} variant="settings" remove={custom ? remove : undefined} busy={busy} />
    {zones.length < 4 && <form className="clock-add" aria-busy={busy} onSubmit={add}>
      <label htmlFor={id}>World clock timezone
        <Input id={id} required placeholder="Europe/London" value={zone} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setZone(event.target.value); setError('') }} />
      </label>
      <Button size="small" type="submit" loading={busy}>Add clock</Button>
    </form>}
    {error && <p className="clock-error" id={`${id}-error`} role="alert">{error}</p>}
  </section>
}

export default function Clock({ data, full = false, size = 's', design = DEFAULT_CLOCK_FACE, onOpen }) {
  const { changeDesign } = useDashboard() || {}
  const face = clockFace(design)
  const reducedMotion = useReducedMotion()
  const seconds = showSeconds(face, size, reducedMotion)
  const now = useClock(size === 'l' || seconds)
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

  const saved = zones.length > 0
  const limit = worldLimit(face, size)
  const shownZones = (saved ? zones : DEFAULT_WORLD_ZONES).slice(0, limit || 3)
  const city = cityName(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const time = formatTime(now)
  const label = `Clock, ${city}, ${timeLabel(time)}${size === 's' ? '' : ', world clocks'}`

  async function save(next) {
    if (saving.current) return
    saving.current = true
    setBusy(true); setError('')
    try {
      const result = await request('/widgets/glance.clock/settings', 'PUT', { zones: next })
      setZones(Array.isArray(result?.zones) ? result.zones : next)
      setZone('')
      window.dispatchEvent(new CustomEvent('dashboard-clock-changed'))
    } catch (err) { setError(err.message || 'Could not save clock settings.') } finally { saving.current = false; setBusy(false) }
  }

  function add(event) {
    event.preventDefault()
    if (saving.current) return
    const value = canonicalZone(zone)
    if (!value) { setError('Use a timezone such as Europe/London.'); return }
    const base = saved ? zones : DEFAULT_WORLD_ZONES
    if (base.some(item => typeof item === 'string' && canonicalZone(item) === value)) { setError('This timezone is already shown.'); return }
    save([...base, zone.trim()])
  }

  if (full) return <div className="clock-widget clock-widget--settings">
    <FacePicker design={face.id} changeDesign={changeDesign} />
    <WorldSettings now={now} zones={zones} busy={busy} error={error} zone={zone} setZone={setZone} setError={setError} remove={index => save(zones.filter((_, position) => position !== index))} add={add} id={`${id}-zone`} />
  </div>

  const body = <div className={`clock-widget clock-widget--${face.family}`} data-clock-size={size} data-clock-design={face.id}>
    <ClockFace now={now} face={face} size={size} city={city} zones={shownZones} reducedMotion={reducedMotion} seconds={seconds} />
  </div>

  return onOpen
    ? <Button type="button" className="clock-card" aria-label={label} onClick={onOpen}>{body}</Button>
    : body
}
