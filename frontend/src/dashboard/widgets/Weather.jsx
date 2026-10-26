import { WidgetRow, StateView } from '../primitives.jsx'
import { useEffect, useState } from 'react'
import { request } from '../api.js'
import { Stat, Chip, Input, Button, Sparkline } from '../../components/ui/bento/index.jsx'

export function WeatherFace({ data }) {
  return <div className="pilot-weather"><div key={data?.temperature} className="pilot-number"><Stat value={Number.isFinite(data?.temperature) ? data.temperature : 'Unavailable'} unit={Number.isFinite(data?.temperature) ? '°C' : undefined} label={data?.timezone?.replaceAll('_', ' ') || 'Temperature'} /></div>{data?.rain_alert && <Chip>Rain likely · next 12 hours</Chip>}</div>
}

function SunTime({ value, label }) {
  // Open-Meteo supplies local wall time; parsing it as a Date would shift zones.
  const time = typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)/)
  return <div><span className="adoption-label">{label}</span><div className="adoption-time">{time ? <time dateTime={value}>{time[1]}:{time[2]}</time> : 'Unavailable'}</div></div>
}

export function EnvironmentFace({ data, widgetId }) {
  if (widgetId === 'glance.sun') return <><div className="ui-split adoption-sun"><SunTime value={data?.sunrise} label="Sunrise" /><SunTime value={data?.sunset} label="Sunset" /></div><p className="adoption-label">{data?.timezone}</p></>
  return <div className="adoption-air"><Stat value={Number.isFinite(data?.european_aqi) ? data.european_aqi : 'Unavailable'} label="European AQI" /><div className="ui-split adoption-particles">{[['pm2_5', 'PM2.5'], ['pm10', 'PM10']].map(([key, label]) => <div key={key}><span className="adoption-label">{label}</span><p><strong>{Number.isFinite(data?.[key]) ? data[key] : 'Unavailable'}</strong>{Number.isFinite(data?.[key]) && <small> µg/m³</small>}</p></div>)}</div>{data?.time && <time className="adoption-label" dateTime={data.time}>{data.time.replace('T', ' · ')}</time>}</div>
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
  return <div className="adoption-stack">{data?.set_location && <StateView role="status">Set location</StateView>}{error && <StateView role="alert">{error}</StateView>}{!data?.set_location && data && <>{['glance.air', 'glance.sun'].includes(widgetId) ? <EnvironmentFace data={data} widgetId={widgetId} /> : <><WeatherFace data={data} />{data.hours?.length > 1 && data.hours.every(h => Number.isFinite(h.temperature)) && <Sparkline values={data.hours.map(h => h.temperature)} label="Hourly temperature °C" />}<details><summary>Hourly forecast</summary><ul className="widget-list">{data.hours?.map(h => <WidgetRow key={h.time}>{h.time} · {h.temperature ?? 'Unknown'} °C · Rain {h.rain ?? 'unknown'}%</WidgetRow>)}</ul></details></>}</>}<details open={data?.set_location}><summary>Location settings</summary><form onSubmit={save}><label>Latitude<Input required type="number" min="-90" max="90" step="any" value={latitude} onChange={e => setLatitude(e.target.value)} /></label><label>Longitude<Input required type="number" min="-180" max="180" step="any" value={longitude} onChange={e => setLongitude(e.target.value)} /></label><Button variant="primary" type="submit" loading={busy}>Save location</Button></form></details><details className="adoption-source"><summary>Weather data and attribution</summary><p>{widgetId === 'glance.air' && <><a href="https://ads.atmosphere.copernicus.eu/">CAMS ENSEMBLE data</a> · </>}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a> · <a href="https://open-meteo.com/en/terms">Free API: non-commercial use</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p></details></div>
}
