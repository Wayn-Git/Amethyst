import { Button, Select } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Rules({ data, refresh }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function propose(tool, decision) {
    setBusy(true); setError('')
    try { setDraft(await request('/widgets/agent.rules/actions/set', 'POST', { tool, decision })) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try { await request(`/widgets/agent.rules/drafts/${draft.draft_id}`, 'POST', { approved }); setDraft(null); await refresh() }
    catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <>
    <p>New rules default to Ask. Write tools cannot use Always allow.</p>
    {error && <StateView role="alert">{error}</StateView>}
    {draft && <section aria-label="Review permission rule"><p>{draft.item.tool}: {draft.item.decision}</p><Button variant="primary" type="submit" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => decide(false)}>Reject change</Button></section>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><form onSubmit={e => { e.preventDefault(); propose(item.id, new FormData(e.currentTarget).get('decision')) }}><strong>{item.title}</strong><label>Rule for {item.title}<Select key={item.decision} name="decision" aria-label={`Rule for ${item.title}`} defaultValue={item.decision} disabled={busy || !!draft}><option value="ask">Ask</option><option value="deny">Deny</option><option value="allow" disabled={!item.can_allow}>Always allow</option></Select></label><Button type="submit" disabled={busy || !!draft}>Review rule</Button></form></WidgetRow>)}</ul>
  </>
}
