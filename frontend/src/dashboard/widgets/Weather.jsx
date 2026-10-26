import { WidgetRow, StateView } from '../primitives.jsx'
import { useEffect, useState } from 'react'
import { request } from '../api.js'
import { Stat, Chip, Input, Button, Sparkline } from '../../components/ui/bento/index.jsx'

export function WeatherFace({ data }) {
  return <div className="pilot-weather"><div key={data?.temperature} className="pilot-number"><Stat value={Number.isFinite(data?.temperature) ? data.temperature : 'Unavailable'} unit={Number.isFinite(data?.temperature) ? '°C' : undefined} label={data?.timezone?.replaceAll('_', ' ') || 'Temperature'} /></div>{data?.rain_alert && <Chip>Rain likely · next 12 hours</Chip>}</div>
}

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
  return <div>{data?.set_location && <StateView role="status">Set location</StateView>}<details open={data?.set_location}><summary>Location settings</summary><form onSubmit={save}><label>Latitude<Input required type="number" min="-90" max="90" step="any" value={latitude} onChange={e => setLatitude(e.target.value)} /></label><label>Longitude<Input required type="number" min="-180" max="180" step="any" value={longitude} onChange={e => setLongitude(e.target.value)} /></label><Button variant="primary" type="submit" loading={busy}>Save location</Button></form></details>{error && <StateView role="alert">{error}</StateView>}{!data?.set_location && data && <>{widgetId === 'glance.air' ? <p>European AQI: {data.european_aqi ?? 'Unavailable'} · PM2.5: {data.pm2_5 ?? 'Unavailable'} µg/m³ · PM10: {data.pm10 ?? 'Unavailable'} µg/m³ · {data.time}</p> : widgetId === 'glance.sun' ? <p>Sunrise: {data.sunrise || 'Unavailable'} · Sunset: {data.sunset || 'Unavailable'} · {data.timezone}</p> : <><WeatherFace data={data} />{data.hours?.length > 1 && data.hours.every(h => Number.isFinite(h.temperature)) && <Sparkline values={data.hours.map(h => h.temperature)} label="Hourly temperature °C" />}<ul>{data.hours?.map(h => <WidgetRow key={h.time}>{h.time} · {h.temperature ?? 'Unknown'} °C · Rain {h.rain ?? 'unknown'}%</WidgetRow>)}</ul></>}</>}<p>{widgetId === 'glance.air' && <><a href="https://ads.atmosphere.copernicus.eu/">CAMS ENSEMBLE data</a> · </>}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a> · <a href="https://open-meteo.com/en/terms">Free API: non-commercial use</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p></div>
}
