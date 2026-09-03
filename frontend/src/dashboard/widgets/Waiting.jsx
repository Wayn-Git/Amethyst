import { useState } from 'react'
import { request } from '../api.js'

export default function Waiting({ data, refresh }) {
  const [title, setTitle] = useState('')
  const [recipient, setRecipient] = useState('')
  const [sent, setSent] = useState('')
  const [days, setDays] = useState(null)
  const [nudge, setNudge] = useState(null)
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  function propose(action, body) { return run(async () => setGate(await request(`/widgets/need.waiting/actions/${action}`, 'POST', body))) }
  function decide(approved) { return run(async () => { await request(`/widgets/need.waiting/drafts/${gate.draft_id}`, 'POST', { approved }); setGate(null); setNudge(null); await refresh() }) }
  return <div><p>Sent mail without a later reply · last 90 days, up to 100 sent and 100 received messages. Nudges stay in local drafts.</p>
    {data?.connected === false && <p role="status">Gmail not connected. Showing manual items.</p>}
    <form onSubmit={e => { e.preventDefault(); run(async () => { await request('/widgets/need.waiting/settings', 'PUT', { days: Number(days ?? data?.days ?? 3) }); await refresh() }) }}><label>Wait days<input type="number" min="1" max="90" value={days ?? data?.days ?? 3} onChange={e => setDays(e.target.value)} /></label><button disabled={busy}>Save wait days</button></form>
    {busy && <p role="status">Working…</p>}{error && <p role="alert">{error}</p>}
    {gate ? <section aria-label="Review waiting change"><p>{gate.action}: {gate.item.title || gate.item.subject}</p><p>{gate.item.recipient}</p><p>{gate.item.text}</p><button disabled={busy} onClick={() => decide(true)}>Approve local change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></section> : nudge ? <form onSubmit={e => { e.preventDefault(); propose('nudge', nudge) }}><label>Nudge recipient<input type="email" required value={nudge.recipient} onChange={e => setNudge({ ...nudge, recipient: e.target.value })} /></label><label>Nudge subject<input required maxLength={500} value={nudge.subject} onChange={e => setNudge({ ...nudge, subject: e.target.value })} /></label><label>Nudge text<textarea aria-label="Nudge text" required maxLength={20000} value={nudge.text} onChange={e => setNudge({ ...nudge, text: e.target.value })} /></label><button disabled={busy}>Review nudge draft</button><button type="button" onClick={() => setNudge(null)}>Cancel nudge</button></form> : <form onSubmit={e => { e.preventDefault(); propose('add', { title, recipient, sent_at: new Date(sent).toISOString() }) }}><label>Manual item title<input required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Recipient<input type="email" required value={recipient} onChange={e => setRecipient(e.target.value)} /></label><label>Sent at<input type="datetime-local" required value={sent} onChange={e => setSent(e.target.value)} /></label><button disabled={busy}>Review manual item</button></form>}
    <ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}><div><strong>{item.subject}</strong><p>{item.recipient || item.from} · {item.date} · {item.source}</p><button disabled={busy || !!gate} onClick={() => setNudge({ reference: item.id, recipient: item.recipient || '', subject: item.subject, text: `Following up on ${item.subject}.` })}>Draft nudge</button>{item.manual_id && <button disabled={busy || !!gate} onClick={() => propose('complete', { id: item.manual_id })}>Mark replied</button>}</div></li>)}</ul>
  </div>
}
