import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useApp } from '../store.jsx'
import { useViewEntrance } from '../motion.js'
import { api } from '../api.js'
import { SkeletonRows } from '../components/Skeleton.jsx'

/* The task list, in the shape people already keep tasks in.

   Buckets are computed on the server, never stored: "missed" is a query, not a
   flag someone has to set and something has to unset. The counts and the rows
   come from the same predicate, so a rail saying 5 over a list of 4 is not a
   state this can reach.

   My Day is a list. To Do's own My Day is not in its API at all -- verified
   live, not assumed: showInMyDay and isInMyDay both 400 as unknown properties
   on todoTask, and the live beta schema has no field containing "day" -- and a
   "My Day" category, which was the previous answer, is invisible to a task
   added through To Do's own My Day on the phone. An ordinary list called My Day
   is the one thing both ends can see and edit. So the sun *moves* a task into
   that list, and the list is this bucket. */

const BUCKETS = [
  { id: 'my_day', label: 'My Day', icon: 'sun', blurb: 'Your To Do list called My Day.' },
  { id: 'missed', label: 'Missed', icon: 'clock', blurb: 'Past its deadline and still open.' },
  { id: 'important', label: 'Important', icon: 'star', blurb: 'Flagged, whatever the date.' },
  { id: 'general', label: 'General', icon: 'list', blurb: 'No date attached.' },
  { id: 'all', label: 'All open', icon: 'check', blurb: 'Everything still to do.' },
  { id: 'completed', label: 'Completed', icon: 'archive', blurb: 'Done. Cancelled is not done.' },
]

function when(value) {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isOverdue(task) {
  if (!task.due_at || task.status === 'done' || task.status === 'cancelled') return false
  return new Date(task.due_at.replace(' ', 'T')) < new Date(new Date().toDateString())
}

function parse(value) {
  if (!value) return null
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}

/* The day a card leads with: named while the name still means something, dated
   once it does not. */
function dayLabel(value) {
  const date = parse(value)
  if (!date) return null
  const days = Math.round(
    (new Date(date.toDateString()) - new Date(new Date().toDateString())) / 86400000,
  )
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  // The year only when it is not this one: "8 Sept 2026" in 2026 is a date
  // stamp, where "8 Sept" is a day.
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year })
}

/* Midnight is what a date with no time looks like once it has been stored as a
   timestamp, and printing "12.00 AM" under every all-day task would be reading
   the storage back rather than the task. */
function clock(value) {
  const date = parse(value)
  if (!date || (date.getHours() === 0 && date.getMinutes() === 0)) return null
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/* Scheduled to due when a task has both, one time when it has one.

   Only when the two are in that order, though: `scheduled_at` is when to start
   and `due_at` is the deadline, and nothing stops a task being scheduled for
   the afternoon of a morning deadline. Printing that pair as a range gives
   "14:30 - 09:30", which reads as a bug in the clock. */
function span(task) {
  const start = clock(task.scheduled_at)
  const end = clock(task.due_at)
  if (start && end && parse(task.scheduled_at) < parse(task.due_at)) return `${start} – ${end}`
  return end || start
}

/* Which of the six dot colours each list wears, in the rail and on its chips.

   Local decoration only: Graph's `todoTaskList` carries no colour field, so a
   stored one would be a colour the phone can never agree with. Assigned by
   creation order rather than hashed from the name, because a hash collides --
   five lists over six colours is more likely to repeat one than not, and two
   lists sharing a colour is what the colour is there to prevent. New lists land
   at the end, so an existing list keeps its colour when one is added. */
function huesByList(lists) {
  const order = [...lists].sort((a, b) => a.id - b.id)
  return new Map(order.map((list, i) => [list.id, i % 6]))
}

/* What the reminder loop will do with this row, in the row's own words -- and
   nothing when the deadline chip beside it already says so. The fallback to
   `due_at` used to be spelled out, which put "was due 8 Sept, 09:30" and
   "reminder 8 Sept, 09:30" next to each other on the same card. */
function reminder(task) {
  if (task.reminded_at) return `reminded ${when(task.reminded_at)}`
  if (task.reminder_at) return `reminder ${when(task.reminder_at)}`
  return null
}

/* Adding a task without a model call.

   The date is typed the way it is spoken -- "tomorrow", "friday 5pm" -- and
   resolved on the server by the same scheduling engine the agent's tools use,
   so a task typed here and one created in a turn cannot disagree about what
   "tomorrow" means. Every field the API accepts is here: the composer used to
   offer three of them, which made the browser the least capable way to make a
   task. */
function Composer({ lists, presetList, onAdded, onCancel }) {
  const { toast } = useApp()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [remind, setRemind] = useState('')
  const [notes, setNotes] = useState('')
  const [list, setList] = useState(presetList || '')
  const [important, setImportant] = useState(false)
  const [myDay, setMyDay] = useState(false)
  const [busy, setBusy] = useState(false)
  const ready = title.trim().length > 0

  const submit = async (event) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      const made = await api.createTask({
        title: title.trim(),
        notes: notes.trim() || null,
        due_date_hint: due.trim() || null,
        reminder_hint: remind.trim() || null,
        list: list || null,
        important,
        add_to_my_day: myDay,
      })
      setTitle(''); setDue(''); setRemind(''); setNotes('')
      toast(made.routed_to ? `Task added — ${made.routed_to}` : 'Task added', 'ok')
      onAdded()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="task-composer" onSubmit={submit} data-enter>
      <input
        autoFocus
        value={title}
        placeholder="What needs doing?"
        aria-label="Task"
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="task-composer-row">
        <input
          value={due}
          placeholder="Due — tomorrow, friday 5pm"
          aria-label="Due date"
          onChange={(e) => setDue(e.target.value)}
        />
        <input
          value={remind}
          placeholder="Remind me — optional"
          aria-label="Reminder"
          onChange={(e) => setRemind(e.target.value)}
        />
        <select value={list} aria-label="List" onChange={(e) => setList(e.target.value)}>
          <option value="">Default list</option>
          {lists.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
        </select>
      </div>
      <div className="task-composer-row">
        <input
          value={notes}
          placeholder="Notes — optional"
          aria-label="Notes"
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          type="button"
          className={`btn btn--small${important ? ' btn--primary' : ' btn--ghost'}`}
          aria-pressed={important}
          onClick={() => setImportant((v) => !v)}
        >
          <Icon name="star" size={13} /> Important
        </button>
        <button
          type="button"
          className={`btn btn--small${myDay ? ' btn--primary' : ' btn--ghost'}`}
          aria-pressed={myDay}
          onClick={() => setMyDay((v) => !v)}
        >
          <Icon name="sun" size={13} /> My Day
        </button>
        <button type="submit" className="btn btn--primary btn--small" disabled={!ready || busy}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <span className="field-note">
        Dates are resolved against the real clock. Leave the reminder blank to be told at the
        deadline; leave both blank and nothing is announced.
      </span>
    </form>
  )
}

/* One tile.

   Pulled out of the list so the open pile and the done pile can be the same
   card rather than two that drift apart. */
function TaskCard({ task, lists, myDayListId, hues, view, busy, patch, drop }) {
  const done = task.status === 'done'
  const late = isOverdue(task)
  const listName = lists.find((l) => l.id === task.list_id)?.name
  const inMyDay = myDayListId != null && task.list_id === myDayListId
  const note = reminder(task)
  const day = dayLabel(task.due_at || task.scheduled_at)
  const hours = span(task)
  /* What colours the tile. The list was here first and had to go: a real
     account keeps nearly everything open in one list, so colouring by list
     painted twenty-seven tiles the same pink, and a board where every card is
     one colour is a board with no colour in it. When a task is due differs
     card to card, and is what someone is scanning for anyway. */
  const state = done ? 'done'
    : late ? 'late'
      : day === 'Today' ? 'today'
        : (task.due_at || task.scheduled_at) ? 'soon' : 'none'
  // Naming the list is worth a tag in a bucket that mixes several, and is
  // twenty-seven copies of one word in a view that is already one list.
  const showList = Boolean(listName) && (view.listId
    ? view.listId !== task.list_id
    : !(view.bucket === 'my_day' && inMyDay))

  return (
    <article
      className={`task-card${done ? ' task-row--done' : ''}${late ? ' task-row--late' : ''}${day ? '' : ' task-card--undated'}`}
      data-state={state}
    >
      {/* The day leads the card and the controls close it, the way the boards
          this is drawn from open every tile. */}
      <div className="task-card-top">
        {day && (
          <span className={`task-badge${late ? ' task-badge--late' : ''}`}>
            <Icon name={task.important && !late ? 'star' : 'clock'} size={11} />
            {late ? `was due ${day}` : day}
          </span>
        )}

        <div className="task-tools">
          {/* The sun moves the task between its list and My Day, because that
              is what My Day is. To Do has no move, so the server recreates the
              task there and deletes the original -- the toast says "moved",
              not "tagged", since the task really does leave its list. */}
          <button
            type="button"
            className={`icon-btn task-sun${inMyDay ? ' is-on' : ''}`}
            disabled={busy}
            title={inMyDay ? 'Move out of My Day' : 'Move into My Day'}
            aria-pressed={inMyDay}
            aria-label={`Move ${task.title} into My Day`}
            onClick={() => patch(
              task,
              { add_to_my_day: !inMyDay },
              inMyDay ? 'Moved out of My Day' : 'Moved into My Day',
            )}
          >
            <Icon name="sun" size={14} />
          </button>

          <button
            type="button"
            className={`icon-btn task-star${task.important ? ' is-on' : ''}`}
            disabled={busy}
            title={task.important ? 'Not important' : 'Mark important'}
            aria-pressed={Boolean(task.important)}
            aria-label={`Mark ${task.title} important`}
            onClick={() => patch(task, { important: !task.important })}
          >
            <Icon name="star" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn task-drop"
            disabled={busy}
            title="Cancel this task"
            aria-label={`Cancel ${task.title}`}
            onClick={() => drop(task)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      <div className="task-row">
        <button
          type="button"
          className={`task-check${done ? ' task-check--on' : ''}`}
          disabled={busy}
          aria-label={done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
          aria-pressed={done}
          onClick={() => patch(task, { status: done ? 'todo' : 'done' })}
        >
          {done && <Icon name="check" size={12} />}
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="task-title">{task.title}</h3>
          {task.notes && <div className="task-note">{task.notes}</div>}
        </div>
      </div>

      {/* The foot: the hours on the left, the tags on the right. */}
      {(hours || showList || note || late) && (
        <div className="task-card-foot">
          {hours && <span className="task-hours">{hours}</span>}

          {showList && (
            <span className="task-chip task-chip--list">
              <i className="task-hue-dot" data-hue={hues.get(task.list_id) ?? 5} aria-hidden="true" />
              {listName}
            </span>
          )}
          {note && <span className="task-chip">{note}</span>}

          {/* Missed cards carry their answer. Rescheduling by hand is the step
              people skip, which is how a list of overdue tasks becomes a list
              nobody opens. */}
          {late && (
            <button
              type="button"
              className="task-chip task-chip--do"
              disabled={busy}
              onClick={() => patch(task, { due_date_hint: 'tomorrow' }, 'Due tomorrow')}
            >
              Tomorrow
            </button>
          )}
        </div>
      )}
    </article>
  )
}

export default function Tasks() {
  const rootRef = useRef(null)
  const { toast, setView, chat } = useApp()
  const [view, setViewKey] = useState({ bucket: 'my_day', listId: null })
  // Whether the landing view has already been settled for this mount. My Day is
  // the right place to start a day and the wrong place to start a session that
  // has nothing in it -- an empty default view reads as a broken page.
  const landed = useRef(false)
  const [tasks, setTasks] = useState([])
  const [counts, setCounts] = useState({
    buckets: {}, lists: [], connected: false, my_day_list_id: null,
  })
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busyTask, setBusyTask] = useState(null)
  // Whether the first response has landed. Without it the empty states render
  // against an empty array — so the page opened on "Nothing picked for today
  // yet", complete with its explanation, and then replaced it with the day's
  // tasks. A page that says the wrong thing first is worse than one that says
  // nothing yet.
  const [loaded, setLoaded] = useState(false)
  useViewEntrance(rootRef)

  // Which request is the current one. Switching buckets quickly fires a new
  // `load()` before the previous one's response has landed, and an older
  // response arriving after a newer one used to overwrite the rows for the
  // bucket now showing in the rail with the bucket it left — a stale answer
  // is discarded here rather than applied.
  const loadToken = useRef(0)

  const load = useCallback(async () => {
    const token = ++loadToken.current
    try {
      const [rows, summary, cal] = await Promise.all([
        api.tasks(view.listId ? { listId: view.listId } : { bucket: view.bucket }),
        api.taskBuckets(),
        api.calendar(21),
      ])
      if (loadToken.current !== token) return
      setTasks(rows)
      setCounts(summary)
      setEvents(cal)
      setError(null)
    } catch (err) {
      if (loadToken.current !== token) return
      // `loaded` still flips true below, so without this a failed fetch
      // rendered the same empty-state copy an actually-empty bucket shows.
      // Rows cleared too, matching Mail's pattern -- a stale list under an
      // error card reads as "it half-loaded", not as "this request failed".
      setError(err.message)
      setTasks([])
      toast(err.message, 'bad')
    } finally {
      if (loadToken.current === token) setLoaded(true)
    }
  }, [view, toast])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    // `counts` starts as an empty shape, and `{}` is truthy -- so guarding on
    // its presence settled the landing view against zeroes before the first
    // response arrived, and then refused to reconsider. Wait for real data.
    if (landed.current || !counts.buckets || Object.keys(counts.buckets).length === 0) return
    const { my_day: myDay = 0, missed = 0, all = 0 } = counts.buckets
    landed.current = true
    if (myDay > 0) return
    // Nothing chosen for today: show the thing that most wants attention rather
    // than an empty room.
    if (missed > 0) setViewKey({ bucket: 'missed', listId: null })
    else if (all > 0) setViewKey({ bucket: 'all', listId: null })
  }, [counts])

  const patch = useCallback(async (task, body, note) => {
    setBusyTask(task.id)
    try {
      await api.updateTask(task.id, body)
      if (note) toast(note, 'ok')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusyTask(null)
    }
  }, [load, toast])

  const drop = useCallback(async (task) => {
    setBusyTask(task.id)
    try {
      await api.deleteTask(task.id)
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setBusyTask(null)
    }
  }, [load, toast])

  /* Microsoft To Do is pushed and pulled on a fifteen-minute loop while AMETHYST is
     up. This is the same sync on demand, for the minute after someone signs in
     or ticks something they want on their phone now. */
  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const report = await api.syncTasks()
      toast(report.summary, 'ok')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    } finally {
      setSyncing(false)
    }
  }, [load, toast])

  /* Opening the page is a request for current tasks, so it asks for one --
     quietly, once per mount, behind whatever is already on screen. The timer
     behind this runs every ninety seconds, which is close enough for a list
     left open and too far away for a list you have just walked back to.
     Failures are silent on purpose: the rows already rendered are still true,
     and the "Sync To Do" button is there for anyone who wants to be told. */
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    synced.current = true
    let cancelled = false
    api.syncTasks().then(() => { if (!cancelled) load() }).catch(() => {})
    return () => { cancelled = true }
  }, [load])

  /* Naming a list used to go through `window.prompt`, which is the one piece
     of browser chrome nobody in this application chose: it cannot be styled,
     it blocks the whole tab, Firefox lets a page suppress it after the second
     use, and it looks like a phishing attempt. An inline field in the rail it
     is adding to is both prettier and closer to the thing it makes. */
  const [namingList, setNamingList] = useState(false)
  const [listName, setListName] = useState('')

  const newList = useCallback(async (name) => {
    const clean = name.trim()
    if (!clean) return
    try {
      const made = await api.createTaskList(clean)
      toast(made.note ? `List created — ${made.note}` : 'List created', 'ok')
      setNamingList(false)
      setListName('')
      await load()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }, [load, toast])

  const hues = useMemo(() => huesByList(counts.lists), [counts.lists])

  /* Done tasks are a record, not a pile of work, and this account has 91 of
     them -- opening My Day on twenty greyed-out tiles buries the four that are
     left to do. So they are parked under their own count and expand when
     asked. The Completed bucket is the exception: there they are the point. */
  const [showDone, setShowDone] = useState(false)
  const [main, parked] = useMemo(() => {
    if (view.bucket === 'completed') return [tasks, []]
    return [
      tasks.filter((t) => t.status !== 'done'),
      tasks.filter((t) => t.status === 'done'),
    ]
  }, [tasks, view.bucket])

  const active = useMemo(() => {
    if (view.listId) {
      const found = counts.lists.find((l) => l.id === view.listId)
      return { label: found?.name || 'List', blurb: found?.external_id ? null : LOCAL_ONLY }
    }
    return BUCKETS.find((b) => b.id === view.bucket) || BUCKETS[0]
  }, [view, counts])

  return (
    <div className="view" ref={rootRef}>
      <div className="view-inner view-inner--wide">
        <header className="vheader" data-enter>
          <div>
            <h1>Tasks</h1>
            <div className="vheader-sub">
              {counts.connected
                ? 'Tasks, lists, dates and importance sync both ways with Microsoft To Do. My Day is your To Do list called My Day — the sun moves a task into it.'
                : 'Kept in AMETHYST. Sign in to Microsoft To Do from Connectors and these follow you.'}
            </div>
          </div>
          <div className="vheader-actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => setAdding((a) => !a)}
            >
              <Icon name="plus" size={15} /> New task
            </button>
            <button type="button" className="btn btn--ghost" disabled={syncing} onClick={sync}>
              <Icon name="refresh" size={15} /> {syncing ? 'Syncing…' : 'Sync To Do'}
            </button>
          </div>
        </header>

        <div className="task-layout" data-enter>
          <nav className="task-rail" aria-label="Task views">
            {BUCKETS.map((bucket) => (
              <button
                key={bucket.id}
                type="button"
                className={`task-rail-row${!view.listId && view.bucket === bucket.id ? ' is-on' : ''}`}
                aria-current={!view.listId && view.bucket === bucket.id}
                onClick={() => setViewKey({ bucket: bucket.id, listId: null })}
              >
                <Icon name={bucket.icon} size={15} />
                <span className="task-rail-label">{bucket.label}</span>
                <span className="task-rail-count">{loaded ? (counts.buckets?.[bucket.id] ?? 0) : ''}</span>
              </button>
            ))}

            <div className="task-rail-head">
              <span>Lists</span>
              <button
                type="button"
                className="icon-btn"
                title="New list"
                aria-label="New list"
                aria-expanded={namingList}
                onClick={() => setNamingList((n) => !n)}
              >
                <Icon name={namingList ? 'x' : 'plus'} size={13} />
              </button>
            </div>
            {namingList && (
              <form
                className="task-rail-new"
                onSubmit={(e) => { e.preventDefault(); newList(listName) }}
              >
                <input
                  autoFocus
                  value={listName}
                  placeholder="List name"
                  aria-label="New list name"
                  onChange={(e) => setListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setNamingList(false)
                      setListName('')
                    }
                  }}
                />
                <button type="submit" className="btn btn--primary btn--small" disabled={!listName.trim()}>
                  Add
                </button>
              </form>
            )}
            {loaded
              && counts.lists.filter((l) => l.id !== counts.my_day_list_id).length === 0 && (
              <div className="task-rail-empty">No other lists yet.</div>
            )}
            {counts.lists.filter((l) => l.id !== counts.my_day_list_id).map((l) => (
              <button
                key={l.id}
                type="button"
                className={`task-rail-row${view.listId === l.id ? ' is-on' : ''}`}
                aria-current={view.listId === l.id}
                onClick={() => setViewKey({ bucket: 'all', listId: l.id })}
              >
                {l.external_id
                  ? <i className="task-hue-dot task-rail-dot" data-hue={hues.get(l.id) ?? 5} aria-hidden="true" />
                  : <Icon name="alert" size={15} />}
                <span className="task-rail-label">{l.name}</span>
                <span className="task-rail-count">{l.open}</span>
              </button>
            ))}
          </nav>

          <section className="task-pane">
            <div className="task-board">
              {/* The head a board column wears: what this pile is, how big it
                  is, and the one button that adds to it. */}
              <div className="task-head">
                {view.listId && (
                  <i
                    className="task-hue-dot task-head-dot"
                    data-hue={hues.get(view.listId) ?? 5}
                    aria-hidden="true"
                  />
                )}
                <span className="task-head-name">{active.label}</span>
                <span className="task-head-count">{loaded ? main.length : '—'}</span>
                <button
                  type="button"
                  className="icon-btn task-head-add"
                  title="New task"
                  aria-label="New task"
                  aria-expanded={adding}
                  onClick={() => setAdding((a) => !a)}
                >
                  <Icon name={adding ? 'x' : 'plus'} size={15} />
                </button>
              </div>
              {active.blurb && <div className="task-pane-blurb">{active.blurb}</div>}
              {/* The distinction that matters, in one line rather than four.
                  It was a paragraph, which is a paragraph of small print over
                  the board every time this page opens. */}
              {view.bucket === 'my_day' && !view.listId && (
                <div className="task-pane-blurb">
                  The <strong>My Day</strong> list on your phone, under Lists — not To Do&rsquo;s own
                  My Day overlay, which its API does not expose. The sun moves a task in or out.
                </div>
              )}

              {adding && (
                <Composer
                  lists={counts.lists}
                  presetList={counts.lists.find((l) => l.id === view.listId)?.name}
                  onAdded={load}
                  onCancel={() => setAdding(false)}
                />
              )}

              {!loaded && <SkeletonRows rows={5} controls={3} />}

              {loaded && error && (
                <div className="empty-state" style={{ padding: 18 }}>
                  <Icon name="alert" size={20} />
                  <div>
                    <div>{error}</div>
                    <div className="empty-actions">
                      <button type="button" className="btn btn--small" onClick={load}>
                        <Icon name="refresh" size={13} /> Retry
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {loaded && !error && main.length === 0 && parked.length === 0 && view.bucket === 'my_day' && !view.listId && (
                <div className="empty-state empty-state--do" style={{ padding: 18 }}>
                  <Icon name="sun" size={20} />
                  <div>
                    <div>
                      {counts.my_day_list_id == null
                        ? 'No My Day list yet.'
                        : 'Nothing in My Day yet.'}
                    </div>
                    <div className="empty-note">
                      {counts.my_day_list_id == null
                        ? 'Make a list called My Day — here or in Microsoft To Do — and it '
                          + 'becomes this page. The sun on any task makes it for you.'
                        : 'Put something here with the sun, or add it to the My Day list in '
                          + 'To Do on your phone. Nothing fills it on its own; that is what '
                          + 'makes it a choice.'}
                    </div>
                    <div className="empty-actions">
                      {counts.buckets?.missed > 0 && (
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => setViewKey({ bucket: 'missed', listId: null })}
                        >
                          Start with the {counts.buckets.missed} overdue
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => setViewKey({ bucket: 'all', listId: null })}
                      >
                        Pick from all {counts.buckets?.all ?? 0}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {loaded && !error && main.length === 0 && parked.length === 0 && !(view.bucket === 'my_day' && !view.listId) && (
                <div className="empty-state" style={{ padding: 18 }}>
                  <Icon name="check" size={20} />
                  {view.bucket === 'missed'
                    ? 'Nothing overdue.'
                    : 'Nothing here. Add one above, or ask AMETHYST to.'}
                </div>
              )}

              <div className="task-cards">
              {main.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  lists={counts.lists}
                  myDayListId={counts.my_day_list_id}
                  hues={hues}
                  view={view}
                  busy={busyTask === task.id}
                  patch={patch}
                  drop={drop}
                />
              ))}

              {/* The tile that adds a tile, at the end of the pile it adds to. */}
              {loaded && !error && !adding && (
                <button type="button" className="task-add-tile" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={15} /> Add task
                </button>
              )}
              </div>

              {parked.length > 0 && (
                <>
                  <button
                    type="button"
                    className="task-done-toggle"
                    aria-expanded={showDone}
                    onClick={() => setShowDone((v) => !v)}
                  >
                    <Icon name="chevron" size={13} className={showDone ? 'task-done-caret is-open' : 'task-done-caret'} />
                    Done
                    <span className="task-head-count">{parked.length}</span>
                  </button>

                  {showDone && (
                    <div className="task-cards">
                      {parked.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          lists={counts.lists}
                          myDayListId={counts.my_day_list_id}
                          hues={hues}
                          view={view}
                          busy={busyTask === task.id}
                          patch={patch}
                          drop={drop}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="card card-pad" style={{ marginTop: 18 }}>
              <div className="card-title">next three weeks · {loaded ? events.length : '—'}</div>
              {!loaded && <SkeletonRows rows={3} controls={0} />}
              {loaded && events.length === 0 && (
                <div className="empty-state" style={{ padding: 18 }}>
                  <Icon name="clock" size={20} />
                  No events. Scheduling one asks first, and checks for conflicts before it writes.
                </div>
              )}
              {events.map((event) => (
                <div className="server-row" key={event.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="server-name" style={{ whiteSpace: 'normal' }}>{event.title}</div>
                    <div className="server-target">
                      {when(event.starts_at)}{event.ends_at ? ` → ${when(event.ends_at)}` : ''}
                      {event.location ? ` · ${event.location}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => { setView('chat'); chat.focusComposer?.() }}
              >
                <Icon name="chat" size={13} /> Ask AMETHYST to add one
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

const LOCAL_ONLY = 'This list is only on this machine — it has not reached Microsoft To Do yet.'
