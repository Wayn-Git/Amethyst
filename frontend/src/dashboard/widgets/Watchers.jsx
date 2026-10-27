import { Button, Input, Select } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Watchers({ data, refresh }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(action, body) {
    setBusy(true); setError('')
    try { setDraft(await request(`/widgets/agent.watchers/actions/${action}`, 'POST', body)) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try { await request(`/widgets/agent.watchers/drafts/${draft.draft_id}`, 'POST', { approved }); setDraft(null); await refresh() }
    catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <>
    {error && <StateView role="alert">{error}</StateView>}
    {draft ? <section aria-label="Review watcher"><pre>{JSON.stringify(draft.item, null, 2)}</pre><Button variant="primary" type="submit" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => decide(false)}>Reject change</Button></section> : <details className="widget-form-disclosure" open={!data?.items?.length}><summary>New watcher</summary><form onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget)
      act('add', { title: f.get('title'), kind: f.get('kind'), target: f.get('target'), interval_s: Number(f.get('minutes')) * 60 })
    }}>
      <label>Title<Input name="title" required maxLength={500} /></label>
      <label>Kind<Select name="kind" aria-label="Kind"><option value="page">Page change</option><option value="mailbox">Mailbox match</option></Select></label>
      <label>Page URL or Gmail query<Input name="target" required maxLength={2048} /></label>
      <label>Poll minutes<Input name="minutes" type="number" defaultValue="15" min="15" max="43200" required /></label>
      <Button type="submit" disabled={busy}>Review watcher</Button>
    </form></details>}
    <ul className="widget-list widget-timeline">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p>{item.error && <StateView role="alert">{item.error}</StateView>}<Button type="submit" disabled={busy} onClick={() => act('delete', { id: item.id })}>Delete</Button></div></WidgetRow>)}</ul>
  </>
}
