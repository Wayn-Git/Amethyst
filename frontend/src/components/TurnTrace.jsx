import { useMemo, useState } from 'react'

import Icon from './Icon.jsx'
import { prettyJSON } from '../api.js'
import ParallelJobCard from './ParallelJobCard.jsx'

/* What the agent did, as a sentence per action.

   A turn that searched five times and opened three pages used to arrive in the
   transcript as eight bordered cards, each with a chevron, a status badge and
   a JSON body folded inside it. That is a build log wedged between a question
   and its answer: it is taller than either, it is the same height whether the
   agent did something interesting or not, and reading the conversation back
   means scrolling past it.

   So the default reading is one line per action, in the past tense, saying what
   was touched rather than which function was called -- `Opened page
   example.com`, not `fetch_url {"url": "..."}`. Consecutive actions of the same
   kind collapse into a count, because "Ran 3 searches" is the fact and three
   identical rows is the same fact spelled out three times.

   Nothing is thrown away. Every line still opens onto the arguments and the
   result it came from, and once the turn is over the whole trace folds into a
   single summary line, because a finished turn's machinery is something you go
   looking for rather than something that should be in the way. */

/* How each tool says what it did. `verb` is the past tense for a settled call,
   `gerund` the present for one still running, `noun`/`plural` name the unit so
   a run of them can be counted. `subject` pulls the one argument worth showing
   -- a URL, a path, a query -- because the tool's name plus its object is the
   whole story and the rest of the JSON is detail. */
const ACTIONS = {
  dispatch_parallel_jobs: { icon: 'term', verb: 'Dispatched parallel jobs', gerund: 'Dispatching parallel jobs', noun: 'job', plural: 'jobs', subject: (a) => a.reason || `${a.jobs?.length || 0} tasks` },
  collect_jobs: { icon: 'term', verb: 'Collected job results', gerund: 'Collecting job results', noun: 'job', plural: 'jobs', subject: (a) => a.job_ids?.join(', ') || 'jobs' },
  search_web: { icon: 'search', verb: 'Searched the web', gerund: 'Searching the web', noun: 'search', plural: 'searches', subject: (a) => a.query },
  fetch_url: { icon: 'globe', verb: 'Opened page', gerund: 'Opening page', noun: 'page', plural: 'pages', subject: (a) => host(a.url) },
  open_url: { icon: 'globe', verb: 'Opened', gerund: 'Opening', noun: 'link', plural: 'links', subject: (a) => host(a.url) },
  search_documents: { icon: 'search', verb: 'Searched documents', gerund: 'Searching documents', noun: 'search', plural: 'searches', subject: (a) => a.query },
  search_history: { icon: 'search', verb: 'Searched history', gerund: 'Searching history', noun: 'search', plural: 'searches', subject: (a) => a.query },
  search_library: { icon: 'search', verb: 'Searched the library', gerund: 'Searching the library', noun: 'search', plural: 'searches', subject: (a) => a.query },
  search_social: { icon: 'search', verb: 'Searched social', gerund: 'Searching social', noun: 'search', plural: 'searches', subject: (a) => a.query },
  grep_files: { icon: 'search', verb: 'Searched files', gerund: 'Searching files', noun: 'search', plural: 'searches', subject: (a) => a.pattern },
  list_files: { icon: 'folder', verb: 'Listed', gerund: 'Listing', noun: 'folder', plural: 'folders', subject: (a) => tail(a.path) },
  view_file: { icon: 'page', verb: 'Read', gerund: 'Reading', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
  open_file: { icon: 'page', verb: 'Opened', gerund: 'Opening', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
  write_file: { icon: 'edit', verb: 'Wrote', gerund: 'Writing', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
  edit_file: { icon: 'edit', verb: 'Edited', gerund: 'Editing', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
  delete_file: { icon: 'trash', verb: 'Deleted', gerund: 'Deleting', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
  create_artifact: { icon: 'page', verb: 'Created', gerund: 'Creating', noun: 'document', plural: 'documents', subject: (a) => a.title || tail(a.path) },
  create_document: { icon: 'page', verb: 'Created', gerund: 'Creating', noun: 'document', plural: 'documents', subject: (a) => a.title || tail(a.path) },
  edit_document: { icon: 'edit', verb: 'Edited', gerund: 'Editing', noun: 'document', plural: 'documents', subject: (a) => a.title || tail(a.path) },
  run_shell_command: { icon: 'term', verb: 'Ran', gerund: 'Running', noun: 'command', plural: 'commands', subject: (a) => a.command },
  open_application: { icon: 'grid', verb: 'Opened', gerund: 'Opening', noun: 'app', plural: 'apps', subject: (a) => a.name },
  list_calendar: { icon: 'clock', verb: 'Read the calendar', gerund: 'Reading the calendar', noun: 'lookup', plural: 'lookups' },
  list_upcoming: { icon: 'clock', verb: 'Read what is coming up', gerund: 'Reading what is coming up', noun: 'lookup', plural: 'lookups' },
  find_free_slot: { icon: 'clock', verb: 'Looked for a free slot', gerund: 'Looking for a free slot', noun: 'lookup', plural: 'lookups' },
  create_calendar_event: { icon: 'clock', verb: 'Added', gerund: 'Adding', noun: 'event', plural: 'events', subject: (a) => a.title || a.summary },
  create_task: { icon: 'check', verb: 'Added', gerund: 'Adding', noun: 'task', plural: 'tasks', subject: (a) => a.title },
  create_tasks: { icon: 'check', verb: 'Added tasks', gerund: 'Adding tasks', noun: 'batch', plural: 'batches' },
  update_task: { icon: 'check', verb: 'Updated', gerund: 'Updating', noun: 'task', plural: 'tasks', subject: (a) => a.title },
  convert_file: { icon: 'refresh', verb: 'Converted', gerund: 'Converting', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
}

function host(url) {
  try { return new URL(String(url)).host.replace(/^www\./, '') } catch { return String(url || '') }
}

function tail(path) {
  const parts = String(path || '').split('/').filter(Boolean)
  return parts[parts.length - 1] || String(path || '')
}

/* Connector tools arrive as `<tool>__mcp__<server>`, with `-` in the server
   name escaped as `_2d` (`create_task__mcp__microsoft_2dtodo`). The readable
   half is the part before the marker -- taking the last segment named the
   server, so every Tavily call read `Used tavily` regardless of what it did. */
function split(name) {
  const [tool, server] = String(name).split('__mcp__')
  return { tool: tool || String(name), server: (server || '').replace(/_2d/g, '-') }
}

/* Nearly two hundred connector tools, and enumerating them would be a list that
   is wrong the moment someone installs another server. Their names are verb_object
   almost without exception, so the leading verb picks the sentence and the rest
   of the name is the object. */
const VERBS = {
  search: { icon: 'search', verb: 'Searched', gerund: 'Searching', noun: 'search', plural: 'searches' },
  find: { icon: 'search', verb: 'Looked for', gerund: 'Looking for', noun: 'search', plural: 'searches' },
  fetch: { icon: 'globe', verb: 'Fetched', gerund: 'Fetching', noun: 'page', plural: 'pages' },
  scrape: { icon: 'globe', verb: 'Read', gerund: 'Reading', noun: 'page', plural: 'pages' },
  crawl: { icon: 'globe', verb: 'Crawled', gerund: 'Crawling', noun: 'page', plural: 'pages' },
  browser: { icon: 'globe', verb: 'Drove the browser', gerund: 'Driving the browser', noun: 'step', plural: 'steps' },
  get: { icon: 'page', verb: 'Read', gerund: 'Reading', noun: 'lookup', plural: 'lookups' },
  read: { icon: 'page', verb: 'Read', gerund: 'Reading', noun: 'lookup', plural: 'lookups' },
  list: { icon: 'list', verb: 'Listed', gerund: 'Listing', noun: 'listing', plural: 'listings' },
  create: { icon: 'plus', verb: 'Created', gerund: 'Creating', noun: 'item', plural: 'items' },
  add: { icon: 'plus', verb: 'Added', gerund: 'Adding', noun: 'item', plural: 'items' },
  update: { icon: 'edit', verb: 'Updated', gerund: 'Updating', noun: 'change', plural: 'changes' },
  modify: { icon: 'edit', verb: 'Changed', gerund: 'Changing', noun: 'change', plural: 'changes' },
  edit: { icon: 'edit', verb: 'Edited', gerund: 'Editing', noun: 'change', plural: 'changes' },
  manage: { icon: 'sliders', verb: 'Managed', gerund: 'Managing', noun: 'change', plural: 'changes' },
  delete: { icon: 'trash', verb: 'Deleted', gerund: 'Deleting', noun: 'deletion', plural: 'deletions' },
  send: { icon: 'send', verb: 'Sent', gerund: 'Sending', noun: 'message', plural: 'messages' },
  open: { icon: 'globe', verb: 'Opened', gerund: 'Opening', noun: 'item', plural: 'items' },
  import: { icon: 'archive', verb: 'Imported', gerund: 'Importing', noun: 'import', plural: 'imports' },
}

/* Whatever the argument object is actually about. Tools disagree on what to
   call it -- `query`, `q`, `url`, `path`, `name` -- and the one they used is
   the object of the sentence. */
const SUBJECT_KEYS = ['query', 'q', 'search_query', 'url', 'path', 'file_path', 'pattern', 'title', 'name', 'command']

function guessSubject(args) {
  if (!args || typeof args !== 'object') return null
  for (const key of SUBJECT_KEYS) {
    const value = args[key]
    if (typeof value !== 'string' || !value.trim()) continue
    return key === 'url' ? host(value) : (key.includes('path') ? tail(value) : value)
  }
  return null
}

function fallback(name) {
  const { tool, server } = split(name)
  const [head, ...rest] = tool.split('_')
  const pattern = VERBS[head]
  // `firecrawl_scrape` and `tavily_search` lead with the server, so the verb is
  // the word after it.
  const second = rest.length ? VERBS[rest[0]] : null
  const base = pattern || second || null
  const object = (pattern ? rest : rest.slice(1)).join(' ').replace(/_/g, ' ')

  if (base) {
    const said = object ? `${base.verb} ${object}` : base.verb
    const doing = object ? `${base.gerund} ${object}` : base.gerund
    return { ...base, verb: said, gerund: doing, subject: guessSubject }
  }

  const readable = tool.replace(/_/g, ' ')
  return {
    icon: 'term',
    verb: `Used ${readable}`,
    gerund: `Using ${readable}`,
    noun: server ? `${server} call` : 'call',
    plural: server ? `${server} calls` : 'calls',
    subject: guessSubject,
  }
}

function describe(name) {
  return ACTIONS[name] || ACTIONS[split(name).tool] || fallback(name)
}

/* Consecutive calls of the same tool become one row with a count. Only
   consecutive ones: three searches, a page, then two more searches is a turn
   that went and looked something up twice, and flattening that into "5
   searches" would describe a turn that never happened. Thoughts break a run for
   the same reason -- they are what happened between the two groups. */
function group(events) {
  const out = []
  for (const ev of events || []) {
    if (ev.type === 'thought') { out.push({ kind: 'thought', text: ev.text }); continue }
    const call = ev.call || ev
    const isError = call.status === 'error' || call.isError
    const item = {
      name: call.name,
      arguments: typeof call.arguments === 'string' ? safeArgs(call.arguments) : (call.arguments ?? {}),
      content: call.content,
      isError,
    }
    const prev = out[out.length - 1]
    if (prev && prev.kind === 'run' && prev.name === item.name && !prev.isError && !isError) {
      prev.items.push(item)
      continue
    }
    out.push({ kind: 'run', name: item.name, isError, items: [item] })
  }
  return out
}

// Provider adapters hand tool arguments back as a JSON string about half the
// time. A call whose arguments will not parse is still a call that happened.
function safeArgs(raw) {
  try { return JSON.parse(raw) } catch { return { arguments: raw } }
}

function Row({ run, live }) {
  const [open, setOpen] = useState(false)
  const action = describe(run.name)
  const count = run.items.length
  const only = count === 1 ? run.items[0] : null
  const subject = only && action.subject ? clip(action.subject(only.arguments ?? {})) : null

  // Use specialized ParallelJobCard for parallel jobs
  if ((run.name === 'dispatch_parallel_jobs' || run.name === 'collect_jobs') && only) {
    return <ParallelJobCard call={only} running={live} />
  }

  const label = count > 1
    ? `${action.verb.startsWith('Ran') ? 'Ran' : action.verb} ${count} ${action.plural}`
    : (live ? action.gerund : action.verb)

  return (
    <div className={`trace-row${run.isError ? ' is-error' : ''}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="trace-line"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={run.isError ? 'This call failed — open it' : 'Show what was sent and what came back'}
      >
        <Icon name={run.isError ? 'alert' : action.icon} size={13} className="trace-icon" />
        <span className="trace-label">{label}</span>
        {subject && <span className="trace-subject mono">{subject}</span>}
        {live && <span className="ellipsis trace-live"><i /><i /><i /></span>}
      </button>

      {/* Opens on a grid track, not by mounting a block. Animating
          `grid-template-rows` from 0fr to 1fr gives a real height transition
          with no measurement and no layout property being animated per frame,
          which animating `height` would be. */}
      <div className={`trace-fold${open ? ' is-open' : ''}`}>
        <div className="trace-fold-inner">
          <div className="trace-detail">
            {run.items.map((item, i) => (
              <div className="trace-detail-call" key={item.id ?? i}>
                <span className="trace-detail-name mono">{item.name}</span>
                <pre className="trace-json">{prettyJSON(item.arguments ?? {})}</pre>
                {item.content !== undefined && item.content !== null && (
                  <pre className={`trace-json${item.isError ? ' is-error' : ''}`}>{String(item.content)}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/* A stretch of reasoning, as one line that opens onto the text. Same shape as
   a tool row, because from the reader's side it is the same kind of event. */
function Thought({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`trace-row${open ? ' is-open' : ''}`}>
      <button type="button" className="trace-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="spark" size={13} className="trace-icon" />
        <span className="trace-label">Thought</span>
        {!open && <span className="trace-subject">{firstLine(text)}</span>}
      </button>
      <div className={`trace-fold${open ? ' is-open' : ''}`}>
        <div className="trace-fold-inner">
          <div className="trace-detail"><p className="trace-thought">{text}</p></div>
        </div>
      </div>
    </div>
  )
}

function firstLine(text) {
  const line = String(text).trim().split('\n').find(Boolean) || ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

/* The object of a trace line, kept to a length a row can hold.

   The stylesheet truncates this too, and that is the part that has to be right.
   This is the belt to its braces: a `gh issue edit --body "…"` argument runs to
   thirteen thousand characters on one unbreakable line, and there is no reason
   to hand the browser a string that size only to paint 40px of it. Newlines
   collapse for the same reason -- this is one line in a list, not a document. */
function clip(value, max = 160) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/* A document the turn produced, named and openable. A turn whose entire output
   was a file used to leave the transcript with nothing in it -- the model says
   little or nothing once the content has gone into the artifact, so the answer
   was an empty box and the only trace of the work was behind a tab. This is the
   conversation's own record that the file exists. */
// The extension, upper-cased, for the card's second line.
function kindOf(args) {
  const ext = String(args.path || args.title || '').split('.').pop()
  return ext && ext.length <= 4 ? ext.toUpperCase() : 'FILE'
}

/* Save straight from the transcript. The content is already here -- it is the
   argument the model sent -- so this needs no round trip to the server and no
   artifact row. Same Blob dance as the panel's own download. */
function saveFile(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

function ArtifactCard({ call, onOpen }) {
  const args = typeof call.arguments === 'string' ? safeArgs(call.arguments) : (call.arguments ?? {})
  const name = args.title || tail(args.path) || 'document'
  const failed = call.status === 'error' || call.isError
  return (
    <button
      type="button"
      className={`trace-artifact${failed ? ' is-error' : ''}`}
      onClick={() => onOpen?.()}
      title={args.path || name}
    >
      <Icon name={failed ? 'alert' : 'page'} size={15} className="trace-artifact-icon" />
      <span className="trace-artifact-text">
        <span className="trace-artifact-name">{name}</span>
        <span className="trace-artifact-sub">
          {failed ? 'could not be written' : `Document · ${kindOf(args)}`}
        </span>
      </span>
      {!failed && typeof args.content === 'string' && (
        /* Saving is not opening, so it does not open. `stopPropagation` keeps
           the card's own click from firing underneath the button. */
        <span
          role="button"
          tabIndex={0}
          className="trace-artifact-save"
          title={`Download ${name}`}
          onClick={(e) => { e.stopPropagation(); saveFile(name, args.content) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); saveFile(name, args.content) }
          }}
        >
          Download
        </span>
      )}
      <Icon name="chevron" size={12} className="trace-artifact-caret" />
    </button>
  )
}

export default function TurnTrace({ events, live, reasoning, running, ms, onOpenArtifact }) {
  const rows = useMemo(() => group(events), [events])
  /* Open while it is happening, shut once it is not. A finished turn's
     machinery is something you go looking for; a running turn's is the only
     thing there is to look at. */
  const [manual, setManual] = useState(null)
  const open = manual === null ? running : manual

  // The one-line version: how long, and what kind of work it was.
  const summary = useMemo(() => {
    const counts = new Map()
    let thinks = 0
    for (const row of rows) {
      if (row.kind === 'thought') { thinks += 1; continue }
      const action = describe(row.name)
      const key = row.items.length > 1 ? action.plural : action.noun
      counts.set(key, (counts.get(key) || 0) + row.items.length)
    }
    const parts = [...counts.entries()].map(([noun, n]) => `${n} ${noun}`)
    if (thinks) parts.push(`${thinks} thought${thinks === 1 ? '' : 's'}`)
    return parts.join(', ')
  }, [rows])

  // After the hooks, never before: an early return above them changes how many
  // run on a turn with no tool calls, which is the one rule hooks have.
  /* The documents this turn wrote, lifted out of the fold. Everything else in
     the trace is machinery you may never open; a file that now exists is an
     outcome, and it stays visible whether the trace is folded or not. */
  const documents = (events || [])
    .filter((e) => e.type === 'tool' && String((e.call || e).name).split('__mcp__')[0] === 'create_artifact')
    .map((e) => e.call || e)

  if (rows.length === 0 && !live && !reasoning) return null

  return (
    <div className={`trace${running ? ' is-running' : ''}${open ? ' is-open' : ''}`}>
      {documents.map((call, i) => (
        <ArtifactCard key={`doc${i}`} call={call} onOpen={onOpenArtifact} />
      ))}

      {!open && (
        <button type="button" className="trace-summary" onClick={() => setManual(true)}>
          <Icon name="chevron" size={11} className="trace-summary-caret" />
          <span>{ms ? `Worked for ${Math.max(1, Math.round(ms / 1000))}s` : 'What it did'}</span>
          {summary && <span className="trace-summary-detail">{summary}</span>}
        </button>
      )}

      {open && (
        <>
          <div className="trace-rows">
            {/* Thinking is a line in the list, in the place it happened --
                not a block above the actions it led to. */}
            {rows.map((row, i) => (
              <div className="trace-row-slot" key={i} style={{ '--i': Math.min(i, 12) }}>
                {row.kind === 'thought'
                  ? <Thought text={row.text} />
                  : <Row run={row} />}
              </div>
            ))}
            {reasoning && (
              <div className="trace-row">
                <span className="trace-line trace-line--static">
                  <Icon name="spark" size={13} className="trace-icon" />
                  <span className="trace-label">Thinking</span>
                  <span className="ellipsis trace-live"><i /><i /><i /></span>
                </span>
              </div>
            )}
            {live && <Row run={{ kind: 'run', name: live.name, items: [live], isError: false }} live />}
          </div>

          {running ? (
            <div className="trace-foot">
              <Icon name="refresh" size={12} className="trace-spin" />
              <span>Working{ms ? ` for ${Math.round(ms / 1000)}s` : ''}</span>
            </div>
          ) : (
            <button type="button" className="trace-fold" onClick={() => setManual(false)}>
              Hide what it did
            </button>
          )}
        </>
      )}
    </div>
  )
}
