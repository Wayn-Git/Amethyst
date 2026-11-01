import { useMemo, useState, useEffect } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import template from '../../../../widgets/glance.next-event/template.txt?raw'

const DEFAULT_LABELS = {
  title: 'Next event',
  loading: 'Loading',
  refreshing: 'Refreshing',
  noEvents: 'No upcoming events',
  notConnected: 'Connect Calendar in settings',
  unavailable: 'Calendar unavailable',
  notAvailable: 'Not available',
}

function adaptNextEvent(data, now) {
  if (!data) {
    const payload = {
      status: 'loading',
      labels: DEFAULT_LABELS,
    }
    payload.data = payload
    return payload
  }

  const items = Array.isArray(data.items) ? data.items : []
  const event = items[0]

  if (!event) {
    const payload = {
      status: 'empty',
      labels: DEFAULT_LABELS,
    }
    payload.data = payload
    return payload
  }

  const zone = data.timezone ? { timeZone: data.timezone } : {}
  const start = new Date(event.start || NaN)
  const end = new Date(event.end || NaN)
  const validStart = Number.isFinite(start.getTime())
  const validEnd = Number.isFinite(end.getTime())
  const diffMinutes = validStart ? Math.ceil((start.getTime() - now) / 60000) : 0
  const ended = validEnd && end.getTime() <= now

  let countdown
  if (ended) {
    countdown = 'Ended'
  } else if (event.all_day) {
    countdown = 'All day'
  } else if (!validStart) {
    countdown = 'Start time unavailable'
  } else if (diffMinutes <= 0) {
    countdown = 'Now'
  } else if (diffMinutes < 60) {
    countdown = `in ${diffMinutes}m`
  } else if (diffMinutes < 1440) {
    const hrs = Math.floor(diffMinutes / 60)
    const mins = diffMinutes % 60
    countdown = mins > 0 ? `in ${hrs}h ${mins}m` : `in ${hrs}h`
  } else {
    const days = Math.round(diffMinutes / 1440)
    countdown = `in ${days}d`
  }

  let eventTime
  if (event.all_day) {
    eventTime = 'All day'
  } else if (validStart) {
    const startTimeStr = start.toLocaleTimeString([], { ...zone, hour: 'numeric', minute: '2-digit' })
    if (validEnd) {
      const endTimeStr = end.toLocaleTimeString([], { ...zone, hour: 'numeric', minute: '2-digit' })
      eventTime = `${startTimeStr} – ${endTimeStr}`
    } else {
      eventTime = startTimeStr
    }
  }

  let dateLabel = 'Today'
  if (validStart) {
    const startDateStr = start.toLocaleDateString([], { ...zone, year: 'numeric', month: 'numeric', day: 'numeric' })
    const nowDateStr = new Date(now).toLocaleDateString([], { ...zone, year: 'numeric', month: 'numeric', day: 'numeric' })
    if (startDateStr !== nowDateStr) {
      dateLabel = start.toLocaleDateString([], { ...zone, weekday: 'short', month: 'short', day: 'numeric' })
    }
  }

  const payload = {
    status: data.refreshing ? 'refreshing' : 'ready',
    message: data.message || '',
    lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    countdown,
    eventTitle: event.title || 'Untitled event',
    eventTime,
    location: event.location || 'No location',
    date: dateLabel,
    labels: DEFAULT_LABELS,
  }
  payload.data = payload
  return payload
}

export default function NextEventGlance({ data, onAction }) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  )
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])

  const widgetData = useMemo(() => adaptNextEvent(data, now), [data, now])

  return (
    <div className="glance-next-event-root">
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={onAction}
      />
    </div>
  )
}
