import { WidgetRow, WidgetChip, StateView } from '../primitives.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { request } from '../api.js'
import { api } from '../../api.js'
import { Checkbox, Ring, Stat } from '../../components/ui/bento/index.jsx'
import Button from '../../components/ui/AppButton.jsx'
import { Input } from '../../components/ui/input.tsx'
import { WidgetRenderer } from '@tugan/widgets'
import backlogTemplate from '../../../../widgets/task.backlog/template.txt?raw'
import backlogDesign from '../../../../widgets/task.backlog/design.json'
import deadlinesTemplate from '../../../../widgets/task.deadlines/template.txt?raw'
import deadlinesDesign from '../../../../widgets/task.deadlines/design.json'
import remindersTemplate from '../../../../widgets/task.reminders/template.txt?raw'
import remindersDesign from '../../../../widgets/task.reminders/design.json'
import LocalReview from './LocalReview.jsx'
import './task-generated.css'

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

function GeneratedBacklog({ data, refresh, size = 'm', full = false }) {
  const effectiveSize = full ? 'l' : size
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => observer.disconnect()
  }, [])
  const widgetData = useMemo(() => {
    if (!data || data.state === 'loading') return null
    const tasks = (data.items || []).map(item => ({
      id: String(item.id), title: item.title, project: item.project || 'Not available',
      age: Number.isFinite(item.idle_days) ? item.idle_days : 'Not available',
      priority: item.important ? 'Urgent' : item.priority || 'Normal',
      status: item.status === 'in_progress' ? 'In progress' : 'Open',
    })).sort((a, b) => (b.priority === 'Urgent') - (a.priority === 'Urgent') || (b.age || 0) - (a.age || 0))
    const urgent = tasks.filter(task => task.priority === 'Urgent')
    const regular = tasks.filter(task => task.priority !== 'Urgent')
    const sections = [
      { id: 'urgent', title: 'Important', attention: urgent.length > 0, ids: urgent.map(task => task.id) },
      { id: 'regular', title: 'Other tasks', attention: false, ids: regular.map(task => task.id) },
    ].filter(section => section.ids.length)
    return {
      ...backlogDesign,
      appearance: theme,
      sizeChoice: effectiveSize === 'l' ? 'large' : effectiveSize === 's' ? 'small' : 'medium',
      variantBySize: { small: 'minimal', medium: 'priority', large: 'grouped' },
      recommendedId: tasks[0]?.id || '',
      recommendationReason: tasks[0] ? 'Important tasks come first; age breaks ties.' : '',
      projects: [...new Set(tasks.map(task => task.project))].map(project => ({ id: project, name: project })),
      mediumTaskIds: tasks.slice(0, 3).map(task => task.id),
      mediumSections: sections.map(section => ({ ...section, ids: section.ids.filter(id => tasks.slice(0, 3).some(task => task.id === id)) })).filter(section => section.ids.length),
      splitSections: sections.map(section => ({ id: section.id, title: section.title, priorities: section.ids })),
      labels: { ...backlogDesign.labels, studies: 'Backlog', sampleNote: '', timelineNote: '', groupedAttention: '' },
      status: data.stale ? 'stale' : tasks.length ? 'ready' : 'empty',
      tasks,
    }
  }, [data, effectiveSize, theme])
  if (!widgetData) return <div className="task-state-card" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--w-card, #1c1c1e)', border: '1px solid var(--w-border, rgba(255,255,255,0.08))', borderRadius: 'var(--w-radius, 24px)', padding: '16px', boxSizing: 'border-box' }}><StateView>Loading backlog…</StateView></div>
  if (data?.state === 'error' || data?.error) return <div className="task-state-card" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--w-card, #1c1c1e)', border: '1px solid var(--w-border, rgba(255,255,255,0.08))', borderRadius: 'var(--w-radius, 24px)', padding: '16px', boxSizing: 'border-box' }}><StateView role="alert">{data.error || 'Backlog could not be loaded. Retry from the widget menu.'}</StateView></div>
  if (data?.state === 'not-connected') return <div className="task-state-card" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--w-card, #1c1c1e)', border: '1px solid var(--w-border, rgba(255,255,255,0.08))', borderRadius: 'var(--w-radius, 24px)', padding: '16px', boxSizing: 'border-box' }}><StateView>Connect the task source to view your backlog.</StateView></div>
  return <LocalReview widgetId="task.backlog" refresh={refresh}>{propose => <div className="task-generated-content">
    {full && <details className="task-widget-compose"><summary>Add to backlog</summary><form onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      propose('add', { title: form.get('title'), due_at: null })
    }}><label>Task title<Input name="title" required maxLength={500} /></label><Button type="submit">Review task</Button></form></details>}
    <WidgetRenderer template={backlogTemplate} data={widgetData} theme={theme} />
    {full && <details className="task-widget-settings"><summary>Manage backlog tasks</summary>{(data.items || []).filter(item => item.editable).map(item => <div className="task-widget-row-actions" key={item.id}><span>{item.title}</span><Button type="button" onClick={() => propose('complete', { id: item.id })}>Complete</Button><Button type="button" onClick={() => propose('edit', { id: item.id, title: item.title, due_at: item.due_at, important: !item.important })}>{item.important ? 'Remove importance' : 'Mark important'}</Button><Button type="button" onClick={() => propose('delete', { id: item.id })}>Remove</Button></div>)}</details>}
  </div>}</LocalReview>
}

function GeneratedDatedItems({ data, refresh, size = 'm', full = false, widgetId }) {
  const effectiveSize = full ? 'l' : size
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light')
  const [clockMs, setClockMs] = useState(Date.now)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light'))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const timer = setInterval(() => setClockMs(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  const widgetData = useMemo(() => {
    if (!data || data.state === 'loading') return null
    const localDate = value => {
      const date = new Date(value)
      return Number.isFinite(date.getTime()) ? date : null
    }
    if (widgetId === 'task.deadlines') {
      const deadlines = (data.items || []).map(item => {
        const dueMs = item.due_at ? new Date(item.due_at).getTime() : NaN
        return {
          id: String(item.id), title: item.title, project: 'Not available',
          dateLabel: Number.isFinite(dueMs) ? new Date(dueMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available',
          compactDate: Number.isFinite(dueMs) ? new Date(dueMs).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'Not available',
          offsetMinutes: Number.isFinite(dueMs) ? Math.round((dueMs - clockMs) / 60000) : null,
          remaining: Number.isFinite(dueMs) ? countdown(item.due_at, clockMs) : 'Not available',
          progress: null, note: 'Completion progress is not available for deadlines.',
        }
      })
      return {
        ...deadlinesDesign, sizeChoice: effectiveSize === 'l' ? 'large' : 'medium', variation: 'first',
        deadlines, clockRunning: true, elapsedMinutes: 0, demoStartMs: clockMs,
        dayMinutes: new Date(clockMs).getHours() * 60 + new Date(clockMs).getMinutes(),
        weekMinutes: new Date(clockMs).getDay() * 1440 + new Date(clockMs).getHours() * 60 + new Date(clockMs).getMinutes(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        labels: { ...deadlinesDesign.labels, collection: '', sampleNote: '', clockPrefix: 'Updated ', clockNote: 'Countdown uses the current device time.', pauseClock: 'Pause countdown', resumeClock: 'Resume countdown', resetClock: 'Restart countdown' },
      }
    }
    const now = new Date(clockMs)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const timePart = value => {
      const d = new Date(value)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const reminders = (data.items || []).map(item => {
      const due = localDate(item.due_at)
      const todayDate = new Date(today)
      const dueDate = due && new Date(due.getFullYear(), due.getMonth(), due.getDate())
      const dayDelta = dueDate ? Math.round((dueDate - todayDate) / 86400000) : null
      return {
        id: String(item.id), title: item.title, day: dayDelta === 0 ? 'today' : dayDelta === 1 ? 'tomorrow' : 'later',
        time: due ? timePart(due) : 'Not available',
        dueLabel: due ? due.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available',
        category: 'Not available', priority: 'Not available', repeat: 'Not available', done: false,
      }
    })
    return {
      ...remindersDesign, direction: 'editorial', widgetSize: effectiveSize === 'l' ? 'large' : 'medium',
      darkAppearance: theme === 'dark', items: reminders,
      labels: { ...remindersDesign.labels, galleryTitle: 'Reminders', gallerySubtitle: '', sampleNote: '', scheduleEyebrow: '', prioritySuffix: ' reminders open' },
    }
  }, [data, effectiveSize, widgetId, clockMs, theme])
  if (!widgetData) return <div className="task-state-card" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--w-card, #1c1c1e)', border: '1px solid var(--w-border, rgba(255,255,255,0.08))', borderRadius: 'var(--w-radius, 24px)', padding: '16px', boxSizing: 'border-box' }}><StateView>Loading {widgetId === 'task.deadlines' ? 'deadlines' : 'reminders'}…</StateView></div>
  if (data?.state === 'error' || data?.error) return <div className="task-state-card" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--w-card, #1c1c1e)', border: '1px solid var(--w-border, rgba(255,255,255,0.08))', borderRadius: 'var(--w-radius, 24px)', padding: '16px', boxSizing: 'border-box' }}><StateView role="alert">{data.error || 'Could not load items. Retry from the widget menu.'}</StateView></div>
  if (data?.state === 'not-connected') return <div className="task-state-card" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--w-card, #1c1c1e)', border: '1px solid var(--w-border, rgba(255,255,255,0.08))', borderRadius: 'var(--w-radius, 24px)', padding: '16px', boxSizing: 'border-box' }}><StateView>Connect the task source to view these items.</StateView></div>
  if (widgetId === 'task.reminders' && !(data.items || []).length) return <div className="task-state-card" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--w-card, #1c1c1e)', border: '1px solid var(--w-border, rgba(255,255,255,0.08))', borderRadius: 'var(--w-radius, 24px)', padding: '16px', boxSizing: 'border-box' }}><StateView>No reminders are saved yet. Add one to start your list.</StateView></div>
  const template = widgetId === 'task.deadlines' ? deadlinesTemplate : remindersTemplate
  return <LocalReview widgetId={widgetId} refresh={refresh}>{propose => <div className="task-generated-content">
    {full && widgetId === 'task.reminders' && <details className="task-widget-compose"><summary>Add reminder</summary><form onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const due = new Date(form.get('due_at'))
      if (!Number.isFinite(due.getTime())) return
      propose('add', { title: form.get('title'), due_at: due.toISOString() })
    }}><label>Reminder title<Input name="title" required maxLength={500} /></label><label>Due<Input name="due_at" type="datetime-local" required /></label><Button type="submit">Review reminder</Button></form></details>}
    <WidgetRenderer template={template} data={widgetData} theme={theme} onAction={action => {
      if (widgetId === 'task.deadlines' && action?.type === 'task.deadlines.complete') {
        const item = data?.items?.find(row => String(row.id) === String(action.payload?.id))
        if (item?.editable) propose('complete', { id: item.id })
      }
      if (widgetId === 'task.reminders' && action?.type === 'task.reminders.complete') {
        const item = data?.items?.find(row => String(row.id) === String(action.payload?.id))
        if (item?.editable) propose('complete', { id: item.id })
      }
    }} />
    {full && widgetId === 'task.deadlines' && <details className="task-widget-settings"><summary>Manage deadlines</summary>{(data.items || []).filter(item => item.editable).map(item => <div className="task-widget-row-actions" key={item.id}><span>{item.title} · {item.due_at ? new Date(item.due_at).toLocaleString() : 'Not available'}</span><Button type="button" onClick={() => propose('complete', { id: item.id })}>Complete</Button></div>)}</details>}
  </div>}</LocalReview>
}

export default function Items(props) {
  if (props.widgetId === 'task.backlog') return <GeneratedBacklog {...props} />
  if (props.widgetId === 'task.deadlines' || props.widgetId === 'task.reminders') return <GeneratedDatedItems {...props} />
  return <LegacyItems {...props} />
}

function LegacyItems({ data, summaryData = data, widgetId }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer) }, [])
  const [title, setTitle] = useState('')
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msConnected, setMsConnected] = useState(false)
  const [msHandedOff, setMsHandedOff] = useState(false)
  const [msConnecting, setMsConnecting] = useState(false)
  const msPoll = useRef(null)
  const msAttempt = useRef(0)

  useEffect(() => {
    let cancelled = false
    if (widgetId?.startsWith('task.')) {
      api.microsoftStatus?.().then(res => {
        if (!cancelled) {
          if (res?.connected) {
            setMsConnected(true)
            setMsHandedOff(false)
          } else if (res?.handed_off) {
            setMsConnected(false)
            setMsHandedOff(true)
          }
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
          {msHandedOff && (
            <p style={{ margin: 0, fontSize: '12px', opacity: 0.8 }}>
              Signed in on your phone. Sign in here to use on PC too.
            </p>
          )}
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
