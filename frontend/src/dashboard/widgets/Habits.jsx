import { WidgetRow } from '../primitives.jsx'
import LocalReview from './LocalReview.jsx'

export default function Habits({ data, widgetId, refresh }) {
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <>
    <form onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); propose('add', { title: form.get('title'), period: form.get('period'), target: Number(form.get('target')) }) }}>
      <label>Habit title<input name="title" required maxLength="500" /></label>
      <label>Period<select name="period"><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label>
      <label>Target<input name="target" type="number" min="1" max="100" defaultValue="1" required /></label><button>Create habit</button>
    </form>
    <ul>{(data?.items || []).map(row => <WidgetRow key={row.id}><strong>{row.title}</strong><p>{row.count}/{row.target} {row.period} · Streak: {row.streak}</p><button aria-label={`Check in ${row.title}`} onClick={() => propose('checkin', { id: row.id })}>Check in</button></WidgetRow>)}</ul>
  </>}</LocalReview>
}
