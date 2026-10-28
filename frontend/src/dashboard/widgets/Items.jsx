import { WidgetRow, WidgetChip, StateView } from '../primitives.jsx'
import { useEffect, useRef, useState } from 'react'
import { request } from '../api.js'
import { api } from '../../api.js'
import { Checkbox, Ring, Stat } from '../../components/ui/bento/index.jsx'
import Button from '../../components/ui/AppButton.jsx'
import { Input } from '../../components/ui/input.tsx'

function localInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function countdown(due, now) {
  const seconds = (new Date(due).getTime() - now) / 1000
  if (!Number.isFinite(seconds)) return 'Due time unavailable'
  const minutes = Math.max(1, Math.ceil(Math.abs(seconds) / 60))
  const duration = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`
  return seconds <= 0 ? `${duration} overdue` : `${duration} remaining`
}

export default function Items({ data, summaryData = data, widgetId }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msConnected, setMsConnected] = useState(false)
  const [msConnecting, setMsConnecting] = useState(false)
  const msPoll = useRef(null)
  const msAttempt = useRef(0)

  useEffect(() => {
    let cancelled = false
    if (widgetId?.startsWith('task.')) {
      api.microsoftStatus?.().then(res => {
        if (!cancelled && res?.connected) {
          setMsConnected(true)
        }
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [widgetId])

  useEffect(() => {
    // Only the backend's OAuth poll can confirm a connection.
    // Clear the latest timer, including attempts started after this effect.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++msAttempt.current; clearInterval(msPoll.current) }
  }, [])

  async function connectMicrosoft() {
    const attempt = ++msAttempt.current
    clearInterval(msPoll.current)
    setMsConnecting(true)
    setError('')
    try {
      const res = await api.startMicrosoftAuth?.()
      if (attempt !== msAttempt.current) return
      if (res?.auth_url) {
        window.open(res.auth_url, '_blank')
        if (res.state) {
          let checking = false
          msPoll.current = setInterval(async () => {
            if (checking || attempt !== msAttempt.current) return
            checking = true
            try {
              const status = await api.pollMicrosoftAuth?.(res.state)
              if (attempt !== msAttempt.current) return
              if (status?.connected) {
                clearInterval(msPoll.current)
                setMsConnected(true)
                setMsConnecting(false)
                window.dispatchEvent(new Event('dashboard-items-changed'))
              } else if (['failed', 'expired'].includes(status?.status)) {
                clearInterval(msPoll.current)
                setMsConnecting(false)
                setError(status.error || 'Microsoft authentication expired or failed. Try connecting again.')
              }
            } catch (e) {
              clearInterval(msPoll.current)
              if (attempt === msAttempt.current) { setMsConnecting(false); setError(e.message) }
            } finally { checking = false }
          }, 1500)
        } else { setMsConnecting(false); setError('Authentication session unavailable. Try connecting again.') }
      } else {
        window.dispatchEvent(new CustomEvent('amethyst:open-connectors', {
          detail: { connectorId: 'microsoft-todo', service: 'Microsoft To Do' }
        }))
        setMsConnecting(false)
      }
    } catch (e) {
      if (attempt !== msAttempt.current) return
      setError(e.message)
      setMsConnecting(false)
    }
  }
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
      if (result.state === 'applied') { setEditing(null); setTitle(''); window.dispatchEvent(new Event('dashboard-items-changed')) }
      else if (approved) setError('Permission denied. No item changed.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const all = summaryData?.items || []
  const completed = all.filter(item => item.completed || item.status === 'done' || item.state === 'done').length
  const pending = all.filter(item => !(item.completed || item.status === 'done' || item.state === 'done'))
  const overdue = pending.filter(item => item.due_at && new Date(item.due_at).getTime() <= now).length
  const today = pending.filter(item => item.due_at && new Date(item.due_at).getTime() > now && new Date(item.due_at).toDateString() === new Date(now).toDateString()).length
  return <div className={widgetId === 'task.today' ? 'widget-tasks' : undefined}>
    {widgetId === 'task.today' && <div className="pilot-progress">{all.length > 0 && <Ring value={completed} max={all.length} label="Completed in current list" />}<span>{all.length ? `${completed} of ${all.length} completed in current list` : 'No tasks in this list'}</span></div>}
    {widgetId === 'task.deadlines' && <div className="ui-split pilot-deadlines"><Stat value={overdue} label="Overdue" /><Stat value={today} label="Today · upcoming" /></div>}
    {widgetId === 'dev.recovery' && <p>Track mirror, local clone and export recovery steps.</p>}
    {widgetId === 'task.reminders' && <p>Due state only. Notifications are not enabled.</p>}
    {error && <StateView role="alert">{error}</StateView>}
    {draft ? <section aria-label="Review item change">
      <p>{draft.action}: {draft.item.title || data?.items?.find(item => item.id === draft.item.id)?.title}</p>
      {['add', 'edit'].includes(draft.action) && <p>{draft.item.due_at ? `Due ${new Date(draft.item.due_at).toLocaleString()}` : 'No due date'}</p>}
      <div className="widget-buttons"><Button size="small" disabled={busy} onClick={() => decide(true)}>Approve change</Button><Button size="small" disabled={busy} onClick={() => decide(false)}>Reject change</Button></div>
    </section> : <>
      {editing ? <form onSubmit={event => { event.preventDefault(); propose(editing.id ? 'edit' : 'add', { id: editing.id || null, title: editing.title, due_at: editing.due ? new Date(editing.due).toISOString() : null }) }}>
        <label>Title<Input required maxLength={500} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
        {widgetId !== 'dev.recovery' && <label>Due<Input type="datetime-local" required={['task.deadlines', 'task.reminders'].includes(widgetId)} value={editing.due} onChange={event => setEditing({ ...editing, due: event.target.value })} /></label>}
        <div className="widget-buttons"><Button size="small" disabled={busy} type="submit">Review change</Button><Button size="small" disabled={busy} type="button" onClick={() => setEditing(null)}>Cancel</Button></div>
      </form> : <form className="widget-inline-add" onSubmit={event => { event.preventDefault(); if (!title.trim()) return; if (widgetId === 'task.today') propose('add', { title: title.trim(), due_at: null }); else { setEditing({ title, due: '' }); setTitle('') } }}><Input required aria-label="New item title" placeholder="Add a task…" maxLength={500} value={title} onChange={event => setTitle(event.target.value)} /><Button variant="primary" size="small" type="submit" disabled={busy}>Add item</Button></form>}
      <ul className="widget-list">{(data?.items || []).map(item => {
        const isCompleted = item.completed || item.status === 'done' || item.state === 'done'
        const due = new Date(item.due_at || NaN)
        const isOverdue = !isCompleted && due.getTime() <= now
        return <WidgetRow key={item.id} className="task-item-row">
          <div className="task-content-wrap">
            {widgetId === 'task.today' && item.editable && (
              <Checkbox checked={Boolean(isCompleted)} disabled={busy || Boolean(isCompleted)} aria-label={`Toggle complete ${item.title}`} onCheckedChange={() => propose('complete', { id: item.id })} />
            )}
            <div className={`task-label-wrap${isCompleted ? ' is-completed' : ''}`}>
              <strong>{item.title}</strong>
              {widgetId === 'task.backlog' && <p>Idle {item.idle_days} {item.idle_days === 1 ? 'day' : 'days'}</p>}
              {item.due_at && (
                <WidgetChip className={`task-due-chip ${isOverdue ? 'is-overdue' : 'is-due'}`}>
                  {isCompleted ? 'Completed' : isOverdue ? 'Overdue' : 'Due'} · {Number.isFinite(due.getTime()) ? <time dateTime={item.due_at}>{due.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time> : 'Time unavailable'}
                </WidgetChip>
              )}
              {widgetId === 'task.deadlines' && !isCompleted && <p>{countdown(item.due_at, now)}</p>}
            </div>
          </div>
          {item.editable ? <details className="widget-row-menu"><summary aria-label={`Actions ${item.title}`}>Actions</summary><div className="widget-buttons">
            <Button size="small" disabled={busy} aria-label={`Edit ${item.title}`} onClick={() => setEditing({ id: item.id, title: item.title, due: localInput(item.due_at) })}>Edit</Button>
            <Button size="small" disabled={busy} aria-label={`Complete ${item.title}`} onClick={() => propose('complete', { id: item.id })}>Complete</Button>
            <Button size="small" disabled={busy} aria-label={`Delete ${item.title}`} onClick={() => propose('delete', { id: item.id })}>Delete</Button>
          </div></details> : <span className="task-source-note">Edit in connected source.</span>}
        </WidgetRow>
      })}</ul>
      {!(data?.items?.length) && widgetId?.startsWith('task.') && !msConnected && !editing && (
        <div className="widget-empty-connect" style={{ padding: '16px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <Button
            size="small"
            variant="primary"
            disabled={msConnecting}
            onClick={connectMicrosoft}
          >
            {msConnecting ? 'Connecting…' : 'Connect Microsoft To Do'}
          </Button>
        </div>
      )}
    </>}
  </div>
}
