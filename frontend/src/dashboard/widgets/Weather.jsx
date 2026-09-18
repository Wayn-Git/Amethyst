import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { Stat, Chip, Sparkline } from '../../components/ui/bento/index.jsx'
import LocationSettings from './LocationSettings.jsx'

export function WeatherFace({ data }) {
  const temperatures = data?.hours?.map(hour => hour.temperature)
  return <div className="pilot-weather"><div className="weather-reading"><div key={data?.temperature} className="pilot-number"><Stat value={Number.isFinite(data?.temperature) ? data.temperature : 'Unavailable'} unit={Number.isFinite(data?.temperature) ? '°C' : undefined} label={data?.timezone?.replaceAll('_', ' ') || 'Temperature'} /></div>{temperatures?.length > 1 && temperatures.every(Number.isFinite) && <div className="weather-forecast"><Sparkline values={temperatures} label="Hourly temperature °C" /><span className="adoption-label">Hourly forecast</span></div>}</div>{data?.rain_alert && <Chip>Rain likely · next 12 hours</Chip>}</div>
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

export default function Weather({ data, widgetId, full = false }) {
  const [locationOpen, setLocationOpen] = useState(full)
  const showLocation = locationOpen || Boolean(data?.set_location)
  return <div className="adoption-stack">
    {data?.set_location && <StateView role="status">Choose your location</StateView>}
    {!data?.set_location && data && (['glance.air', 'glance.sun'].includes(widgetId)
      ? <EnvironmentFace data={data} widgetId={widgetId} />
      : <><WeatherFace data={data} /><details><summary>Hourly forecast</summary><ul className="widget-list">{data.hours?.map(h => <WidgetRow key={h.time}>{h.time} · {h.temperature ?? 'Unknown'} °C · Rain {h.rain ?? 'unknown'}%</WidgetRow>)}</ul></details></>)}
    <details open={showLocation} onToggle={event => setLocationOpen(event.currentTarget.open)}><summary>Location settings</summary>{showLocation && <LocationSettings />}</details>
    <details className="adoption-source"><summary>Weather data and attribution</summary><p>{widgetId === 'glance.air' && <><a href="https://ads.atmosphere.copernicus.eu/">CAMS ENSEMBLE data</a> · </>}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a> · <a href="https://open-meteo.com/en/terms">Free API: non-commercial use</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p></details>
  </div>
}
