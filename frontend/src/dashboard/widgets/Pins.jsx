import { useState } from 'react'
import SandboxedUi from '../../components/widgets/SandboxedUi.jsx'
import { request } from '../api.js'

export default function Pins({ data, refresh }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function remove(id) {
    setBusy(true); setError('')
    try { setDraft(await request('/widgets/dash.pin/actions/delete', 'POST', { id })) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/dash.pin/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (result.state === 'applied') await refresh()
      else if (approved) setError('Permission denied. Pin unchanged.')
    } catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <div>{error && <p role="alert">{error}</p>}{draft && <section aria-label="Review pin removal"><p>Remove this pinned answer?</p><button disabled={busy} onClick={() => decide(true)}>Approve removal</button><button disabled={busy} onClick={() => decide(false)}>Keep pin</button></section>}
    {data?.items?.map(item => <section key={item.id} aria-label={item.data.title}><p>pinned from chat · Offline snapshot</p><SandboxedUi data={item.data} pinned /><button disabled={busy || Boolean(draft)} aria-label={`Remove ${item.data.title}`} onClick={() => remove(item.id)}>Remove</button></section>)}
  </div>
}
