import { Button, Switch } from '../../components/ui/bento/index.jsx'
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
    {draft && <section aria-label="Review skill toggle"><p>{draft.item.name}: {draft.item.enabled ? 'Enable' : 'Disable'}</p><Button variant="primary" type="submit" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => decide(false)}>Reject change</Button></section>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p><div className="widget-switch-row"><span>Enable {item.title}</span><Switch label={`Enable ${item.title}`} on={item.enabled} disabled={busy || !!draft} onChange={enabled => propose(item.id, enabled)} /></div><details><summary>Available tools</summary><ul>{item.tools.map(tool => <li key={tool}>{tool}</li>)}</ul></details></div></WidgetRow>)}</ul>
  </>
}
