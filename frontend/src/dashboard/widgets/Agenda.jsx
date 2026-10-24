import { useEffect, useState } from 'react'
import { request } from '../api.js'

export default function Agenda({ data, refresh }) {
  const [view, setView] = useState('agenda')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let mounted = true
    request('/widgets/task.agenda/settings').then(value => { if (mounted) setEnabled(value.enabled !== false) }).catch(e => { if (mounted) setError(e.message) })
    return () => { mounted = false }
  }, [])
  async function access(next) {
    setBusy(true); setError('')
    try {
      await request('/widgets/task.agenda/settings', 'PUT', { enabled: next })
      setEnabled(next)
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const zone = data?.timezone || 'UTC'
  const day = value => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
  const time = value => new Date(value).toLocaleString([], { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const items = (data?.items || []).filter(item => view === 'week' || (item.all_day ? day(item.end) > data.today : day(item.end) >= data.today))
  return <div>
    <p>Google Calendar via Composio. Primary calendar, current week. {zone}.</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy} onClick={() => access(!enabled)}>{enabled ? 'Stop calendar access and delete cached data' : 'Enable calendar access'}</button>
    {enabled && <><div className="widget-buttons" aria-label="Calendar view"><button aria-pressed={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button><button aria-pressed={view === 'week'} onClick={() => setView('week')}>Week</button></div>
      {data?.limited && <p role="status">Showing up to 100 events. More events may exist.</p>}
      {data?.items?.length > 0 && items.length === 0 && <p>No upcoming events this week.</p>}
      <ul className="widget-list">{items.map(item => <li key={item.id}><div><strong>{item.title}</strong><p>{item.all_day ? `All day · ${day(item.start)} (end ${day(item.end)}, exclusive)` : `${time(item.start)} – ${time(item.end)}`}</p></div></li>)}</ul></>}
  </div>
}
