// Read-only month composition from Wigggle calendar-sm-03/md-01.
export default function CalendarMonth({ date, events = [], timezone }) {
  const options = timezone ? { timeZone: timezone } : {}
  const parts = new Intl.DateTimeFormat('en', { ...options, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date)
  const part = type => Number(parts.find(value => value.type === type)?.value)
  const year = part('year'), month = part('month') - 1, day = part('day')
  const offset = new Date(Date.UTC(year, month, 1)).getUTCDay()
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const eventDays = new Set(events.flatMap(event => {
    const start = new Date(event.start || NaN)
    if (!Number.isFinite(start.getTime())) return []
    const fields = new Intl.DateTimeFormat('en', { ...options, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(start)
    const value = type => Number(fields.find(row => row.type === type)?.value)
    return value('year') === year && value('month') === month + 1 ? [value('day')] : []
  }))
  return <section className="wigggle-month" aria-label="Month with events from the cached calendar results">
    <strong>{date.toLocaleDateString([], { ...options, month: 'long', year: 'numeric' })}</strong>
    <div className="wigggle-month-grid" aria-hidden="true">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <span className="wigggle-weekday" key={`weekday-${index}`}>{label}</span>)}{Array.from({ length: offset }, (_, index) => <span key={`pad-${index}`} />)}{Array.from({ length: count }, (_, index) => <span key={index} data-current={index + 1 === day || undefined} data-event={eventDays.has(index + 1) || undefined}>{index + 1}</span>)}</div>
  </section>
}
