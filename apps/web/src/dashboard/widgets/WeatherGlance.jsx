import { useMemo } from 'react'
import { variationNumber } from '../widgetVariations.js'
import LocationSettings from './LocationSettings.jsx'
import './weather/weather.css'

const CONDITIONS = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
  85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm',
  96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
}

function WeatherIcon({ name, size = 20, color = 'currentColor' }) {
  if (name === 'sun') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  }
  if (name === 'cloud-sun') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2v2M4.9 4.9l1.4 1.4M20 12h2M19.1 4.9l-1.4 1.4" />
        <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.5A4 4 0 0 0 6.5 19z" />
      </svg>
    )
  }
  if (name === 'cloud') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.7 1.5A4 4 0 0 0 6.5 19z" />
      </svg>
    )
  }
  if (name === 'cloud-rain') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 13a4 4 0 0 0-8 0 5 5 0 0 0-4 4.9A4.1 4.1 0 0 0 8.1 22h7.8A4.1 4.1 0 0 0 20 17.9 5 5 0 0 0 16 13z" />
        <path d="M8 15v3M12 15v5M16 15v3" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function iconForCode(code) {
  if (code == null) return 'sun'
  if (code === 0) return 'sun'
  if (code <= 2) return 'cloud-sun'
  if (code <= 48) return 'cloud'
  return 'cloud-rain'
}

export default function WeatherGlance({ data, full = false, size = 'm', design = 'weather-sm-01' }) {
  const variation = variationNumber(design)
  const place = data?.location_name || (data?.set_location ? 'Set Location' : 'Local')
  const temp = Number.isFinite(data?.temperature) ? Math.round(data.temperature) : 24
  const condition = (data?.weather_code != null && CONDITIONS[data.weather_code]) || 'Partly cloudy'
  const todayDaily = Array.isArray(data?.daily) && data.daily[0]
  const high = Number.isFinite(todayDaily?.temperature_max) ? Math.round(todayDaily.temperature_max) : temp + 4
  const low = Number.isFinite(todayDaily?.temperature_min) ? Math.round(todayDaily.temperature_min) : temp - 5
  const feelsLike = Number.isFinite(data?.feels_like) ? Math.round(data.feels_like) : temp
  const uvIndex = Number.isFinite(data?.uv_index) ? Math.round(data.uv_index) : 5

  const rawHours = Array.isArray(data?.hours) && data.hours.length > 0 ? data.hours.slice(0, 6) : [
    { time: 'Now', temp, icon: 'sun' },
    { time: '3 PM', temp: temp + 1, icon: 'sun' },
    { time: '4 PM', temp, icon: 'sun' },
    { time: '5 PM', temp: temp - 1, icon: 'cloud' },
    { time: '6 PM', temp: temp - 2, icon: 'cloud' },
    { time: '7 PM', temp: temp - 3, icon: 'cloud-rain' },
  ]

  const hours = rawHours.map((h, i) => {
    let label = h.time || ''
    if (i === 0) label = 'Now'
    else if (label.includes('T')) {
      const d = new Date(label)
      label = !isNaN(d.getTime()) ? `${d.getHours() % 12 || 12} ${d.getHours() >= 12 ? 'PM' : 'AM'}` : label
    }
    const t = Number.isFinite(h.temperature) ? Math.round(h.temperature) : (h.temp ?? temp)
    const icon = h.icon || iconForCode(h.weather_code)
    return { label, temp: t, icon }
  })

  const daily = (Array.isArray(data?.daily) && data.daily.length > 0 ? data.daily.slice(1, 4) : [
    { day: 'Mon', min: low, max: high, code: 0 },
    { day: 'Tue', min: low + 1, max: high - 1, code: 2 },
    { day: 'Wed', min: low - 1, max: high + 1, code: 0 },
  ]).map((d, i) => {
    let dayLabel = d.day
    if (!dayLabel && d.date) {
      const dt = new Date(d.date)
      dayLabel = !isNaN(dt.getTime()) ? dt.toLocaleDateString('en-US', { weekday: 'short' }) : `Day ${i + 1}`
    }
    return {
      day: dayLabel || (i === 0 ? 'Mon' : i === 1 ? 'Tue' : 'Wed'),
      min: Number.isFinite(d.temperature_min) ? Math.round(d.temperature_min) : low,
      max: Number.isFinite(d.temperature_max) ? Math.round(d.temperature_max) : high,
      icon: iconForCode(d.weather_code || d.code),
    }
  })

  // Style concept A (Scene), B (Poster), C (Curve), D (Dial)
  const styleName = variation === 2 ? 'poster' : variation === 3 ? 'curve' : variation === 4 ? 'dial' : 'scene'

  if (full) {
    return (
      <div className="glance-weather glance-weather--full">
        <LocationSettings active />
      </div>
    )
  }

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="glance-weather" data-size="s">
        <p className="gw-label">
          <WeatherIcon name="sun" size={18} />
          <span>Weather</span>
          <b>{place}</b>
        </p>
        <div style={{ marginTop: 'auto' }}>
          <div className="n" style={{ fontSize: '64px', fontWeight: 300, letterSpacing: '-0.07em', lineHeight: 0.95 }}>
            {temp}°
          </div>
          <p className="t" style={{ fontSize: '15px', fontWeight: 600, marginTop: '6px' }}>{condition}</p>
          <p className="t" style={{ fontSize: '13px', opacity: 0.8, marginTop: '2px' }}>H {high}° · L {low}°</p>
        </div>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="glance-weather" data-size="l">
        <p className="gw-label">
          <WeatherIcon name="sun" size={18} />
          <span>Weather</span>
          <b>{place}</b>
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14px' }}>
          <div>
            <div className="n" style={{ fontSize: '110px', fontWeight: 300, letterSpacing: '-0.06em', lineHeight: 0.95 }}>
              {temp}°
            </div>
            <p className="t" style={{ fontSize: '20px', fontWeight: 600, marginTop: '6px' }}>{condition}</p>
            <p className="t" style={{ fontSize: '15px', marginTop: '4px', opacity: 0.85 }}>High {high}° · Low {low}°</p>
          </div>
          <div style={{ position: 'relative', width: '150px', height: '130px', flexShrink: 0 }}>
            <div style={{ position: 'absolute', right: 0, top: 0, width: '100px', height: '100px', borderRadius: '50%', background: '#ffd24a' }} />
            <div style={{ position: 'absolute', left: 0, bottom: 0, width: '110px', height: '48px', borderRadius: '24px', background: 'rgba(255,255,255,0.92)' }} />
            <div style={{ position: 'absolute', left: '28px', bottom: '26px', width: '56px', height: '42px', borderRadius: '50%', background: 'rgba(255,255,255,0.92)' }} />
          </div>
        </div>

        {/* Hourly forecast row */}
        <div className="gw-hourly-row" style={{ marginTop: '16px' }}>
          {hours.map((h, i) => (
            <div key={i} className={`gw-hourly-item ${i === 0 ? 'is-now' : ''}`}>
              <span>{h.label}</span>
              <WeatherIcon name={h.icon} size={20} />
              <span>{h.temp}°</span>
            </div>
          ))}
        </div>

        {/* 3-day forecast */}
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {daily.map((d, i) => (
            <div key={i} className="gw-daily-row">
              <span style={{ width: '48px' }}>{d.day}</span>
              <WeatherIcon name={d.icon} size={18} />
              <span style={{ width: '28px', textAlign: 'right', opacity: 0.8 }}>{d.min}°</span>
              <div className="gw-daily-bar">
                <span className="gw-daily-bar-fill" style={{ left: '20%', width: '60%' }} />
              </div>
              <span style={{ width: '28px' }}>{d.max}°</span>
            </div>
          ))}
        </div>
      </section>
    )
  }

  // Medium size (2x1) with 4 styles
  if (styleName === 'poster') {
    return (
      <section className="glance-weather style-poster" data-size="m" data-style="poster">
        <div className="n" style={{ position: 'absolute', left: '14px', top: '-14px', fontSize: '200px', fontWeight: 700, letterSpacing: '-0.09em', lineHeight: 1, color: '#1d1d1f' }}>
          {temp}
        </div>
        <div className="n" style={{ position: 'absolute', right: '20px', top: '16px', fontSize: '64px', fontWeight: 700, letterSpacing: '-0.04em', color: 'transparent', WebkitTextStroke: '2px #1d1d1f', lineHeight: 1 }}>
          {condition.toUpperCase().split(' ')[0]}
        </div>
        <div style={{ position: 'absolute', right: '24px', bottom: '18px', textAlign: 'right', fontSize: '14px', fontWeight: 600 }}>
          High {high}° · Low {low}°<br />
          <span style={{ fontWeight: 500, opacity: 0.7 }}>Feels like {feelsLike}°</span>
        </div>
        <div style={{ position: 'absolute', left: '22px', bottom: '16px' }}>
          <p className="gw-label">
            <WeatherIcon name="sun" size={18} />
            <span>Weather</span>
          </p>
        </div>
      </section>
    )
  }

  if (styleName === 'curve') {
    return (
      <section className="glance-weather style-curve" data-size="m" data-style="curve">
        <p className="gw-label">
          <WeatherIcon name="sun" size={18} />
          <span>Weather</span>
          <b>{place}</b>
        </p>
        <div style={{ position: 'absolute', left: '22px', top: '44px' }}>
          <div className="n" style={{ fontSize: '54px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{temp}°</div>
        </div>
        <svg width="100%" height="160" viewBox="0 0 644 224" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, bottom: 0 }} aria-hidden="true">
          <path d="M20 150C70 140 90 120 120 120S190 74 220 70S290 50 320 52S390 62 420 70S490 108 520 115S590 140 620 145V224H20Z" fill="rgba(255, 176, 0, 0.12)" />
          <path d="M20 150C70 140 90 120 120 120S190 74 220 70S290 50 320 52S390 62 420 70S490 108 520 115S590 140 620 145" fill="none" stroke="#ff6a2b" strokeWidth="4" strokeLinecap="round" />
          <circle cx="20" cy="150" r="8" fill="#ff6a2b" />
          <circle cx="120" cy="120" r="5" fill="#fff" stroke="#ff6a2b" strokeWidth="3" />
          <circle cx="220" cy="70" r="5" fill="#fff" stroke="#ff6a2b" strokeWidth="3" />
          <circle cx="320" cy="52" r="5" fill="#fff" stroke="#ff6a2b" strokeWidth="3" />
          <circle cx="420" cy="70" r="5" fill="#fff" stroke="#ff6a2b" strokeWidth="3" />
          <circle cx="520" cy="115" r="5" fill="#fff" stroke="#ff6a2b" strokeWidth="3" />
          <circle cx="620" cy="145" r="5" fill="#fff" stroke="#ff6a2b" strokeWidth="3" />
          <text x="20" y="210" textAnchor="middle" fontSize="12" fill="#6e6e73" fontFamily="Inter">Now</text>
          <text x="120" y="210" textAnchor="middle" fontSize="12" fill="#6e6e73" fontFamily="Inter">3 PM</text>
          <text x="220" y="210" textAnchor="middle" fontSize="12" fill="#6e6e73" fontFamily="Inter">4 PM</text>
          <text x="320" y="210" textAnchor="middle" fontSize="12" fill="#6e6e73" fontFamily="Inter">5 PM</text>
          <text x="420" y="210" textAnchor="middle" fontSize="12" fill="#6e6e73" fontFamily="Inter">6 PM</text>
          <text x="520" y="210" textAnchor="middle" fontSize="12" fill="#6e6e73" fontFamily="Inter">7 PM</text>
          <text x="620" y="210" textAnchor="middle" fontSize="12" fill="#6e6e73" fontFamily="Inter">8 PM</text>
        </svg>
      </section>
    )
  }

  if (styleName === 'dial') {
    return (
      <section className="glance-weather style-dial" data-size="m" data-style="dial">
        <svg width="180" height="120" viewBox="0 0 220 140" style={{ position: 'absolute', left: '20px', top: '48px' }} aria-hidden="true">
          <path d="M24.0 120.0A86 86 0 0 1 196.0 120.0" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="16" strokeLinecap="round" />
          <path d="M24.0 120.0A86 86 0 0 1 153.0 45.5" fill="none" stroke="#ff6a2b" strokeWidth="16" strokeLinecap="round" />
          <circle cx="153.0" cy="45.5" r="7" fill="#fff" />
          <text x="22" y="138" fontSize="12" fill="#b9b9c2" fontFamily="Inter">{low}°</text>
          <text x="198" y="138" fontSize="12" fill="#b9b9c2" fontFamily="Inter" textAnchor="end">{high}°</text>
        </svg>
        <div style={{ position: 'absolute', left: '20px', top: '88px', width: '180px', textAlign: 'center' }}>
          <div className="n" style={{ fontSize: '46px', letterSpacing: '-0.06em', lineHeight: 0.95, fontWeight: 500 }}>{temp}°</div>
        </div>
        <p className="gw-label">
          <WeatherIcon name="sun" size={18} />
          <span>Weather</span>
          <b>{place}</b>
        </p>
        <div style={{ position: 'absolute', left: '240px', right: '22px', top: '24px', bottom: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '14px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500, color: '#b9b9c2' }}>Condition</span>
            <span>{condition}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '14px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500, color: '#b9b9c2' }}>Feels like</span>
            <span>{feelsLike}°</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '14px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500, color: '#b9b9c2' }}>UV index</span>
            <span>{uvIndex} High</span>
          </div>
        </div>
      </section>
    )
  }

  // Default Medium (Scene)
  return (
    <section className="glance-weather" data-size="m" data-style="scene">
      <div style={{ position: 'absolute', right: '-20px', top: '-24px', width: '140px', height: '140px', borderRadius: '50%', background: '#ffd54a' }} />
      <div style={{ position: 'absolute', right: '24px', top: '64px' }}>
        <svg width="170" height="76" viewBox="0 0 250 110" aria-hidden="true">
          <rect x="20" y="52" width="200" height="48" rx="24" fill="#fff" />
          <circle cx="82" cy="52" r="34" fill="#fff" />
          <circle cx="140" cy="40" r="42" fill="#fff" />
          <circle cx="188" cy="58" r="28" fill="#fff" />
        </svg>
      </div>
      <p className="gw-label">
        <WeatherIcon name="sun" size={18} />
        <span>Weather</span>
        <b>{place}</b>
      </p>
      <div className="n" style={{ fontSize: '92px', fontWeight: 300, letterSpacing: '-0.07em', marginTop: '2px', position: 'relative' }}>
        {temp}°
      </div>
      <p className="t" style={{ fontSize: '16px', fontWeight: 600, position: 'relative' }}>
        {condition} · H {high}° L {low}°
      </p>
      <div style={{ position: 'absolute', right: '20px', bottom: '20px', width: '280px', display: 'flex', gap: '6px' }}>
        {hours.slice(0, 4).map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              borderRadius: '16px',
              padding: '8px 0',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 600,
              background: i === 0 ? '#fff' : 'rgba(255,255,255,0.25)',
              color: i === 0 ? '#2563eb' : '#fff',
            }}
          >
            <div style={{ fontWeight: 500, opacity: 0.85 }}>{h.label}</div>
            <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
              <WeatherIcon name={h.icon} size={16} />
            </div>
            {h.temp}°
          </div>
        ))}
      </div>
    </section>
  )
}
