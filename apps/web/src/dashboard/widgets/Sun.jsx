import { useMemo } from 'react'
import { variationNumber } from '../widgetVariations.js'
import './sun/sun.css'

function formatSunTime(isoStr) {
  if (!isoStr) return '6:00 AM'
  try {
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return isoStr.slice(11, 16) || isoStr
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch {
    return isoStr.slice(11, 16) || isoStr
  }
}

export default function Sun({ data, size = 's', design = 'sun-sm-01' }) {
  const variation = variationNumber(design)

  const sunriseStr = formatSunTime(data?.sunrise || '2026-11-08T06:34:00')
  const sunsetStr = formatSunTime(data?.sunset || '2026-11-08T17:58:00')

  // Calculate daylight duration
  const daylightText = useMemo(() => {
    try {
      const r = new Date(data?.sunrise || '2026-11-08T06:34:00')
      const s = new Date(data?.sunset || '2026-11-08T17:58:00')
      if (!isNaN(r.getTime()) && !isNaN(s.getTime())) {
        const diffMs = s.getTime() - r.getTime()
        const h = Math.floor(diffMs / 3600000)
        const m = Math.floor((diffMs % 3600000) / 60000)
        return `${h}h ${String(m).padStart(2, '0')}m`
      }
    } catch {}
    return '11h 24m'
  }, [data?.sunrise, data?.sunset])

  // Is currently after sunset?
  const isNight = useMemo(() => {
    try {
      const now = Date.now()
      const s = new Date(data?.sunset || '2026-11-08T17:58:00').getTime()
      const r = new Date(data?.sunrise || '2026-11-08T06:34:00').getTime()
      return now > s || now < r
    } catch {
      return false
    }
  }, [data?.sunrise, data?.sunset])

  const styleName = variation === 2 ? 'dial' : variation === 3 ? 'path' : variation === 4 ? 'split' : 'landscape'

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="glance-sun" data-size="s">
        <p className="gs-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 18a5 5 0 0 0-10 0M12 9V2M4 18H2M22 18h-2M5 11l1.5 1.5M19 11l-1.5 1.5M2 22h20" />
          </svg>
          <span>{isNight ? 'Sunrise' : 'Sunset'}</span>
        </p>
        <svg width="100%" height="70" viewBox="0 0 232 76" style={{ marginTop: '10px' }} role="img" aria-label="Sun position">
          <path d="M6 70A110 62 0 0 1 226 70" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" />
          <circle cx="166" cy="28" r="8" fill="currentColor" />
        </svg>
        <div className="n" style={{ fontSize: '40px', marginTop: 'auto' }}>
          {isNight ? sunriseStr : sunsetStr}
        </div>
        <p className="t" style={{ fontSize: '13px', fontWeight: 500, marginTop: '4px', opacity: 0.8 }}>
          {isNight ? `Sunset ${sunsetStr}` : `Sunrise ${sunriseStr}`}
        </p>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="glance-sun" data-size="l">
        <p className="gs-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 18a5 5 0 0 0-10 0M12 9V2M4 18H2M22 18h-2M5 11l1.5 1.5M19 11l-1.5 1.5M2 22h20" />
          </svg>
          <span>Sunrise & sunset</span>
        </p>
        <svg width="100%" height="120" viewBox="0 0 300 120" style={{ marginTop: '12px' }} role="img" aria-label="Sun trajectory">
          <line x1="20" y1="90" x2="280" y2="90" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M20 90 A130 70 0 0 1 280 90" fill="none" stroke="#ff9a00" strokeWidth="4" strokeLinecap="round" />
          <circle cx="190" cy="30" r="10" fill="#ffb000" />
          <text x="30" y="112" fontSize="12" fill="currentColor" fontFamily="Inter">Sunrise {sunriseStr}</text>
          <text x="270" y="112" textAnchor="end" fontSize="12" fill="currentColor" fontFamily="Inter">Sunset {sunsetStr}</text>
        </svg>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: 'auto' }}>
          <div style={{ borderRadius: '16px', padding: '12px', background: 'rgba(0,0,0,0.06)' }}>
            <p className="t" style={{ fontSize: '12px', opacity: 0.75 }}>Daylight duration</p>
            <p className="t" style={{ fontSize: '20px', fontWeight: 600, marginTop: '2px' }}>{daylightText}</p>
          </div>
          <div style={{ borderRadius: '16px', padding: '12px', background: 'rgba(0,0,0,0.06)' }}>
            <p className="t" style={{ fontSize: '12px', opacity: 0.75 }}>Golden hour</p>
            <p className="t" style={{ fontSize: '20px', fontWeight: 600, marginTop: '2px' }}>5:20 PM</p>
          </div>
        </div>
      </section>
    )
  }

  // Medium (2x1) with 4 styles
  if (styleName === 'dial') {
    return (
      <section className="glance-sun style-dial" data-size="m" data-style="dial">
        <svg width="160" height="160" viewBox="0 0 224 224" style={{ position: 'absolute', left: '16px', top: '10px' }} aria-hidden="true">
          <circle cx="112" cy="112" r="80" fill="none" stroke="#2c2c30" strokeWidth="22" />
          <path d="M191.1 123.9A80 80 0 0 1 32.0 112.6" fill="none" stroke="#ffb000" strokeWidth="22" strokeLinecap="round" />
          <circle cx="60.4" cy="173.1" r="9" fill="#fff" />
          <text x="112" y="108" textAnchor="middle" fontSize="12" fill="#b9b9c2" fontFamily="Inter">Daylight</text>
          <text x="112" y="132" textAnchor="middle" fontSize="20" fontWeight="600" fill="#fff" fontFamily="Inter">{daylightText}</text>
        </svg>
        <p className="gs-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 18a5 5 0 0 0-10 0M12 9V2M4 18H2M22 18h-2M5 11l1.5 1.5M19 11l-1.5 1.5M2 22h20" />
          </svg>
          <span>Sunrise and sunset</span>
        </p>
        <div style={{ position: 'absolute', left: '230px', right: '22px', top: '48px', bottom: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '15px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500, color: '#b9b9c2' }}>Sunrise</span>
            <span>{sunriseStr}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '15px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500, color: '#b9b9c2' }}>Sunset</span>
            <span>{sunsetStr}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: '15px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500, color: '#b9b9c2' }}>Golden hour</span>
            <span>5:20 PM</span>
          </div>
        </div>
      </section>
    )
  }

  if (styleName === 'path') {
    return (
      <section className="glance-sun style-path" data-size="m" data-style="path">
        <p className="gs-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 18a5 5 0 0 0-10 0M12 9V2M4 18H2M22 18h-2M5 11l1.5 1.5M19 11l-1.5 1.5M2 22h20" />
          </svg>
          <span>Sunrise and sunset</span>
        </p>
        <svg width="100%" height="130" viewBox="0 0 644 180" style={{ position: 'absolute', left: 0, top: '24px' }} aria-hidden="true">
          <line x1="30" y1="100" x2="614" y2="100" stroke="#3a2e0055" strokeWidth="2" />
          <path d="M30 110 Q 322 10 614 110" fill="none" stroke="#ff9a00" strokeWidth="4" strokeLinecap="round" />
          <circle cx="190" cy="100" r="6" fill="#3a2e00" />
          <circle cx="467" cy="100" r="6" fill="#3a2e00" />
          <circle cx="387" cy="46" r="11" fill="#ffb000" />
          <text x="190" y="126" textAnchor="middle" fontSize="13" fontWeight="600" fontFamily="Inter" fill="#3a2e00">{sunriseStr}</text>
          <text x="467" y="126" textAnchor="middle" fontSize="13" fontWeight="600" fontFamily="Inter" fill="#3a2e00">{sunsetStr}</text>
        </svg>
        <div style={{ position: 'absolute', left: '22px', bottom: '18px' }}>
          <p className="t" style={{ fontSize: '15px', fontWeight: 600 }}>Daylight {daylightText}</p>
        </div>
      </section>
    )
  }

  if (styleName === 'split') {
    return (
      <section className="glance-sun style-split" data-size="m" data-style="split">
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', background: '#2b2140', color: '#fff' }} />
        <div style={{ position: 'absolute', left: '24px', top: '20px', color: '#2a1f00' }}>
          <p className="gs-label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <span>Sunrise</span>
          </p>
          <div className="n" style={{ fontSize: '56px', letterSpacing: '-0.06em', lineHeight: 0.95, marginTop: '14px' }}>
            {sunriseStr.split(' ')[0]}
          </div>
          <p className="t" style={{ fontSize: '13px', fontWeight: 500, marginTop: '6px' }}>{sunriseStr.split(' ')[1] || 'AM'} · Today</p>
        </div>
        <div style={{ position: 'absolute', right: '24px', top: '20px', color: '#fff', textAlign: 'right' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <p className="gs-label">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 18a5 5 0 0 0-10 0M12 9V2M4 18H2M22 18h-2M5 11l1.5 1.5M19 11l-1.5 1.5M2 22h20" />
              </svg>
              <span>Sunset</span>
            </p>
          </div>
          <div className="n" style={{ fontSize: '56px', letterSpacing: '-0.06em', lineHeight: 0.95, marginTop: '14px' }}>
            {sunsetStr.split(' ')[0]}
          </div>
          <p className="t" style={{ fontSize: '13px', fontWeight: 500, marginTop: '6px', color: '#e6dff5' }}>{sunsetStr.split(' ')[1] || 'PM'} · Today</p>
        </div>
      </section>
    )
  }

  // Default Medium (Landscape)
  return (
    <section className="glance-sun" data-size="m" data-style="landscape">
      <div style={{ position: 'absolute', left: 0, right: 0, top: '90px', bottom: 0, background: '#f3bf94' }} />
      <div style={{ position: 'absolute', right: '100px', bottom: '34px', width: '80px', height: '80px', borderRadius: '50%', background: '#fff0d0' }} />
      <div style={{ position: 'absolute', left: '-60px', bottom: '-50px', width: '340px', height: '100px', borderRadius: '50%', background: '#b9674a' }} />
      <div style={{ position: 'absolute', right: '-80px', bottom: '-40px', width: '380px', height: '90px', borderRadius: '50%', background: '#8a4a3a' }} />
      <p className="gs-label">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 18a5 5 0 0 0-10 0M12 9V2M4 18H2M22 18h-2M5 11l1.5 1.5M19 11l-1.5 1.5M2 22h20" />
        </svg>
        <span>{isNight ? 'Sunrise' : 'Sunset'}</span>
      </p>
      <div style={{ position: 'relative', marginTop: '10px' }}>
        <div className="n" style={{ fontSize: '52px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>
          {isNight ? sunriseStr : sunsetStr}
        </div>
        <p className="t" style={{ fontSize: '14px', fontWeight: 500, marginTop: '6px' }}>
          {isNight ? `Sunset ${sunsetStr}` : `Sunrise ${sunriseStr}`}
        </p>
      </div>
    </section>
  )
}
