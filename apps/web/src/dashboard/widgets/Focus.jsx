import { useEffect, useState } from 'react'
import { WidgetRow } from '../primitives.jsx'
import { Ring, Button, Input, Chip } from '../../components/ui/bento/index.jsx'
import LocalReview from './LocalReview.jsx'

export default function Focus({ data, widgetId, refresh, full = true, size = 'l' }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const active = data?.items?.find(row => !row.ended_at)
  const duration = active?.duration_s ?? (data?.focus_minutes ?? 25) * 60
  const remaining = active ? Math.max(0, Math.min(duration, Math.ceil((new Date(active.started_at).getTime() + duration * 1000 - now) / 1000))) : duration
  const valid = Number.isFinite(remaining) && Number.isFinite(duration) && duration > 0
  return <div className="pilot-focus"><LocalReview widgetId={widgetId} refresh={refresh}>{propose => <>
    <div className="pilot-timer">
      {valid && <Ring value={remaining} max={duration} label="Seconds remaining" />}
      <output aria-label="Time remaining">{valid ? `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}` : 'Unavailable'}</output>
    </div>
    <Chip>{active ? active.mode === 'break' ? 'Break' : 'Focusing' : 'Ready'}</Chip>
    <div className="widget-buttons">{active ? <Button onClick={() => propose('stop')}>Stop timer</Button> : <><Button variant="primary" onClick={() => propose('start', { mode: 'focus' })}>Start focus</Button><Button onClick={() => propose('start', { mode: 'break' })}>Start break</Button></>}</div>
    <div className="focus-options" hidden={!full && !['l', 'tall'].includes(size)}><p className="pilot-note">Pause is unavailable for saved sessions.</p>
    <details><summary>Timer settings</summary><form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); propose('configure', { focus_minutes: Number(form.get('focus')), break_minutes: Number(form.get('break')) }) }}>
      <label>Focus minutes<Input name="focus" type="number" min="1" max="240" required defaultValue={data?.focus_minutes ?? 25} /></label>
      <label>Break minutes<Input name="break" type="number" min="1" max="240" required defaultValue={data?.break_minutes ?? 5} /></label><Button type="submit">Save settings</Button>
    </form></details>
    <details><summary>Session history</summary><ul>{(data?.items || []).map(row => <WidgetRow key={row.id}>{row.mode}: {row.started_at} · {row.completed ? 'Completed' : row.ended_at ? 'Stopped' : 'Running'}</WidgetRow>)}</ul></details></div>
  </>}</LocalReview></div>
}
