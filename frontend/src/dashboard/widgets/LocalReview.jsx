import { Button } from '../../components/ui/bento/index.jsx'
import { useState } from 'react'
import { request } from '../api.js'
import { StateView } from '../primitives.jsx'

export default function LocalReview({ widgetId, refresh, children }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const propose = (action, body = {}) => run(async () => setDraft(await request(`/widgets/${widgetId}/actions/${action}`, 'POST', body)))
  const decide = approved => run(async () => {
    const result = await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
    setDraft(null)
    if (approved && result.state !== 'applied') setError('Permission denied.')
    window.dispatchEvent(new Event('dashboard-items-changed'))
    await refresh()
  })
  return <div>{error && <StateView role="alert">{error}</StateView>}{draft ? <section aria-label="Review local change"><p>{draft.action}</p><pre>{JSON.stringify(draft.item, null, 2)}</pre><Button variant="primary" type="submit" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button type="submit" disabled={busy} onClick={() => decide(false)}>Reject change</Button></section> : <fieldset disabled={busy}>{children(propose)}</fieldset>}</div>
}
