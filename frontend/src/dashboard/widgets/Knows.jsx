import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Knows({ data, refresh }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function propose(action, body) {
    setBusy(true); setError('')
    try { setDraft(await request('/widgets/agent.knows/actions/' + action, 'POST', body)) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try { await request(`/widgets/agent.knows/drafts/${draft.draft_id}`, 'POST', { approved }); setDraft(null); await refresh() }
    catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <>
    {error && <StateView role="alert">{error}</StateView>}
    {draft && <section aria-label="Review memory change"><p>{draft.action}: {draft.item.fact || `Memory ${draft.item.id}`}</p><button disabled={busy} onClick={() => decide(true)}>Approve change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></section>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><form onSubmit={e => { e.preventDefault(); propose('edit', { id: item.id, fact: new FormData(e.currentTarget).get('fact') }) }}><p>{item.detail}</p><label>Memory {item.id}<textarea key={item.fact} name="fact" defaultValue={item.fact} required maxLength={10000} /></label><button disabled={busy || !!draft}>Review edit</button><button type="button" disabled={busy || !!draft} onClick={() => propose('delete', { id: item.id })}>Delete memory</button></form></WidgetRow>)}</ul>
  </>
}
