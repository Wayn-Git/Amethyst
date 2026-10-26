import { useState } from 'react'
import { request } from '../api.js'
import { WidgetRow, StateView } from '../primitives.jsx'
import { Button, Input, Initials } from '../../components/ui/bento/index.jsx'

export default function Reachout({ data, refresh }) {
  const [days, setDays] = useState(null)
  const [name, setName] = useState('')
  const [birthday, setBirthday] = useState('')
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  function propose(birthdays) {
    return run(async () => setGate(await request('/widgets/comm.reachout/actions/configure', 'POST', { days: Number(days ?? data?.days ?? 30), birthdays })))
  }
  function decide(approved) {
    return run(async () => {
      await request(`/widgets/comm.reachout/drafts/${gate.draft_id}`, 'POST', { approved })
      setGate(null); setName(''); setBirthday(''); await refresh()
    })
  }
  return <div className="adoption-stack">
    {busy && <StateView role="status">Working…</StateView>}
    {error && <StateView role="alert">{error}</StateView>}
    {data?.unavailable?.length > 0 && <StateView role="status">Unavailable: {data.unavailable.join(', ')}</StateView>}
    {gate ? <section className="adoption-review" aria-label="Review reach-out settings"><p>After {gate.item.days} days without contact</p>
      <ul>{gate.item.birthdays.map((row, i) => <WidgetRow key={i}>{row.name}: {row.birthday}</WidgetRow>)}</ul>
      <div className="widget-buttons"><Button variant="primary" loading={busy} onClick={() => decide(true)}>Approve local change</Button><Button disabled={busy} onClick={() => decide(false)}>Reject change</Button></div>
    </section> : <details open={!data?.items?.length}><summary>Reminder settings and birthdays</summary>
      <form onSubmit={e => { e.preventDefault(); propose(data?.birthdays || []) }}>
        <label>Days without contact<Input type="number" min="1" max="3650" required value={days ?? data?.days ?? 30} onChange={e => setDays(e.target.value)} /></label><Button variant="primary" type="submit" loading={busy}>Review reminder interval</Button>
      </form>
      <form onSubmit={e => { e.preventDefault(); propose([...(data?.birthdays || []), { name, birthday }]) }}>
        <label>Name<Input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Birthday (MM-DD)<Input required pattern="[0-9]{2}-[0-9]{2}" placeholder="MM-DD" value={birthday} onChange={e => setBirthday(e.target.value)} /></label><Button variant="primary" type="submit" loading={busy}>Review birthday</Button>
      </form>
      <ul aria-label="Manual birthdays">{(data?.birthdays || []).map((row, i) => <WidgetRow key={i}>{row.name}: {row.birthday}<Button disabled={busy} onClick={() => propose(data.birthdays.filter((_, index) => index !== i))}>Review birthday removal</Button></WidgetRow>)}</ul>
    </details>}
    {data?.limited && <StateView role="status">Contact history is limited to cached source metadata.</StateView>}
    <ul className="widget-list adoption-people">{(data?.items || []).map(item => <WidgetRow key={item.id}><Initials name={item.title || 'Unknown contact'} /><div><strong>{item.title}</strong><p>{item.reason}</p>{item.at && <p className="adoption-label">Last contact: <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></p>}</div></WidgetRow>)}</ul>
    <p className="adoption-label">Birthdays today and people without contact for the configured number of days. Nothing is sent.</p>
  </div>
}
