import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Skills({ data, refresh }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function propose(name, enabled) {
    setBusy(true); setError('')
    try { setDraft(await request('/widgets/agent.skills/actions/toggle', 'POST', { name, enabled })) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try { await request(`/widgets/agent.skills/drafts/${draft.draft_id}`, 'POST', { approved }); setDraft(null); await refresh() }
    catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <>
    <p>{data?.tool_note}</p>
    {error && <StateView role="alert">{error}</StateView>}
    {draft && <section aria-label="Review skill toggle"><p>{draft.item.name}: {draft.item.enabled ? 'Enable' : 'Disable'}</p><button disabled={busy} onClick={() => decide(true)}>Approve change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></section>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p><label>Enable {item.title}<input type="checkbox" checked={item.enabled} disabled={busy || !!draft} onChange={e => propose(item.id, e.target.checked)} /></label><details><summary>Available tools</summary><ul>{item.tools.map(tool => <li key={tool}>{tool}</li>)}</ul></details></div></WidgetRow>)}</ul>
  </>
}
