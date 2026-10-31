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
import { canonicalZone, useClock, useReducedMotion } from './clock/helpers.js'
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
  return <section className="clock-world-settings" aria-label="World clocks">
    <p className="clock-limit" role="status">{zones.length} of 4 world clocks</p>
    <WorldClocks now={now} zones={zones} variant="settings" remove={remove} busy={busy} />
    {zones.length < 4 && <form className="clock-add" aria-busy={busy} onSubmit={add}>
      <label htmlFor={id}>World clock timezone
        <Input id={id} required placeholder="Europe/London" value={zone} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setZone(event.target.value); setError('') }} />
      </label>
      <Button size="small" type="submit" loading={busy}>Add clock</Button>
    </form>}
    {error && <p className="clock-error" id={`${id}-error`} role="alert">{error}</p>}
  </section>
}

export default function Clock({ data, full = true, size = 'l', design = DEFAULT_CLOCK_FACE }) {
  const now = useClock()
  const reducedMotion = useReducedMotion()
  const { changeDesign } = useDashboard() || {}
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

  const face = clockFace(design)
  const limit = worldLimit(face, size)
  const shown = full ? [] : zones.slice(0, limit)
  const hidden = full ? 0 : zones.length - shown.length
  const seconds = showSeconds(face, size, reducedMotion)
  const variant = face.number === 8 ? 'grid' : face.number === 9 ? 'ledger' : 'rows'

  async function save(next) {
    if (saving.current) return
    saving.current = true
    setBusy(true); setError('')
    try {
      const saved = await request('/widgets/glance.clock/settings', 'PUT', { zones: next })
      setZones(Array.isArray(saved?.zones) ? saved.zones : next)
      setZone('')
      window.dispatchEvent(new CustomEvent('dashboard-clock-changed'))
    } catch (err) { setError(err.message || 'Could not save clock settings.') } finally { saving.current = false; setBusy(false) }
  }

  function add(event) {
    event.preventDefault()
    if (saving.current) return
    const value = canonicalZone(zone)
    if (!value) { setError('Use a timezone such as Europe/London.'); return }
    if (zones.some(saved => typeof saved === 'string' && canonicalZone(saved) === value)) { setError('This timezone is already shown.'); return }
    save([...zones, zone.trim()])
  }

  return <div className={`clock-widget clock-widget--${face.family}`} data-clock-size={size} data-clock-design={face.id}>
    <div className="clock-stage">
      <ClockFace now={now} face={face} size={size} seconds={seconds} />
      {shown.length > 0 && <WorldClocks now={now} zones={zones} variant={variant} limit={limit} />}
    </div>
    {hidden > 0 && <p className="clock-note">{size === 's' ? `${zones.length} world clocks` : `${zones.length} world clocks saved`}</p>}
    {full && <div className="clock-settings">
      <FacePicker design={face.id} changeDesign={changeDesign} />
      <WorldSettings now={now} zones={zones} busy={busy} error={error} zone={zone} setZone={setZone} setError={setError} remove={index => save(zones.filter((_, position) => position !== index))} add={add} id={`${id}-zone`} />
    </div>}
  </div>
}
