import { useEffect, useRef, useState } from 'react'
import { request } from '../api.js'
import { StateView, WidgetRow } from '../primitives.jsx'
import { Button, Input } from '../../components/ui/bento/index.jsx'
import { deviceLocation } from '../location.js'
import Icon from '../../components/Icon.jsx'

export default function Travel({ data, refresh }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [home, setHome] = useState('')
  const [notice, setNotice] = useState('')
  const live = useRef(false)
  useEffect(() => {
    let active = true
    live.current = true
    request('/widgets/glance.travel/settings').then(value => { if (active) setHome(value.home || '') }).catch(err => { if (active) setError(err.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false; live.current = false }
  }, [])
  async function locate() {
    setBusy(true); setError(''); setNotice('')
    try {
      const value = await deviceLocation()
      if (live.current) { setHome(`${value.latitude}, ${value.longitude}`); setNotice('Current location filled. Save to use it as your trip origin.') }
    } catch (err) { if (live.current) setError(err.message) }
    finally { if (live.current) setBusy(false) }
  }
  async function save(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await request('/widgets/glance.travel/settings', 'PUT', { home: home.trim(), enabled: true })
      setError(''); setNotice('Trip origin saved.'); await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className="adoption-stack adoption-travel">
    {data?.message && <StateView>{data.message}</StateView>}
    {error && <StateView role="alert">{error}</StateView>}
    {data?.set_location ? <StateView>Choose where your trip starts.</StateView> : <ul className="widget-list">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong>{item.detail && <p className="adoption-route">{item.detail}</p>}{item.start && <time className="adoption-label" dateTime={item.start}>{new Date(item.start).toLocaleString([], { timeZone: data.timezone })}</time>}</div></WidgetRow>)}</ul>}
    <details open={data?.set_location}><summary>Home location settings</summary><form onSubmit={save}><label>Home location<Input name="home" required maxLength={500} autoComplete="street-address" placeholder="Address or latitude, longitude" value={home} onChange={event => setHome(event.target.value)} disabled={busy} /></label><div className="widget-buttons"><Button disabled={busy} onClick={locate}><Icon name="target" size={16} />Use current location</Button><Button variant="primary" type="submit" loading={busy} disabled={!home.trim()}>Save location</Button></div></form></details>
    {notice && <StateView role="status">{notice}</StateView>}
    <details className="adoption-source"><summary>About this estimate</summary><p className="adoption-label">Your saved origin and next calendar event’s location are sent to Google Maps via Composio for a driving estimate.</p></details>
  </div>
}
