import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import design from '../../../../widgets/glance.air/design.json'
import LocationSettings from './LocationSettings.jsx'
import template from '../../../../widgets/glance.air/template.txt?raw'
import { variationNumber } from '../widgetVariations.js'
import './air/air.css'

function palette(value, theme) {
  if (!value || typeof value !== 'object') return value
  return value[theme] || value.light || null
}

function adaptAirQuality(data, layout, theme) {
  const bands = design.bands.map(band => ({ ...band, color: palette(band.color, theme) }))
  const pollutants = design.pollutants.map(item => {
    const value = {
      pm10: data?.pm10,
      co: data?.carbon_monoxide,
      no2: data?.nitrogen_dioxide,
      o3: data?.ozone,
    }[item.id]
    return {
      id: item.id,
      label: item.label,
      value: Number.isFinite(value) ? Number(value.toFixed(1)) : null,
      unit: Number.isFinite(value) ? 'μg/m³' : null,
    }
  })
  const pm25 = Number.isFinite(data?.pm2_5) ? Number(data.pm2_5.toFixed(1)) : null

  return {
    layout,
    layouts: design.layouts,
    labels: design.labels,
    surfaces: Object.fromEntries(
      Object.entries(design.surfaces).map(([key, value]) => [key, palette(value, theme)]),
    ),
    bands,
    current: {
      location: data?.location_name || null,
      usAqi: Number.isFinite(data?.us_aqi) ? data.us_aqi : null,
      euAqi: Number.isFinite(data?.european_aqi) ? data.european_aqi : null,
      observationTime: typeof data?.time === 'string' ? data.time : null,
      pm25: { value: pm25, unit: pm25 === null ? null : 'μg/m³' },
    },
    pollutants,
  }
}

export default function AirQuality({ data, size = 's', full = false, onAction, design }) {
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
  const widgetData = useMemo(() => adaptAirQuality(data, layout, theme), [data, layout, theme])

  return (
    <div className="glance-air-root" data-variation={variationNumber(design)}>
      <WidgetRenderer template={template} data={widgetData} theme={theme} onAction={onAction} />
      {full && <LocationSettings active />}
    </div>
  )
}
