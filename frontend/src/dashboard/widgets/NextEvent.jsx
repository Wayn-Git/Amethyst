import { useEffect, useState } from 'react'
import { Stat, Chip } from '../../components/ui/bento/index.jsx'

export default function NextEvent({ data }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const event = data?.items?.[0]
  if (!event) return <p className="adoption-label" role="status">No upcoming events</p>
  const start = new Date(event.start || NaN)
  const validStart = Number.isFinite(start.getTime())
  const minutes = Math.ceil((start.getTime() - now) / 60000)
  const ended = new Date(event.end || NaN).getTime() <= now
  const zone = { timeZone: data.timezone }
  return <div className="adoption-stack adoption-event">
    {validStart && <div className="event-calendar" aria-label={start.toLocaleDateString([], { ...zone, dateStyle: 'full' })}>
      <span className="event-day" aria-hidden="true">{start.toLocaleDateString([], { ...zone, day: 'numeric' })}</span>
      <div aria-hidden="true"><strong>{start.toLocaleDateString([], { ...zone, weekday: 'long' })}</strong><span>{start.toLocaleDateString([], { ...zone, month: 'long', year: 'numeric' })}</span></div>
    </div>}
    <div className="event-summary">
      <strong>{event.title}</strong>
      {validStart && !event.all_day && <time className="adoption-label" dateTime={event.start}>{start.toLocaleTimeString([], { ...zone, hour: 'numeric', minute: '2-digit' })}</time>}
      {event.location && <p className="adoption-label">{event.location}</p>}
    </div>
    <div className="event-countdown">{ended ? <Chip>Event ended</Chip> : event.all_day ? <Chip>All day</Chip> : validStart ? <Stat value={Math.max(0, minutes)} unit="min" label={start.getTime() > now ? 'Until next event' : 'In progress'} /> : <p>Start time unavailable</p>}</div>
    <p className="adoption-label">Primary calendar · current week{data.limited ? ' · Calendar results limited' : ''}</p>
  </div>
}
