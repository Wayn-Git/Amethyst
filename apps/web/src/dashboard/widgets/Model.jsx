import { Button, Input, Select } from '../../components/ui/bento/index.jsx'
import { StateView } from '../primitives.jsx'
import { useState } from 'react'
import { request } from '../api.js'

export default function Model({ data, refresh }) {
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(event, approved) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      if (approved === undefined) setDraft(await request('/widgets/sys.model/actions/switch', 'POST', { provider, model }))
      else { const result = await request(`/widgets/sys.model/drafts/${draft.draft_id}`, 'POST', { approved }); setDraft(null); if (approved && result.state !== 'applied') throw new Error('Permission denied. No changes were applied.'); await refresh() }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div><p>{data?.active ? `${data.active.provider} / ${data.active.model} · ${data.active.location}` : 'No configured model.'}</p>
    <p>Default model for new work. Running conversations keep their selected model; automatic routing may fall back.</p>
    {error && <StateView role="alert">{error}</StateView>}
    <form onSubmit={event => act(event)}><label>Provider<Select aria-label="Model provider" value={provider} disabled={busy || !!draft} required onChange={event => { setProvider(event.target.value); setModel(data.providers.find(item => item.name === event.target.value)?.model || '') }}><option value="">Choose provider</option>{data?.providers?.map(item => <option key={item.name} value={item.name}>{item.name} · {item.location}</option>)}</Select></label>
      <label>Model<Input aria-label="Model name" value={model} onChange={event => setModel(event.target.value)} required maxLength={200} disabled={busy || !!draft} /></label>
      <Button type="submit" disabled={busy || !!draft}>Draft switch</Button>
    </form>
    {draft && <div><p>Switch default to {draft.item.provider} / {draft.item.model}?</p><Button variant="primary" type="submit" disabled={busy} onClick={event => act(event, true)}>Approve</Button><Button type="submit" disabled={busy} onClick={event => act(event, false)}>Deny</Button></div>}
  </div>
}
