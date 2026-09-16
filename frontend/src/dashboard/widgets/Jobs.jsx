import { useState } from 'react'
import { WidgetRow, StateView } from '../primitives.jsx'
import { request } from '../api.js'

export default function Jobs({ data, widgetId, refresh }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function propose(action, body) {
    setBusy(true); setError('')
    try { setDraft(await request(`/widgets/${widgetId}/actions/${action}`, 'POST', body)) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null); await refresh()
    } catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <>
    <p>Runs while Amethyst is open. Missed runs are skipped. Writes require approval.</p>
    {error && <StateView role="alert">{error}</StateView>}
    {draft ? <section aria-label="Review job"><pre>{JSON.stringify(draft.item, null, 2)}</pre><button disabled={busy} onClick={() => decide(true)}>Approve change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></section> : <form onSubmit={e => {
      e.preventDefault(); const f = new FormData(e.currentTarget)
      propose('add', { title: f.get('title'), prompt: f.get('prompt'), run_at: new Date(f.get('at')).toISOString(), interval_s: f.get('interval') ? Number(f.get('interval')) * 60 : null })
    }}>
      <label>Title<input name="title" required maxLength={500} /></label>
      <label>Prompt<textarea name="prompt" required maxLength={10000} /></label>
      <label>Run at<input name="at" type="datetime-local" required /></label>
      <label>Repeat every minutes (blank for once)<input name="interval" type="number" min="15" max="43200" /></label>
      <button disabled={busy}>Review job</button>
    </form>}
    <ul>{(data?.items || []).map(item => <WidgetRow key={item.id}><div><strong>{item.title}</strong><p>{item.detail}</p><button disabled={busy} onClick={() => propose('delete', { id: item.id })}>Delete</button></div></WidgetRow>)}</ul>
    <ul>{(data?.runs || []).map(run => <WidgetRow key={run.id}><div>Run {run.id}: {run.status} {run.error}</div></WidgetRow>)}</ul>
  </>
}
