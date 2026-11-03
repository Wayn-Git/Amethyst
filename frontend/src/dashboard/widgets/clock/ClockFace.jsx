import AnalogDial from './AnalogDial.jsx'
import WorldClocks from './WorldClocks.jsx'
import { cityName, formatDate, formatTime, offsetLabel, relativeOffset, timeLabel } from './helpers.js'

function ClockTime({ now, time, seconds, second }) {
  return <p className={`clock-time-row${time.text.length > 4 ? ' is-long' : ''}`}>
    <time className="clock-time" dateTime={now.toISOString()}>{time.text}</time>
    {seconds && second ? <span className="clock-seconds">:{second}</span> : null}
    {time.period && <span className="clock-period">{time.period}</span>}
  </p>
}

export default function ClockFace({ now, face, size, city, zones, reducedMotion, seconds }) {
  const time = formatTime(now)
  const date = formatDate(now)
  const second = String(now.getSeconds()).padStart(2, '0')
  const weekday = now.toLocaleDateString([], { weekday: 'long' })
  const weekdayShort = now.toLocaleDateString([], { weekday: 'short' })
  const month = now.toLocaleDateString([], { month: 'short' })

  // 1. Analog family (clock-sm-04 Roman, clock-sm-05 Index, clock-sm-06 Split)
  if (face?.family === 'analog') {
    const variant = face.number === 4 ? 'roman' : face.number === 5 ? 'index' : 'split'
    if (size === 's') {
      if (variant === 'split') {
        return <div className="clock-layout clock-small clock-small--split">
          <div className="clock-split-dial">
            <AnalogDial now={now} label={timeLabel(time)} variant="split" seconds={seconds} reducedMotion={reducedMotion} />
          </div>
          <div className="clock-split-info">
            <p className="clock-city">{city}</p>
            <ClockTime now={now} time={time} />
          </div>
        </div>
      }
      return <div className="clock-layout clock-small clock-small--analog">
        <AnalogDial now={now} label={timeLabel(time)} variant={variant} seconds={seconds} reducedMotion={reducedMotion} />
      </div>
    }
    if (size === 'm') {
      return <div className="clock-layout clock-medium clock-medium--analog">
        <div className="clock-medium-dial-slot">
          <AnalogDial now={now} label={timeLabel(time)} variant={variant} seconds={seconds} reducedMotion={reducedMotion} />
        </div>
        <span className="clock-medium-rule" aria-hidden="true" />
        {zones.length > 0 && variant !== 'split' ? (
          <WorldClocks now={now} zones={zones} variant="medium" />
        ) : (
          <div className="clock-medium-left">
            <p className="clock-city">{city}</p>
            <div className="clock-medium-bottom">
              <ClockTime now={now} time={time} seconds={seconds} second={second} />
              <p className="clock-date">{date}</p>
            </div>
          </div>
        )}
      </div>
    }
    return <div className="clock-layout clock-large">
      <div className="clock-large-top">
        <AnalogDial now={now} label={timeLabel(time)} variant={variant} seconds={true} reducedMotion={reducedMotion} />
        <div className="clock-large-copy">
          <p className="clock-city">{city}</p>
          <ClockTime now={now} time={time} />
          <p className="clock-date">{date}</p>
        </div>
      </div>
      <span className="clock-large-rule" aria-hidden="true" />
      <WorldClocks now={now} zones={zones} variant="large" />
    </div>
  }

  // 2. Editorial face (clock-sm-03)
  if (face?.number === 3) {
    const tiles = <div className="clock-tiles">
      <div className="clock-tile"><span className="clock-tile-label">Date</span><strong>{now.getDate()}</strong><small>{month}</small></div>
      <div className="clock-tile"><span className="clock-tile-label">Day</span><strong>{weekdayShort}</strong><small>{weekday}</small></div>
      <div className="clock-tile"><span className="clock-tile-label">Zone</span><strong>{city}</strong><small>Local</small></div>
    </div>
    if (size === 's') {
      return <div className="clock-layout clock-small clock-small--editorial">
        <div className="clock-editorial-sm-top">
          <p className="clock-city">{city}</p>
          <span className="clock-editorial-badge">{weekdayShort}</span>
        </div>
        <div className="clock-editorial-sm-bottom">
          <div className="clock-tile-sm">
            <span className="clock-tile-sm-num">{now.getDate()}</span>
            <span className="clock-tile-sm-month">{month}</span>
          </div>
          <ClockTime now={now} time={time} />
        </div>
      </div>
    }
    if (size === 'm') {
      return <div className="clock-layout clock-medium clock-medium--editorial">
        <div className="clock-medium-left">
          <p className="clock-city">{city}</p>
          <div className="clock-medium-bottom">
            <ClockTime now={now} time={time} />
            <p className="clock-date">{date}</p>
          </div>
        </div>
        <span className="clock-medium-rule" aria-hidden="true" />
        {tiles}
      </div>
    }
    return <div className="clock-layout clock-large clock-large--editorial">
      <div className="clock-large-top">
        <div className="clock-large-lead">
          <p className="clock-city">{city}</p>
          <ClockTime now={now} time={time} />
        </div>
        {tiles}
      </div>
      <span className="clock-large-rule" aria-hidden="true" />
      <WorldClocks now={now} zones={zones} variant="large" />
    </div>
  }

  // 3. World grid (clock-sm-08), ledger (clock-sm-09), pair (clock-sm-07)
  if (face?.family === 'world') {
    const worldVariant = face.number === 8 ? 'grid' : face.number === 9 ? 'ledger' : 'medium'
    if (size === 's') {
      if (face.number === 7) {
        const otherZone = zones[0] || 'Europe/London'
        const otherTime = formatTime(now, otherZone)
        return <div className="clock-layout clock-small clock-small--pair">
          <div className="clock-pair-row">
            <p className="clock-city">{city}</p>
            <ClockTime now={now} time={time} />
          </div>
          <span className="clock-pair-rule" aria-hidden="true" />
          <div className="clock-pair-row is-secondary">
            <p className="clock-city">{cityName(otherZone)}</p>
            {otherTime && <ClockTime now={now} time={otherTime} />}
          </div>
        </div>
      }
      if (face.number === 8) {
        const gridZones = [
          { name: city, time: time },
          ...zones.slice(0, 3).map(z => ({ name: cityName(z), time: formatTime(now, z) })),
        ].slice(0, 4)
        return <div className="clock-layout clock-small clock-small--grid">
          <div className="clock-grid-4">
            {gridZones.map((g, i) => (
              <div key={i} className="clock-grid-item">
                <span className="clock-grid-city">{g.name}</span>
                <span className="clock-grid-time">{g.time.text}</span>
                {g.time.period && <small className="clock-grid-period">{g.time.period}</small>}
              </div>
            ))}
          </div>
        </div>
      }
      if (face.number === 9) {
        const ledgerZones = [
          { name: city, time: time, offset: 'Local' },
          ...zones.slice(0, 3).map(z => ({ name: cityName(z), time: formatTime(now, z), offset: offsetLabel(relativeOffset(now, z)) })),
        ].slice(0, 3)
        return <div className="clock-layout clock-small clock-small--ledger">
          <div className="clock-ledger-items">
            {ledgerZones.map((l, i) => (
              <div key={i} className="clock-ledger-row">
                <div className="clock-ledger-info">
                  <span className="clock-ledger-name">{l.name}</span>
                  <span className="clock-ledger-offset">{l.offset}</span>
                </div>
                <span className="clock-ledger-time">{l.time.text} <small>{l.time.period}</small></span>
              </div>
            ))}
          </div>
        </div>
      }
    }
    if (size === 'm') {
      if (face.number === 8) {
        return <div className="clock-layout clock-medium clock-medium--grid">
          <WorldClocks now={now} zones={zones} variant="grid" />
        </div>
      }
      return <div className="clock-layout clock-medium">
        <div className="clock-medium-left">
          <p className="clock-city">{city}</p>
          <div className="clock-medium-bottom">
            <ClockTime now={now} time={time} />
            <p className="clock-date">{date}</p>
          </div>
        </div>
        <span className="clock-medium-rule" aria-hidden="true" />
        <WorldClocks now={now} zones={zones} variant={worldVariant} />
      </div>
    }
    return <div className="clock-layout clock-large">
      <div className="clock-large-top">
        <AnalogDial now={now} label={timeLabel(time)} variant="index" seconds={true} reducedMotion={reducedMotion} />
        <div className="clock-large-copy">
          <p className="clock-city">{city}</p>
          <ClockTime now={now} time={time} />
          <p className="clock-date">{date}</p>
        </div>
      </div>
      <span className="clock-large-rule" aria-hidden="true" />
      <WorldClocks now={now} zones={zones} variant={worldVariant} />
    </div>
  }

  // 4. Precision (clock-sm-02) & Minimal (clock-sm-01 default)
  const isPrecision = face?.number === 2
  if (size === 's') return <div className={`clock-layout clock-small${isPrecision ? ' clock-small--precision' : ''}`}>
    <div className="clock-small-header">
      <p className="clock-city">{city}</p>
      {isPrecision && <span className="clock-precision-badge">SEC</span>}
    </div>
    <ClockTime now={now} time={time} seconds={isPrecision && seconds} second={second} />
  </div>

  if (size === 'm') {
    if (face?.number === 1) {
      return <div className="clock-layout clock-medium clock-medium--minimal">
        <div className="clock-minimal-m">
          <p className="clock-city">{city}</p>
          <div className="clock-minimal-m-center">
            <ClockTime now={now} time={time} />
            <p className="clock-date">{date}</p>
          </div>
        </div>
      </div>
    }
    return <div className="clock-layout clock-medium">
      <div className="clock-medium-left">
        <p className="clock-city">{city}</p>
        <div className="clock-medium-bottom">
          <ClockTime now={now} time={time} seconds={isPrecision && seconds} second={second} />
          <p className="clock-date">{date}</p>
        </div>
      </div>
      <span className="clock-medium-rule" aria-hidden="true" />
      <WorldClocks now={now} zones={zones} variant="medium" />
    </div>
  }

  if (face?.number === 1) {
    return <div className="clock-layout clock-large clock-large--minimal">
      <div className="clock-minimal-l">
        <p className="clock-city">{city}</p>
        <div className="clock-minimal-l-center">
          <ClockTime now={now} time={time} />
          <p className="clock-date">{date}</p>
        </div>
      </div>
    </div>
  }

  return <div className="clock-layout clock-large">
    <div className="clock-large-top">
      <AnalogDial now={now} label={timeLabel(time)} variant="index" seconds={true} reducedMotion={reducedMotion} />
      <div className="clock-large-copy">
        <p className="clock-city">{city}</p>
        <ClockTime now={now} time={time} seconds={isPrecision && seconds} second={second} />
        <p className="clock-date">{date}</p>
      </div>
    </div>
    <span className="clock-large-rule" aria-hidden="true" />
    <WorldClocks now={now} zones={zones} variant="large" />
  </div>
}
