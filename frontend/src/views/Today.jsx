import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { api } from '../api.js'
import { safeStorage } from '../lib/storage.js'
import { ageLabel, dateValue, isLater, rankItems, rankTasks, safeLink } from './today/model.js'
import ConversationImport from './today/ConversationImport.jsx'
import './today/dashboard.css'

const STATES = { needs_reply: 'Your turn', waiting: 'Waiting for them', backlog: 'Backlog', done: 'Completed' }
const KINDS = { email: 'Email', message: 'Message', project: 'Project', recommendation: 'Video' }
const ICONS = { email: 'mail', message: 'chat', project: 'github', recommendation: 'play' }
const shortDate = value => dateValue(value)?.toLocaleDateString([], { month: 'short', day: 'numeric' }) || 'No date'
const time = value => dateValue(value)?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) || 'Time unavailable'
const loadItems = () => api.todayItems().then(r => r.items)
const loadTasks = () => api.tasks({ limit: 200 })
const loadCalendar = () => api.calendar(14)
const loadLibrary = () => api.library({ limit: 6 }).then(r => r.items)

// Sources settle independently. A failed refresh retains the last good result.
function useSource(loader, interval = 60000) {
  const [state, setState] = useState({ data: null, error: '', loading: true, updated: null })
  const token = useRef(0)
  const load = useCallback(async () => {
    const id = ++token.current
    setState(s => ({ ...s, loading: true }))
    try {
      const data = await loader()
      if (id === token.current) setState({ data, error: '', loading: false, updated: new Date() })
    } catch (error) {
      if (id === token.current) setState(s => ({ ...s, error: error.message || 'Could not refresh this source.', loading: false }))
    }
  }, [loader])
  useEffect(() => {
    // Starts independent external requests; source state is not derived from props.
    // oxlint-disable-next-line react/set-state-in-effect
    load()
    const refresh = () => { if (!document.hidden) load() }
    const timer = setInterval(refresh, interval)
    window.addEventListener('focus', refresh)
    // Invalidate asynchronous requests on cleanup, including StrictMode remounts.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return () => { ++token.current; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [load, interval])
  const update = useCallback(fn => {
    // A pending pre-mutation read must not overwrite an optimistic write.
    ++token.current
    setState(previous => ({ ...fn(previous), loading: false }))
  }, [])
  return { ...state, load, setState: update }
}

function SourceNotice({ source, empty, children }) {
  if (source.loading && source.data === null) return <p className="day-empty" role="status">Loading {children || 'items'}…</p>
  return <>
    {source.error && <div className="day-notice" role="status"><Icon name="warning" size={17} /><span>{source.data !== null ? 'Showing the last available data. ' : ''}{source.error}</span><button onClick={source.load}>Retry</button></div>}
    {!source.error && !source.data?.length && empty && <p className="day-empty">{empty}</p>}
  </>
}
function Section({ title, caption, action, children, className = '' }) {
  return <section className={`day-section ${className}`} aria-label={title}><header className="day-section-head"><div><h2>{title}</h2>{caption && <p>{caption}</p>}</div>{action}</header>{children}</section>
}
function ExpandList({ items, render, limit = 4 }) {
  const [all, setAll] = useState(false)
  return <>{(all ? items : items.slice(0, limit)).map(render)}{items.length > limit && <button className="day-more" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show ${items.length - limit} more`}<Icon name={all ? 'chevron-up' : 'chevron-down'} size={16} /></button>}</>
}
function Item({ item, now, update, busy }) {
  const [expanded, setExpanded] = useState(false)
  const later = isLater(item, now)
  const overdue = item.follow_up_at && dateValue(item.follow_up_at) <= now && !later
  return <article className={`day-item${item.priority && !later ? ' day-item--priority' : ''}`}>
    <button className="day-item-main" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span className="day-item-icon"><Icon name={ICONS[item.kind]} size={20} /></span>
      <span className="day-item-copy"><span className="day-meta">{item.source} · {STATES[item.state]}{item.priority && <span className="day-priority"><Icon name="pin" size={12} /> Priority</span>}</span><strong>{item.title}</strong>{item.summary && <span className="day-summary">{item.summary}</span>}<span className="day-meta">{item.occurred_at ? 'Activity ' : 'Tracked '}{ageLabel(item.occurred_at || item.created_at, now)}{item.follow_up_at && <span className={overdue ? 'day-due' : ''}> · Follow up {shortDate(item.follow_up_at)}{overdue ? ' · Due' : ''}</span>}{item.snoozed_until && later && item.state !== 'done' && ` · Snoozed until ${shortDate(item.snoozed_until)}`}</span></span>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
    </button>
    {expanded && <div className="day-item-detail">
      {item.summary && <p>{item.summary}</p>}
      <p className="day-meta">Last recorded {ageLabel(item.updated_at, now)}. {item.kind === 'email' && item.source.toLowerCase() === 'gmail' && item.external_id ? 'Gmail activity is checked about every five minutes while Today is open. Reply status is yours to update.' : 'This source is updated manually or by the agent.'}{item.sync?.checked_at && ` Last checked ${ageLabel(item.sync.checked_at, now)}.`}</p>
      <>{item.sync?.error && <p className="day-notice" role="status">{item.sync.error}</p>}</>
      <div className="day-item-controls">
        <label>Status<select value={item.state} disabled={busy} onChange={e => update(item, { state: e.target.value })}>{Object.entries(STATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Follow-up date<input type="date" value={item.follow_up_at ? new Date(item.follow_up_at).toLocaleDateString('en-CA') : ''} disabled={busy} onChange={e => update(item, { follow_up_at: e.target.value ? new Date(`${e.target.value}T09:00:00`).toISOString() : null })} /></label>
      </div>
      <div className="day-actions">
        {safeLink(item.url) && <a href={safeLink(item.url)} target="_blank" rel="noreferrer">Open source<Icon name="arrow-up-right" size={16} /></a>}
        <button disabled={busy} onClick={() => update(item, { priority: !item.priority })}><Icon name="pin" size={16} />{item.priority ? 'Unpin' : 'Prioritize'}</button>
        <button disabled={busy} onClick={() => update(item, { snoozed_until: later ? null : new Date(now.getTime() + 86400000).toISOString(), ...(item.state === 'done' ? { state: item.kind === 'project' ? 'backlog' : 'needs_reply' } : {}) })}>{later ? 'Bring back' : 'Snooze 1 day'}</button>
        {item.state !== 'done' && <button disabled={busy} onClick={() => update(item, { state: 'done' })}><Icon name="check-simple" size={16} />Done</button>}
      </div>
    </div>}
  </article>
}
function TrackForm({ onSave, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form className="day-track-form" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('')
    const values = Object.fromEntries(new FormData(e.currentTarget))
    try { await onSave({ ...values, priority: values.priority === 'on', follow_up_at: values.follow_up_at ? new Date(`${values.follow_up_at}T09:00:00`).toISOString() : null }); onClose() } catch (err) { setError(err.message) } finally { setBusy(false) }
  }}>
    <div className="day-section-head"><h2>Keep something in view</h2><button type="button" onClick={onClose} aria-label="Close tracking form"><Icon name="x" size={20} /></button></div>
    <label>What are you tracking?<input autoFocus required name="title" maxLength={240} placeholder="Follow up with GitHub support" /></label>
    <div className="day-form-grid"><label>Type<select name="kind">{Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Status<select name="state">{Object.entries(STATES).filter(([v]) => v !== 'done').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Source<input name="source" defaultValue="Manual" required maxLength={80} /></label><label>Follow up<input type="date" name="follow_up_at" /></label></div>
    <label>Link to the conversation or project<input type="url" name="url" placeholder="https://…" maxLength={2000} /></label>
    <label>Context<textarea name="summary" rows={2} maxLength={4000} placeholder="What happened, and what needs to happen next?" /></label>
    <label className="day-checkbox"><input type="checkbox" name="priority" />Keep this at the top</label>
    {error && <p role="alert" className="day-due">{error}</p>}
    <div className="day-actions"><button className="day-primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Start tracking'}</button><button type="button" onClick={onClose}>Cancel</button></div>
  </form>
}
function Weather() {
  const [location, setLocation] = useState(() => { try { return JSON.parse(safeStorage.getItem('amethyst-today-location') || 'null') } catch { return null } })
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const loader = useCallback(() => location ? api.todayWeather(location) : Promise.resolve(null), [location])
  const weather = useSource(loader, 1800000)
  const current = weather.data?.current
  const code = current?.weather_code
  const description = code === 0 ? 'Clear' : code <= 3 ? 'Cloudy' : code <= 48 ? 'Fog' : code <= 67 ? 'Rain' : code <= 77 ? 'Snow' : code <= 86 ? 'Showers' : 'Thunderstorms'
  return <div className="day-weather">
    <button onClick={() => setEditing(!editing)} aria-expanded={editing}><Icon name={code === 0 ? 'sun' : 'cloud'} size={22} /><span>{current ? `${Math.round(current.temperature_2m)}°C · ${description}` : weather.loading && location ? 'Loading weather…' : 'Set weather location'}<small>{location?.name || 'Choose your city'}</small></span></button>
    {(weather.error || weather.data?.error) && <span className="day-meta">{weather.error || weather.data.error}</span>}
    {editing && <div className="day-weather-picker"><form onSubmit={async e => { e.preventDefault(); setSearching(true); setError(''); try { setMatches((await api.todayLocations(query)).items) } catch (err) { setError(err.message) } finally { setSearching(false) } }}><label>City<input value={query} onChange={e => setQuery(e.target.value)} minLength={2} maxLength={100} required placeholder="Search city" /></label><button disabled={searching}>{searching ? 'Searching…' : 'Find city'}</button></form>{error && <p role="alert">{error}</p>}{matches?.length === 0 && <p>No cities found. Try another spelling.</p>}{matches?.map((match, i) => <button key={i} onClick={() => { setLocation(match); safeStorage.setItem('amethyst-today-location', JSON.stringify(match)); setEditing(false) }}>{match.name}</button>)}<p className="day-meta">City search and coordinates are sent to <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>.</p></div>}
  </div>
}
function Inbox({ onTrack, now, tracked }) {
  const source = useSource(api.todayMail, 60000)
  useEffect(() => {
    if (!source.data?.refreshing) return
    const timer = setTimeout(source.load, 1500)
    return () => clearTimeout(timer)
  }, [source.data, source.load])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const mail = source.data
  return <>
    <div className="day-inbox-note"><span>Unread, starred, or important. Choose the threads that need a reply.</span><button disabled={source.loading || mail?.refreshing} onClick={() => api.todayMail(true).then(data => source.setState(s => ({ ...s, data }))).catch(err => setError(err.message))}>Refresh inbox</button></div>
    <SourceNotice source={source} />
    {mail?.error && <p className="day-notice" role="status">{mail.error}{mail.updated_at ? ` Last success ${ageLabel(mail.updated_at, now)}.` : ''}</p>}
    {error && <p role="alert" className="day-due">{error}</p>}
    {mail?.refreshing && <p className="day-meta" role="status">Refreshing mail in the background…</p>}
    {mail && !mail.error && !mail.refreshing && !mail.items.length && <p className="day-empty">No unread, starred, or important inbox messages.</p>}
    <ExpandList items={mail?.items || []} limit={5} render={m => {
      const exists = tracked.some(item => item.source === 'Gmail' && item.external_id === (m.thread_id || m.id))
      return <article key={m.id} className="day-inbox-row"><div><span className="day-meta">{m.from} · {ageLabel(m.date, now)}</span><strong>{m.subject}</strong><p className="day-summary">{m.snippet}</p></div><button disabled={busy === m.id || exists} onClick={async () => {
        setBusy(m.id); setError('')
        try { await onTrack({ kind: 'email', title: m.subject, summary: `${m.from}\n${m.snippet || ''}`, source: 'Gmail', external_id: m.thread_id || m.id, url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.thread_id || m.id)}`, occurred_at: dateValue(m.date)?.toISOString() || null, priority: Boolean(m.starred), state: 'needs_reply' }) } catch (err) { setError(err.message) } finally { setBusy(null) }
      }}>{exists ? 'Tracked' : busy === m.id ? 'Saving…' : 'Track reply'}</button></article>
    }} />
  </>
}

export default function Today() {
  const { setView, toast } = useApp()
  const [now, setNow] = useState(new Date())
  const [filter, setFilter] = useState('active')
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(new Set())
  const [taskTitle, setTaskTitle] = useState('')
  const [taskSaving, setTaskSaving] = useState(false)
  const [prompt, setPrompt] = useState('')
  const tracked = useSource(loadItems, 30000)
  const tasks = useSource(loadTasks)
  const calendar = useSource(loadCalendar)
  const library = useSource(loadLibrary)
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(timer) }, [])
  const all = tracked.data || []
  const active = rankItems(all.filter(item => !isLater(item, now)), now)
  const attention = active.filter(item => ['email', 'message'].includes(item.kind))
  const filtered = filter === 'later' ? all.filter(item => isLater(item, now)) : filter === 'active' ? attention : attention.filter(item => item.state === filter)
  const openTasks = rankTasks(tasks.data || [], now)
  const events = (calendar.data || []).filter(e => (dateValue(e.ends_at || e.starts_at)?.getTime() || 0) >= now.getTime()).sort((a, b) => dateValue(a.starts_at) - dateValue(b.starts_at))
  const hour = now.getHours()
  const greeting = hour < 5 ? 'A quiet start' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const track = async body => { const row = await api.trackTodayItem(body); tracked.setState(s => ({ ...s, data: [row, ...(s.data || []).filter(i => i.id !== row.id)] })); return row }
  const update = async (item, patch) => {
    setBusy(s => new Set(s).add(item.id))
    tracked.setState(s => ({ ...s, data: s.data.map(i => i.id === item.id ? { ...i, ...patch } : i) }))
    try { const row = await api.updateTodayItem(item.id, patch); tracked.setState(s => ({ ...s, data: s.data.map(i => i.id === item.id ? row : i) })) } catch (err) { tracked.setState(s => ({ ...s, data: s.data.map(i => i.id === item.id ? item : i) })); toast(err.message, 'bad') } finally { setBusy(s => { const next = new Set(s); next.delete(item.id); return next }) }
  }
  const renderItem = item => <Item key={item.id} item={item} now={now} update={update} busy={busy.has(item.id)} />
  const ask = text => { setView('chat'); window.dispatchEvent(new CustomEvent('amethyst-send-prompt', { detail: { text, submit: false } })) }
  return <div className="view day-view"><div className="day-shell">
    <header className="day-header"><div><p className="day-eyebrow">TODAY <span>/</span> {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p><h1>{greeting}.</h1><p className="day-intro">A little clarity for the day ahead.</p></div><div className="day-conditions"><div className="day-clock"><time dateTime={now.toISOString()}>{time(now)}</time><span>{Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ')}</span></div><Weather /></div></header>
    <div className="day-overview" aria-label="Day at a glance"><div><Icon name="pin" size={18} /><span><b>{tracked.data === null ? '—' : attention.filter(i => i.priority).length}</b> priorities in view</span></div><div><Icon name="tasks" size={18} /><span><b>{tasks.data === null ? '—' : openTasks.length}</b> open tasks{openTasks.length === 200 ? ' (first 200)' : ''}</span></div><div><Icon name="calendar" size={18} /><span>{calendar.data === null ? 'Checking your calendar' : events[0] ? <>Next: <b>{time(events[0].starts_at)}</b> · {shortDate(events[0].starts_at)}</> : 'No upcoming events recorded'}</span></div></div>
    <div className="day-layout"><div className="day-main-column">
      <Section title="Needs your attention" caption="The conversations you don’t want to lose track of." action={<button className={adding || importing ? '' : 'day-primary'} onClick={() => { setAdding(!adding); setImporting(false) }}><Icon name="plus" size={18} />Track something</button>}>
        {importing && <ConversationImport onSaved={() => { tracked.load(); setImporting(false) }} onClose={() => setImporting(false)} />}
        {adding && <TrackForm onSave={track} onClose={() => setAdding(false)} />}
        <div className="day-filters" role="group" aria-label="Filter attention"><button aria-pressed={filter === 'active'} onClick={() => setFilter('active')}>Tracked <span>{attention.length}</span></button><button aria-pressed={filter === 'needs_reply'} onClick={() => setFilter('needs_reply')}>Your turn</button><button aria-pressed={filter === 'waiting'} onClick={() => setFilter('waiting')}>Waiting</button><button aria-pressed={filter === 'inbox'} onClick={() => setFilter('inbox')}>Inbox</button><button aria-pressed={filter === 'later'} onClick={() => setFilter('later')}>Later & done</button></div>
        {filter === 'inbox' ? <Inbox onTrack={track} now={now} tracked={all} /> : <><SourceNotice source={tracked} /><ExpandList items={filtered} render={renderItem} limit={5} />{tracked.data !== null && !filtered.length && <div className="day-empty-state"><Icon name={filter === 'waiting' ? 'clock' : 'check-circle'} size={28} /><h3>{filter === 'active' ? 'Keep the important threads close.' : 'Nothing in this view.'}</h3><p>{filter === 'active' ? 'Track a reply, a support request, or a group conversation. Give it a follow-up date, and come back when it matters.' : filter === 'later' ? 'Snoozed and completed items stay here. You can bring them back anytime.' : 'Change a tracked conversation’s status to add it here.'}</p>{filter === 'active' && <button onClick={() => setFilter('inbox')}>Review your inbox<Icon name="arrow-right" size={16} /></button>}</div>}</>}
      </Section>
      <button className="day-import-link" onClick={() => { setImporting(!importing); setAdding(false) }}><Icon name="download" size={18} />Import a personal conversation<span>WhatsApp or Instagram export</span></button>
      <Section title="Projects in reach" caption="Your backlog, with a next step attached." action={<button onClick={() => ask('Review my GitHub projects and the projects we have discussed. Use connected tools to read their current state. Use track_today_item with kind project and state backlog to save the ones I should revisit, including source links and a concrete next step. Do not invent activity.')}>Review with agent<Icon name="arrow-up-right" size={16} /></button>}>
        <SourceNotice source={tracked} /><ExpandList items={active.filter(i => i.kind === 'project')} render={renderItem} limit={3} />{tracked.data && !active.some(i => i.kind === 'project') && <p className="day-empty">No projects tracked yet. Add one, or ask the agent to review your connected GitHub projects.</p>}
      </Section>
      <Section title="Pick up where you left off" caption="Recent saves stay here beyond the day you saved them." action={<button onClick={() => setView('library')}>Library<Icon name="arrow-up-right" size={16} /></button>}>
        <SourceNotice source={library} empty="Save a link, video, or note to your library to find it here." />
        <div className="day-saves">{(library.data || []).map(item => <button key={item.id} className="day-save" onClick={() => { if (safeLink(item.url)) window.open(safeLink(item.url), '_blank', 'noopener,noreferrer'); else setView('library') }}><div className="day-save-image"><Icon name={item.kind === 'video' ? 'play' : 'bookmark'} size={24} /><img loading="lazy" src={api.thumbnailUrl(item.id)} alt="" onError={e => { e.currentTarget.hidden = true }} /></div><span className="day-meta">{item.kind || 'Saved'}{item.author ? ` · ${item.author}` : ''}</span><strong>{item.title || 'Untitled save'}</strong></button>)}</div>
      </Section>
      <Section title="For a quieter moment" caption="Video suggestions with a reason to watch.">
        <ExpandList items={active.filter(i => i.kind === 'recommendation')} render={renderItem} limit={3} />{!active.some(i => i.kind === 'recommendation') && <div className="day-discovery"><Icon name="play" size={26} /><div><h3>Start with what you’re interested in.</h3><p>Recommendations can use your saved videos or viewing history you explicitly share. Your YouTube watch history is not connected.</p><button onClick={() => ask('Recommend up to three YouTube videos based on videos I have saved in my library or viewing history I have explicitly shared. Read that evidence and find real video links first. Save each using track_today_item with kind recommendation, state backlog, source YouTube, and explain why it fits in summary. If there is no evidence, ask what I have been watching.')}>Find videos from my saves<Icon name="arrow-up-right" size={16} /></button></div></div>}
      </Section>
    </div><aside className="day-side-column">
      <Section title="On your schedule" caption="Next 14 days · recorded calendar events">
        <SourceNotice source={calendar} empty="No upcoming events recorded. Ask the agent to add your plans or check your connected calendar." />
        <ExpandList items={events} limit={5} render={(event, index) => <div className="day-event" key={event.id || index}><div><time>{time(event.starts_at)}</time><span>{shortDate(event.starts_at)}</span></div><div><strong>{event.title}</strong><p>{event.location || `${time(event.starts_at)} – ${time(event.ends_at)}`}</p></div></div>} />
        <button className="day-more" onClick={() => ask('Check my upcoming calendar events using the connected calendar tools and help me plan today. If external events are not in the local calendar, explain that rather than claiming the dashboard is synced.')}>Plan with agent<Icon name="arrow-up-right" size={16} /></button>
      </Section>
      <Section title="Your next steps" caption="Overdue first, then important and upcoming." action={<button onClick={() => setView('tasks')}>All tasks<Icon name="arrow-up-right" size={16} /></button>}>
        <SourceNotice source={tasks} empty="Your task list is clear. Add your next step below." />
        <ExpandList items={openTasks} limit={5} render={task => <div className="day-task" key={task.id}><button aria-label={`Complete ${task.title}`} disabled={busy.has(`task:${task.id}`)} onClick={async () => {
          const key = `task:${task.id}`; setBusy(s => new Set(s).add(key))
          tasks.setState(s => ({ ...s, data: s.data.map(t => t.id === task.id ? { ...t, status: 'done' } : t) }))
          try { await api.updateTask(task.id, { status: 'done' }); toast('Task completed', 'good') } catch (err) { tasks.setState(s => ({ ...s, data: s.data.map(t => t.id === task.id ? task : t) })); toast(err.message, 'bad') } finally { setBusy(s => { const next = new Set(s); next.delete(key); return next }) }
        }}><span className="day-task-check" /></button><div><strong>{task.title}</strong><span className={task.due_at && dateValue(task.due_at) < now ? 'day-meta day-due' : 'day-meta'}>{task.important ? 'Important · ' : ''}{task.due_at ? `${dateValue(task.due_at) < now ? 'Overdue · ' : 'Due '}${shortDate(task.due_at)}` : 'No due date'}</span></div></div>} />
        <form className="day-add-task" onSubmit={async e => { e.preventDefault(); if (!taskTitle.trim()) return; setTaskSaving(true); try { await api.createTask({ title: taskTitle.trim() }); setTaskTitle(''); tasks.load() } catch (err) { toast(err.message, 'bad') } finally { setTaskSaving(false) } }}><input aria-label="New task" placeholder="Add a small next step…" value={taskTitle} maxLength={240} onChange={e => setTaskTitle(e.target.value)} /><button aria-label="Add task" disabled={taskSaving || !taskTitle.trim()}><Icon name="plus" size={20} /></button></form>
      </Section>
      <details className="day-connections"><summary><Icon name="connectors" size={18} />Your sources & privacy<Icon name="chevron-down" size={16} /></summary><p>Tasks, tracked items, and cached readings stay in the local Amethyst database.</p><ul><li>Gmail refreshes when you open Inbox.</li><li>Calendar shows locally recorded events.</li><li>GitHub and other summaries are captured by the agent through your available connections.</li><li>Personal WhatsApp and Instagram conversations can be imported from exports. They do not sync automatically. Discord message access depends on the connector and channel permissions.</li><li>Tracked native Gmail threads refresh while Today is open. Other sources need imports or agent review. Reply status is updated manually.</li></ul><button onClick={() => setView('capabilities')}>Manage connections<Icon name="arrow-up-right" size={16} /></button></details>
    </aside></div>
    <form className="day-ask" onSubmit={e => { e.preventDefault(); if (prompt.trim()) ask(prompt.trim()) }}><Icon name="sparkle" size={21} /><input aria-label="Ask Amethyst" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Ask Amethyst to track, plan, or help you catch up…" /><button disabled={!prompt.trim()} aria-label="Continue in chat"><Icon name="arrow-right" size={20} /></button></form>
  </div></div>
}
