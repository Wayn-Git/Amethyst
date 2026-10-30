import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import design from '../../../../widgets/glance.next-event/design.json'
import template from '../../../../widgets/glance.next-event/template.txt?raw'
import { variationNumber } from '../widgetVariations.js'
import './next-event/next-event.css'

function themePalette(theme) {
  return Object.fromEntries(
    Object.entries(design.palette).map(([key, value]) => [key, typeof value === 'object' ? value[theme] || value.light : value]),
  )
}

function adaptNextEvent(data, layout, theme) {
  const events = Array.isArray(data?.events) ? data.events : []
  const live = Array.isArray(data?.items) ? data.items[0] : null
  const event = live && typeof live.start === 'string' ? live : null
  const timezone = typeof data?.timezone === 'string' ? data.timezone : ''

  return {
    layout,
    colorMode: theme,
    layouts: design.layouts,
    palette: themePalette(theme),
    labels: design.labels,
    calendar: {
      liveEvent: event ? {
        title: event.title || '',
        start: event.start,
        end: event.end || '',
        timeZone: timezone,
        location: event.location || '',
        meetingUrl: '',
      } : { title: '', start: '', end: '', timeZone: timezone, location: '', meetingUrl: '' },
      upcomingEvents: events.filter(item => item && item.id !== event?.id && typeof item.start === 'string').map(item => ({
        title: item.title || '',
        start: item.start,
        timeZone: timezone,
      })),
    },
  }
}

export default function NextEventGlance({ data, onAction, size = 's', full = false, design }) {
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
  const widgetData = useMemo(() => adaptNextEvent(data, layout, theme), [data, layout, theme])

  return (
    <div className="glance-next-event-root" data-variation={variationNumber(design)}>
      <WidgetRenderer template={template} data={widgetData} theme={theme} onAction={onAction} />
    </div>
  )
}
