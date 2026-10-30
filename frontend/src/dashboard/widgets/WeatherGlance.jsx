import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import design from '../../../../widgets/glance.weather/design.json'
import LocationSettings from './LocationSettings.jsx'
import template from '../../../../widgets/glance.weather/template.txt?raw'
import { variationNumber } from '../widgetVariations.js'
import './weather/weather.css'

const CONDITIONS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

function iconFor(code, isDay = true) {
  if (!Number.isInteger(code)) return null
  if (code === 0) return isDay ? 'sun' : 'moon'
  if (code === 1 || code === 2) return isDay ? 'cloud-sun' : 'cloud-moon'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'cloud'
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'cloud-rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'cloud-snow'
  if ([95, 96, 99].includes(code)) return 'bolt'
  return null
}

function temperature(value) {
  return Number.isFinite(value) ? `${Math.round(value)}°` : null
}

function timeLabel(value, timezone) {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      timeZone: timezone || undefined,
    }).format(date)
  } catch {
    return null
  }
}

function dayLabel(value, timezone) {
  if (typeof value !== 'string' || !value) return null
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      timeZone: timezone || undefined,
    }).format(date)
  } catch {
    return null
  }
}

function adaptWeather(data, layout, theme) {
  const colors = Object.fromEntries(
    Object.entries(design.colors).map(([key, value]) => [key, value[theme] || value.light]),
  )
  const timezone = typeof data?.timezone === 'string' ? data.timezone : undefined
  const hourly = Array.isArray(data?.hours) ? data.hours.slice(0, 5) : []
  const daily = Array.isArray(data?.daily) ? data.daily.slice(0, 5) : []

  return {
    layout,
    layouts: design.layouts,
    colors,
    labels: {
      ...design.labels,
      dataNote: 'Forecast data is unavailable.',
    },
    weatherIcons: design.weatherIcons,
    weather: {
      location: data?.location_name || null,
      current: {
        temperatureLabel: temperature(data?.temperature),
        condition: CONDITIONS[data?.weather_code] || null,
        humidityLabel: Number.isFinite(data?.humidity) ? `${Math.round(data.humidity)}%` : null,
        icon: iconFor(data?.weather_code, data?.is_day !== 0),
      },
      hourly: hourly.map(hour => ({
        timeLabel: timeLabel(hour.time, timezone),
        temperatureLabel: temperature(hour.temperature),
        icon: iconFor(hour.weather_code, data?.is_day !== 0),
      })),
      daily: daily.map(day => ({
        dayLabel: dayLabel(day.date, timezone),
        lowLabel: temperature(day.temperature_min),
        highLabel: temperature(day.temperature_max),
        icon: iconFor(day.weather_code),
      })),
    },
  }
}

export default function WeatherGlance({ data, onAction, size = 's', full = false, design: selectedDesign }) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  const layout = full || size === 'l' ? 'large' : size === 'm' ? 'medium' : 'small'
  const widgetData = useMemo(() => adaptWeather(data, layout, theme), [data, layout, theme])

  return (
    <div className="glance-weather-root" data-variation={variationNumber(selectedDesign)}>
      <WidgetRenderer template={template} data={widgetData} theme={theme} onAction={onAction} />
      {full && <LocationSettings active />}
    </div>
  )
}
