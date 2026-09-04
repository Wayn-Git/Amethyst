import { useState } from 'react'
import { request } from '../api.js'

export default function MailDrafts({ data, refresh }) {
  const [form, setForm] = useState({ recipient: '', subject: '', text: '' })
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  function propose(action, body) { return run(async () => setGate(await request(`/widgets/need.drafts/actions/${action}`, 'POST', body))) }
  function review(id) { return run(async () => { const row = await request(`/widgets/need.drafts/mail/${id}`); setForm({ id: row.id, recipient: row.recipient, subject: row.subject, text: row.text }) }) }
  function decide(approved) { return run(async () => { await request(`/widgets/need.drafts/drafts/${gate.draft_id}`, 'POST', { approved }); setGate(null); setForm({ recipient: '', subject: '', text: '' }); await refresh() }) }
  return <div><p>Drafts stay in local SQLite. Approve requests gate review; it never sends.</p><button disabled>Send (send scope disabled)</button>
    {busy && <p role="status">Working…</p>}{error && <p role="alert">{error}</p>}
    {gate ? <section aria-label="Review mail change"><p>{gate.action}: {gate.item.subject || form.subject}</p>{gate.item.text && <p>{gate.item.text}</p>}<button disabled={busy} onClick={() => decide(true)}>Approve local change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></section> : <form onSubmit={e => { e.preventDefault(); propose(form.id ? 'edit' : 'add', form) }}>
      <label>Recipient<input type="email" required value={form.recipient} onChange={e => setForm({ ...form, recipient: e.target.value })} /></label>
      <label>Subject<input required maxLength={500} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>
      <label>Draft text<textarea required maxLength={20000} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} /></label>
      <button disabled={busy}>{form.id ? 'Review edit' : 'Review new draft'}</button>{form.id && <button type="button" onClick={() => setForm({ recipient: '', subject: '', text: '' })}>New draft</button>}
    </form>}
    <ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}><div><strong>{item.subject}</strong><p>{item.recipient} · {item.status}</p><p>{item.snippet}</p><button disabled={busy || !!gate} onClick={() => review(item.id)}>Review / Edit</button><button disabled={busy || !!gate || item.status === 'approved'} onClick={() => propose('approve', { id: item.id })}>Approve</button></div></li>)}</ul>
  </div>
}
