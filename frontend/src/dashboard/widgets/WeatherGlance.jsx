import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
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
  if (!Number.isInteger(code)) return 'sun'
  if (code === 0) return isDay ? 'sun' : 'moon'
  if (code === 1 || code === 2) return isDay ? 'cloud-sun' : 'cloud-moon'
  if (code === 3 || code === 45 || code === 48) return 'cloud'
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'cloud-rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'cloud-snow'
  if ([95, 96, 99].includes(code)) return 'bolt'
  return 'sun'
}

const IMAGES = {
  air: 'https://images.unsplash.com/photo-1746210039445-15adaf931d49?auto=format&fit=crop&fm=jpg&ixid=M3wxMjA3fDB8MHxzZWFyY2h8M3x8JUVCJUIwJTk0JUVCJTlFJThDJUVDJTlEJUI0JTIwJUVCJUI2JTgwJUVCJThBJTk0JTIwJUVEJTk1JTk4JUVCJThBJTk4fGVufDB8fDB8fHww&ixlib=rb-4.1.0&q=60&w=3000',
  coast: 'https://www.manfred-koch-fotografie.de/fotos/meerhimmelland_max/B3_51.jpg',
  alpine: 'https://i.falstaff.com/storage/2026/04/Courmayeur-Mont-Blanc_summer_ph-Giacomo-Buzio_19.jpg?aspect_ratio=4%3A3&crop_gravity=center&width=800',
  dusk: 'https://img.goodfon.com/original/8192x3190/0/fb/gory-siluety-oblaka-nebo-sumerki-zakat-panorama-multi-monito.jpg',
  sunrise: 'https://images.squarespace-cdn.com/content/v1/65578509a6d57e5fdb931eba/ca6c9909-5d41-43f0-a4f9-10daedb13cd5/DSC08570_Toskansko_Mist%27s%2BGoblet_web.jpg',
  storm: 'https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=1200&q=80',
}

const DESIGNS_BY_INDEX = ['air', 'coast', 'alpine', 'dusk', 'sunrise', 'storm']

function resolveActiveDesign(size, selectedDesign) {
  const s = String(selectedDesign || '')
  if (DESIGNS_BY_INDEX.includes(s)) return s
  const num = variationNumber(s)
  if (num >= 1 && num <= 6) return DESIGNS_BY_INDEX[num - 1]
  return size === 's' ? 'air' : size === 'm' ? 'alpine' : 'sunrise'
}

function formatHour(timeStr, index, timezone) {
  if (index === 0) return 'Now'
  if (!timeStr) return ''
  const d = new Date(timeStr)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: timezone || undefined }).format(d)
  } catch {
    return `${d.getHours()}`
  }
}

function formatTime(isoStr, timezone) {
  if (!isoStr) return '--:--'
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return isoStr.slice(11, 16) || isoStr
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone || undefined,
    }).format(d)
  } catch {
    return isoStr.slice(11, 16) || isoStr
  }
}

function uvRating(uv) {
  if (!Number.isFinite(uv)) return 'Low'
  if (uv < 3) return 'Low'
  if (uv < 6) return 'Moderate'
  if (uv < 8) return 'High'
  if (uv < 11) return 'Very High'
  return 'Extreme'
}

function adaptWeather(data, size, selectedDesign) {
  const activeDesign = resolveActiveDesign(size, selectedDesign)
  const timezone = typeof data?.timezone === 'string' ? data.timezone : undefined

  const place = data?.location_name || (data?.set_location ? 'Set Location' : 'Local')
  const hasTemp = Number.isFinite(data?.temperature)
  const temperature = hasTemp ? Math.round(data.temperature) : '--'
  const condition = (data?.weather_code != null && CONDITIONS[data.weather_code]) || (data?.set_location ? 'Configure location in settings' : 'Clear sky')
  const icon = iconFor(data?.weather_code, data?.is_day !== 0)

  const todayDaily = Array.isArray(data?.daily) && data.daily[0]
  const high = Number.isFinite(todayDaily?.temperature_max) ? Math.round(todayDaily.temperature_max) : temperature
  const low = Number.isFinite(todayDaily?.temperature_min) ? Math.round(todayDaily.temperature_min) : '--'
  const range = `H:${high}°  L:${low}°`

  const hourCount = activeDesign === 'dusk' ? 5 : 6
  const rawHours = Array.isArray(data?.hours) ? data.hours.slice(0, hourCount) : []
  const hours = rawHours.map((h, i) => ({
    time: formatHour(h.time, i, timezone),
    temp: Number.isFinite(h.temperature) ? Math.round(h.temperature) : '--',
    icon: iconFor(h.weather_code, true),
    rain: Number.isFinite(h.rain) ? Math.round(h.rain) : 0,
  }))

  const solar = [
    { label: 'Sunrise', time: formatTime(data?.sunrise, timezone), icon: 'sunrise' },
    { label: 'Sunset', time: formatTime(data?.sunset, timezone), icon: 'sunset' },
  ]

  const precipVal = (data?.precipitation_today ?? data?.precipitation ?? 0)
  const rainTotal = `${Number.isFinite(precipVal) ? precipVal.toFixed(1) : '0.0'} mm`
  const windVal = Number.isFinite(data?.wind_speed) ? `${Math.round(data.wind_speed)} km/h` : '0 km/h'
  const humidityVal = Number.isFinite(data?.humidity) ? `${Math.round(data.humidity)}%` : '--'
  const uvVal = Number.isFinite(data?.uv_index) ? `${Math.round(data.uv_index)} · ${uvRating(data.uv_index)}` : 'Low'

  const metrics = [
    { label: 'Precipitation today', value: rainTotal, icon: 'droplet' },
    { label: 'Wind', value: windVal, icon: 'wind' },
    { label: 'Humidity', value: humidityVal, icon: 'waves' },
    { label: 'UV index', value: uvVal, icon: 'sun' },
  ]

  let summary = `${condition} throughout the day with a high of ${high}° and low of ${low}°.`
  if (precipVal > 0) {
    summary = `Rain expected today with around ${rainTotal} total precipitation.`
  }

  let background = '#10213b'
  if (activeDesign === 'air') {
    background = `linear-gradient(180deg, rgba(19,60,87,.28), rgba(14,50,77,.48)), url('${IMAGES.air}') 50% 45% / cover`
  } else if (activeDesign === 'alpine') {
    background = `linear-gradient(180deg, rgba(10,35,45,.45) 0%, rgba(10,35,45,.08) 35%, rgba(8,29,35,.87) 100%), url('${IMAGES.alpine}') 50% 50% / cover`
  } else if (activeDesign === 'dusk') {
    background = `linear-gradient(120deg, rgba(34,26,58,.58), rgba(38,30,57,.22)), url('${IMAGES.dusk}') 50% 50% / cover`
  } else if (activeDesign === 'storm') {
    background = `linear-gradient(180deg, rgba(10,24,38,.65), rgba(8,18,29,.95)), url('${IMAGES.storm}') 50% 44% / cover`
  }

  const heroBackground = `radial-gradient(ellipse at 77% 10%, rgba(255,213,145,.25), transparent 65%), linear-gradient(180deg, rgba(48,37,22,.12), rgba(42,35,24,.65)), url('${IMAGES.sunrise}') 50% 50% / cover`

  return {
    activeDesign,
    place,
    temperature,
    condition,
    range,
    icon,
    hours,
    solar,
    metrics,
    summary,
    rainTotal,
    background,
    heroBackground,
    images: {
      coast: IMAGES.coast,
    },
    labels: {
      rainToday: 'Rain today',
      rainChance: 'Hourly chance of precipitation',
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

  const widgetData = useMemo(() => adaptWeather(data, size, selectedDesign), [data, size, selectedDesign])

  return (
    <div className="glance-weather-root" data-variation={variationNumber(selectedDesign)}>
      <WidgetRenderer template={template} data={widgetData} theme={theme} onAction={onAction} />
      {full && <LocationSettings active />}
    </div>
  )
}
