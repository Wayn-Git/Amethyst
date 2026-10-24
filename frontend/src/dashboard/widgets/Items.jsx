import { useState } from 'react'
import { request } from '../api.js'

function localInput(value) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export default function Items({ data, widgetId }) {
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function propose(action, item) {
    setBusy(true); setError('')
    try {
      setDraft(await request(`/widgets/${widgetId}/actions/${action}`, 'POST', item))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function decide(approved) {
    setBusy(true); setError('')
    try {
      const result = await request(`/widgets/${widgetId}/drafts/${draft.draft_id}`, 'POST', { approved })
      setDraft(null)
      if (result.state === 'applied') { setEditing(null); window.dispatchEvent(new Event('dashboard-items-changed')) }
      else if (approved) setError('Permission denied. No item changed.')
    } catch (e) { setError(e.message); setDraft(null) } finally { setBusy(false) }
  }
  return <div>
    {error && <p role="alert">{error}</p>}
    {draft ? <section aria-label="Review item change">
      <p>{draft.action}: {draft.item.title || data?.items?.find(item => item.id === draft.item.id)?.title}</p>
      {['add', 'edit'].includes(draft.action) && <p>{draft.item.due_at ? `Due ${new Date(draft.item.due_at).toLocaleString()}` : 'No due date'}</p>}
      <div className="widget-buttons"><button disabled={busy} onClick={() => decide(true)}>Approve change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></div>
    </section> : <>
      {editing ? <form onSubmit={event => { event.preventDefault(); propose(editing.id ? 'edit' : 'add', { id: editing.id || null, title: editing.title, due_at: editing.due ? new Date(editing.due).toISOString() : null }) }}>
        <label>Title<input required maxLength={500} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
        <label>Due<input type="datetime-local" value={editing.due} onChange={event => setEditing({ ...editing, due: event.target.value })} /></label>
        <div className="widget-buttons"><button disabled={busy} type="submit">Review change</button><button disabled={busy} type="button" onClick={() => setEditing(null)}>Cancel</button></div>
      </form> : <button disabled={busy} onClick={() => setEditing({ title: '', due: '' })}>Add item</button>}
      <ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}>
        <div><strong>{item.title}</strong>{widgetId === 'task.backlog' && <p>Idle {item.idle_days} {item.idle_days === 1 ? 'day' : 'days'}</p>}{item.due_at && <p>{item.due_state === 'overdue' ? 'Overdue' : 'Due'} · {new Date(item.due_at).toLocaleString()}</p>}</div>
        {item.editable ? <div className="widget-buttons">
          <button disabled={busy} aria-label={`Edit ${item.title}`} onClick={() => setEditing({ id: item.id, title: item.title, due: localInput(item.due_at) })}>Edit</button>
          <button disabled={busy} aria-label={`Complete ${item.title}`} onClick={() => propose('complete', { id: item.id })}>Complete</button>
          <button disabled={busy} aria-label={`Delete ${item.title}`} onClick={() => propose('delete', { id: item.id })}>Delete</button>
        </div> : <p>Edit in connected source.</p>}
      </li>)}</ul>
    </>}
  </div>
}
