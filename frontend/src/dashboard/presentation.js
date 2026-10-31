// Content families determine composition; sizes never change provider data or permissions.
export const PRESENTATIONS = {
  clock: ['glance.clock'],
  weather: ['glance.weather'],
  sun: ['glance.sun'],
  air: ['glance.air'],
  calendar: ['glance.next-event', 'task.agenda'],
  player: ['glance.music'],
  timer: ['task.focus'],
  route: ['glance.travel'],
  correspondence: ['need.inbox', 'need.drafts', 'need.waiting', 'comm.unread', 'comm.thread-summary', 'comm.newsletters', 'comm.templates', 'comm.tone'],
  people: ['need.mentions', 'need.lor-slack', 'comm.contacts', 'comm.reachout'],
  editorial: ['lib.inbox', 'lib.resurface', 'lib.recent', 'lib.dupes', 'lib.readlater', 'lib.highlights', 'lib.daily', 'lib.collections', 'agent.brief', 'agent.next'],
  feed: ['feed.news', 'feed.rss'],
  tasks: ['task.today', 'task.backlog', 'task.deadlines', 'task.reminders', 'need.overdue', 'need.snoozed', 'dev.recovery'],
  schedule: ['task.plan', 'task.free', 'task.conflicts', 'task.risk'],
  timeline: ['agent.feed', 'agent.running', 'agent.errors', 'agent.audit', 'agent.jobs', 'agent.delegated', 'agent.research', 'agent.watchers', 'dev.ci', 'dev.issues', 'dev.prs', 'dev.appeal', 'dev.unpushed', 'dev.backup', 'sys.notify'],
  metrics: ['task.goals', 'task.habits', 'agent.usage', 'sys.vault'],
  board: ['task.kanban'],
  review: ['need.approvals', 'need.decisions'],
  controls: ['agent.rules', 'agent.skills', 'agent.knows', 'sys.model', 'sys.connectors', 'dash.quiet', 'dash.sync', 'dash.shortcuts', 'dash.gallery', 'dash.palette', 'dash.pin'],
  capture: ['lib.capture', 'lib.search', 'lib.ask'],
}

export const WIDGET_PRESENTATIONS = Object.fromEntries(Object.entries(PRESENTATIONS).flatMap(([pattern, ids]) => ids.map(id => [id, pattern])))

export function visibleRows(data, widgetId) {
  const rows = Array.isArray(data?.items) ? data.items : []
  if (widgetId === 'comm.unread') return rows.flatMap(group => (group.items || []).map(item => ({ ...item, from: group.from })))
  if (widgetId === 'feed.news') return rows.flatMap(group => (group.items || []).map(item => ({ ...item, source: group.tag })))
  return rows
}

export const DETAIL_LABELS = {
  'glance.clock': 'Faces & world clocks', 'glance.weather': 'Change location', 'glance.sun': 'Location settings',
  'glance.air': 'Location settings', 'glance.next-event': 'Open calendar', 'glance.music': 'Player settings',
  'glance.travel': 'Trip settings', 'task.focus': 'Timer settings', 'need.inbox': 'Open inbox',
  'need.drafts': 'Review drafts', 'need.waiting': 'Track a reply', 'need.approvals': 'Review approvals',
  'need.decisions': 'Answer questions', 'lib.capture': 'Capture a note', 'lib.search': 'Search Library',
  'lib.ask': 'Ask your Library', 'dash.palette': 'Open command palette', 'dash.gallery': 'Browse widgets',
}
