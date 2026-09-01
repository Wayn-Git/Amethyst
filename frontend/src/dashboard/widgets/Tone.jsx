import { useState } from 'react'
import { request } from '../api.js'

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
  return <div><p>Rewrite a saved local draft. Optional free model, including Ollama; nothing sends.</p>
    {busy && <p role="status">Generating / reviewing…</p>}{error && <p role="alert">{error}</p>}
    <label>Saved draft<select aria-label="Saved draft" value={id} disabled={busy || !!gate} onChange={e => { setId(e.target.value); setRewrite(null) }}><option value="">Select draft</option>{(data?.items || []).map(item => <option key={item.id} value={item.id}>{item.subject} · {item.recipient}</option>)}</select></label>
    <label>Tone<select aria-label="Tone" value={tone} disabled={busy || !!gate} onChange={e => { setTone(e.target.value); setRewrite(null) }}>{['short', 'formal', 'friendly'].map(value => <option key={value}>{value}</option>)}</select></label><button disabled={busy || !id || !!gate} onClick={generate}>Generate rewrite</button>
    {gate ? <section aria-label="Review tone change"><p>{gate.item.text}</p><button disabled={busy} onClick={() => decide(true)}>Approve rewrite</button><button disabled={busy} onClick={() => decide(false)}>Reject rewrite</button></section> : rewrite && <div><label>Rewritten draft<textarea aria-label="Rewritten draft" maxLength={20000} value={rewrite.text} onChange={e => setRewrite({ ...rewrite, text: e.target.value })} /></label><button disabled={busy || !rewrite.text.trim()} onClick={propose}>Review rewrite</button></div>}
  </div>
}
