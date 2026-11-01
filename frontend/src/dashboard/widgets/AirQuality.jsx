import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/glance.air/template.txt?raw'

const DEFAULT_LABELS = {
  title: 'Air quality',
  pm25Label: 'PM2.5',
  pm10Label: 'PM10',
  aqiLabel: 'European AQI',
  loading: 'Loading',
  refreshing: 'Refreshing',
  locationUnset: 'Location unset in settings',
  unavailable: 'Air quality unavailable',
  notAvailable: 'Not available',
  updatedPrefix: 'Updated ',
  offlinePrefix: 'Offline, updated ',
  refreshingPrefix: 'Refreshing · Updated ',
}

function aqiCategory(aqi) {
  if (typeof aqi !== 'number' || Number.isNaN(aqi)) return 'Not available'
  if (aqi <= 20) return 'Good'
  if (aqi <= 40) return 'Fair'
  if (aqi <= 60) return 'Moderate'
  if (aqi <= 80) return 'Poor'
  return 'Very Poor'
}

function adaptAirQuality(data) {
  if (!data) {
    return {
      status: 'loading',
      labels: DEFAULT_LABELS,
    }
  }

  if (data.set_location) {
    return {
      status: 'empty',
      labels: DEFAULT_LABELS,
    }
  }

  const timeMatch = typeof data.time === 'string' && data.time.match(/T([0-9]{2}:[0-9]{2})/)
  const time = timeMatch ? timeMatch[1] : (data.time || undefined)

  const aqiNum = typeof data.european_aqi === 'number' ? data.european_aqi : null
  const pm25Num = typeof data.pm2_5 === 'number' ? data.pm2_5 : null
  const pm10Num = typeof data.pm10 === 'number' ? data.pm10 : null

  return {
    status: data.refreshing ? 'refreshing' : 'ready',
    message: data.message || '',
    lastUpdated: time,
    aqi: aqiNum !== null ? String(aqiNum) : undefined,
    category: aqiNum !== null ? aqiCategory(aqiNum) : undefined,
    pm2_5: pm25Num !== null ? `${pm25Num} µg/m³` : undefined,
    pm10: pm10Num !== null ? `${pm10Num} µg/m³` : undefined,
    labels: DEFAULT_LABELS,
  }
}

export default function AirQuality({ data, onAction }) {
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

  const widgetData = useMemo(() => adaptAirQuality(data), [data])

  return (
    <div className="glance-air-root">
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={onAction}
      />
    </div>
  )
}
