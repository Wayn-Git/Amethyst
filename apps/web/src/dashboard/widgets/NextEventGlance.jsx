import { useMemo } from 'react'
import { variationNumber } from '../widgetVariations.js'
import './next-event/next-event.css'

function formatEventTime(isoString) {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch {
    return isoString
  }
}

function getMinutesUntil(startStr) {
  if (!startStr) return null
  const d = new Date(startStr)
  if (isNaN(d.getTime())) return null
  const diffMs = d.getTime() - Date.now()
  return Math.max(0, Math.round(diffMs / 60000))
}

export default function NextEventGlance({ data, size = 's', design = 'calendar-sm-01' }) {
  const variation = variationNumber(design)

  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.events) ? data.events : []
  const firstEvent = items[0] || null

  const eventTitle = firstEvent?.title || firstEvent?.summary || 'No upcoming events'
  const startTime = formatEventTime(firstEvent?.start)
  const endTime = formatEventTime(firstEvent?.end)
  const timeRange = startTime ? (endTime ? `${startTime} – ${endTime}` : startTime) : 'Enjoy your free time'
  const rawMinutes = getMinutesUntil(firstEvent?.start)
  const minutesUntil = rawMinutes != null ? rawMinutes : 49
  const countdownText = rawMinutes != null ? (rawMinutes > 60 ? `In ${Math.floor(rawMinutes / 60)}h ${rawMinutes % 60}m` : `In ${rawMinutes} min`) : 'In 49 min'

  const upcomingList = items.slice(0, 3)

  const styleName = variation === 2 ? 'ticket' : variation === 3 ? 'timeline' : variation === 4 ? 'calendar' : 'ring'

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="glance-next-event" data-size="s">
        <p className="gne-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
          </svg>
          <span>Next event</span>
        </p>
        <p className="t" style={{ marginTop: 'auto', fontSize: '14px', fontWeight: 600 }}>{countdownText}</p>
        <p className="t" style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: '6px' }}>
          {eventTitle}
        </p>
        <p className="t" style={{ fontSize: '13px', marginTop: '6px', fontWeight: 500, opacity: 0.85 }}>
          {timeRange}
        </p>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="glance-next-event" data-size="l">
        <p className="gne-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
          </svg>
          <span>Next event</span>
        </p>
        <div style={{ marginTop: '12px' }}>
          <div>
            <span className="n" style={{ fontSize: '96px', letterSpacing: '-0.07em' }}>{minutesUntil}</span>
            <span style={{ fontSize: '18px', fontWeight: 600, marginLeft: '6px' }}>min</span>
          </div>
          <p className="t" style={{ fontSize: '15px', opacity: 0.8, marginTop: '2px' }}>until {eventTitle}</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto' }}>
          {(upcomingList.length > 0 ? upcomingList : [
            { title: eventTitle, time: timeRange, rel: countdownText },
            { title: 'Focus time', time: '5:00 – 6:00 PM', rel: 'In 2 h' },
            { title: 'Weekly sync', time: '6:30 – 7:00 PM', rel: 'In 3.5 h' },
          ]).map((item, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                borderRadius: '16px',
                padding: '10px 14px',
                background: idx === 0 ? 'currentColor' : 'rgba(0,0,0,0.06)',
                color: idx === 0 ? 'var(--ev, #fff1b8)' : 'inherit',
              }}
            >
              <i style={{ width: '4px', height: '28px', borderRadius: '2px', background: idx === 0 ? 'var(--ev, #fff1b8)' : 'currentColor' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="t" style={{ fontSize: '15px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </p>
                <p className="t" style={{ fontSize: '12px', opacity: 0.8 }}>
                  {item.time || (item.start ? `${formatEventTime(item.start)} – ${formatEventTime(item.end)}` : timeRange)}
                </p>
              </div>
              <b style={{ fontSize: '12px', flexShrink: 0 }}>{item.rel || countdownText}</b>
            </div>
          ))}
        </div>
      </section>
    )
  }

  // Medium (2x1) with 4 styles
  if (styleName === 'ticket') {
    return (
      <section className="glance-next-event style-ticket" data-size="m" data-style="ticket">
        <div style={{ position: 'absolute', left: '16px', right: '16px', top: '16px', bottom: '16px', background: '#fff', borderRadius: '20px' }} />
        <i style={{ position: 'absolute', right: '180px', top: '6px', width: '20px', height: '20px', borderRadius: '50%', background: '#e8e2d4' }} />
        <i style={{ position: 'absolute', right: '180px', bottom: '6px', width: '20px', height: '20px', borderRadius: '50%', background: '#e8e2d4' }} />
        <i style={{ position: 'absolute', right: '189px', top: '28px', bottom: '28px', borderLeft: '2px dashed rgba(29, 29, 31, 0.2)' }} />

        <div style={{ position: 'absolute', left: '36px', top: '30px', right: '210px' }}>
          <p className="t" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', color: '#ff6a2b' }}>TODAY</p>
          <div className="n" style={{ fontSize: '32px', letterSpacing: '-0.04em', lineHeight: 1.1, marginTop: '8px', fontWeight: 600 }}>
            {eventTitle}
          </div>
          <p className="t" style={{ fontSize: '13px', fontWeight: 500, marginTop: '6px', opacity: 0.7 }}>
            Next event · {countdownText}
          </p>
        </div>

        <div style={{ position: 'absolute', right: '26px', top: '32px', width: '150px', textAlign: 'center' }}>
          <p className="t" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.6 }}>STARTS</p>
          <div className="n" style={{ fontSize: '42px', letterSpacing: '-0.06em', lineHeight: 0.95, marginTop: '6px' }}>
            {startTime || '3:30'}
          </div>
          <p className="t" style={{ fontSize: '14px', fontWeight: 700, marginTop: '4px' }}>
            {firstEvent?.start ? (new Date(firstEvent.start).getHours() >= 12 ? 'PM' : 'AM') : 'PM'}
          </p>
        </div>
      </section>
    )
  }

  if (styleName === 'timeline') {
    return (
      <section className="glance-next-event style-timeline" data-size="m" data-style="timeline">
        <p className="gne-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
          </svg>
          <span>Next event</span>
        </p>
        <div style={{ position: 'absolute', right: '24px', top: '20px', textAlign: 'right' }}>
          <div className="n" style={{ fontSize: '26px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{minutesUntil} min</div>
        </div>
        <svg width="100%" height="110" viewBox="0 0 644 140" style={{ position: 'absolute', left: 0, bottom: '12px' }} aria-hidden="true">
          <rect x="20" y="30" width="50" height="42" rx="10" fill="#d9d9de" />
          <rect x="121" y="30" width="76" height="42" rx="10" fill="#d9d9de" />
          <rect x="347" y="30" width="30" height="42" rx="10" fill="#ff6a2b" />
          <rect x="423" y="30" width="50" height="42" rx="10" fill="#d9d9de" />
          <rect x="498" y="30" width="25" height="42" rx="10" fill="#d9d9de" />
          <text x="347" y="20" fontSize="12" fontWeight="700" fill="#ff6a2b" fontFamily="Inter">{eventTitle}</text>
          <line x1="306" y1="12" x2="306" y2="84" stroke="#1d1d1f" strokeWidth="2" />
          <circle cx="306" cy="12" r="5" fill="#1d1d1f" />
          <text x="20" y="98" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">9 AM</text>
          <text x="171" y="98" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">12 PM</text>
          <text x="322" y="98" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">3 PM</text>
          <text x="473" y="98" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">6 PM</text>
          <text x="624" y="98" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">9 PM</text>
        </svg>
      </section>
    )
  }

  if (styleName === 'calendar') {
    const today = new Date()
    const month = today.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
    const day = today.getDate()
    const weekday = today.toLocaleDateString('en-US', { weekday: 'long' })
    return (
      <section className="glance-next-event style-calendar" data-size="m" data-style="calendar">
        <div style={{ position: 'absolute', left: '22px', top: '18px', width: '130px', height: '144px', background: '#fff', borderRadius: '18px', overflow: 'hidden', boxShadow: '0 3px 0 #bdbdc4' }}>
          <div style={{ background: '#e5484d', color: '#fff', textAlign: 'center', fontSize: '12px', fontWeight: 700, letterSpacing: '0.1em', padding: '8px 0' }}>
            {month}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="n" style={{ fontSize: '68px', letterSpacing: '-0.06em', lineHeight: 0.95, marginTop: '6px' }}>{day}</div>
            <p className="t" style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px', opacity: 0.7 }}>{weekday}</p>
          </div>
        </div>
        <div style={{ position: 'absolute', left: '176px', right: '22px', top: '20px' }}>
          <p className="gne-label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
            </svg>
            <span>Next event</span>
          </p>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '12px 14px', marginTop: '10px', borderLeft: '5px solid #ff6a2b' }}>
            <p className="t" style={{ fontSize: '18px', fontWeight: 700, letterSpacing: '-0.03em' }}>{eventTitle}</p>
            <p className="t" style={{ fontSize: '13px', fontWeight: 500, marginTop: '3px', opacity: 0.7 }}>{timeRange}</p>
          </div>
          <span style={{ display: 'inline-block', borderRadius: '99px', background: '#1d1d1f', color: '#fff', padding: '3px 10px', fontSize: '12px', fontWeight: 600, marginTop: '10px' }}>
            {countdownText}
          </span>
        </div>
      </section>
    )
  }

  // Default Medium (Countdown Ring)
  return (
    <section className="glance-next-event" data-size="m" data-style="ring">
      <svg width="120" height="120" viewBox="0 0 150 150" style={{ position: 'absolute', left: '20px', top: '28px' }} aria-hidden="true">
        <circle cx="75" cy="75" r="56" fill="none" stroke="rgba(20, 20, 20, 0.15)" strokeWidth="16" />
        <circle cx="75" cy="75" r="56" fill="none" stroke="#141414" strokeWidth="16" strokeLinecap="round" strokeDasharray="289 352" transform="rotate(-90 75 75)" />
      </svg>
      <div style={{ position: 'absolute', left: '20px', top: '74px', width: '120px', textAlign: 'center' }}>
        <div className="n" style={{ fontSize: '42px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{minutesUntil}</div>
      </div>
      <p className="gne-label">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4" />
        </svg>
        <span>Next event</span>
      </p>
      <div style={{ position: 'absolute', left: '160px', right: '22px', bottom: '22px' }}>
        <p className="t" style={{ fontSize: '13px', fontWeight: 600 }}>{countdownText}</p>
        <div className="n" style={{ fontSize: '32px', letterSpacing: '-0.04em', lineHeight: 1.05, marginTop: '4px', fontWeight: 600 }}>
          {eventTitle}
        </div>
        <p className="t" style={{ fontSize: '14px', fontWeight: 500, marginTop: '4px', opacity: 0.85 }}>
          {timeRange}
        </p>
      </div>
    </section>
  )
}
