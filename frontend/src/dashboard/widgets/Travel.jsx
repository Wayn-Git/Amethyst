import { useState } from 'react'
import { request } from '../api.js'
import { StateView, WidgetRow } from '../primitives.jsx'
import { Button, Input } from '../../components/ui/bento/index.jsx'

export default function Travel({ data, refresh }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await request('/widgets/glance.travel/settings', 'PUT', { home: new FormData(event.currentTarget).get('home'), enabled: true })
      setError(''); await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className="adoption-stack adoption-travel">
    {data?.message && <StateView>{data.message}</StateView>}
    {error && <StateView role="alert">{error}</StateView>}
    <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong>{item.detail && <p className="adoption-route">{item.detail}</p>}{item.start && <time className="adoption-label" dateTime={item.start}>{new Date(item.start).toLocaleString([], { timeZone: data.timezone })}</time>}</div></WidgetRow>)}</ul>
    <details open={data?.set_location}><summary>Home location settings</summary><form onSubmit={save}><label>Home location<Input name="home" required maxLength={500} disabled={busy} /></label><Button variant="primary" type="submit" loading={busy}>Save location</Button></form></details>
    <p className="adoption-label">Calendar and Google Maps via Composio. Driving estimate for the next event with a location.</p>
  </div>
}
