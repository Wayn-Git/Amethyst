import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import LocationSettings from './LocationSettings.jsx'
import template from '../../../../widgets/glance.weather/template.txt?raw'

const DEFAULT_LABELS = {
  title: 'Weather',
  forecast: 'Hourly forecast',
  loading: 'Loading',
  refreshing: 'Refreshing',
  locationUnset: 'Location unset in settings',
  unavailable: 'Weather data unavailable',
  notAvailable: 'Not available',
  updated: 'Updated',
  offlineUpdated: 'Offline, updated',
}

const WMO_CONDITIONS = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Moderate showers',
  82: 'Violent showers',
  95: 'Thunderstorm',
}

function adaptWeather(data) {
  if (!data) {
    const res = {
      status: 'loading',
      labels: DEFAULT_LABELS,
      hours: [],
    }
    res.data = res
    return res
  }

  if (data.set_location) {
    const res = {
      status: 'empty',
      labels: DEFAULT_LABELS,
      hours: [],
    }
    res.data = res
    return res
  }

  const location = data.timezone ? data.timezone.split('/').pop().replace('_', ' ') : undefined
  const condition = WMO_CONDITIONS[data.weather_code] || (Number.isFinite(data.weather_code) ? `Code ${data.weather_code}` : undefined)
  const temperature = Number.isFinite(data.temperature) ? `${Math.round(data.temperature)}°` : undefined
  const feelsLike = Number.isFinite(data.feels_like) ? `Feels like ${Math.round(data.feels_like)}°` : undefined
  const wind = Number.isFinite(data.wind_speed) ? `${Math.round(data.wind_speed)} km/h` : undefined
  const rainAlert = data.rain_alert ? 'Rain likely · next 12 hours' : ''

  const hours = Array.isArray(data.hours)
    ? data.hours.slice(0, 4).map(h => {
        const timeMatch = typeof h.time === 'string' && h.time.match(/T([0-9]{2}:[0-9]{2})/)
        return {
          time: timeMatch ? timeMatch[1] : h.time,
          temp: Number.isFinite(h.temperature) ? `${Math.round(h.temperature)}°` : '—',
          rain: Number.isFinite(h.rain) ? `${h.rain}%` : '0%',
        }
      })
    : []

  const lastUpdated = hours[0]?.time || (typeof data.time === 'string' ? data.time.replace('T', ' ') : undefined)

  const payload = {
    status: data.refreshing ? 'refreshing' : 'ready',
    message: data.message || '',
    lastUpdated,
    temperature,
    condition,
    location,
    feelsLike,
    wind,
    rainAlert,
    hours,
    labels: DEFAULT_LABELS,
  }
  // Allow template to access fields either top-level or via data.*
  payload.data = payload
  return payload
}

export default function WeatherGlance({ data, onAction, full = false }) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )

  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  const widgetData = useMemo(() => adaptWeather(data), [data])

  return (
    <div className="glance-weather-root">
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={onAction}
      />
      {full && (
        <div style={{ marginTop: '16px' }}>
          <LocationSettings active={full} />
        </div>
      )}
    </div>
  )
}
