import { Button, Input, Select, SegmentedBar } from '../../components/ui/bento/index.jsx'
import { WidgetRow } from '../primitives.jsx'
import LocalReview from './LocalReview.jsx'

export default function Habits({ data, widgetId, refresh }) {
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <>
    <details className="widget-form-disclosure" open={!data?.items?.length}><summary>New habit</summary><form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); propose('add', { title: form.get('title'), period: form.get('period'), target: Number(form.get('target')) }) }}>
      <label>Habit title<Input name="title" required maxLength="500" /></label>
      <label>Period<Select name="period"><option value="daily">Daily</option><option value="weekly">Weekly</option></Select></label>
      <label>Target<Input name="target" type="number" min="1" max="100" defaultValue="1" required /></label><Button type="submit">Create habit</Button>
    </form></details>
    <ul>{(data?.items || []).map(row => <WidgetRow key={row.id}><strong>{row.title}</strong><div className="widget-metric"><SegmentedBar value={row.count} max={row.target} segments={row.target} label={`${row.title} check-ins`} /></div><p>{row.count}/{row.target} {row.period} · Streak: {row.streak}</p><Button type="submit" aria-label={`Check in ${row.title}`} onClick={() => propose('checkin', { id: row.id })}>Check in</Button></WidgetRow>)}</ul>
  </>}</LocalReview>
}
