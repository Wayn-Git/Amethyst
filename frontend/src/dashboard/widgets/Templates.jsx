import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'
import Icon from '../../components/Icon.jsx'
import { Button, Input, IconBadge, Textarea } from '../../components/ui/bento/index.jsx'

export default function Templates({ data, refresh }) {
  const empty = { title: '', subject: '', text: '' }
  const [form, setForm] = useState(empty)
  const [using, setUsing] = useState(null)
  const [recipient, setRecipient] = useState('')
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [openForm, setOpenForm] = useState(false)
  async function run(fn) { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  function propose(action, body) { return run(async () => setGate(await request(`/widgets/comm.templates/actions/${action}`, 'POST', body))) }
  function edit(id) { return run(async () => { const row = await request(`/widgets/comm.templates/templates/${id}`); setForm({ id: row.id, title: row.title, subject: row.subject, text: row.text }); setUsing(null); setOpenForm(true) }) }
  function decide(approved) { return run(async () => { await request(`/widgets/comm.templates/drafts/${gate.draft_id}`, 'POST', { approved }); setGate(null); setUsing(null); setForm(empty); setOpenForm(false); await refresh() }) }
  return <div className="adoption-stack">
    {busy && <StateView role="status">Working…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    {gate ? <section aria-label="Review template change" className="template-gate-review adoption-review"><p>{gate.action}: {gate.item.title}</p><p>{gate.item.recipient}</p><p>{gate.item.subject}</p><p>{gate.item.text}</p><div className="widget-buttons"><Button variant="primary" loading={busy} onClick={() => decide(true)}>Approve local change</Button><Button disabled={busy} onClick={() => decide(false)}>Reject change</Button></div></section> : using ? <form className="template-use-form" onSubmit={e => { e.preventDefault(); propose('use', { id: using.id, recipient }) }}><p>Use {using.title}</p><label>Draft recipient<Input type="email" required value={recipient} onChange={e => setRecipient(e.target.value)} /></label><div className="widget-buttons"><Button variant="primary" type="submit" loading={busy}>Review template draft</Button><Button type="button" onClick={() => setUsing(null)}>Cancel</Button></div></form> : <details className="template-composer-details" open={openForm || !!form.id} onToggle={e => setOpenForm(e.currentTarget.open)}>
      <summary className="template-composer-summary"><Icon name="plus" size={13} /><span>{form.id ? 'Edit template' : 'New template'}</span></summary>
      <form onSubmit={e => { e.preventDefault(); propose(form.id ? 'edit' : 'add', form) }}>
        <label>Template name<Input required maxLength={500} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label>Template subject<Input required maxLength={500} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>
        <label>Template text<Textarea aria-label="Template text" required maxLength={20000} value={form.text} onChange={e => setForm({ ...form, text: e.target.value })} /></label>
        <div className="widget-buttons"><Button variant="primary" type="submit" loading={busy}>{form.id ? 'Review template edit' : 'Review new template'}</Button>{form.id && <Button type="button" onClick={() => { setForm(empty); setOpenForm(false) }}>Cancel</Button>}</div>
      </form>
    </details>}
    <ul className="widget-list adoption-people">{(data?.items || []).map(item => <WidgetRow key={item.id} className="widget-row template-row-item"><IconBadge><Icon name="copy" /></IconBadge><div><strong>{item.title}</strong><p className="template-subject-line">{item.subject}</p><p className="template-snippet-line">{item.snippet}</p><div className="widget-buttons template-item-actions"><Button disabled={busy || !!gate} onClick={() => edit(item.id)}>Edit template</Button><Button disabled={busy || !!gate} onClick={() => { setUsing(item); setRecipient('') }}>Use template</Button><Button disabled={busy || !!gate} onClick={() => propose('delete', { id: item.id })}>Review delete</Button></div></div></WidgetRow>)}</ul>
  </div>
}
