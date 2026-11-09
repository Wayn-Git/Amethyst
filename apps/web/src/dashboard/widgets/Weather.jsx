import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { Stat, Chip } from '../../components/ui/bento/index.jsx'
import { Drop } from '@phosphor-icons/react'
import LocationSettings from './LocationSettings.jsx'
import LiveWeather from '../../components/wigggle/LiveWeather.jsx'

export function WeatherFace({ data, size = 'm' }) {
  const hours = Array.isArray(data?.hours) ? data.hours.slice(0, size === 's' ? 1 : size === 'l' ? 12 : 6) : []
  return <div className="pilot-weather">
    <div className="weather-reading">
      <div className="pilot-number"><Stat value={Number.isFinite(data?.temperature) ? data.temperature : 'Unavailable'} unit={Number.isFinite(data?.temperature) ? '°' : undefined} label="Current temperature · °C" /></div>
      <p className="weather-location">{data?.timezone?.replaceAll('_', ' ') || 'Location unavailable'}</p>
    </div>
    {hours.length > 0 && <div className="weather-forecast">
      <p className="adoption-label">Hourly forecast <span>Chance of rain</span></p>
      <ol className="weather-hours" aria-label="Hourly temperature and chance of rain">
        {hours.map((hour, index) => <li key={`${hour.time}-${index}`}>
          <time dateTime={hour.time}>{typeof hour.time === 'string' && hour.time.match(/(?:^|T)((?:[01]\d|2[0-3]):[0-5]\d)(?::|$)/)?.[1] || '—'}</time>
          <Drop size={20} aria-hidden="true" />
          <span className="weather-rain" aria-label={Number.isFinite(hour.rain) ? `Chance of rain ${hour.rain}%` : 'Chance of rain unavailable'}>{Number.isFinite(hour.rain) ? `${hour.rain}%` : '—'}</span>
          <strong aria-label={Number.isFinite(hour.temperature) ? `${hour.temperature} degrees Celsius` : 'Temperature unavailable'}>{Number.isFinite(hour.temperature) ? `${hour.temperature}°` : '—'}</strong>
        </li>)}
      </ol>
    </div>}
    {data?.rain_alert && <Chip>Rain likely · next 12 hours</Chip>}
  </div>
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

export default function Weather({ data, widgetId, full = false, design }) {
  const [locationOpen, setLocationOpen] = useState(null)
  const showLocation = (locationOpen ?? full) || Boolean(data?.set_location)
  return <div className="adoption-stack">
    {data?.set_location && <StateView role="status">Choose your location</StateView>}
    {!data?.set_location && data && (['glance.air', 'glance.sun'].includes(widgetId)
      ? <EnvironmentFace data={data} widgetId={widgetId} />
      : <><LiveWeather data={data} design={design} /><details hidden={!full}><summary>Hourly forecast</summary><ul className="widget-list">{data.hours?.map(h => <WidgetRow key={h.time}>{h.time} · {h.temperature ?? 'Unknown'} °C · Rain {h.rain ?? 'unknown'}%</WidgetRow>)}</ul></details></>)}
    <div className="weather-options" hidden={!full && !data?.set_location}><details open={showLocation} onToggle={event => setLocationOpen(event.currentTarget.open)}><summary>Location settings</summary>{(locationOpen !== null || showLocation) && <LocationSettings active={(full || Boolean(data?.set_location)) && showLocation} />}</details>
    <details className="adoption-source"><summary>Weather data and attribution</summary><p>{widgetId === 'glance.air' && <><a href="https://ads.atmosphere.copernicus.eu/">CAMS ENSEMBLE data</a> · </>}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather data by Open-Meteo</a> · <a href="https://open-meteo.com/en/terms">Free API: non-commercial use</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></p></details></div>
  </div>
}
