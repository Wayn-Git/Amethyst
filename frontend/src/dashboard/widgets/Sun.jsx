import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/glance.sun/template.txt?raw'

const DEFAULT_LABELS = {
  title: 'Sun',
  sunrise: 'Sunrise',
  sunset: 'Sunset',
  dayLength: 'Daylight',
  loading: 'Loading',
  refreshing: 'Refreshing',
  locationUnset: 'Location unset in settings',
  unavailable: 'Solar times unavailable',
  notAvailable: 'Not available',
  updatedPrefix: 'Updated ',
  offlineUpdatedPrefix: 'Offline, updated ',
}

function formatWallTime(isoString) {
  if (typeof isoString !== 'string') return undefined
  const match = isoString.match(/T([0-9]{2}):([0-9]{2})/)
  if (!match) return undefined
  let hours = Number.parseInt(match[1], 10)
  const minutes = match[2]
  const ampm = hours >= 12 ? 'PM' : 'AM'
  hours = hours % 12
  if (hours === 0) hours = 12
  return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
}

function calculateDayLength(sunriseIso, sunsetIso) {
  if (typeof sunriseIso !== 'string' || typeof sunsetIso !== 'string') return undefined
  const matchRise = sunriseIso.match(/T([0-9]{2}):([0-9]{2})/)
  const matchSet = sunsetIso.match(/T([0-9]{2}):([0-9]{2})/)
  if (!matchRise || !matchSet) return undefined
  const riseMinutes = Number.parseInt(matchRise[1], 10) * 60 + Number.parseInt(matchRise[2], 10)
  const setMinutes = Number.parseInt(matchSet[1], 10) * 60 + Number.parseInt(matchSet[2], 10)
  let diff = setMinutes - riseMinutes
  if (diff < 0) diff += 24 * 60
  const hours = Math.floor(diff / 60)
  const mins = diff % 60
  return `${hours}h ${mins}m`
}

function adaptSun(data) {
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

  const sunrise = formatWallTime(data.sunrise)
  const sunset = formatWallTime(data.sunset)
  const dayLength = calculateDayLength(data.sunrise, data.sunset)
  const tz = data.timezone ? data.timezone.replace('_', ' ') : undefined

  return {
    status: data.refreshing ? 'refreshing' : 'ready',
    message: data.message || '',
    lastUpdated: sunrise ? sunrise.split(' ')[0] : undefined,
    sunrise,
    sunset,
    dayLength,
    timezone: tz,
    labels: DEFAULT_LABELS,
  }
}

export default function Sun({ data, onAction }) {
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

  const widgetData = useMemo(() => adaptSun(data), [data])

  return (
    <div className="glance-sun-root">
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={onAction}
      />
    </div>
  )
}
