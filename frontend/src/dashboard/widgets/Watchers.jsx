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
    {draft ? <section aria-label="Review watcher"><pre>{JSON.stringify(draft.item, null, 2)}</pre><button disabled={busy} onClick={() => decide(true)}>Approve change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></section> : <form onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget)
      act('add', { title: f.get('title'), kind: f.get('kind'), target: f.get('target'), interval_s: Number(f.get('minutes')) * 60 })
    }}>
      <label>Title<input name="title" required maxLength={500} /></label>
      <label>Kind<select name="kind" aria-label="Kind"><option value="page">Page change</option><option value="mailbox">Mailbox match</option></select></label>
      <label>Page URL or Gmail query<input name="target" required maxLength={2048} /></label>
      <label>Poll minutes<input name="minutes" type="number" defaultValue="15" min="15" max="43200" required /></label>
      <button disabled={busy}>Review watcher</button>
    </form>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p>{item.error && <StateView role="alert">{item.error}</StateView>}<button disabled={busy} onClick={() => act('delete', { id: item.id })}>Delete</button></div></WidgetRow>)}</ul>
  </>
}
