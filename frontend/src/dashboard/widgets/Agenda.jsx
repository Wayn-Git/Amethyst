import { useState, useEffect, useMemo } from 'react'
import { WidgetRenderer } from '@tugan/widgets'
import { request } from '../api.js'
import { Button, Segmented } from '../../components/ui/bento/index.jsx'
import template from '../../../../widgets/task.agenda/template.txt?raw'
import './agenda/agenda.css'

const CALENDAR_RED = {
  light: '#b8433e',
  dark: '#f18b82',
}

const CATEGORY_COLORS = {
  work: {
    light: '#577ba9',
    dark: '#8dadd5',
  },
  personal: {
    light: '#70876d',
    dark: '#a3bb9d',
  },
  focus: {
    light: '#9275a7',
    dark: '#bca0cf',
  },
}

const CATEGORY_SURFACES = {
  work: {
    light: '#edf2f8',
    dark: '#253243',
  },
  personal: {
    light: '#eff3ec',
    dark: '#2b372c',
  },
  focus: {
    light: '#f2edf6',
    dark: '#352b3e',
  },
}

const BANDS = [
  { id: 'all', label: 'All day', start: 0, end: 1440 },
  { id: 'am', label: 'AM', start: 0, end: 720 },
  { id: 'pm', label: 'PM', start: 720, end: 1440 },
]

const LAYOUT_DESCRIPTIONS = {
  timeline: 'A time-scaled morning, with overlapping meetings side by side.',
  split: 'The whole week, with one day in focus.',
  grid: 'A quiet weekly grid, followed by the selected day.',
}

function getCategory(title = '', location = '') {
  const text = (title + ' ' + (location || '')).toLowerCase()
  if (
    text.includes('personal') ||
    text.includes('lunch') ||
    text.includes('coffee') ||
    text.includes('dentist') ||
    text.includes('walk') ||
    text.includes('brunch') ||
    text.includes('doctor') ||
    text.includes('gym')
  ) {
    return 'personal'
  }
  if (
    text.includes('focus') ||
    text.includes('deep') ||
    text.includes('code') ||
    text.includes('write') ||
    text.includes('reading') ||
    text.includes('study') ||
    text.includes('lab')
  ) {
    return 'focus'
  }
  return 'work'
}

function adaptAgenda(
  data,
  now,
  size = 'm',
  mediumLayout = 'agenda',
  largeLayout = 'split',
  theme = 'light'
) {
  const sizeChoice = size === 'l' ? 'large' : 'medium'
  const timezone = data?.timezone || 'UTC'
  const zoneOption = { timeZone: timezone }
  const nowDate = new Date(now)

  let nowHours = 0
  let nowMins = 0
  try {
    const timeParts = new Intl.DateTimeFormat('en-US', {
      ...zoneOption,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(nowDate)
    nowHours = parseInt(timeParts.find((p) => p.type === 'hour')?.value || '0', 10)
    nowMins = parseInt(timeParts.find((p) => p.type === 'minute')?.value || '0', 10)
  } catch {
    nowHours = nowDate.getHours()
    nowMins = nowDate.getMinutes()
  }
  const nowMinute = nowHours * 60 + nowMins
  const nowTime = `${String(nowHours).padStart(2, '0')}:${String(nowMins).padStart(2, '0')}`

  let weekdayShort = 'MON'
  let monthShort = 'SEP'
  let monthFull = 'September'
  let yearNum = '2026'
  let todayIso = ''
  try {
    weekdayShort = new Intl.DateTimeFormat('en-US', { ...zoneOption, weekday: 'short' })
      .format(nowDate)
      .toUpperCase()
    monthShort = new Intl.DateTimeFormat('en-US', { ...zoneOption, month: 'short' })
      .format(nowDate)
      .toUpperCase()
    monthFull = new Intl.DateTimeFormat('en-US', { ...zoneOption, month: 'long' }).format(nowDate)
    yearNum = new Intl.DateTimeFormat('en-US', { ...zoneOption, year: 'numeric' }).format(nowDate)
    todayIso = new Intl.DateTimeFormat('en-CA', {
      ...zoneOption,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(nowDate)
  } catch {
    todayIso = nowDate.toISOString().slice(0, 10)
  }

  // Calculate Monday of the current week
  const dayOfWeek = nowDate.getDay()
  const mondayOffset = (dayOfWeek + 6) % 7
  const mondayDate = new Date(nowDate)
  mondayDate.setDate(nowDate.getDate() - mondayOffset)

  const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const dayShorts = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const dayNames = [
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'Sunday',
  ]

  const rawItems = Array.isArray(data?.items) ? data.items : []

  const week = []
  let todayId = 'mon'

  for (let i = 0; i < 7; i++) {
    const currentDayDate = new Date(mondayDate)
    currentDayDate.setDate(mondayDate.getDate() + i)

    let currentDayIso = ''
    let dayNum = '1'
    try {
      currentDayIso = new Intl.DateTimeFormat('en-CA', {
        ...zoneOption,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(currentDayDate)
      dayNum = new Intl.DateTimeFormat('en-US', {
        ...zoneOption,
        day: 'numeric',
      }).format(currentDayDate)
    } catch {
      currentDayIso = currentDayDate.toISOString().slice(0, 10)
      dayNum = String(currentDayDate.getDate())
    }

    const isCurrentToday = currentDayIso === todayIso
    const id = dayKeys[i]
    if (isCurrentToday) todayId = id

    // Filter items belonging to this day
    const dayItems = rawItems.filter((it) => {
      if (!it.start) return false
      try {
        const itemDay = new Intl.DateTimeFormat('en-CA', {
          ...zoneOption,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(it.start))
        return itemDay === currentDayIso
      } catch {
        return it.start.startsWith(currentDayIso)
      }
    })

    const allDayItems = dayItems
      .filter((it) => it.all_day)
      .map((it) => ({
        title: it.title || 'All-day event',
        category: getCategory(it.title, it.location),
      }))

    const timedItems = dayItems
      .filter((it) => !it.all_day)
      .map((it, idx) => {
        const startDt = new Date(it.start)
        const endDt = new Date(it.end || it.start)
        let sHours = 0
        let sMins = 0
        let eHours = 0
        let eMins = 0
        try {
          const sParts = new Intl.DateTimeFormat('en-US', {
            ...zoneOption,
            hour: 'numeric',
            minute: 'numeric',
            hour12: false,
          }).formatToParts(startDt)
          sHours = parseInt(sParts.find((p) => p.type === 'hour')?.value || '0', 10)
          sMins = parseInt(sParts.find((p) => p.type === 'minute')?.value || '0', 10)

          const eParts = new Intl.DateTimeFormat('en-US', {
            ...zoneOption,
            hour: 'numeric',
            minute: 'numeric',
            hour12: false,
          }).formatToParts(endDt)
          eHours = parseInt(eParts.find((p) => p.type === 'hour')?.value || '0', 10)
          eMins = parseInt(eParts.find((p) => p.type === 'minute')?.value || '0', 10)
        } catch {
          sHours = startDt.getHours()
          sMins = startDt.getMinutes()
          eHours = endDt.getHours()
          eMins = endDt.getMinutes()
        }

        const startMinute = sHours * 60 + sMins
        const endMinute = eHours * 60 + eMins
        const dur = Math.max(15, Math.round((endDt.getTime() - startDt.getTime()) / 60000))
        const timeStr = `${String(sHours).padStart(2, '0')}:${String(sMins).padStart(2, '0')}`
        const endTimeStr = `${String(eHours).padStart(2, '0')}:${String(eMins).padStart(2, '0')}`

        const loc = it.location || ''
        const isVideo =
          loc.toLowerCase().includes('video') ||
          loc.toLowerCase().includes('zoom') ||
          loc.toLowerCase().includes('meet') ||
          loc.toLowerCase().includes('call')

        return {
          id: it.id || `evt-${id}-${idx}`,
          title: it.title || 'Untitled event',
          time: timeStr,
          endTime: endTimeStr,
          start: startMinute,
          end: endMinute,
          duration: dur,
          location: loc || (isVideo ? 'Video call' : 'Studio desk'),
          icon: isVideo ? 'video' : 'map-pin',
          category: getCategory(it.title, loc),
          lane: 0,
          overlap: false,
        }
      })
      .sort((a, b) => a.start - b.start)

    // Compute lanes & overlaps
    let overlapNote = ''
    for (let j = 0; j < timedItems.length; j++) {
      for (let k = 0; k < j; k++) {
        const prev = timedItems[k]
        const curr = timedItems[j]
        if (curr.start < prev.start + prev.duration) {
          curr.lane = (prev.lane + 1) % 2
          curr.overlap = true
          prev.overlap = true
          if (!overlapNote) {
            overlapNote = `${curr.time}–${curr.endTime} · ${curr.title} and ${prev.title} overlap.`
          }
        }
      }
    }

    const firstEvent = timedItems[0]
    const timelineStart = firstEvent ? Math.max(0, Math.floor(firstEvent.start / 60) * 60) : 540
    const startHourStr = String(Math.floor(timelineStart / 60)).padStart(2, '0')
    const endHourStr = String(Math.floor((timelineStart + 120) / 60)).padStart(2, '0')

    week.push({
      id,
      short: dayShorts[i],
      name: dayNames[i],
      number: dayNum,
      label: `${dayNames[i]}, ${dayNum} ${monthShort}`,
      isToday: isCurrentToday,
      preview: timedItems[0]?.title || allDayItems[0]?.title || 'No events',
      timelineStart,
      timelineLabel: `Morning window · ${startHourStr}:00–${endHourStr}:00 · time-scaled`,
      overlapNote,
      allDay: allDayItems,
      events: timedItems,
    })
  }

  // Find next upcoming event today
  const todayEntry = week.find((d) => d.id === todayId) || week[0]
  const upcomingToday = todayEntry ? todayEntry.events.filter((e) => e.start >= nowMinute) : []
  const nextEvent = upcomingToday[0]
  const nextId = nextEvent ? nextEvent.id : ''

  let status = 'ready'
  if (!data || data.state === 'loading') {
    status = 'loading'
  } else if (data.state === 'not-connected') {
    status = 'not_connected'
  } else if (data.state === 'error' || data.error) {
    status = 'error'
  } else if (rawItems.length === 0) {
    status = 'empty'
  } else if (data.refreshing) {
    status = 'refreshing'
  }

  return {
    appearance: theme,
    status,
    sizeChoice,
    mediumLayout,
    largeLayout,
    selectedDay: todayId,
    todayId,
    nowMinute,
    nextId,
    calendarRed: CALENDAR_RED,
    categoryColors: CATEGORY_COLORS,
    categorySurfaces: CATEGORY_SURFACES,
    labels: {
      collection: 'Calendar studies',
      collectionNote: 'Six layouts · three Medium, three Large',
      size: 'Size',
      layout: 'Layout',
      darkAction: 'Switch to dark appearance',
      lightAction: 'Switch to light appearance',
      snapshot: 'Calendar agenda',
      monthYear: `${monthFull.toUpperCase()} ${yearNum}`,
      monthTitle: `${monthFull} ${yearNum}`,
      agendaSubtitle: 'A little space between the important things.',
      nowShort: `${nowTime} NOW`,
      nowTime,
      nowDay: `NOW · ${weekdayShort} · ${timezone}`,
      now: 'NOW',
      timezone,
      nextIn: nextEvent ? `Next · at ${nextEvent.time}` : 'Next',
      next: 'Next',
      inTenMinutes: nextEvent ? `at ${nextEvent.time}` : '',
      overlapShort: 'Overlapping event',
      selected: 'Selected day',
      allDay: 'All day',
      stripLegend: `${week[0]?.number}–${week[6]?.number} ${monthShort} · timed events`,
      weekTitle: `${monthFull} ${week[0]?.number}–${week[6]?.number}`,
      weekCountLegend: 'Each day: timed events / all-day events',
      weekOverview: 'THIS WEEK',
      later: 'LATER IN THE DAY',
      gridLegend: 'Event counts · AM before noon, PM from noon',
      septemberShort: monthShort,
      noEvents: 'No upcoming events this week',
      notConnected: 'Connect Google Calendar to see your schedule',
      loading: 'Loading agenda...',
      error: 'Could not sync calendar events.',
      noRemainingEvents: 'No more events today',
    },
    layoutDescriptions: LAYOUT_DESCRIPTIONS,
    sizes: [
      { label: 'Medium', value: 'medium' },
      { label: 'Large', value: 'large' },
    ],
    mediumOptions: [
      { label: 'Chronological agenda', value: 'agenda' },
      { label: 'Seven-day strip', value: 'strip' },
      { label: 'Minimal next up', value: 'minimal' },
    ],
    largeOptions: [
      { label: 'Split week + agenda', value: 'split' },
      { label: 'Vertical timeline', value: 'timeline' },
      { label: 'Weekly calendar grid', value: 'grid' },
    ],
    bands: BANDS,
    week,
    message: data?.error || '',
  }
}

export default function Agenda({
  data,
  refresh,
  full = false,
  size = 'm',
  onOpen,
  onAction,
}) {
  const [theme, setTheme] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
  )
  const [now, setNow] = useState(() => Date.now())
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('agenda')
  const [mediumLayout, setMediumLayout] = useState('agenda')
  const [largeLayout, setLargeLayout] = useState('split')

  useEffect(() => {
    let mounted = true
    request('/widgets/task.agenda/settings')
      .then((val) => {
        if (mounted) setEnabled(val.enabled !== false)
      })
      .catch((e) => {
        if (mounted) setError(e.message)
      })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  async function access(next) {
    setBusy(true)
    setError('')
    try {
      await request('/widgets/task.agenda/settings', 'PUT', { enabled: next })
      setEnabled(next)
      window.dispatchEvent(
        new CustomEvent('dashboard-settings-changed', {
          detail: [
            'task.agenda',
            'glance.next-event',
            'glance.travel',
            'task.plan',
            'task.free',
            'task.conflicts',
            'task.risk',
          ],
        })
      )
      if (refresh) await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const effectiveSize = full ? 'l' : size
  const widgetData = useMemo(
    () => adaptAgenda(data, now, effectiveSize, mediumLayout, largeLayout, theme),
    [data, now, effectiveSize, mediumLayout, largeLayout, theme]
  )

  const timezone = data?.timezone || 'UTC'
  const items = Array.isArray(data?.items) ? data.items : []

  // Detail View (Drawer)
  if (full) {
    const detailItems = items.filter((item) => {
      if (view === 'week') return true
      const end = new Date(item.end || item.start).getTime()
      return Number.isFinite(end) ? end >= now : true
    })

    return (
      <div className="agenda-detail" role="region" aria-label="Agenda details">
        <div className="agenda-detail-top">
          <h3 className="agenda-detail-title">Google Calendar</h3>
          <p className="agenda-detail-subtitle">Primary calendar, current week · {timezone}</p>
        </div>

        {error && (
          <p className="agenda-detail-subtitle" style={{ color: 'var(--w-danger, #ff453a)' }}>
            {error}
          </p>
        )}

        <div className="agenda-detail-actions">
          <Button
            type="button"
            className="agenda-access-btn"
            disabled={busy}
            onClick={() => access(!enabled)}
          >
            {enabled ? 'Stop calendar access and delete cached data' : 'Enable calendar access'}
          </Button>

          {enabled && (
            <Segmented
              aria-label="Calendar view"
              value={view}
              onValueChange={setView}
              options={[
                { value: 'agenda', label: 'Upcoming' },
                { value: 'week', label: 'All week' },
              ]}
            />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
          <label style={{ fontSize: '13px', fontWeight: 500 }}>Medium Card Layout</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['agenda', 'strip', 'minimal'].map((l) => (
              <Button
                key={l}
                type="button"
                variant={mediumLayout === l ? 'primary' : 'default'}
                onClick={() => setMediumLayout(l)}
                style={{ borderRadius: '999px', textTransform: 'capitalize' }}
              >
                {l}
              </Button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
          <label style={{ fontSize: '13px', fontWeight: 500 }}>Large Card Layout</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['split', 'timeline', 'grid'].map((l) => (
              <Button
                key={l}
                type="button"
                variant={largeLayout === l ? 'primary' : 'default'}
                onClick={() => setLargeLayout(l)}
                style={{ borderRadius: '999px', textTransform: 'capitalize' }}
              >
                {l}
              </Button>
            ))}
          </div>
        </div>

        {enabled && (
          <>
            {data?.limited && (
              <p className="agenda-detail-subtitle" role="status">
                Showing up to 100 events. More events may exist.
              </p>
            )}

            {!items.length ? (
              <p className="agenda-detail-subtitle" role="status">
                No calendar events found.
              </p>
            ) : detailItems.length === 0 ? (
              <p className="agenda-detail-subtitle" role="status">
                No upcoming events this week.
              </p>
            ) : (
              <ul className="agenda-detail-list">
                {detailItems.map((item) => {
                  const start = new Date(item.start)
                  const weekday = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    weekday: 'short',
                  })
                    .format(start)
                    .toUpperCase()
                  const day = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    day: 'numeric',
                  }).format(start)
                  return (
                    <li className="agenda-detail-item" key={item.id}>
                      <div className="agenda-date-badge" aria-hidden="true">
                        <span className="agenda-badge-day">{weekday}</span>
                        <span className="agenda-badge-num">{day}</span>
                      </div>
                      <div className="agenda-detail-item-body">
                        <span className="agenda-detail-item-title">
                          {item.title || 'Untitled event'}
                        </span>
                        <span className="agenda-detail-item-meta">
                          {item.all_day
                            ? 'All day'
                            : `${start.toLocaleTimeString([], { timeZone: timezone, hour: 'numeric', minute: '2-digit' })} · ${item.location || 'Studio'}`}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    )
  }

  // Dashboard Tile View using WidgetRenderer
  return (
    <div
      className="agenda-widget-root"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (onOpen) onOpen()
        }
      }}
    >
      <WidgetRenderer
        template={template}
        data={widgetData}
        theme={theme}
        onAction={onAction}
      />
    </div>
  )
}
