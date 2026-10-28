import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'
import { request } from '../api.js'
import { deviceLocation, validCoordinates } from '../location.js'
import { StateView } from '../primitives.jsx'

export default function LocationSettings({ active = true }) {
  const [coordinates, setCoordinates] = useState({ latitude: '', longitude: '' })
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState(null)
  const [busy, setBusy] = useState('loading')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const live = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    live.current = active
    // A hidden persistent editor retains fields, but must cancel pending lookups.
    // oxlint-disable-next-line react/set-state-in-effect
    if (!active) setBusy('')
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { live.current = false; generation.current++ }
  }, [active])
  useEffect(() => {
    let mounted = true
    request('/widgets/glance.weather/settings').then(value => {
      if (mounted) setCoordinates({ latitude: value.latitude ?? '', longitude: value.longitude ?? '' })
    }).catch(err => { if (mounted) setError(err.message) }).finally(() => { if (mounted) setBusy('') })
    return () => { mounted = false }
  }, [])

  async function save(value, isCurrent) {
    if (!validCoordinates(value)) throw new Error('Enter valid latitude and longitude coordinates.')
    await request('/widgets/glance.weather/settings', 'PUT', value)
    // All three cards share this setting, including any open detail view.
    window.dispatchEvent(new Event('dashboard-location-changed'))
    if (isCurrent()) {
      setCoordinates(value)
      setMatches(null)
      setSaved('Location saved for Weather, Air quality, and Sunrise and sunset.')
    }
  }
  async function run(action, operation) {
    const token = generation.current
    const isCurrent = () => live.current && generation.current === token
    setBusy(action); setError(''); setSaved('')
    try { await operation(isCurrent) }
    catch (err) { if (isCurrent()) setError(err.message) }
    finally { if (isCurrent()) setBusy('') }
  }

  return <div className="location-settings adoption-stack" aria-busy={Boolean(busy)}>
    <p className="adoption-label">One location for weather, air quality, and sunrise/sunset. City searches and saved coordinates are sent to Open-Meteo.</p>
    <Button variant="primary" disabled={Boolean(busy)} loading={busy === 'device'} onClick={() => run('device', async isCurrent => {
      const value = await deviceLocation()
      if (isCurrent()) await save(value, isCurrent)
    })}><Icon name="target" size={18} />{busy === 'device' ? 'Finding your location…' : 'Use device location'}</Button>
    <form className="location-search" onSubmit={event => {
      event.preventDefault()
      run('search', async isCurrent => {
        const value = await request(`/today/locations?q=${encodeURIComponent(query.trim())}`)
        if (isCurrent()) setMatches(value.items || [])
      })
    }}>
      <label>City<Input type="search" required minLength={2} maxLength={100} placeholder="Search your city" value={query} disabled={Boolean(busy)} onChange={event => { setQuery(event.target.value); setMatches(null) }} /></label>
      <Button type="submit" loading={busy === 'search'} disabled={Boolean(busy) || query.trim().length < 2}>Find city</Button>
    </form>
    {matches?.length === 0 && <StateView role="status">No cities found. Try another spelling.</StateView>}
    {matches?.length > 0 && <ul className="location-results" aria-label="City search results">{matches.map((match, index) => <li key={`${match.latitude}:${match.longitude}:${index}`}><Button disabled={Boolean(busy)} onClick={() => run('save', isCurrent => save({ latitude: match.latitude, longitude: match.longitude }, isCurrent))}>{match.name}<Icon name="arrow-up-right" size={16} /></Button></li>)}</ul>}
    <details className="location-coordinates"><summary>Enter coordinates manually</summary><form onSubmit={event => {
      event.preventDefault()
      run('save', isCurrent => save({ latitude: Number(coordinates.latitude), longitude: Number(coordinates.longitude) }, isCurrent))
    }}>
      <label>Latitude<Input required type="number" min="-90" max="90" step="any" disabled={Boolean(busy)} value={coordinates.latitude} onChange={event => setCoordinates({ ...coordinates, latitude: event.target.value })} /></label>
      <label>Longitude<Input required type="number" min="-180" max="180" step="any" disabled={Boolean(busy)} value={coordinates.longitude} onChange={event => setCoordinates({ ...coordinates, longitude: event.target.value })} /></label>
      <Button variant="primary" type="submit" loading={busy === 'save'} disabled={Boolean(busy)}>Save location</Button>
    </form></details>
    {error && <StateView role="alert">{error}</StateView>}
    {saved && <StateView role="status">{saved}</StateView>}
  </div>
}
