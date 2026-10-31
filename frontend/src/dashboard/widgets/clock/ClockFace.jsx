import AnalogDial from './AnalogDial.jsx'
import { cityName, timeParts, timeText, zoneDate, zoneLabel, zoneOffset } from './helpers.js'

function Period({ value }) {
  return value ? <small className="clock-period">{value}</small> : null
}

function Meta({ children }) {
  return <p className="clock-meta">{children}</p>
}

export default function ClockFace({ now, face, size, seconds }) {
  const parts = timeParts(now, undefined, false)
  const digits = timeText(parts)
  const period = parts.find(part => part.type === 'dayPeriod')?.value
  const second = timeParts(now, undefined, true).find(part => part.type === 'second')?.value
  const weekday = now.toLocaleDateString([], { weekday: 'long' })
  const weekdayShort = now.toLocaleDateString([], { weekday: 'short' })
  const date = zoneDate(now)
  const month = now.toLocaleDateString([], { month: 'long' })
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const city = cityName(zone)
  const offset = zoneOffset(now)

  if (face.family === 'analog') {
    const variant = face.number === 4 ? 'roman' : face.number === 5 ? 'index' : 'split'
    const readSeconds = variant === 'split' && seconds
    return <div className={`clock-face clock-face--analog clock-face--analog-${variant}`}>
      <AnalogDial now={now} variant={variant} seconds={seconds} />
      <div className="clock-analog-copy">
        <time className="clock-time clock-time--analog" dateTime={now.toISOString()}>
          {readSeconds ? timeText(timeParts(now, undefined, true)) : digits}
          <Period value={period} />
        </time>
        <Meta><span>{weekdayShort}, {date}</span><span title={zoneLabel(zone)}>{city}</span></Meta>
      </div>
    </div>
  }

  if (face.number === 2) {
    return <div className="clock-face clock-face--precision">
      <div className="clock-display">
        <div className="clock-topline"><span>Local time</span><span className="clock-signal">Live</span></div>
        <time className="clock-time clock-time--mono" dateTime={now.toISOString()}>
          {digits}{seconds && second ? <small className="clock-seconds">:{second}</small> : null}<Period value={period} />
        </time>
        <div className="clock-display-foot"><span>{weekdayShort} {date}</span><span>{offset}</span></div>
      </div>
      <Meta><span title={zoneLabel(zone)}>{zoneLabel(zone)}</span></Meta>
    </div>
  }

  if (face.number === 3) {
    return <div className="clock-face clock-face--editorial">
      <div className="clock-editorial-lead">
        <p className="clock-eyebrow">Local time</p>
        <time className="clock-time" dateTime={now.toISOString()}>{digits}<Period value={period} /></time>
      </div>
      <div className="clock-tiles">
        <article className="clock-tile clock-tile--date"><span className="clock-tile-label">Date</span><strong>{now.getDate()}</strong><small>{month}</small></article>
        <article className="clock-tile clock-tile--weekday"><span className="clock-tile-label">Weekday</span><strong>{weekdayShort}</strong><small>{weekday}</small></article>
        <article className="clock-tile clock-tile--zone"><span className="clock-tile-label">Zone</span><strong title={zoneLabel(zone)}>{city}</strong><small>{offset}</small></article>
      </div>
    </div>
  }

  const world = face.family === 'world'
  return <div className={`clock-face clock-face--minimal${world ? ` clock-face--world clock-face--world-${face.number}` : ''}`}>
    <div className="clock-lead">
      <p className="clock-eyebrow">{world ? 'Local time' : 'Today'}</p>
      <span className="clock-chip">{offset}</span>
    </div>
    <time className="clock-time" dateTime={now.toISOString()}>{digits}<Period value={period} /></time>
    <Meta><span>{weekday}</span><span>{date}</span><span title={zoneLabel(zone)}>{city}</span></Meta>
    {size === 'l' && !world && <span className="clock-rule" aria-hidden="true" />}
  </div>
}
