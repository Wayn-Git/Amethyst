import { useState } from 'react'
import { request } from './api.js'

export default function PinToHome({ conversationId, messageId }) {
  const [draft, setDraft] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function pin() {
    setBusy(true); setError(''); setStatus('')
    try { setDraft(await request('/widgets/dash.pin/actions/add', 'POST', { conversation_id: conversationId, message_id: messageId })) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/dash.pin/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null); setStatus(result.state === 'applied' ? 'Pinned to Home' : 'Pin cancelled')
    } catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  if (!conversationId || !messageId) return null
  return <div className="widget-buttons">{error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}{draft ? <section aria-label="Review Home pin"><p>Pin this answer as an offline snapshot? Scripts, external resources and live data are disabled.</p><button disabled={busy} onClick={() => decide(true)}>Approve pin</button><button disabled={busy} onClick={() => decide(false)}>Cancel pin</button></section> : <button type="button" className="response-action-btn" disabled={busy} onClick={pin}>Pin to Home</button>}</div>
}
