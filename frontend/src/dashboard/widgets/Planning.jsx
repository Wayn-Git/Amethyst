import { Button, Input } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { request } from '../api.js'
import { StateView, WidgetRow } from '../primitives.jsx'

export default function Planning({ data, widgetId, refresh }) {
  const [error, setError] = useState('')
  async function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      await request(`/widgets/${widgetId}/settings`, 'PUT', {
        start: form.get('start'), end: form.get('end'), timezone: form.get('timezone'),
        days: form.getAll('days').map(Number),
      })
      setError(''); await refresh()
    } catch (e) { setError(e.message) }
  }
  const format = value => new Date(value).toLocaleString([], { timeZone: data.timezone })
  return <div>
    {data?.message && <StateView>{data.message}</StateView>}
    {error && <StateView role="alert">{error}</StateView>}
    <ul className="widget-list widget-timeline">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p>{item.start && <p>{format(item.start)} – {format(item.end)}</p>}</div></WidgetRow>)}</ul>
    <details><summary>Working hours settings</summary><form onSubmit={save}>
      <label>Start<Input name="start" type="time" required /></label>
      <label>End<Input name="end" type="time" required /></label>
      <label>Timezone<Input name="timezone" required defaultValue={data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} /></label>
      <fieldset><legend>Working days</legend>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => <label key={day}><Input type="checkbox" name="days" value={index} />{day}</label>)}</fieldset>
      <Button type="submit">Save working hours</Button>
    </form></details>
  </div>
}
