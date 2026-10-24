import { useState } from 'react'
import { request } from '../api.js'

export default function Templates({ data, refresh }) {
  const empty = { title: '', subject: '', text: '' }
  const [form, setForm] = useState(empty)
  const [using, setUsing] = useState(null)
  const [recipient, setRecipient] = useState('')
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  function propose(action, body) { return run(async () => setGate(await request(`/widgets/comm.templates/actions/${action}`, 'POST', body))) }
  function edit(id) { return run(async () => { const row = await request(`/widgets/comm.templates/templates/${id}`); setForm({ id: row.id, title: row.title, subject: row.subject, text: row.text }); setUsing(null) }) }
  function decide(approved) { return run(async () => { await request(`/widgets/comm.templates/drafts/${gate.draft_id}`, 'POST', { approved }); setGate(null); setUsing(null); setForm(empty); await refresh() }) }
  return <div><p>Local templates. Use template creates an unsent local draft after review.</p>
    {busy && <p role="status">Working…</p>}{error && <p role="alert">{error}</p>}
    {gate ? <section aria-label="Review template change"><p>{gate.action}: {gate.item.title}</p><p>{gate.item.recipient}</p><p>{gate.item.subject}</p><p>{gate.item.text}</p><button disabled={busy} onClick={() => decide(true)}>Approve local change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></section> : using ? <form onSubmit={e => { e.preventDefault(); propose('use', { id: using.id, recipient }) }}><p>Use {using.title}</p><label>Draft recipient<input type="email" required value={recipient} onChange={e => setRecipient(e.target.value)} /></label><button disabled={busy}>Review template draft</button><button type="button" onClick={() => setUsing(null)}>Cancel</button></form> : <form onSubmit={e => { e.preventDefault(); propose(form.id ? 'edit' : 'add', form) }}>
      <label>Template name<input required maxLength={500} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label><label>Template subject<input required maxLength={500} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></label><label>Template text<textarea aria-label="Template text" required maxLength={20000} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} /></label><button disabled={busy}>{form.id ? 'Review template edit' : 'Review new template'}</button>{form.id && <button type="button" onClick={() => setForm(empty)}>New template</button>}
    </form>}
    <ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}><div><strong>{item.title}</strong><p>{item.subject}</p><p>{item.snippet}</p><button disabled={busy || !!gate} onClick={() => edit(item.id)}>Edit template</button><button disabled={busy || !!gate} onClick={() => { setUsing(item); setRecipient('') }}>Use template</button><button disabled={busy || !!gate} onClick={() => propose('delete', { id: item.id })}>Review delete</button></div></li>)}</ul>
  </div>
}
