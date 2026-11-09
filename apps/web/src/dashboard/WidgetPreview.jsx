import Icon from '../components/Icon.jsx'
import { Chip, Initials, Ring, SegmentedBar, Stat } from '../components/ui/bento/index.jsx'
import { useDashboard } from './context.js'
import { freshness, quietNow } from './layout.js'
import { visibleRows } from './presentation.js'

const titleOf = row => row?.title || row?.subject || row?.fact || row?.data?.title || row?.id || ''
const detailOf = row => row?.summary || row?.excerpt || row?.text || row?.snippet || row?.detail || row?.reason || ''
const completed = row => row.completed || row.status === 'done' || row.state === 'done'
const date = value => { const parsed = new Date(value || NaN); return Number.isFinite(parsed.getTime()) ? parsed : null }

function SourceTitle({ row, widgetId, children }) {
  const href = widgetId?.startsWith('lib.') && row?.id != null
    ? `/today?source=library&item=${encodeURIComponent(row.id)}`
    : /^https:\/\//.test(row?.url || '') ? row.url
      : /^\/today(?:[?#]|$)/.test(row?.href || '') ? row.href : null
  return href ? <a href={href} {...(href.startsWith('https:') ? { target: '_blank', rel: 'noreferrer' } : {})}>{children || titleOf(row)}</a> : children || titleOf(row)
}

function Stamp({ value, timezone }) {
  const parsed = date(value)
  if (!parsed) return null
  return <time dateTime={value}>{parsed.toLocaleString([], { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
}

function Rows({ rows, children, limit = 2, widgetId }) {
  return <ul className="preview-rows">{rows.slice(0, limit).map((row, index) => <li key={`${row.id ?? index}-${index}`}>{children ? children(row) : <><strong><SourceTitle row={row} widgetId={widgetId} /></strong><span>{detailOf(row)}</span></>}</li>)}</ul>
}

function Correspondence({ data, rows, compact, widgetId }) {
  const first = rows[0]
  return <><div className="preview-person"><Initials name={first?.from || first?.recipient || 'Mail'} /><div><span>{first?.from || first?.recipient || 'Saved correspondence'}</span>{first?.status && <Chip>{first.status}</Chip>}</div></div>
    <h3 className="preview-headline"><SourceTitle row={first}>{first?.subject || first?.title || 'No conversations in this view'}</SourceTitle></h3>
    {!compact && <><p className="preview-excerpt">{detailOf(first)}</p>{first?.reason && first.reason !== detailOf(first) && <p className="preview-caption">{first.reason}</p>}<Rows rows={rows.slice(1)} limit={1}>{row => <><strong>{row.subject || row.title}</strong><span>{row.from || row.recipient}</span></>}</Rows></>}
    {['comm.thread-summary', 'comm.newsletters'].includes(widgetId) && <p className="preview-caption">{data?.model_enabled ? 'Summaries use partial source snippets.' : 'Summaries off.'}</p>}
  </>
}

function Editorial({ data, rows, compact, widgetId }) {
  const first = rows[0]
  return <><div className="preview-bookmark"><Icon name={widgetId.startsWith('agent.') ? 'sparkle' : first?.kind === 'video' ? 'play' : 'bookmark'} size={28} /><span>{data?.day || first?.kind || first?.source || (widgetId.startsWith('agent.') ? 'From cached sources' : 'Your Library')}</span></div>
    <h3 className="preview-headline"><SourceTitle row={first} widgetId={widgetId}>{titleOf(first) || data?.prompt || 'A place for your next thought'}</SourceTitle></h3>
    {!compact && <><p className="preview-excerpt">{detailOf(first) || data?.answer}</p><Rows rows={rows.slice(1)} widgetId={widgetId} limit={1} /></>}
    {data?.degraded && <p className="preview-caption">Keyword results · semantic search unavailable</p>}
  </>
}

function TaskList({ rows, compact, widgetId, now }) {
  const pending = rows.filter(row => !completed(row))
  const done = rows.length - pending.length
  const late = pending.filter(row => date(row.due_at) && date(row.due_at) < now).length
  return <><div className="preview-task-heading"><Stat value={pending.length} label={widgetId === 'task.deadlines' ? 'Open deadlines shown' : 'Open items shown'} />{rows.length > 0 && <Ring value={done} max={rows.length} label="Completed in this list" />}</div>
    {!compact && late > 0 && <span className="preview-urgent">{late} overdue</span>}
    <Rows rows={pending.length ? pending : rows} limit={1}>{row => <><span className="preview-task-dot" aria-hidden="true"><Icon name={completed(row) ? 'check-simple' : 'tasks'} size={18} /></span><div><strong>{titleOf(row)}</strong><Stamp value={row.until || row.due_at} /></div></>}</Rows>
  </>
}

function Timeline({ rows, compact, widgetId }) {
  const first = rows[0]
  return <><div className="preview-status"><span className="preview-status-dot" aria-hidden="true" />{first?.status || first?.state || first?.watch_state || (widgetId === 'agent.running' ? 'Current activity' : 'Latest recorded activity')}</div>
    <h3 className="preview-headline"><SourceTitle row={first}>{titleOf(first) || 'No activity recorded'}</SourceTitle></h3>
    {!compact && !['dev.unpushed', 'dev.backup'].includes(widgetId) && <p className="preview-excerpt">{detailOf(first)}</p>}
    {first?.at && <span className="preview-caption">{freshness(first.at) === 'now' ? 'Recorded just now' : `Recorded ${freshness(first.at)} ago`}</span>}
    {widgetId === 'dev.unpushed' && <p className="preview-caption">Working tree {first?.dirty == null ? 'unknown' : first.dirty ? 'dirty' : 'clean'} · local tracking refs only{!compact && first?.branches?.map(branch => ` · ${branch.name}: ${branch.upstream ? `${branch.ahead ?? 'Unknown'} unpushed` : 'no upstream'}`).join('')}</p>}
    {widgetId === 'dev.backup' && <p className="preview-caption">Local clone {first?.local_clone ? 'present' : 'unavailable'} · last locally recorded push {first?.remotes?.[0]?.last_push || 'unknown'}</p>}
  </>
}

function Metrics({ data, rows, compact, widgetId }) {
  const first = rows[0]
  if (!first) return <p className="preview-caption">No measurements recorded.</p>
  if (widgetId === 'task.goals') return <><div className="preview-goal"><Ring value={first.progress} label="Goal progress percent" /><div><h3>{first.title}</h3><span>Target {first.target_date}</span></div></div>{!compact && <Rows rows={rows.slice(1)}>{row => <><strong>{row.title}</strong><span>{row.progress}%</span></>}</Rows>}</>
  if (widgetId === 'task.habits') return <><Stat value={first.count} unit={`/ ${first.target}`} label={first.title} /><SegmentedBar value={first.count} max={first.target} segments={first.target} label={`${first.title} check-ins`} />{!compact && <div className="preview-metric-context"><span>{first.period}</span><span>Streak {first.streak}</span></div>}</>
  if (widgetId === 'agent.usage') return <><span className="preview-caption">{data?.window}</span><Stat value={first.calls ?? 'Unavailable'} label={`${first.title} · model calls`} />{!compact && <div className="preview-metric-context"><span>{first.input_tokens ?? 'Unknown'} input tokens</span><span>{first.output_tokens ?? 'Unknown'} output tokens</span><span>{first.latency_ms ?? 'Unknown'} ms latency</span></div>}</>
  return <><span className="preview-caption">{first.title}</span><h3 className="preview-headline">{first.detail}</h3>{!compact && <Rows rows={rows.slice(1)} />}</>
}

function Board({ rows, compact }) {
  const board = rows[0]
  if (!board) return <p className="preview-caption">Create a project to arrange your tasks.</p>
  return <><h3 className="preview-headline">{board.title}</h3><div className="preview-board">{(board.columns || []).slice(0, compact ? 2 : 3).map(column => {
    const cards = (board.cards || []).filter(card => card.column_id === column.id)
    return <section key={column.id}><h4>{column.title}<span>{cards.length}</span></h4>{cards.slice(0, compact ? 1 : 2).map(card => <p key={card.id}>{card.title}</p>)}</section>
  })}</div></>
}

function Schedule({ data, rows, compact, widgetId }) {
  const first = rows[0]
  return <><div className="preview-schedule-heading"><Icon name={widgetId === 'glance.travel' ? 'globe-west' : 'calendar'} size={28} /><span>{data?.timezone?.replaceAll('_', ' ') || 'Calendar'}</span></div>
    <h3 className="preview-headline">{titleOf(first) || data?.message || 'No recorded openings'}</h3>
    {first?.start && <div className="preview-slot-time"><Stamp value={first.start} timezone={data?.timezone} />{!compact && <Stamp value={first.end} timezone={data?.timezone} />}</div>}
    {!compact && <><p className="preview-excerpt">{first?.detail || (first?.all_day ? 'All day' : first?.location)}</p><Rows rows={rows.slice(1)} widgetId={widgetId} limit={1} /></>}
    {data?.errors?.length > 0 && <p className="preview-caption" role="status">Some feeds could not refresh. Open for details.</p>}
    {data?.limited && <p className="preview-caption">Calendar results limited.</p>}
  </>
}

function Controls({ data, rows, compact, widgetId, context }) {
  if (widgetId === 'sys.model') return <><span className="preview-caption">Default model</span><h3 className="preview-headline">{data?.active?.model || 'No configured model'}</h3>{!compact && <div className="preview-metric-context"><span>{data?.active?.provider}</span><span>{data?.active?.location}</span><span>{data?.providers?.length || 0} configured providers shown</span></div>}</>
  if (widgetId === 'sys.connectors') return <><Stat value={rows.filter(row => row.status === 'connected').length} label="Connected apps shown" />{!compact && <Rows rows={rows} limit={3}>{row => <><strong>{row.id}</strong><span>{row.status}</span></>}</Rows>}</>
  if (widgetId === 'dash.quiet') return <><Icon name="moon" size={40} /><h3 className="preview-headline">{quietNow(context?.quietSettings, context?.now) ? 'A quieter moment.' : 'Refresh is on.'}</h3>{!compact && <p className="preview-excerpt">Automatic Home refresh only. Manual refresh remains available.</p>}</>
  if (widgetId === 'dash.shortcuts') return <><kbd className="preview-shortcut">⌘K / Ctrl+K</kbd>{!compact && <Rows rows={(data?.shortcuts || []).map(([id, title]) => ({ id, title }))}>{row => <><kbd>{row.id}</kbd><span>{row.title}</span></>}</Rows>}</>
  if (widgetId === 'dash.palette') return <><Icon name="search" size={36} /><h3 className="preview-headline">Find a thought.<br />Pick up a task.</h3>{!compact && <p className="preview-excerpt">Search your Library, widgets, tasks and actions.</p>}</>
  if (widgetId === 'dash.gallery') return <><Stat value={context?.manifests?.length ?? '—'} label="Available widgets" />{!compact && <div className="preview-gallery-shapes" aria-hidden="true"><span /><span /><span /></div>}</>
  if (widgetId === 'dash.sync') {
    const records = Object.values(context?.records || {})
    return <><Stat value={context?.records ? records.filter(row => row.synced_at).length : 'Unavailable'} label="Widgets with recorded syncs" />{!compact && <p className="preview-excerpt">{context?.quiet ? 'Automatic refresh paused.' : 'Sources refresh independently.'}</p>}</>
  }
  if (widgetId === 'dash.pin') return <><Icon name="pin" size={32} /><h3 className="preview-headline">{rows[0]?.data?.title || 'Keep an answer close.'}</h3>{!compact && <p className="preview-excerpt">Pinned from chat · offline snapshot</p>}</>
  return <><div className="preview-control-heading"><Stat value={rows.length} label={widgetId === 'agent.skills' ? 'Installed skills shown' : widgetId === 'agent.rules' ? 'Permission rules shown' : 'Saved entries shown'} /></div><Rows rows={rows} limit={compact ? 1 : 2}>{row => <><strong>{titleOf(row)}</strong>{!compact && <span>{row.decision || (typeof row.enabled === 'boolean' ? row.enabled ? 'Enabled' : 'Disabled' : detailOf(row))}</span>}</>}</Rows></>
}

export default function WidgetPreview({ data, manifest, pattern, size }) {
  const context = useDashboard()
  const rows = visibleRows(data, manifest.id)
  const compact = size === 's'
  if (data?.disabled === true && ['agent.brief', 'agent.next'].includes(manifest.id)) return <p role="status">Model selection is off. Open to enable a configured model.</p>
  if (data?.available === false) return <p role="status">This capability is unavailable.</p>
  let content
  if (pattern === 'correspondence') content = <Correspondence data={data} rows={rows} compact={compact} widgetId={manifest.id} />
  else if (pattern === 'editorial' || pattern === 'feed') content = <Editorial data={data} rows={rows} compact={compact} widgetId={manifest.id} />
  else if (pattern === 'tasks') content = <TaskList rows={rows} compact={compact} widgetId={manifest.id} now={context?.now || new Date()} />
  else if (pattern === 'timeline') content = <Timeline rows={rows} compact={compact} widgetId={manifest.id} />
  else if (pattern === 'metrics') content = <Metrics data={data} rows={rows} compact={compact} widgetId={manifest.id} />
  else if (pattern === 'board') content = <Board rows={rows} compact={compact} />
  else if (pattern === 'schedule' || pattern === 'calendar' || pattern === 'route') content = <Schedule data={data} rows={rows} compact={compact} widgetId={manifest.id} />
  else if (pattern === 'people') content = <><div className="preview-portraits">{rows.slice(0, compact ? 1 : 3).map((row, index) => <Initials key={`${row.id}-${index}`} name={row.person || row.title || row.source || 'Contact'} />)}</div><h3 className="preview-headline"><SourceTitle row={rows[0]}>{rows[0]?.person || titleOf(rows[0]) || 'No contacts in this view'}</SourceTitle></h3>{!compact && <><p className="preview-excerpt">{detailOf(rows[0])}</p><Rows rows={rows.slice(1)} widgetId={manifest.id} limit={1} /></>}</>
  else if (pattern === 'review') content = <><Stat value={rows.length} label={manifest.id === 'need.approvals' ? 'Approvals waiting' : 'Questions waiting'} /><h3 className="preview-headline">{titleOf(rows[0]) || 'Nothing waiting for review'}</h3>{!compact && <p className="preview-excerpt">{detailOf(rows[0])}</p>}</>
  else if (pattern === 'capture') content = <><Icon name={manifest.id === 'lib.capture' ? 'plus' : 'search'} size={36} /><h3 className="preview-headline">{data?.query || (manifest.id === 'lib.capture' ? 'Make room for a thought.' : manifest.id === 'lib.ask' ? 'Ask what your notes know.' : 'Find it in your Library.')}</h3>{!compact && (rows.length ? <Rows rows={rows} widgetId={manifest.id} limit={2} /> : <p className="preview-excerpt">{data?.answer || (manifest.id === 'lib.capture' ? 'A title and a note. Review before saving.' : 'Open to search your saved sources.')}</p>)}</>
  else content = <Controls data={data} rows={rows} compact={compact} widgetId={manifest.id} context={context} />
  return <div className={`widget-preview preview-${pattern} preview-${size}`} data-composition={`${pattern}-${size}`}>{content}
    {data?.unavailable?.length > 0 && <p className="preview-caption" role="status">Unavailable: {data.unavailable.join(', ')}</p>}
    {data?.errors?.length > 0 && <p className="preview-caption" role="status">Some feeds could not refresh. Open for details.</p>}
    {data?.limited && !['calendar', 'schedule', 'route'].includes(pattern) && <p className="preview-caption" role="status">Results limited to available source metadata.</p>}
  </div>
}
