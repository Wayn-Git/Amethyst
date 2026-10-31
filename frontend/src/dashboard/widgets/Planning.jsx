import { useEffect, useMemo, useState } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import { StateView } from '../primitives.jsx'
import Button from '../../components/ui/AppButton.jsx'
import { Input } from '../../components/ui/input.tsx'
import freeTemplate from '../../../../widgets/task.free/template.txt?raw'
import freeDesign from '../../../../widgets/task.free/design.json'
import conflictsTemplate from '../../../../widgets/task.conflicts/template.txt?raw'
import conflictsDesign from '../../../../widgets/task.conflicts/design.json'
import planTemplate from '../../../../widgets/task.plan/template.txt?raw'
import planDesign from '../../../../widgets/task.plan/design.json'
import riskTemplate from '../../../../widgets/task.risk/template.txt?raw'
import riskDesign from '../../../../widgets/task.risk/design.json'
import './task-generated.css'

const templates = {
  'task.free': [freeTemplate, freeDesign], 'task.conflicts': [conflictsTemplate, conflictsDesign],
  'task.plan': [planTemplate, planDesign], 'task.risk': [riskTemplate, riskDesign],
}
const dateValue = value => value ? new Date(value) : null
const timeAt = (value, zone) => {
  const date = dateValue(value)
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).format(date) : 'Not available'
}
const minutesAt = (value, zone) => {
  const date = dateValue(value)
  if (!date || !Number.isFinite(date.getTime())) return null
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: zone }).formatToParts(date).map(part => [part.type, part.value]))
  return Number(parts.hour) * 60 + Number(parts.minute)
}
const dayAt = (value, zone) => {
  const date = dateValue(value)
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : ''
}
const dateLabel = (value, zone) => {
  const date = dateValue(value)
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: zone }).format(date) : 'Not available'
}
const clock = value => value == null ? 'Not available' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
const timeRange = (start, end, zone) => `${timeAt(start, zone)}–${timeAt(end, zone)}`
const themeNow = () => document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light'

function adaptFree(data, design, slotSize, settings, theme) {
  const zone = data.timezone || settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = data.today || ''
  const events = (data.events || []).filter(event => event.start && event.end)
  const slots = (data.items || []).filter(item => item.start && item.end).map((item, index) => {
    const start = minutesAt(item.start, zone), end = minutesAt(item.end, zone)
    const previous = events.filter(event => new Date(event.end) <= new Date(item.start)).sort((a, b) => new Date(b.end) - new Date(a.end))[0]
    const following = events.filter(event => new Date(event.start) >= new Date(item.end)).sort((a, b) => new Date(a.start) - new Date(b.start))[0]
    const duration = Math.max(0, Math.round((new Date(item.end) - new Date(item.start)) / 60000))
    return {
      id: String(item.id), start, end, range: timeRange(item.start, item.end, zone), duration,
      durationLabel: `${duration} min`, beforeStart: minutesAt(previous?.start, zone),
      before: previous?.title || 'Start of availability', after: following?.title || 'End of availability',
      upcoming: dayAt(item.start, zone) > today || (dayAt(item.start, zone) === today && start >= minutesAt(new Date().toISOString(), zone)),
      medium: index < 3, note: [previous?.title, following?.title].filter(Boolean).join(' → ') || 'No surrounding events available.',
      date: dayAt(item.start, zone),
    }
  }).filter(slot => slot.start != null && slot.end != null)
  const next = slots.find(slot => slot.upcoming) || slots[0]
  const best = [...slots].sort((a, b) => b.duration - a.duration)[0]
  const todaySlots = slots.filter(slot => slot.date === today)
  const eventsToday = events.filter(event => dayAt(event.start, zone) === today)
  const totalMinutes = todaySlots.reduce((sum, slot) => sum + slot.duration, 0)
  const nowMinute = minutesAt(new Date().toISOString(), zone)
  return {
    ...design, appearance: theme, sizeChoice: slotSize, variation: slotSize === 'large' ? 'large-timeline' : 'medium-first',
    motion: false, slots, nextId: next?.id || '', selectedId: next?.id || '', recommendedId: best?.id || '',
    closingEvent: { start: eventsToday.at(-1) ? timeAt(eventsToday.at(-1).start, zone) : '', title: eventsToday.at(-1)?.title || '' },
    colors: { accent: { light: 'var(--w-accent)', dark: 'var(--w-accent)' }, selection: { light: 'var(--w-surface-secondary)', dark: 'var(--w-surface-secondary)' } },
    labels: {
      ...design.labels, sampleNote: '', startsIn: next && next.date === today ? `In ${Math.max(0, (next.start || 0) - (nowMinute || 0))} min` : next ? dateLabel(next.date, zone) : 'No upcoming free time',
      threeWindows: `${todaySlots.length} available ${todaySlots.length === 1 ? 'window' : 'windows'}`,
      remainingTotal: `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min available today`,
      recommendationLine: best ? `Recommended · ${best.range} · ${best.durationLabel}` : 'No free windows available',
      editorialHeadline: best ? 'Your longest open window' : 'No free windows found',
      editorialReason: best?.note || 'Calendar availability is not available.',
    },
  }
}

function adaptConflicts(data, design, slotSize, settings, theme) {
  const zone = data.timezone || settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const events = data.events || []
  const workStart = settings?.start ? Number(settings.start.slice(0, 2)) * 60 + Number(settings.start.slice(3, 5)) : 0
  const conflicts = (data.items || []).filter(row => row.start && row.end).map((row, index) => {
    const ids = String(row.id).replace(/^event:/, '').split(':')
    const pair = ids.map(id => events.find(event => String(event.id) === id)).filter(Boolean)
    const start = minutesAt(row.start, zone), end = minutesAt(row.end, zone)
    const overlap = Math.max(0, Math.round((new Date(row.end) - new Date(row.start)) / 60000))
    return {
      id: String(row.id), at: timeAt(row.start, zone), window: timeRange(row.start, row.end, zone), overlap,
      overlapStart: start == null ? 0 : Math.max(0, start - workStart), overlapEnd: end == null ? 0 : Math.max(0, end - workStart),
      events: pair.map(event => ({ id: String(event.id), title: event.title || 'Not available', time: timeRange(event.start, event.end, zone), calendar: 'Not available', start: minutesAt(event.start, zone), end: minutesAt(event.end, zone), participants: [] })),
      index,
    }
  }).sort((a, b) => b.overlap - a.overlap)
  const firstDate = conflicts.length ? (data.items || []).find(row => String(row.id) === conflicts[0].id)?.start : `${data.today || ''}T12:00:00`
  const date = dateValue(firstDate)
  const axisDuration = settings?.start && settings?.end ? (Number(settings.end.slice(0, 2)) * 60 + Number(settings.end.slice(3, 5))) - workStart : 480
  const minute = Number.isFinite(date?.getTime()) ? new Intl.DateTimeFormat([], { day: 'numeric', month: 'short', weekday: 'short', timeZone: zone }).formatToParts(date) : []
  const parts = Object.fromEntries(minute.map(part => [part.type, part.value]))
  return {
    ...design, appearance: theme,
    variation: slotSize === 'large' ? 'large-timeline' : 'medium-comparison',
    date: { day: parts.day || '', weekday: parts.weekday || '', weekdayShort: (parts.weekday || '').slice(0, 3).toUpperCase(), monthShort: parts.month || '', monthYear: dateLabel(firstDate, zone), short: dateLabel(firstDate, zone), long: firstDate ? dateLabel(firstDate, zone) : 'Not available' },
    axis: { duration: axisDuration, ticks: Array.from({ length: 5 }, (_, i) => clock(workStart + Math.round(axisDuration * i / 4))) },
    palette: { overlap: 'var(--w-accent)', event: 'var(--w-border)' },
    labels: { ...design.labels, demo: '', threeOfFive: `${conflicts.length} conflicts`, highestImpact: conflicts[0] ? `Longest overlap · ${conflicts[0].window}` : '', editorialTitle: '', editorialReason: '', suggestionTitle: '', suggestion: '', suggestionCaveat: '', timelineFootnote: '', dailyFootnote: '' },
    conflicts,
  }
}

function adaptPlan(data, design, slotSize, settings, theme) {
  const zone = data.timezone || settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = data.today || ''
  const start = settings?.start ? Number(settings.start.slice(0, 2)) * 60 + Number(settings.start.slice(3, 5)) : 9 * 60
  const end = settings?.end ? Number(settings.end.slice(0, 2)) * 60 + Number(settings.end.slice(3, 5)) : 17 * 60
  const events = (data.events || []).filter(event => dayAt(event.start, zone) === today && event.start && event.end)
  const tasks = (data.items || []).filter(item => item.start && item.end)
  const schedule = [
    ...events.map(event => ({ id: `event-${event.id}`, title: event.title || 'Not available', start: timeAt(event.start, zone), end: timeAt(event.end, zone), minutes: Math.max(0, Math.round((new Date(event.end) - new Date(event.start)) / 60000)), kind: 'event', kindLabel: 'Calendar event', priority: 'Not available', work: false, section: (minutesAt(event.start, zone) || 0) < 720 ? 'morning' : 'afternoon', icon: 'calendar', note: 'Fixed calendar event' })),
    ...tasks.map(item => ({ id: String(item.id), title: item.title || 'Not available', start: timeAt(item.start, zone), end: timeAt(item.end, zone), minutes: Math.max(0, Math.round((new Date(item.end) - new Date(item.start)) / 60000)), kind: 'focus', kindLabel: 'Proposed focus', priority: item.priority || 'Not available', work: true, section: (minutesAt(item.start, zone) || 0) < 720 ? 'morning' : 'afternoon', icon: 'check', note: item.detail || 'Proposed time; no calendar changes made' })),
  ].sort((a, b) => a.start.localeCompare(b.start))
  const busy = events.map(event => [minutesAt(event.start, zone), minutesAt(event.end, zone)]).concat(tasks.map(item => [minutesAt(item.start, zone), minutesAt(item.end, zone)])).filter(([a, b]) => a != null && b != null).sort((a, b) => a[0] - b[0])
  let cursor = start
  const finish = end
  const open = []
  for (const [from, to] of busy) {
    const boundedFrom = Math.max(start, from), boundedTo = Math.min(finish, to)
    if (boundedFrom > cursor) open.push(`${clock(cursor)}–${clock(boundedFrom)}`)
    cursor = Math.max(cursor, boundedTo)
  }
  if (cursor < finish) open.push(`${clock(cursor)}–${clock(finish)}`)
  const date = dateValue(`${today}T12:00:00`)
  return {
    ...design, direction: slotSize === 'large' ? 'timeline' : 'minimal', sizeChoice: slotSize, appearance: theme,
    dateLabel: date ? date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : 'Not available',
    dayRange: `${clock(start)}–${clock(end)}`, dayMinutes: Math.max(0, end - start), schedule,
    daySections: [{ id: 'morning', title: 'Morning', range: '00:00–12:00' }, { id: 'afternoon', title: 'Afternoon', range: '12:00–24:00' }],
    freeWindows: open.length ? `Open windows: ${open.join(', ')}.` : 'No remaining open windows.',
    collectionTitle: 'Day plan', collectionNote: '', demoNote: '', accountingNote: 'Calendar events are fixed. Suggested work is not scheduled.',
    smallMeetingNote: events[0] ? `Next meeting · ${events[0].title}` : 'No calendar events today.',
    smallBreakNote: 'Break timing is not available.', smallBalancedHeading: 'Plan around fixed events', smallBufferNote: 'Leave room between commitments.',
    smallEditorialHeading: schedule[0]?.title || 'No tasks scheduled', smallEditorialNote: schedule[0]?.note || '',
    mediumTimelineHeading: 'Today in time order', mediumBalancedHeading: 'A plan around your calendar', mediumEditorialHeading: 'Your next work block', mediumScopeNote: `${schedule.length} live items`,
    largeTimelineHeading: 'The shape of your day', timelineGuidance: 'Calendar events are fixed; suggested tasks remain proposals.', largeBalancedHeading: 'Work around fixed events', balancedGuidance: 'Only saved calendar events and task proposals are shown.', largeEditorialHeading: 'Rest of your day', editorialGuidance: '', editorialNextAction: schedule[0] ? `Next · ${schedule[0].title}` : 'Nothing scheduled next.',
  }
}

function adaptRisk(data, design, slotSize, settings, theme) {
  const zone = data.timezone || settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const tasks = (data.items || []).map(row => {
    const high = row.risk === 'high'
    const due = dateValue(row.due)
    const remaining = Number(row.known_minutes)
    const available = Number(row.capacity_minutes)
    return {
      id: String(row.id), title: row.title || 'Not available', severity: high ? 'high' : row.risk === 'unknown' ? 'watch' : 'fits',
      risk: row.risk === 'high' ? 'High risk' : row.risk === 'fits' ? 'Fits available time' : row.risk === 'unknown' ? 'Unknown' : 'Not available',
      tone: high ? 'danger' : 'secondary', dueFull: due ? due.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }) : 'Not available',
      remaining: Number.isFinite(remaining) ? Math.round(remaining / 60 * 10) / 10 : 'Not available',
      available: Number.isFinite(available) ? Math.round(available / 60 * 10) / 10 : 'Not available',
      totalEffort: Number.isFinite(remaining) ? Math.round(remaining / 60 * 10) / 10 : null,
      progress: null, reason: row.detail || 'Not available', factors: row.detail ? [row.detail] : ['Not available'],
    }
  })
  const high = tasks.filter(task => task.severity === 'high')
  const unknown = tasks.filter(task => task.severity === 'watch')
  const fits = tasks.filter(task => task.severity === 'fits')
  return {
    ...design, darkMode: theme === 'dark', sizeChoice: slotSize,
    direction: slotSize === 'large' ? 'digest' : 'priority', tasks,
    groups: [
      { id: 'high', label: 'High risk', tone: 'danger', icon: 'alert-triangle' },
      { id: 'watch', label: 'Unknown capacity', tone: 'warning', icon: 'clock' },
      { id: 'fits', label: 'Fits available time', tone: 'secondary', icon: 'check' },
    ],
    deadlineTimeline: tasks.slice(0, 2).map(task => ({ title: task.title, description: task.reason, time: task.dueFull, icon: 'clock', color: task.tone, state: task.severity })),
    labels: {
      ...design.labels, galleryTitle: 'Deadline risk', gallerySubtitle: '', snapshot: '', projectName: '', editorialTitle: '', editorialIntro: '', editorialSummary: '',
      dueTomorrow: tasks[0]?.dueFull || 'No saved deadlines', priorityIntro: `${high.length} high risk · ${unknown.length} unknown · ${fits.length} fit available capacity`,
      digestNote: 'Capacity is assessed from saved task estimates and calendar availability.',
    },
  }
}

export default function Planning({ data, widgetId, refresh, size = 'm', full = false }) {
  const effectiveSize = full ? 'l' : size
  const slotSize = effectiveSize === 'l' ? 'large' : 'medium'
  const [error, setError] = useState('')
  const [settings, setSettings] = useState(null)
  const [theme, setTheme] = useState(themeNow)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(themeNow()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme-mode'] })
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let active = true
    request('/widgets/task.free/settings').then(value => { if (active) setSettings(value) }).catch(e => { if (active) { setError(e.message); setSettings({}) } })
    return () => { active = false }
  }, [])
  async function save(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      const value = await request(`/widgets/${widgetId}/settings`, 'PUT', { start: form.get('start'), end: form.get('end'), timezone: form.get('timezone'), days: form.getAll('days').map(Number) })
      setSettings(value)
      window.dispatchEvent(new CustomEvent('dashboard-settings-changed', { detail: ['task.plan', 'task.free', 'task.conflicts', 'task.risk', 'glance.travel'] }))
      await refresh()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const [template, design] = templates[widgetId] || []
  const value = useMemo(() => {
    if (!design || !data || data.state === 'loading') return null
    if (widgetId === 'task.free') return adaptFree(data, design, slotSize, settings, theme)
    if (widgetId === 'task.conflicts') return adaptConflicts(data, design, slotSize, settings, theme)
    if (widgetId === 'task.plan') return adaptPlan(data, design, slotSize, settings, theme)
    return adaptRisk(data, design, slotSize, settings, theme)
  }, [data, design, widgetId, slotSize, settings, theme])
  if (!value) return <StateView>Loading planning data…</StateView>
  if (data?.state === 'error' || data?.error) return <StateView role="alert">{data.error || 'Planning data could not be loaded. Retry from the widget menu.'}</StateView>
  if (data?.state === 'not-connected') return <StateView>{data.message || 'Connect a calendar to view planning data.'}</StateView>
  if (data?.set_hours) return <StateView>{data.message || 'Set working hours and timezone in settings.'}</StateView>
  if (widgetId === 'task.free' && !(data.items || []).length) return <StateView>{data.message || 'No free time was found in the current working hours.'}</StateView>
  if (widgetId === 'task.conflicts' && !(data.items || []).some(item => item.start && item.end)) return <StateView>No overlapping calendar events were found.</StateView>
  if (widgetId === 'task.risk' && !(data.items || []).length) return <StateView>No saved deadlines to assess.</StateView>
  return <div className="task-generated-content"><WidgetRenderer template={template} data={value} theme={theme} onAction={action => {
    if (action?.type === 'send_message') window.dispatchEvent(new CustomEvent('amethyst-send-prompt', { detail: { text: action.payload?.text, submit: false } }))
  }} />{error && <StateView role="alert">{error}</StateView>}{widgetId === 'task.free' && <details className="task-widget-settings"><summary>Working hours</summary><form key={JSON.stringify(settings)} onSubmit={save}><fieldset disabled={settings === null || busy}><label>Start<Input name="start" type="time" required defaultValue={settings?.start || ''} /></label><label>End<Input name="end" type="time" required defaultValue={settings?.end || ''} /></label><label>Timezone<Input name="timezone" required defaultValue={settings?.timezone || data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone} /></label><fieldset><legend>Working days</legend>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => <label key={day}><Input type="checkbox" name="days" value={index} defaultChecked={settings?.days?.includes(index)} />{day}</label>)}</fieldset><Button type="submit" disabled={busy}>Save working hours</Button></fieldset></form></details>}</div>
}
