import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '../../components/ui/bento/index.jsx'
import Icon from '../../components/Icon.jsx'
import { request } from '../api.js'
import { deviceLocation, validCoordinates } from '../location.js'
import { StateView } from '../primitives.jsx'

export default function LocationSettings() {
  const [coordinates, setCoordinates] = useState({ latitude: '', longitude: '' })
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState(null)
  const [busy, setBusy] = useState('loading')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const live = useRef(false)
  useEffect(() => {
    let active = true
    live.current = true
    request('/widgets/glance.weather/settings').then(value => {
      if (active) setCoordinates({ latitude: value.latitude ?? '', longitude: value.longitude ?? '' })
    }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy('') })
    return () => { active = false; live.current = false }
  }, [])

  async function save(value) {
    if (!validCoordinates(value)) throw new Error('Enter valid latitude and longitude coordinates.')
    await request('/widgets/glance.weather/settings', 'PUT', value)
    // All three cards share this setting, including any open detail view.
    window.dispatchEvent(new Event('dashboard-location-changed'))
    if (live.current) {
      setCoordinates(value)
      setMatches(null)
      setSaved('Location saved for Weather, Air quality, and Sunrise and sunset.')
    }
  }
  async function run(action, operation) {
    setBusy(action); setError(''); setSaved('')
    try { await operation() }
    catch (err) { if (live.current) setError(err.message) }
    finally { if (live.current) setBusy('') }
  }

  return <div className="location-settings adoption-stack" aria-busy={Boolean(busy)}>
    <p className="adoption-label">One location for weather, air quality, and sunrise/sunset. City searches and saved coordinates are sent to Open-Meteo.</p>
    <Button variant="primary" disabled={Boolean(busy)} loading={busy === 'device'} onClick={() => run('device', async () => {
      const value = await deviceLocation()
      if (live.current) await save(value)
    })}><Icon name="target" size={18} />{busy === 'device' ? 'Finding your location…' : 'Use device location'}</Button>
    <form className="location-search" onSubmit={event => {
      event.preventDefault()
      run('search', async () => {
        const value = await request(`/today/locations?q=${encodeURIComponent(query.trim())}`)
        if (live.current) setMatches(value.items || [])
      })
    }}>
      <label>City<Input type="search" required minLength={2} maxLength={100} placeholder="Search your city" value={query} disabled={Boolean(busy)} onChange={event => { setQuery(event.target.value); setMatches(null) }} /></label>
      <Button type="submit" loading={busy === 'search'} disabled={Boolean(busy) || query.trim().length < 2}>Find city</Button>
    </form>
    {matches?.length === 0 && <StateView role="status">No cities found. Try another spelling.</StateView>}
    {matches?.length > 0 && <ul className="location-results" aria-label="City search results">{matches.map((match, index) => <li key={`${match.latitude}:${match.longitude}:${index}`}><Button disabled={Boolean(busy)} onClick={() => run('save', () => save({ latitude: match.latitude, longitude: match.longitude }))}>{match.name}<Icon name="arrow-up-right" size={16} /></Button></li>)}</ul>}
    <details className="location-coordinates"><summary>Enter coordinates manually</summary><form onSubmit={event => {
      event.preventDefault()
      run('save', () => save({ latitude: Number(coordinates.latitude), longitude: Number(coordinates.longitude) }))
    }}>
      <label>Latitude<Input required type="number" min="-90" max="90" step="any" disabled={Boolean(busy)} value={coordinates.latitude} onChange={event => setCoordinates({ ...coordinates, latitude: event.target.value })} /></label>
      <label>Longitude<Input required type="number" min="-180" max="180" step="any" disabled={Boolean(busy)} value={coordinates.longitude} onChange={event => setCoordinates({ ...coordinates, longitude: event.target.value })} /></label>
      <Button variant="primary" type="submit" loading={busy === 'save'} disabled={Boolean(busy)}>Save location</Button>
    </form></details>
    {error && <StateView role="alert">{error}</StateView>}
    {saved && <StateView role="status">{saved}</StateView>}
  </div>
}
