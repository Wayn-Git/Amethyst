import { useEffect, useState } from 'react'
import { request } from '../api.js'
import Icon from '../../components/Icon.jsx'

function localInput(value) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function countdown(due, now) {
  const seconds = (new Date(due).getTime() - now) / 1000
  const minutes = Math.max(1, Math.ceil(Math.abs(seconds) / 60))
  const duration = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`
  return seconds <= 0 ? `${duration} overdue` : `${duration} remaining`
}

export default function Items({ data, widgetId }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const [title, setTitle] = useState('')
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
    {widgetId === 'dev.recovery' && <p>Track mirror, local clone and export recovery steps.</p>}
    {widgetId === 'task.reminders' && <p>Due state only. Notifications are not enabled.</p>}
    {error && <p role="alert">{error}</p>}
    {draft ? <section aria-label="Review item change">
      <p>{draft.action}: {draft.item.title || data?.items?.find(item => item.id === draft.item.id)?.title}</p>
      {['add', 'edit'].includes(draft.action) && <p>{draft.item.due_at ? `Due ${new Date(draft.item.due_at).toLocaleString()}` : 'No due date'}</p>}
      <div className="widget-buttons"><button disabled={busy} onClick={() => decide(true)}>Approve change</button><button disabled={busy} onClick={() => decide(false)}>Reject change</button></div>
    </section> : <>
      {editing ? <form onSubmit={event => { event.preventDefault(); propose(editing.id ? 'edit' : 'add', { id: editing.id || null, title: editing.title, due_at: editing.due ? new Date(editing.due).toISOString() : null }) }}>
        <label>Title<input required maxLength={500} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
        {widgetId !== 'dev.recovery' && <label>Due<input type="datetime-local" required={['task.deadlines', 'task.reminders'].includes(widgetId)} value={editing.due} onChange={event => setEditing({ ...editing, due: event.target.value })} /></label>}
        <div className="widget-buttons"><button disabled={busy} type="submit">Review change</button><button disabled={busy} type="button" onClick={() => setEditing(null)}>Cancel</button></div>
      </form> : <form className="widget-inline-add" onSubmit={event => { event.preventDefault(); setEditing({ title, due: '' }); setTitle('') }}><input aria-label="New item title" placeholder="Add a task…" maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /><button disabled={busy}>Add item</button></form>}
      <ul className="widget-list">{(data?.items || []).map(item => {
        const isOverdue = item.due_at && new Date(item.due_at).getTime() <= now
        const isCompleted = item.completed || item.status === 'done' || item.state === 'done'
        return <li key={item.id} className="task-item-row">
          <div className="task-content-wrap">
            {widgetId === 'task.today' && item.editable && (
              <button
                type="button"
                className={`task-check-button${isCompleted ? ' is-completed' : ''}`}
                disabled={busy}
                aria-label={`Toggle complete ${item.title}`}
                onClick={() => propose('complete', { id: item.id })}
                title="Complete task"
              >
                {isCompleted && <Icon name="check-simple" size={13} />}
              </button>
            )}
            <div className={`task-label-wrap${isCompleted ? ' is-completed' : ''}`}>
              <strong>{item.title}</strong>
              {widgetId === 'task.backlog' && <p>Idle {item.idle_days} {item.idle_days === 1 ? 'day' : 'days'}</p>}
              {item.due_at && (
                <span className={`task-due-chip ${isOverdue ? 'is-overdue' : 'is-due'}`}>
                  {isOverdue ? 'Overdue' : 'Due'} · {new Date(item.due_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {widgetId === 'task.deadlines' && <p>{countdown(item.due_at, now)}</p>}
            </div>
          </div>
          {item.editable ? <details className="widget-row-menu"><summary aria-label={`Actions ${item.title}`}>Actions</summary><div className="widget-buttons">
            <button disabled={busy} aria-label={`Edit ${item.title}`} onClick={() => setEditing({ id: item.id, title: item.title, due: localInput(item.due_at) })}>Edit</button>
            <button disabled={busy} aria-label={`Complete ${item.title}`} onClick={() => propose('complete', { id: item.id })}>Complete</button>
            <button disabled={busy} aria-label={`Delete ${item.title}`} onClick={() => propose('delete', { id: item.id })}>Delete</button>
          </div></details> : null}
        </li>
      })}</ul>
    </>}
  </div>
}
