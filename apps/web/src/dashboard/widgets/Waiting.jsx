import { WidgetRow, StateView } from '../primitives.jsx'
import { useState } from 'react'
import Drawer from '../Drawer.jsx'
import { request } from '../api.js'
import { Button, Input, Initials, Chip, Textarea } from '../../components/ui/bento/index.jsx'

export default function Waiting({ data, refresh }) {
  const [title, setTitle] = useState('')
  const [recipient, setRecipient] = useState('')
  const [sent, setSent] = useState('')
  const [days, setDays] = useState(null)
  const [nudge, setNudge] = useState(null)
  const [gate, setGate] = useState(null)
  const [editor, setEditor] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  function propose(action, body) { setEditor(true); return run(async () => setGate(await request(`/widgets/need.waiting/actions/${action}`, 'POST', body))) }
  function decide(approved) { return run(async () => {
    const result = await request(`/widgets/need.waiting/drafts/${gate.draft_id}`, 'POST', { approved })
    setGate(null)
    if (approved && result.state !== 'applied') throw new Error('Permission denied. Waiting item unchanged.')
    if (result.state === 'applied') { setEditor(false); setNudge(null); setTitle(''); setRecipient(''); setSent(''); window.dispatchEvent(new Event('dashboard-items-changed')) }
    await refresh()
  }) }
  return <div className="adoption-stack">
    {data?.connected === false && <StateView role="status">Gmail not connected. Showing manual items.</StateView>}
    {busy && <StateView role="status">Working…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    <div className="widget-buttons"><Button onClick={() => setEditor(true)}>{gate ? 'Continue review' : nudge ? 'Continue nudge' : 'Add manual item'}</Button><Button onClick={() => setEditor('settings')}>Waiting settings</Button></div>
    {editor === true && <Drawer title="Waiting on a reply" description="Track a reply or prepare a local nudge draft." closeDisabled={busy} onClose={() => setEditor(false)}><div className="widget-home"><div className="home-widget widget-adoption adoption-stack">
    {busy && <StateView role="status">Working…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    {gate ? <section className="adoption-review" aria-label="Review waiting change"><p>{gate.action}: {gate.item.title || gate.item.subject}</p><p>{gate.item.recipient}</p><p>{gate.item.text}</p><div className="widget-buttons"><Button variant="primary" loading={busy} onClick={() => decide(true)}>Approve local change</Button><Button disabled={busy} onClick={() => decide(false)}>Reject change</Button></div></section> : nudge ? <form onSubmit={e => { e.preventDefault(); propose('nudge', nudge) }}><label>Nudge recipient<Input type="email" required value={nudge.recipient} onChange={e => setNudge({ ...nudge, recipient: e.target.value })} /></label><label>Nudge subject<Input required maxLength={500} value={nudge.subject} onChange={e => setNudge({ ...nudge, subject: e.target.value })} /></label><label>Nudge text<Textarea aria-label="Nudge text" required maxLength={20000} value={nudge.text} onChange={e => setNudge({ ...nudge, text: e.target.value })} /></label><div className="widget-buttons"><Button variant="primary" type="submit" loading={busy}>Review nudge draft</Button><Button onClick={() => setNudge(null)}>Cancel nudge</Button></div></form> : <form onSubmit={e => { e.preventDefault(); propose('add', { title, recipient, sent_at: new Date(sent).toISOString() }) }}><label>Manual item title<Input required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} /></label><label>Recipient<Input type="email" required value={recipient} onChange={e => setRecipient(e.target.value)} /></label><label>Sent at<Input type="datetime-local" required value={sent} onChange={e => setSent(e.target.value)} /></label><Button variant="primary" type="submit" loading={busy}>Review manual item</Button></form>}
    </div></div></Drawer>}
    <ul className="widget-list adoption-people">{(data?.items || []).map(item => <WidgetRow key={item.id}><Initials name={item.recipient || item.from || 'Unknown recipient'} /><div><strong>{item.subject}</strong><div className="adoption-meta"><span>{item.recipient || item.from}</span><Chip>{item.source}</Chip></div><p className="adoption-label">{item.date}</p><div className="widget-buttons"><Button disabled={busy || !!gate} onClick={() => { setEditor(true); setNudge({ reference: item.id, recipient: item.recipient || '', subject: item.subject, text: `Following up on ${item.subject}.` }) }}>Draft nudge</Button>{item.manual_id && <Button disabled={busy || !!gate} onClick={() => propose('complete', { id: item.manual_id })}>Mark replied</Button>}</div></div></WidgetRow>)}</ul>
    {editor === 'settings' && <Drawer title="Waiting settings" closeDisabled={busy} onClose={() => setEditor(false)}><div className="widget-home"><div className="home-widget widget-adoption adoption-stack">{error && <StateView role="alert">{error}</StateView>}<form onSubmit={e => { e.preventDefault(); run(async () => { await request('/widgets/need.waiting/settings', 'PUT', { days: Number(days ?? data?.days ?? 3) }); await refresh() }) }}><label>Wait days<Input type="number" min="1" max="90" value={days ?? data?.days ?? 3} onChange={e => setDays(e.target.value)} /></label><Button variant="primary" type="submit" loading={busy}>Save wait days</Button></form><p className="adoption-label">Sent mail without a later reply · last 90 days, up to 100 sent and 100 received messages. Nudges stay in local drafts.</p></div></div></Drawer>}
  </div>
}
