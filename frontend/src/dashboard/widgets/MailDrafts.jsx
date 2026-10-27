import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import Drawer from '../Drawer.jsx'
import { request } from '../api.js'
import { Button, Input, Chip, Initials } from '../../components/ui/bento/index.jsx'

export default function MailDrafts({ data, refresh }) {
  const [form, setForm] = useState({ recipient: '', subject: '', text: '' })
  const [gate, setGate] = useState(null)
  const [editor, setEditor] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  function propose(action, body) { setEditor(true); return run(async () => setGate(await request(`/widgets/need.drafts/actions/${action}`, 'POST', body))) }
  function review(id) { setEditor(true); return run(async () => { const row = await request(`/widgets/need.drafts/mail/${id}`); setForm({ id: row.id, recipient: row.recipient, subject: row.subject, text: row.text }) }) }
  function decide(approved) { return run(async () => { await request(`/widgets/need.drafts/drafts/${gate.draft_id}`, 'POST', { approved }); setGate(null); setEditor(false); setForm({ recipient: '', subject: '', text: '' }); await refresh() }) }
  return <div className="adoption-stack">
    {busy && <StateView role="status">Working…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    <Button onClick={() => setEditor(true)}>{gate ? 'Continue review' : form.id ? 'Continue editing' : 'New draft'}</Button>
    {editor && <Drawer title="Edit mail draft" description="Changes stay local and require your approval." onClose={() => { if (!busy) setEditor(false) }}><div className="widget-home"><div className="home-widget widget-adoption adoption-stack">
    {busy && <StateView role="status">Working…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    {gate ? <section className="adoption-review" aria-label="Review mail change"><p>{gate.action}: {gate.item.subject || form.subject}</p>{gate.item.text && <p>{gate.item.text}</p>}<div className="widget-buttons"><Button variant="primary" loading={busy} onClick={() => decide(true)}>Approve local change</Button><Button disabled={busy} onClick={() => decide(false)}>Reject change</Button></div></section> : <form onSubmit={e => { e.preventDefault(); propose(form.id ? 'edit' : 'add', form) }}>
      <label>Recipient<Input type="email" required value={form.recipient} onChange={e => setForm({ ...form, recipient: e.target.value })} /></label>
      <label>Subject<Input required maxLength={500} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>
      <label>Draft text<textarea aria-label="Draft text" required maxLength={20000} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} /></label>
      <div className="widget-buttons"><Button variant="primary" type="submit" loading={busy}>{form.id ? 'Review edit' : 'Review new draft'}</Button>{form.id && <Button onClick={() => setForm({ recipient: '', subject: '', text: '' })}>New draft</Button>}</div>
    </form>}
    </div></div></Drawer>}
    <ul className="widget-list adoption-people">{(data?.items || []).map(item => <WidgetRow key={item.id}><Initials name={item.recipient || 'Unknown recipient'} /><div><strong>{item.subject}</strong><div className="adoption-meta"><span>{item.recipient}</span><Chip>{item.status}</Chip></div><p>{item.snippet}</p><div className="widget-buttons"><Button disabled={busy || !!gate} onClick={() => review(item.id)}>Review / Edit</Button><Button variant="primary" disabled={busy || !!gate || item.status === 'approved'} onClick={() => propose('approve', { id: item.id })}>Approve</Button></div></div></WidgetRow>)}</ul>
    <details className="adoption-source"><summary>About local drafts</summary><p>Drafts stay in local SQLite. Approve requests gate review; it never sends.</p><Button disabled>Send (send scope disabled)</Button></details>
  </div>
}
