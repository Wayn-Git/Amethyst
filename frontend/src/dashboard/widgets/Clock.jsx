import { useEffect, useState } from 'react'
import { variationNumber } from '../widgetVariations.js'
import './clock/clock.css'

function getTimeParts(date, timeZone) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    const parts = f.formatToParts(date)
    const hour = parts.find(p => p.type === 'hour')?.value || '12'
    const minute = parts.find(p => p.type === 'minute')?.value || '00'
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value || 'AM'
    return { hour, minute, dayPeriod, full: `${hour}:${minute} ${dayPeriod}` }
  } catch {
    const h = date.getHours() % 12 || 12
    const m = String(date.getMinutes()).padStart(2, '0')
    const ap = date.getHours() >= 12 ? 'PM' : 'AM'
    return { hour: String(h), minute: m, dayPeriod: ap, full: `${h}:${m} ${ap}` }
  }
}

function timeInWords(date) {
  const hoursWords = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
  const m = date.getMinutes()
  const h = date.getHours() % 12
  const nextH = (h + 1) % 12

  if (m === 0) return { main: `It's ${hoursWords[h]}`, sub: "o'clock" }
  if (m === 15) return { main: "It's quarter", sub: `past ${hoursWords[h]}` }
  if (m === 30) return { main: "It's half", sub: `past ${hoursWords[h]}` }
  if (m === 45) return { main: "It's quarter", sub: `to ${hoursWords[nextH]}` }
  if (m < 30) {
    const mins = m === 1 ? 'one minute' : m <= 10 ? `${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][m]} past` : `${m} past`
    return { main: `It's ${mins}`, sub: `${hoursWords[h]}` }
  }
  const diff = 60 - m
  const mins = diff === 1 ? 'one minute' : diff <= 10 ? `${['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][diff]} to` : `${diff} to`
  return { main: `It's ${mins}`, sub: `${hoursWords[nextH]}` }
}

function AnalogClockSVG({ date, size = 112, light = true }) {
  const h = date.getHours() % 12
  const m = date.getMinutes()
  const s = date.getSeconds()

  const hDeg = h * 30 + m * 0.5
  const mDeg = m * 6 + s * 0.1
  const sDeg = s * 6

  const faceFill = light ? '#f5f5f7' : '#222'
  const tickStroke = light ? '#1d1d1f' : '#ffffff'
  const handStroke = light ? '#1d1d1f' : '#ffffff'
  const secColor = '#ff6a2b'

  return (
    <svg width={size} height={size} viewBox="0 0 128 128" role="img" aria-label="Analog clock">
      <circle cx="64" cy="64" r="62" fill={faceFill} />
      {/* 12 tick marks */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => (
        <line
          key={deg}
          x1="64" y1="9" x2="64" y2={deg % 90 === 0 ? '20' : '15'}
          stroke={tickStroke}
          strokeWidth={deg % 90 === 0 ? 3 : 1.5}
          strokeLinecap="round"
          transform={`rotate(${deg} 64 64)`}
        />
      ))}
      {/* Hour hand */}
      <line
        x1="64" y1="64" x2="64" y2="34"
        stroke={handStroke}
        strokeWidth="5"
        strokeLinecap="round"
        transform={`rotate(${hDeg} 64 64)`}
      />
      {/* Minute hand */}
      <line
        x1="64" y1="64" x2="64" y2="20"
        stroke={handStroke}
        strokeWidth="3.5"
        strokeLinecap="round"
        transform={`rotate(${mDeg} 64 64)`}
      />
      {/* Second hand */}
      <line
        x1="64" y1="78" x2="64" y2="14"
        stroke={secColor}
        strokeWidth="2"
        strokeLinecap="round"
        transform={`rotate(${sDeg} 64 64)`}
      />
      <circle cx="64" cy="64" r="4.5" fill={secColor} />
    </svg>
  )
}

export default function Clock({ size = 'm', design = 'clock-sm-01' }) {
  const [now, setNow] = useState(() => new Date())
  const variation = variationNumber(design)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const local = getTimeParts(now)
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
  const london = getTimeParts(now, 'Europe/London')
  const newyork = getTimeParts(now, 'America/New_York')
  const tokyo = getTimeParts(now, 'Asia/Tokyo')

  const styleName = variation === 2 ? 'flip' : variation === 3 ? 'words' : variation === 4 ? 'strip' : 'analog'

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="glance-clock" data-size="s" style={{ background: '#d4f53c', color: '#141414' }}>
        <p className="gc-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
          </svg>
          <span>Clock</span>
        </p>
        <div className="n" style={{ fontSize: '72px', letterSpacing: '-0.08em', marginTop: '10px', lineHeight: 0.95 }}>
          {local.hour}:{local.minute}
          <span style={{ fontSize: '18px', letterSpacing: 0, marginLeft: '6px' }}>{local.dayPeriod}</span>
        </div>
        <p className="t" style={{ marginTop: 'auto', fontSize: '13px', fontWeight: 500, opacity: 0.8 }}>
          {dateStr}
        </p>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="glance-clock" data-size="l">
        <p className="gc-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
          </svg>
          <span>Clock</span>
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
          <div>
            <div className="n" style={{ fontSize: '100px', letterSpacing: '-0.08em', lineHeight: 0.9 }}>
              {local.hour}:{local.minute}
            </div>
            <p className="t" style={{ fontSize: '20px', fontWeight: 600, marginTop: '8px' }}>
              {local.dayPeriod}
            </p>
            <p className="t" style={{ fontSize: '15px', opacity: 0.75, marginTop: '4px' }}>
              {dateStr}
            </p>
          </div>
          <AnalogClockSVG date={now} size={150} light={false} />
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
          <div style={{ flex: 1, borderRadius: '18px', padding: '12px 14px', background: 'var(--ws, rgba(0,0,0,0.06))' }}>
            <p className="t" style={{ fontSize: '12px', opacity: 0.75 }}>London</p>
            <p className="t" style={{ fontSize: '18px', fontWeight: 600, marginTop: '3px' }}>{london.full}</p>
          </div>
          <div style={{ flex: 1, borderRadius: '18px', padding: '12px 14px', background: 'var(--ws, rgba(0,0,0,0.06))' }}>
            <p className="t" style={{ fontSize: '12px', opacity: 0.75 }}>New York</p>
            <p className="t" style={{ fontSize: '18px', fontWeight: 600, marginTop: '3px' }}>{newyork.full}</p>
          </div>
          <div style={{ flex: 1, borderRadius: '18px', padding: '12px 14px', background: 'var(--ws, rgba(0,0,0,0.06))' }}>
            <p className="t" style={{ fontSize: '12px', opacity: 0.75 }}>Tokyo</p>
            <p className="t" style={{ fontSize: '18px', fontWeight: 600, marginTop: '3px' }}>{tokyo.full}</p>
          </div>
        </div>
      </section>
    )
  }

  // Medium (2x1) with 4 styles
  if (styleName === 'flip') {
    return (
      <section className="glance-clock style-flip" data-size="m" data-style="flip">
        <p className="gc-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
          </svg>
          <span>Clock</span>
        </p>
        <div style={{ position: 'absolute', left: '200px', top: '28px', display: 'flex', gap: '10px' }}>
          {local.hour.padStart(2, '0').split('').concat(local.minute.split('')).map((digit, idx) => (
            <div key={idx} style={{ position: 'relative', width: '80px', height: '112px', borderRadius: '14px', background: '#2a2a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="n" style={{ fontSize: '84px', letterSpacing: '-0.04em', color: '#fff' }}>{digit}</span>
              <i style={{ position: 'absolute', left: 0, right: 0, top: '55px', height: '2px', background: '#141414' }} />
            </div>
          ))}
        </div>
        <div style={{ position: 'absolute', left: '22px', bottom: '20px' }}>
          <span className="pl" style={{ background: '#ff6a2b', color: '#141414', padding: '4px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 700 }}>
            {local.dayPeriod}
          </span>
          <p className="t" style={{ fontSize: '13px', fontWeight: 500, marginTop: '8px', opacity: 0.8 }}>
            {dateStr}
          </p>
        </div>
      </section>
    )
  }

  if (styleName === 'words') {
    const { main, sub } = timeInWords(now)
    return (
      <section className="glance-clock style-words" data-size="m" data-style="words">
        <p className="gc-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
          </svg>
          <span>Clock</span>
        </p>
        <div style={{ position: 'absolute', left: '24px', top: '52px', fontSize: '50px', fontWeight: 600, letterSpacing: '-0.05em', lineHeight: 1.05 }}>
          {main}<br />
          <span style={{ color: '#ff6a2b' }}>{sub}</span>
        </div>
        <div style={{ position: 'absolute', right: '24px', bottom: '20px', textAlign: 'right' }}>
          <div className="n" style={{ fontSize: '26px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{local.hour}:{local.minute} {local.dayPeriod}</div>
          <p className="t" style={{ fontSize: '13px', fontWeight: 500, opacity: 0.7, marginTop: '4px' }}>{dateStr}</p>
        </div>
      </section>
    )
  }

  if (styleName === 'strip') {
    return (
      <section className="glance-clock style-strip" data-size="m" data-style="strip">
        <p className="gc-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
          </svg>
          <span>World clock</span>
        </p>
        <div style={{ position: 'absolute', right: '24px', top: '20px', textAlign: 'right' }}>
          <div className="n" style={{ fontSize: '26px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{local.hour}:{local.minute} {local.dayPeriod}</div>
        </div>
        <svg width="100%" height="100" viewBox="0 0 644 140" style={{ position: 'absolute', left: 0, bottom: '16px' }} aria-hidden="true">
          <rect x="20" y="40" width="604" height="34" rx="17" fill="rgba(255, 226, 138, 0.2)" />
          <rect x="20" y="40" width="151" height="34" rx="0" fill="rgba(255, 255, 255, 0.08)" />
          <rect x="473" y="40" width="151" height="34" fill="rgba(255, 255, 255, 0.08)" />
          <circle cx="251" cy="57" r="7" fill="#fff" />
          <text x="251" y="95" textAnchor="middle" fontSize="11" fill="#fff" fontFamily="Inter" fontWeight="600">London {london.hour}:{london.minute}</text>
          <circle cx="125" cy="57" r="7" fill="#fff" />
          <text x="125" y="30" textAnchor="middle" fontSize="11" fill="#fff" fontFamily="Inter" fontWeight="600">New York {newyork.hour}:{newyork.minute}</text>
          <circle cx="389" cy="57" r="8" fill="#ff6a2b" />
          <text x="389" y="95" textAnchor="middle" fontSize="11" fill="#ff6a2b" fontFamily="Inter" fontWeight="600">Local {local.hour}:{local.minute}</text>
          <circle cx="478" cy="57" r="7" fill="#fff" />
          <text x="478" y="30" textAnchor="middle" fontSize="11" fill="#fff" fontFamily="Inter" fontWeight="600">Tokyo {tokyo.hour}:{tokyo.minute}</text>
        </svg>
      </section>
    )
  }

  // Default Medium (Analog)
  return (
    <section className="glance-clock" data-size="m" data-style="analog">
      <p className="gc-label">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />
        </svg>
        <span>Clock</span>
      </p>
      <div style={{ display: 'flex', gap: '30px', flex: 1, alignItems: 'center' }}>
        <div style={{ flex: 1.2 }}>
          <div className="n" style={{ fontSize: '80px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>
            {local.hour}:{local.minute}
            <span style={{ fontSize: '20px', letterSpacing: 0, marginLeft: '6px', color: 'var(--mu, #6e6e73)' }}>{local.dayPeriod}</span>
          </div>
          <p className="t mu" style={{ fontSize: '14px', marginTop: '8px', fontWeight: 500 }}>
            {dateStr}
          </p>
        </div>
        <div style={{ flex: 1 }}>
          <div className="gc-world-row">
            <span className="mu" style={{ fontWeight: 500 }}>London</span>
            <span>{london.full}</span>
          </div>
          <div className="gc-world-row">
            <span className="mu" style={{ fontWeight: 500 }}>New York</span>
            <span>{newyork.full}</span>
          </div>
          <div className="gc-world-row">
            <span className="mu" style={{ fontWeight: 500 }}>Tokyo</span>
            <span>{tokyo.full}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
