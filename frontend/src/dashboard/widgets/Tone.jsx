import { StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'
import { Button, Select } from '../../components/ui/bento/index.jsx'

export default function Tone({ data, refresh }) {
  const [id, setId] = useState('')
  const [tone, setTone] = useState('short')
  const [rewrite, setRewrite] = useState(null)
  const [gate, setGate] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(fn) { setBusy(true); setError(''); try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  function generate() { return run(async () => setRewrite(await request('/widgets/comm.tone/rewrite', 'POST', { id: Number(id), tone }))) }
  function propose() { return run(async () => setGate(await request('/widgets/comm.tone/actions/rewrite', 'POST', rewrite))) }
  function decide(approved) { return run(async () => { await request(`/widgets/comm.tone/drafts/${gate.draft_id}`, 'POST', { approved }); setGate(null); setRewrite(null); await refresh() }) }
  return <div className="adoption-stack"><p className="adoption-label">Rewrite a saved local draft. Optional free model, including Ollama; nothing sends.</p>
    {busy && <StateView role="status">Generating / reviewing…</StateView>}{error && <StateView role="alert">{error}</StateView>}
    <label>Saved draft<Select aria-label="Saved draft" value={id} disabled={busy || !!gate} onChange={e => { setId(e.target.value); setRewrite(null) }}><option value="">Select draft</option>{(data?.items || []).map(item => <option key={item.id} value={item.id}>{item.subject} · {item.recipient}</option>)}</Select></label>
    <label>Tone<Select aria-label="Tone" value={tone} disabled={busy || !!gate} onChange={e => { setTone(e.target.value); setRewrite(null) }}>{['short', 'formal', 'friendly'].map(value => <option key={value}>{value}</option>)}</Select></label><Button variant="primary" loading={busy} disabled={!id || !!gate} onClick={generate}>Generate rewrite</Button>
    {gate ? <section className="adoption-review" aria-label="Review tone change"><p>{gate.item.text}</p><div className="widget-buttons"><Button variant="primary" loading={busy} onClick={() => decide(true)}>Approve rewrite</Button><Button disabled={busy} onClick={() => decide(false)}>Reject rewrite</Button></div></section> : rewrite && <div><label>Rewritten draft<textarea aria-label="Rewritten draft" maxLength={20000} value={rewrite.text} onChange={e => setRewrite({ ...rewrite, text: e.target.value })} /></label><Button variant="primary" loading={busy} disabled={!rewrite.text.trim()} onClick={propose}>Review rewrite</Button></div>}
  </div>
}
