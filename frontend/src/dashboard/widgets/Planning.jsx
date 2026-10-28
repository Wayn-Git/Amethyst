import { Button, Input } from '../../components/ui/bento/index.jsx'
import { useEffect, useState } from 'react'
import { request } from '../api.js'
import { StateView, WidgetRow } from '../primitives.jsx'

export default function Planning({ data, widgetId, refresh }) {
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    request('/widgets/task.free/settings').then(value => { if (active) setSettings(value) }).catch(e => { if (active) { setError(e.message); setSettings({}) } })
    return () => { active = false }
  }, [])
  async function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const value = await request(`/widgets/${widgetId}/settings`, 'PUT', {
        start: form.get('start'), end: form.get('end'), timezone: form.get('timezone'),
        days: form.getAll('days').map(Number),
      })
      setSettings(value)
      window.dispatchEvent(new CustomEvent('dashboard-settings-changed', { detail: ['task.plan', 'task.free', 'task.conflicts', 'task.risk', 'glance.travel'] }))
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const format = value => new Date(value).toLocaleString([], { timeZone: data.timezone })
  return <div>
    {data?.message && <StateView>{data.message}</StateView>}
    {error && <StateView role="alert">{error}</StateView>}
    <ul className="widget-list widget-timeline">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p>{item.start && <p>{format(item.start)} – {format(item.end)}</p>}</div></WidgetRow>)}</ul>
    <details><summary>Working hours settings</summary><form key={JSON.stringify(settings)} onSubmit={save}>
      <fieldset disabled={settings === null || busy}>
      <label>Start<Input name="start" type="time" required defaultValue={settings?.start || ''} /></label>
      <label>End<Input name="end" type="time" required defaultValue={settings?.end || ''} /></label>
      <label>Timezone<Input name="timezone" required defaultValue={settings?.timezone || data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} /></label>
      <fieldset><legend>Working days</legend>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => <label className="widget-check" key={day}><Input type="checkbox" name="days" value={index} defaultChecked={settings?.days?.includes(index)} />{day}</label>)}</fieldset>
      <Button type="submit" loading={busy}>Save working hours</Button>
      </fieldset>
    </form></details>
  </div>
}
