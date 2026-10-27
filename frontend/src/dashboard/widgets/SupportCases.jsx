import { Button, Input } from '../../components/ui/bento/index.jsx'
import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'

export default function SupportCases({ data, refresh }) {
  const [title, setTitle] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [domain, setDomain] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function propose(action, body) {
    setBusy(true); setError('')
    try { setDraft(await request('/widgets/dev.appeal/actions/' + action, 'POST', body)) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/dev.appeal/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (result.state === 'applied') { setTitle(''); setSubmitted(''); setDomain(''); await refresh() }
    } catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  async function generate(item) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/dev.appeal/cases/${item.id}/follow-up`, 'POST')
      await propose('follow-up', { id: item.id, text: result.text })
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div><p>Optional inbox watch uses Gmail via Composio. Follow-ups stay here as unsent drafts.</p>
    {busy && <StateView role="status">Working…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    {draft ? <section aria-label="Review case change"><p>{draft.action}: {draft.item.title || data?.items?.find(item => item.id === draft.item.id)?.title}</p>{draft.item.submitted_on && <p>Submitted {draft.item.submitted_on} · Watch: {draft.item.sender_domain || 'off'}</p>}{draft.item.text && <p>{draft.item.text}</p>}<Button variant="primary" type="submit" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => decide(false)}>Reject change</Button></section> : <details className="widget-form-disclosure" open={!data?.items?.length}><summary>New case</summary><form onSubmit={event => { event.preventDefault(); propose('add', { title, submitted_on: submitted, sender_domain: domain || null }) }}>
      <label>Case title<Input required maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /></label><label>Submitted date<Input required type="date" value={submitted} onChange={event => setSubmitted(event.target.value)} /></label><label>Watch sender domain (optional)<Input maxLength={253} placeholder="support.example.com" value={domain} onChange={event => setDomain(event.target.value)} /></label><Button type="submit" disabled={busy}>Review case</Button>
    </form></details>}
    <ul className="widget-list widget-timeline">{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><ol><WidgetRow>Sent · {item.submitted_on}</WidgetRow>{item.days > 0 && <WidgetRow>Waiting · day {item.days}</WidgetRow>}{item.reply_at && <WidgetRow>Reply · {item.reply_source} · {new Date(item.reply_at).toLocaleString()}</WidgetRow>}</ol><p>Status: {item.status} · Watch: {item.watch_state}</p>{item.follow_up && <p>Unsent follow-up: {item.follow_up}</p>}<div className="widget-buttons"><Button type="submit" disabled={busy || !!draft || !!item.reply_at} onClick={() => propose('reply', { id: item.id })}>Mark reply received</Button><Button type="submit" disabled={busy || !!draft} onClick={() => generate(item)}>Draft follow-up</Button>{item.sender_domain && <Button type="submit" disabled={busy || !!draft} onClick={() => propose('unwatch', { id: item.id })}>Stop inbox watch</Button>}</div></div></WidgetRow>)}</ul>
  </div>
}
