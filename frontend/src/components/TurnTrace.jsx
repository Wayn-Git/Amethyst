import { useMemo, useState } from 'react'

import Icon from './Icon.jsx'
import { prettyJSON } from '../api.js'
import ParallelJobCard from './ParallelJobCard.jsx'
import SubagentCard from './SubagentCard.jsx'
import { JsonViewer } from './arc/json-viewer/json-viewer'
import { CodeBlock } from './arc/code-block/code-block'
import { BlurredText } from './arc/streaming-text/blurred-text'
import { AgentRun } from './arc/agent-run/agent-run'
import ComposioConnectCard, { extractComposioAuth } from './ComposioConnectCard.jsx'

/* What the agent did, represented as the Worked pill and expandable tool execution tree.
   Matches the user's reference screenshots with high visual fidelity:
   - "Worked" pill with tool stats & elapsed time
   - Curly bracket tree branch connecting the tool operations
   - Monospace queries & paths with result match counts
   - Inset JSON output card with [Latest] chip */

const ACTIONS = {
  dispatch_parallel_jobs: { icon: 'term', shortLabel: 'Workers', verb: 'Dispatched parallel jobs', gerund: 'Dispatching parallel jobs', noun: 'job', plural: 'jobs', subject: (a) => a.reason || `${a.jobs?.length || 0} tasks` },
  collect_jobs: { icon: 'term', shortLabel: 'Collect', verb: 'Collected job results', gerund: 'Collecting job results', noun: 'job', plural: 'jobs', subject: (a) => a.job_ids?.join(', ') || 'jobs' },
  task: { icon: 'spark', shortLabel: 'Subagent', verb: 'Spawned subagent', gerund: 'Running subagent', noun: 'subagent', plural: 'subagents', subject: (a) => a.agent || 'general' },
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
      status: call.status,
      durationMs: call.durationMs ?? call.duration_ms ?? call.elapsed_ms,
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

function durationLabel(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) < 1) return null
  const seconds = Number(ms) / 1000
  return seconds < 1 ? `${Math.max(1, Math.round(Number(ms)))}ms` : `${Math.round(seconds)}s`
}

function ItemPayload({ item, runName }) {
  const content = item.content !== undefined && item.content !== null ? item.content : item.arguments
  const args = typeof item.arguments === 'string' ? safeArgs(item.arguments) : (item.arguments ?? {})

  // 1. Shell commands -> CodeBlock
  if (runName === 'run_shell_command' || runName === 'bash') {
    const cmd = args.command || args.CommandLine || ''
    const output = typeof item.content === 'string' ? item.content : ''
    return (
      <div className="trace-code-section">
        {cmd && <CodeBlock code={cmd} language="bash" filename="Command" maxLines={6} />}
        {output && <CodeBlock code={output} language="text" filename="Output" maxLines={14} />}
      </div>
    )
  }

  // 2. View/Edit/Write file -> CodeBlock
  if (runName === 'view_file' || runName === 'edit_file' || runName === 'write_file' || runName === 'open_file') {
    const filePath = args.path || args.file_path || args.AbsolutePath || args.TargetFile || ''
    const filename = filePath.split('/').pop() || 'file'
    const ext = filename.split('.').pop() || 'text'
    const fileContent = typeof item.content === 'string' ? item.content : (args.content || args.ReplacementContent || '')
    if (fileContent) {
      return <CodeBlock code={fileContent} language={ext} filename={filename} maxLines={18} />
    }
  }

  // 3. Object or JSON parseable -> JsonViewer
  let jsonObj = null
  if (typeof content === 'object' && content !== null) {
    jsonObj = content
  } else if (typeof content === 'string') {
    const trimmed = content.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        jsonObj = JSON.parse(trimmed)
      } catch {
        jsonObj = null
      }
    }
  }

  const auth = extractComposioAuth(jsonObj || content, runName)
  if (auth) {
    return (
      <div>
        <ComposioConnectCard url={auth.url} app={auth.app} />
        {jsonObj && (
          <JsonViewer
            data={jsonObj}
            rootName={runName || 'payload'}
            defaultExpandDepth={1}
            maxHeight={200}
          />
        )}
      </div>
    )
  }

  if (jsonObj) {
    return (
      <JsonViewer
        data={jsonObj}
        rootName={runName || 'payload'}
        defaultExpandDepth={2}
        maxHeight={280}
      />
    )
  }

  // 4. Default clean text
  const textStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  return <pre className="trace-json">{textStr}</pre>
}

function Row({ run, live, isLatest }) {
  const [open, setOpen] = useState(Boolean(live))
  const action = describe(run.name)
  const count = run.items.length
  const only = count === 1 ? run.items[0] : null
  const subject = only && action.subject ? clip(action.subject(only.arguments ?? {})) : null
  const shortLabel = action.shortLabel || 'Tool'
  const metrics = only ? extractMetrics(only) : `${count} calls`
  const duration = only ? durationLabel(only.durationMs) : null

  if ((run.name === 'dispatch_parallel_jobs' || run.name === 'collect_jobs') && only) {
    return <ParallelJobCard call={only} running={live} />
  }

  if (run.name === 'task' && only) {
    return <SubagentCard call={only} running={live} />
  }

  return (
    <div className={`trace-item${run.isError ? ' is-error' : ''}${open ? ' is-open' : ''}${live ? ' is-live' : ''}`}>
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
           {duration && <span className="trace-tool-count">{duration}</span>}
          <Icon name="chevron" size={11} className={`trace-tool-chevron${open ? ' is-open' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="trace-item-fold">
          <div className="trace-inset-card">
            {isLatest && <span className="trace-latest-badge">Latest</span>}
            {run.items.map((item, i) => (
              <div className="trace-call-output" key={item.id ?? i}>
                <ItemPayload item={item} runName={run.name} />
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
          <Icon name="brain" size={13} className="trace-tool-icon" />
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
            <BlurredText text={text} className="trace-thought-text" />
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
  const errorReason = String(call.content || call.error || '')
  const isReadOnly = errorReason.toLowerCase().includes('read-only')
  const ext = String(args.path || name).split('.').pop()?.toLowerCase()
  const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)
  const statusLabel = failed
    ? (isReadOnly ? 'Write blocked (read-only mode)' : 'Could not be written')
    : `Artifact · ${kindOf(args)}`

  return (
    <div
      role="button"
      tabIndex={0}
      className={`trace-artifact${failed ? ' is-error' : ''}`}
      onClick={() => onOpen?.(args.path, { ...args, error: errorReason || 'The file was not written to disk.', is_error: failed })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen?.(args.path, { ...args, error: errorReason || 'The file was not written to disk.', is_error: failed })
        }
      }}
      aria-label={`Open artifact: ${name}`}
    >
      <span className="trace-artifact-icon-wrap">
        <Icon name={failed ? 'alert' : (isImage ? 'image' : 'page')} size={15} className="trace-artifact-icon" />
      </span>
      <span className="trace-artifact-text">
        <span className="trace-artifact-name">{name}</span>
        <span className="trace-artifact-sub">
          {statusLabel}
        </span>
      </span>
      {!failed && typeof args.content === 'string' && (
        <span
          role="button"
          tabIndex={0}
          className="trace-artifact-save"
          aria-label={`Download ${name}`}
          onClick={(e) => { e.stopPropagation(); saveFile(name, args.content) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); saveFile(name, args.content) }
          }}
        >
          <Icon name="download" size={12} />
          <span>Download</span>
        </span>
      )}
      <span className="trace-artifact-action-badge">
        <Icon name="chevron" size={12} className="trace-artifact-caret" />
      </span>
    </div>
  )
}

export default function TurnTrace({ events, live, reasoning, running, ms, onOpenArtifact }) {
  const documents = (events || [])
    .filter((e) => e.type === 'tool' && String((e.call || e).name).split('__mcp__')[0] === 'create_artifact')
    .map((e) => e.call || e)

  const hasTools = (events || []).some((e) => e.type === 'tool' || e.call)
  if (!hasTools && !running && !live && documents.length === 0) {
    return null
  }

  return (
    <div className={`trace-worked-panel${running ? ' is-running' : ''}`}>
      {documents.map((call, i) => (
        <ArtifactCard key={`doc${i}`} call={call} onOpen={onOpenArtifact} />
      ))}
      <AgentRun
        events={events}
        live={live}
        reasoning={reasoning}
        running={running}
        ms={ms}
        onOpenArtifact={onOpenArtifact}
      />
    </div>
  )
}
