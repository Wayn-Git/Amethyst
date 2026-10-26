import { useEffect, useState } from 'react'
import { Stat, Chip } from '../../components/ui/bento/index.jsx'

export default function NextEvent({ data }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const event = data?.items?.[0]
  if (!event) return null
  const minutes = Math.ceil((new Date(event.start).getTime() - now) / 60000)
  return <div className="adoption-stack adoption-event">{event.all_day ? <Chip>All day</Chip> : Number.isFinite(minutes) ? <Stat value={Math.max(0, minutes)} unit="min" label={minutes > 0 ? 'Until next event' : 'Starting now'} /> : <p>Start time unavailable</p>}<strong>{event.title}</strong>{Number.isFinite(minutes) && <time className="adoption-label" dateTime={event.start}>{new Date(event.start).toLocaleString([], { timeZone: data.timezone })}</time>}<p className="adoption-label">Primary calendar · current week{data.limited ? ' · Calendar results limited' : ''}</p></div>
}
