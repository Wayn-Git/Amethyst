import { useMemo, useState } from 'react'

import Icon from './Icon.jsx'
import { prettyJSON } from '../api.js'
import ParallelJobCard from './ParallelJobCard.jsx'

/* What the agent did, represented as the Worked pill and expandable tool execution tree.
   Matches the user's reference screenshots with high visual fidelity:
   - "Worked" pill with tool stats & elapsed time
   - Curly bracket tree branch connecting the tool operations
   - Monospace queries & paths with result match counts
   - Inset JSON output card with [Latest] chip */

const ACTIONS = {
  dispatch_parallel_jobs: { icon: 'term', shortLabel: 'Workers', verb: 'Dispatched parallel jobs', gerund: 'Dispatching parallel jobs', noun: 'job', plural: 'jobs', subject: (a) => a.reason || `${a.jobs?.length || 0} tasks` },
  collect_jobs: { icon: 'term', shortLabel: 'Collect', verb: 'Collected job results', gerund: 'Collecting job results', noun: 'job', plural: 'jobs', subject: (a) => a.job_ids?.join(', ') || 'jobs' },
  search_web: { icon: 'search', shortLabel: 'Search', verb: 'Searched the web', gerund: 'Searching the web', noun: 'search', plural: 'searches', subject: (a) => a.query ? `"${a.query}"` : '' },
  fetch_url: { icon: 'globe', shortLabel: 'Fetch', verb: 'Opened page', gerund: 'Opening page', noun: 'page', plural: 'pages', subject: (a) => host(a.url) },
  open_url: { icon: 'globe', shortLabel: 'Open', verb: 'Opened', gerund: 'Opening', noun: 'link', plural: 'links', subject: (a) => host(a.url) },
  search_documents: { icon: 'search', shortLabel: 'Search', verb: 'Searched documents', gerund: 'Searching documents', noun: 'search', plural: 'searches', subject: (a) => a.query ? `"${a.query}"` : '' },
  search_history: { icon: 'search', shortLabel: 'History', verb: 'Searched history', gerund: 'Searching history', noun: 'search', plural: 'searches', subject: (a) => a.query ? `"${a.query}"` : '' },
  search_library: { icon: 'search', shortLabel: 'Library', verb: 'Searched the library', gerund: 'Searching the library', noun: 'search', plural: 'searches', subject: (a) => a.query ? `"${a.query}"` : '' },
  search_social: { icon: 'search', shortLabel: 'Social', verb: 'Searched social', gerund: 'Searching social', noun: 'search', plural: 'searches', subject: (a) => a.query ? `"${a.query}"` : '' },
  grep_files: {
    icon: 'search',
    shortLabel: 'Grep',
    verb: 'Searched files',
    gerund: 'Searching files',
    noun: 'search',
    plural: 'searches',
    subject: (a) => {
      const q = a.pattern || a.Query || a.query
      const p = a.file_path || a.path || a.SearchPath || a.Includes?.[0]
      return `${q ? `"${q}"` : ''}${p ? ` · ${p}` : ''}`
    }
  },
  list_files: { icon: 'folder', shortLabel: 'List', verb: 'Listed', gerund: 'Listing', noun: 'folder', plural: 'folders', subject: (a) => tail(a.path || a.DirectoryPath) },
  view_file: { icon: 'page', shortLabel: 'Read', verb: 'Read', gerund: 'Reading', noun: 'file', plural: 'files', subject: (a) => a.path || a.file_path || a.AbsolutePath || '' },
  open_file: { icon: 'page', shortLabel: 'Read', verb: 'Opened', gerund: 'Opening', noun: 'file', plural: 'files', subject: (a) => a.path || a.file_path || '' },
  write_file: { icon: 'edit', shortLabel: 'Write', verb: 'Wrote', gerund: 'Writing', noun: 'file', plural: 'files', subject: (a) => a.path || a.TargetFile || '' },
  edit_file: { icon: 'edit', shortLabel: 'Edit', verb: 'Edited', gerund: 'Editing', noun: 'file', plural: 'files', subject: (a) => a.path || a.TargetFile || '' },
  delete_file: { icon: 'trash', shortLabel: 'Delete', verb: 'Deleted', gerund: 'Deleting', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
  create_artifact: { icon: 'page', shortLabel: 'Artifact', verb: 'Created', gerund: 'Creating', noun: 'document', plural: 'documents', subject: (a) => a.title || tail(a.path) },
  create_document: { icon: 'page', shortLabel: 'Doc', verb: 'Created', gerund: 'Creating', noun: 'document', plural: 'documents', subject: (a) => a.title || tail(a.path) },
  edit_document: { icon: 'edit', shortLabel: 'Edit', verb: 'Edited', gerund: 'Editing', noun: 'document', plural: 'documents', subject: (a) => a.title || tail(a.path) },
  run_shell_command: { icon: 'term', shortLabel: 'Bash', verb: 'Ran', gerund: 'Running', noun: 'command', plural: 'commands', subject: (a) => a.command || a.CommandLine || '' },
  open_application: { icon: 'grid', shortLabel: 'App', verb: 'Opened', gerund: 'Opening', noun: 'app', plural: 'apps', subject: (a) => a.name },
  list_calendar: { icon: 'clock', shortLabel: 'Calendar', verb: 'Read the calendar', gerund: 'Reading the calendar', noun: 'lookup', plural: 'lookups' },
  list_upcoming: { icon: 'clock', shortLabel: 'Calendar', verb: 'Read what is coming up', gerund: 'Reading what is coming up', noun: 'lookup', plural: 'lookups' },
  find_free_slot: { icon: 'clock', shortLabel: 'Calendar', verb: 'Looked for a free slot', gerund: 'Looking for a free slot', noun: 'lookup', plural: 'lookups' },
  create_calendar_event: { icon: 'clock', shortLabel: 'Calendar', verb: 'Added', gerund: 'Adding', noun: 'event', plural: 'events', subject: (a) => a.title || a.summary },
  create_task: { icon: 'check', shortLabel: 'Task', verb: 'Added', gerund: 'Adding', noun: 'task', plural: 'tasks', subject: (a) => a.title },
  create_tasks: { icon: 'check', shortLabel: 'Tasks', verb: 'Added tasks', gerund: 'Adding tasks', noun: 'batch', plural: 'batches' },
  update_task: { icon: 'check', shortLabel: 'Task', verb: 'Updated', gerund: 'Updating', noun: 'task', plural: 'tasks', subject: (a) => a.title },
  convert_file: { icon: 'refresh', shortLabel: 'Convert', verb: 'Converted', gerund: 'Converting', noun: 'file', plural: 'files', subject: (a) => tail(a.path) },
}

function host(url) {
  try { return new URL(String(url)).host.replace(/^www\./, '') } catch { return String(url || '') }
}

function tail(path) {
  const parts = String(path || '').split('/').filter(Boolean)
  return parts[parts.length - 1] || String(path || '')
}

function split(name) {
  const [tool, server] = String(name).split('__mcp__')
  return { tool: tool || String(name), server: (server || '').replace(/_2d/g, '-') }
}

const VERBS = {
  search: { icon: 'search', shortLabel: 'Search', verb: 'Searched', gerund: 'Searching', noun: 'search', plural: 'searches' },
  find: { icon: 'search', shortLabel: 'Search', verb: 'Looked for', gerund: 'Looking for', noun: 'search', plural: 'searches' },
  fetch: { icon: 'globe', shortLabel: 'Fetch', verb: 'Fetched', gerund: 'Fetching', noun: 'page', plural: 'pages' },
  scrape: { icon: 'globe', shortLabel: 'Scrape', verb: 'Read', gerund: 'Reading', noun: 'page', plural: 'pages' },
  crawl: { icon: 'globe', shortLabel: 'Crawl', verb: 'Crawled', gerund: 'Crawling', noun: 'page', plural: 'pages' },
  browser: { icon: 'globe', shortLabel: 'Browser', verb: 'Drove the browser', gerund: 'Driving the browser', noun: 'step', plural: 'steps' },
  get: { icon: 'page', shortLabel: 'Get', verb: 'Read', gerund: 'Reading', noun: 'lookup', plural: 'lookups' },
  read: { icon: 'page', shortLabel: 'Read', verb: 'Read', gerund: 'Reading', noun: 'lookup', plural: 'lookups' },
  list: { icon: 'folder', shortLabel: 'List', verb: 'Listed', gerund: 'Listing', noun: 'folder', plural: 'folders' },
  create: { icon: 'plus', shortLabel: 'Create', verb: 'Created', gerund: 'Creating', noun: 'item', plural: 'items' },
  add: { icon: 'plus', shortLabel: 'Add', verb: 'Added', gerund: 'Adding', noun: 'item', plural: 'items' },
  update: { icon: 'edit', shortLabel: 'Update', verb: 'Updated', gerund: 'Updating', noun: 'change', plural: 'changes' },
  modify: { icon: 'edit', shortLabel: 'Edit', verb: 'Changed', gerund: 'Changing', noun: 'change', plural: 'changes' },
  edit: { icon: 'edit', shortLabel: 'Edit', verb: 'Edited', gerund: 'Editing', noun: 'change', plural: 'changes' },
  manage: { icon: 'sliders', shortLabel: 'Manage', verb: 'Managed', gerund: 'Managing', noun: 'change', plural: 'changes' },
  delete: { icon: 'trash', shortLabel: 'Delete', verb: 'Deleted', gerund: 'Deleting', noun: 'deletion', plural: 'deletions' },
  send: { icon: 'send', shortLabel: 'Send', verb: 'Sent', gerund: 'Sending', noun: 'message', plural: 'messages' },
  open: { icon: 'globe', shortLabel: 'Open', verb: 'Opened', gerund: 'Opening', noun: 'item', plural: 'items' },
  import: { icon: 'archive', shortLabel: 'Import', verb: 'Imported', gerund: 'Importing', noun: 'import', plural: 'imports' },
}

const SUBJECT_KEYS = ['query', 'q', 'search_query', 'pattern', 'url', 'path', 'file_path', 'AbsolutePath', 'TargetFile', 'command', 'CommandLine', 'title', 'name']

function guessSubject(args) {
  if (!args || typeof args !== 'object') return null
  for (const key of SUBJECT_KEYS) {
    const value = args[key]
    if (typeof value !== 'string' || !value.trim()) continue
    if (key === 'url') return host(value)
    if (key.toLowerCase().includes('path')) return value
    return key.includes('query') || key === 'pattern' ? `"${value}"` : value
  }
  return null
}

function fallback(name) {
  const { tool, server } = split(name)
  const [head, ...rest] = tool.split('_')
  const pattern = VERBS[head]
  const second = rest.length ? VERBS[rest[0]] : null
  const base = pattern || second || null
  const object = (pattern ? rest : rest.slice(1)).join(' ').replace(/_/g, ' ')

  if (base) {
    const said = object ? `${base.verb} ${object}` : base.verb
    const doing = object ? `${base.gerund} ${object}` : base.gerund
    const label = capitalize(base.shortLabel || head)
    return { ...base, shortLabel: label, verb: said, gerund: doing, subject: guessSubject }
  }

  const readable = tool.replace(/_/g, ' ')
  return {
    icon: 'term',
    shortLabel: capitalize(tool.slice(0, 8)),
    verb: `Used ${readable}`,
    gerund: `Using ${readable}`,
    noun: server ? `${server} call` : 'call',
    plural: server ? `${server} calls` : 'calls',
    subject: guessSubject,
  }
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

function describe(name) {
  return ACTIONS[name] || ACTIONS[split(name).tool] || fallback(name)
}

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

function safeArgs(raw) {
  try { return JSON.parse(raw) } catch { return { arguments: raw } }
}

function extractMetrics(item) {
  if (item.isError) return 'error'
  const content = item.content
  if (!content) return null

  if (typeof content === 'object') {
    if (content.matchCount !== undefined) return `${content.matchCount} matches`
    if (content.total_matches !== undefined) return `${content.total_matches} matches`
    if (content.lines !== undefined) return `${content.lines} lines`
    if (Array.isArray(content)) return `${content.length} results`
  }

  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (parsed.matchCount !== undefined) return `${parsed.matchCount} matches`
      if (parsed.total_matches !== undefined) return `${parsed.total_matches} matches`
      if (parsed.lines !== undefined) return `${parsed.lines} lines`
      if (Array.isArray(parsed)) return `${parsed.length} results`
    } catch {
      const lines = content.split('\n').filter(Boolean).length
      if (item.name?.includes('grep') || item.name?.includes('search')) {
        return lines > 0 ? `${lines} match${lines === 1 ? '' : 'es'}` : null
      }
      if (item.name?.includes('view') || item.name?.includes('read')) {
        return lines > 0 ? `${lines} lines` : null
      }
    }
  }
  return null
}

function formatOutput(content) {
  if (content === undefined || content === null) return '{}'
  if (typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return content.trim() || '{}'
    }
  }
  return String(content)
}

function clip(value, max = 130) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function Row({ run, live, isLatest }) {
  const [open, setOpen] = useState(false)
  const action = describe(run.name)
  const count = run.items.length
  const only = count === 1 ? run.items[0] : null
  const subject = only && action.subject ? clip(action.subject(only.arguments ?? {})) : null
  const shortLabel = action.shortLabel || 'Tool'
  const metrics = only ? extractMetrics(only) : `${count} calls`

  if ((run.name === 'dispatch_parallel_jobs' || run.name === 'collect_jobs') && only) {
    return <ParallelJobCard call={only} running={live} />
  }

  return (
    <div className={`trace-item${run.isError ? ' is-error' : ''}${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="trace-item-line"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={run.isError ? 'Call failed — click to inspect' : 'Click to inspect payload'}
      >
        <span className="trace-tool-badge">
          <Icon name={run.isError ? 'alert' : (action.icon || 'term')} size={13} className="trace-tool-icon" />
          <span className="trace-tool-name">{shortLabel}</span>
        </span>
        {subject && <span className="trace-tool-subject mono">{subject}</span>}
        {live && <span className="ellipsis trace-live"><i /><i /><i /></span>}
        <span className="trace-tool-meta">
          {metrics && <span className="trace-tool-count">{metrics}</span>}
          <Icon name="chevron" size={11} className={`trace-tool-chevron${open ? ' is-open' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="trace-item-fold">
          <div className="trace-inset-card">
            {isLatest && <span className="trace-latest-badge">Latest</span>}
            {run.items.map((item, i) => (
              <div className="trace-call-output" key={item.id ?? i}>
                {item.content !== undefined && item.content !== null ? (
                  <pre className="trace-json">{formatOutput(item.content)}</pre>
                ) : (
                  <pre className="trace-json">{formatOutput(item.arguments ?? {})}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Thought({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`trace-item trace-item--thought${open ? ' is-open' : ''}`}>
      <button type="button" className="trace-item-line" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="trace-tool-badge trace-tool-badge--thought">
          <Icon name="spark" size={13} className="trace-tool-icon" />
          <span className="trace-tool-name">Thinking</span>
        </span>
        {!open && <span className="trace-tool-subject">{firstLine(text)}</span>}
        <span className="trace-tool-meta">
          <Icon name="chevron" size={11} className={`trace-tool-chevron${open ? ' is-open' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="trace-item-fold">
          <div className="trace-inset-card">
            <p className="trace-thought-text">{text}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function firstLine(text) {
  const line = String(text).trim().split('\n').find(Boolean) || ''
  return line.length > 90 ? `${line.slice(0, 90)}…` : line
}

function kindOf(args) {
  const ext = String(args.path || args.title || '').split('.').pop()
  return ext && ext.length <= 4 ? ext.toUpperCase() : 'FILE'
}

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
      onClick={() => onOpen?.(args.path)}
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
  const [manual, setManual] = useState(null)
  const open = manual === null ? false : manual

  // Compute stats for "Worked" pill: e.g. "read 1 file · searched 3 times · 12s"
  const stats = useMemo(() => {
    let filesRead = 0
    let searches = 0
    let commands = 0
    let edits = 0

    for (const r of rows) {
      if (r.kind === 'thought') continue
      const n = r.items.length
      const name = r.name || ''
      if (name.includes('view') || name.includes('read') || name.includes('open_file')) {
        filesRead += n
      } else if (name.includes('search') || name.includes('grep') || name.includes('find')) {
        searches += n
      } else if (name.includes('shell') || name.includes('term') || name.includes('exec') || name.includes('bash')) {
        commands += n
      } else if (name.includes('edit') || name.includes('write')) {
        edits += n
      }
    }

    const parts = []
    if (filesRead > 0) parts.push(`read ${filesRead} file${filesRead > 1 ? 's' : ''}`)
    if (searches > 0) parts.push(`searched ${searches} time${searches > 1 ? 's' : ''}`)
    if (commands > 0) parts.push(`ran ${commands} command${commands > 1 ? 's' : ''}`)
    if (edits > 0) parts.push(`edited ${edits} file${edits > 1 ? 's' : ''}`)

    if (parts.length === 0) {
      const totalTools = rows.reduce((acc, r) => acc + (r.items?.length || 0), 0)
      if (totalTools > 0) parts.push(`${totalTools} tool${totalTools > 1 ? 's' : ''}`)
    }

    const durationSec = ms ? Math.max(1, Math.round(ms / 1000)) : null
    if (durationSec) parts.push(`${durationSec}s`)

    return parts.join(' · ')
  }, [rows, ms])

  const documents = (events || [])
    .filter((e) => e.type === 'tool' && String((e.call || e).name).split('__mcp__')[0] === 'create_artifact')
    .map((e) => e.call || e)

  const hasTools = rows.some((r) => r.kind !== 'thought' && (r.items?.length > 0 || r.name))
  if (!hasTools && !live && documents.length === 0) return null

  return (
    <div className={`trace-worked-panel${running ? ' is-running' : ''}${open ? ' is-open' : ''}`}>
      {documents.map((call, i) => (
        <ArtifactCard key={`doc${i}`} call={call} onOpen={onOpenArtifact} />
      ))}

      {/* The "Worked" Top Pill (Screenshot 1 & 2) */}
      <button
        type="button"
        className={`trace-worked-pill${open ? ' is-open' : ''}`}
        onClick={() => setManual((prev) => (prev === null ? !open : !prev))}
        aria-expanded={open}
      >
        <Icon name="search" size={13} className="trace-worked-icon" />
        <span className="trace-worked-title">{running ? 'Working' : 'Worked'}</span>
        {stats && (
          <>
            <span className="trace-worked-sep">·</span>
            <span className="trace-worked-stats">{stats}</span>
          </>
        )}
        <Icon name="caret-down" size={11} className={`trace-worked-caret${open ? ' is-open' : ''}`} />
      </button>

      {/* The Curly Tree Container with Left Bracket */}
      {open && (
        <div className="trace-tree-container">
          <svg className="trace-tree-bracket-svg" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 16 100">
            <path
              d="M 12,0 C 12,8 3,12 3,24 L 3,42 C 3,48 0,50 0,50 C 0,50 3,52 3,58 L 3,76 C 3,88 12,92 12,100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="trace-tree-items">
            {rows.map((row, i) => (
              row.kind === 'thought' ? (
                <Thought key={i} text={row.text} />
              ) : (
                <Row
                  key={i}
                  run={row}
                  live={live}
                  isLatest={i === rows.length - 1}
                />
              )
            ))}
            {reasoning && (
              <div className="trace-item">
                <span className="trace-item-line trace-item-line--static">
                  <span className="trace-tool-badge">
                    <Icon name="spark" size={12} className="trace-tool-icon" />
                    <span className="trace-tool-name">Thinking</span>
                  </span>
                  <span className="ellipsis trace-live"><i /><i /><i /></span>
                </span>
              </div>
            )}
            {live && <Row run={{ kind: 'run', name: live.name, items: [live], isError: false }} live isLatest />}
          </div>
        </div>
      )}
    </div>
  )
}
