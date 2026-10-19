import { useEffect, useState } from 'react'
import { WidgetRow } from '../primitives.jsx'
import LocalReview from './LocalReview.jsx'

export default function Focus({ data, widgetId, refresh }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const active = data?.items?.find(row => !row.ended_at)
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <>
    <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); propose('configure', { focus_minutes: Number(form.get('focus')), break_minutes: Number(form.get('break')) }) }}>
      <label>Focus minutes<input name="focus" type="number" min="1" max="240" required defaultValue={data?.focus_minutes ?? 25} /></label>
      <label>Break minutes<input name="break" type="number" min="1" max="240" required defaultValue={data?.break_minutes ?? 5} /></label><button>Save settings</button>
    </form>
    {active ? <><output aria-label="Seconds remaining">{Math.max(0, Math.ceil((new Date(active.started_at).getTime() + active.duration_s * 1000 - now) / 1000))}</output><button onClick={() => propose('stop')}>Stop timer</button></> : <><button onClick={() => propose('start', { mode: 'focus' })}>Start focus</button><button onClick={() => propose('start', { mode: 'break' })}>Start break</button></>}
    <ul>{(data?.items || []).map(row => <WidgetRow key={row.id}>{row.mode}: {row.started_at} · {row.completed ? 'Completed' : row.ended_at ? 'Stopped' : 'Running'}</WidgetRow>)}</ul>
  </>}</LocalReview>
}
