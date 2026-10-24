import { useEffect, useState } from 'react'

export default function NextEvent({ data }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const event = data?.items?.[0]
  if (!event) return null
  const minutes = Math.ceil((new Date(event.start).getTime() - now) / 60000)
  return <div><strong>{event.title}</strong><p>{minutes > 0 ? `In ${minutes} minutes` : 'Starting now'} · {new Date(event.start).toLocaleString([], { timeZone: data.timezone })}{event.all_day ? ' · All day' : ''}</p><p>Primary calendar · current week{data.limited ? ' · Calendar results limited' : ''}</p></div>
}
