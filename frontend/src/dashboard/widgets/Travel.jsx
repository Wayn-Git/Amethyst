import { useState } from 'react'
import { request } from '../api.js'
import { StateView, WidgetRow } from '../primitives.jsx'

export default function Travel({ data, refresh }) {
  const [error, setError] = useState('')
  async function save(event) {
    event.preventDefault()
    try {
      await request('/widgets/glance.travel/settings', 'PUT', { home: new FormData(event.currentTarget).get('home'), enabled: true })
      setError(''); await refresh()
    } catch (e) { setError(e.message) }
  }
  return <div>
    {data?.message && <StateView>{data.message}</StateView>}
    {error && <StateView role="alert">{error}</StateView>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p>{item.start && <time dateTime={item.start}>{new Date(item.start).toLocaleString([], { timeZone: data.timezone })}</time>}</div></WidgetRow>)}</ul>
    <form onSubmit={save}><label>Home location<input name="home" maxLength={500} /></label><button>Save location</button></form>
    <p>Calendar and Google Maps via Composio. Driving estimate for the next event with a location.</p>
  </div>
}
