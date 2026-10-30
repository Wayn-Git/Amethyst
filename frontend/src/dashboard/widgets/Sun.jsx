import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import LocationSettings from './LocationSettings.jsx'
import design from '../../../../widgets/glance.sun/design.json'
import template from '../../../../widgets/glance.sun/template.txt?raw'
import { variationNumber } from '../widgetVariations.js'
import { useClock } from './clock/helpers.js'
import './sun/sun.css'

function zonedTimestamp(value, timezone) {
  if (typeof value !== 'string' || !timezone) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : null
  }

  const [, year, month, day, hour, minute, second = '0'] = match
  const wallTime = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)
  let timestamp = wallTime
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]))
      const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
      timestamp += wallTime - represented
    }
    return timestamp
  } catch {
    return null
  }
}

function themeColors(theme) {
  return Object.fromEntries(
    Object.entries(design.colors).map(([key, value]) => [key, value[theme] || value.light]),
  )
}

function adaptSun(data, layout, theme, now) {
  let sunrise = zonedTimestamp(data?.sunrise, data?.timezone)
  const sunset = zonedTimestamp(data?.sunset, data?.timezone)
  const nextSunrise = zonedTimestamp(data?.next_sunrise, data?.timezone)
  if (layout === 'small' && sunset !== null && sunset < now.getTime() && nextSunrise !== null && nextSunrise > now.getTime()) {
    sunrise = nextSunrise
  }
  return {
    layout,
    sunrise,
    sunset,
    timezone: typeof data?.timezone === 'string' ? data.timezone : '',
    labels: design.labels,
    colors: themeColors(theme),
  }
}

export default function Sun({ data, onAction, size = 's', full = false, design }) {
  const now = useClock()
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
  const widgetData = useMemo(() => adaptSun(data, layout, theme, now), [data, layout, theme, now])

  return (
    <div className="glance-sun-root" data-variation={variationNumber(design)}>
      <WidgetRenderer template={template} data={widgetData} theme={theme} onAction={onAction} />
      {full && <LocationSettings active />}
    </div>
  )
}
