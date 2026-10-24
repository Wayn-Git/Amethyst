import { useEffect, useState } from 'react'
import { request } from '../api.js'

export default function Weather({ data, refresh, widgetId }) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; request('/widgets/glance.weather/settings').then(v => { if (live) { setLatitude(v.latitude ?? ''); setLongitude(v.longitude ?? '') } }).catch(e => { if (live) setError(e.message) }); return () => { live = false } }, [])
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try { await request('/widgets/glance.weather/settings', 'PUT', { latitude: Number(latitude), longitude: Number(longitude) }); await refresh() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div>{data?.set_location && <p role="status">Set location</p>}<details open={data?.set_location}><summary>Location settings</summary><form onSubmit={save}><label>Latitude<input required type="number" min="-90" max="90" step="any" value={latitude} onChange={e => setLatitude(e.target.value)} /></label><label>Longitude<input required type="number" min="-180" max="180" step="any" value={longitude} onChange={e => setLongitude(e.target.value)} /></label><button disabled={busy}>Save location</button></form></details>{error && <p role="alert">{error}</p>}{!data?.set_location && data && <>{widgetId === 'glance.sun' ? <p>Sunrise: {data.sunrise || 'Unavailable'} · Sunset: {data.sunset || 'Unavailable'} · {data.timezone}</p> : <><p>{data.temperature ?? 'Unavailable'} °C · {data.timezone}</p>{data.rain_alert && <p role="status">Rain likely in the next 12 hours (50% or higher).</p>}<ul>{data.hours?.map(h => <li key={h.time}>{h.time} · {h.temperature ?? 'Unknown'} °C · Rain {h.rain ?? 'unknown'}%</li>)}</ul></>}</>}<p><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a> · <a href="https://open-meteo.com/en/terms">Free API: non-commercial use</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p></div>
}
