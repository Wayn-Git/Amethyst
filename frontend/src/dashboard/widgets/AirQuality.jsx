import { useMemo } from 'react'
import { variationNumber } from '../widgetVariations.js'
import './air/air.css'

function getAqiRating(aqi) {
  if (aqi <= 50) return { label: 'Good', color: '#2fb457' }
  if (aqi <= 100) return { label: 'Moderate', color: '#f2c200' }
  if (aqi <= 150) return { label: 'Unhealthy for sensitive', color: '#ff8a00' }
  if (aqi <= 200) return { label: 'Unhealthy', color: '#e5484d' }
  if (aqi <= 300) return { label: 'Very Unhealthy', color: '#8e4ec6' }
  return { label: 'Hazardous', color: '#7e0023' }
}

export default function AirQuality({ data, size = 'm', design = 'air-sm-01' }) {
  const variation = variationNumber(design)

  const aqi = Number.isFinite(data?.us_aqi) ? Math.round(data.us_aqi) : Number.isFinite(data?.aqi) ? Math.round(data.aqi) : 42
  const rating = getAqiRating(aqi)
  const pm25 = Number.isFinite(data?.pm2_5) ? Math.round(data.pm2_5) : 12
  const pm10 = Number.isFinite(data?.pm10) ? Math.round(data.pm10) : 21
  const ozone = Number.isFinite(data?.ozone) ? Math.round(data.ozone) : 48

  const styleName = variation === 2 ? 'scale' : variation === 3 ? 'particles' : variation === 4 ? 'skyline' : 'gauge'

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="glance-air" data-size="s">
        <p className="ga-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
          </svg>
          <span>Air quality</span>
        </p>
        <div style={{ marginTop: 'auto' }}>
          <div className="n" style={{ fontSize: '64px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>
            {aqi}
          </div>
          <p className="t" style={{ fontSize: '16px', fontWeight: 700, marginTop: '6px', color: rating.color }}>
            {rating.label}
          </p>
          <div style={{ display: 'flex', gap: '3px', marginTop: '10px' }}>
            {['#2fb457', '#f2c200', '#ff8a00', '#e5484d', '#8e4ec6'].map((c, i) => (
              <i key={i} style={{ flex: 1, height: '4px', borderRadius: '2px', background: c, opacity: i === 0 ? 1 : 0.4 }} />
            ))}
          </div>
        </div>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="glance-air" data-size="l">
        <p className="ga-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
          </svg>
          <span>Air quality</span>
        </p>
        <div style={{ display: 'flex', gap: '30px', marginTop: '14px', alignItems: 'center' }}>
          <div>
            <div className="n" style={{ fontSize: '84px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{aqi}</div>
            <p className="t" style={{ fontSize: '18px', fontWeight: 700, marginTop: '6px', color: rating.color }}>{rating.label}</p>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.1)', fontSize: '14px', fontWeight: 600 }}>
              <span style={{ fontWeight: 500, opacity: 0.75 }}>PM2.5</span>
              <span>{pm25} µg/m³</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.1)', fontSize: '14px', fontWeight: 600 }}>
              <span style={{ fontWeight: 500, opacity: 0.75 }}>PM10</span>
              <span>{pm10} µg/m³</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(0,0,0,0.1)', fontSize: '14px', fontWeight: 600 }}>
              <span style={{ fontWeight: 500, opacity: 0.75 }}>Ozone</span>
              <span>{ozone} ppb</span>
            </div>
          </div>
        </div>

        {/* 6-segment color band */}
        <div style={{ marginTop: 'auto' }}>
          <div style={{ display: 'flex', gap: '4px', position: 'relative' }}>
            <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#2fb457' }} />
            <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#f2c200' }} />
            <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#ff8a00' }} />
            <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#e5484d' }} />
            <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#8e4ec6' }} />
            <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#7e0023' }} />
            <span
              style={{
                position: 'absolute',
                left: `${Math.min(95, Math.max(5, (aqi / 300) * 100))}%`,
                top: '-5px',
                width: '4px',
                height: '18px',
                borderRadius: '2px',
                background: 'currentColor',
                boxShadow: '0 0 0 2px var(--ar, #d4f1ff)',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', opacity: 0.7, marginTop: '8px' }}>
            <span>0 Good</span>
            <span>50</span>
            <span>100</span>
            <span>150</span>
            <span>200</span>
            <span>300+ Hazardous</span>
          </div>
        </div>
      </section>
    )
  }

  // Medium (2x1) with 4 styles
  if (styleName === 'scale') {
    const pointerPercent = Math.min(95, Math.max(5, (aqi / 300) * 100))
    return (
      <section className="glance-air style-scale" data-size="m" data-style="scale">
        <p className="ga-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
          </svg>
          <span>Air quality</span>
        </p>
        <div style={{ position: 'absolute', left: '24px', top: '48px', display: 'flex', alignItems: 'baseline', gap: '14px' }}>
          <div className="n" style={{ fontSize: '72px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{aqi}</div>
          <p className="t" style={{ fontSize: '22px', fontWeight: 700, color: rating.color }}>{rating.label}</p>
        </div>
        <div style={{ position: 'absolute', left: '24px', right: '24px', bottom: '46px', display: 'flex', gap: '4px', position: 'relative' }}>
          <i style={{ flex: 1, height: '12px', borderRadius: '6px', background: '#2fb457' }} />
          <i style={{ flex: 1, height: '12px', borderRadius: '6px', background: '#f2c200' }} />
          <i style={{ flex: 1, height: '12px', borderRadius: '6px', background: '#ff8a00' }} />
          <i style={{ flex: 1, height: '12px', borderRadius: '6px', background: '#e5484d' }} />
          <i style={{ flex: 1, height: '12px', borderRadius: '6px', background: '#8e4ec6' }} />
          <i style={{ flex: 1, height: '12px', borderRadius: '6px', background: '#7e0023' }} />
          <div style={{ position: 'absolute', left: `${pointerPercent}%`, bottom: '-4px', width: '5px', height: '26px', borderRadius: '2.5px', background: '#1d1d1f', boxShadow: '0 0 0 2.5px #fff' }} />
        </div>
        <div style={{ position: 'absolute', left: '24px', right: '24px', bottom: '18px', display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#6e6e73' }}>
          <span>0</span>
          <span>50</span>
          <span>100</span>
          <span>150</span>
          <span>200</span>
          <span>300+</span>
        </div>
      </section>
    )
  }

  if (styleName === 'particles') {
    return (
      <section className="glance-air style-particles" data-size="m" data-style="particles">
        <svg width="100%" height="100%" viewBox="0 0 644 224" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          {[
            { cx: 451, cy: 175, r: 7, o: 0.4 }, { cx: 519, cy: 178, r: 5, o: 0.7 }, { cx: 363, cy: 179, r: 3, o: 0.6 },
            { cx: 462, cy: 165, r: 3, o: 0.4 }, { cx: 570, cy: 162, r: 7, o: 0.6 }, { cx: 407, cy: 157, r: 5, o: 0.3 },
            { cx: 362, cy: 64, r: 7, o: 0.3 }, { cx: 484, cy: 31, r: 4, o: 0.6 }, { cx: 528, cy: 133, r: 5, o: 0.7 },
            { cx: 348, cy: 58, r: 5, o: 0.4 }, { cx: 462, cy: 196, r: 5, o: 0.5 }, { cx: 545, cy: 153, r: 5, o: 0.7 },
            { cx: 448, cy: 110, r: 3, o: 0.5 }, { cx: 413, cy: 107, r: 7, o: 0.7 }, { cx: 506, cy: 41, r: 5, o: 0.4 },
            { cx: 390, cy: 35, r: 7, o: 0.7 }, { cx: 616, cy: 50, r: 7, o: 0.7 }, { cx: 553, cy: 90, r: 7, o: 0.5 },
          ].map((pt, idx) => (
            <circle key={idx} cx={pt.cx} cy={pt.cy} r={pt.r} fill="#64d2ff" fillOpacity={pt.o} />
          ))}
        </svg>
        <p className="ga-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
          </svg>
          <span>Air quality</span>
        </p>
        <div style={{ position: 'absolute', left: '24px', top: '44px' }}>
          <div className="n" style={{ fontSize: '84px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{aqi}</div>
          <p className="t" style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px', color: '#64d2ff' }}>
            {rating.label} · air is clean
          </p>
        </div>
        <div style={{ position: 'absolute', right: '24px', bottom: '20px', fontSize: '13px', fontWeight: 600, textAlign: 'right', opacity: 0.85 }}>
          PM2.5 {pm25} · PM10 {pm10}
        </div>
      </section>
    )
  }

  if (styleName === 'skyline') {
    return (
      <section className="glance-air style-skyline" data-size="m" data-style="skyline">
        <svg width="100%" height="100%" viewBox="0 0 644 224" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          <circle cx="400" cy="70" r="34" fill="#fff6d6" />
          <rect x="300" y="154" width="40" height="70" fill="#7fb1cf" />
          <rect x="344" y="124" width="30" height="100" fill="#7fb1cf" />
          <rect x="378" y="164" width="50" height="60" fill="#7fb1cf" />
          <rect x="432" y="104" width="36" height="120" fill="#7fb1cf" />
          <rect x="472" y="140" width="44" height="84" fill="#7fb1cf" />
          <rect x="520" y="114" width="30" height="110" fill="#7fb1cf" />
          <rect x="554" y="154" width="50" height="70" fill="#7fb1cf" />
          <rect x="608" y="128" width="40" height="96" fill="#7fb1cf" />
        </svg>
        <p className="ga-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
          </svg>
          <span>Air quality</span>
        </p>
        <div style={{ position: 'absolute', left: '24px', top: '44px' }}>
          <div className="n" style={{ fontSize: '84px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{aqi}</div>
          <p className="t" style={{ fontSize: '15px', fontWeight: 600, marginTop: '4px' }}>
            Clear skies · {rating.label}
          </p>
        </div>
      </section>
    )
  }

  // Default Medium (Gauge)
  return (
    <section className="glance-air" data-size="m" data-style="gauge">
      <p className="ga-label">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
        </svg>
        <span>Air quality</span>
      </p>
      <div style={{ display: 'flex', gap: '30px', marginTop: '10px' }}>
        <div style={{ textAlign: 'center', width: '180px' }}>
          <svg width="180" height="100" viewBox="0 0 200 110" role="img" aria-label={`Air quality index ${aqi}`}>
            <path d="M22.1 96.9A78 78 0 0 1 26.8 73.1" fill="none" stroke="#141414" strokeWidth="14" strokeLinecap="round" />
            <path d="M29.2 67.3A78 78 0 0 1 42.7 47.1" fill="none" stroke="#141414" strokeWidth="14" strokeLinecap="round" />
            <path d="M47.1 42.7A78 78 0 0 1 67.3 29.2" fill="none" stroke="#141414" strokeWidth="14" strokeLinecap="round" />
            <path d="M73.1 26.8A78 78 0 0 1 96.9 22.1" fill="none" stroke="rgba(20,20,20,0.2)" strokeWidth="14" strokeLinecap="round" />
            <path d="M103.1 22.1A78 78 0 0 1 126.9 26.8" fill="none" stroke="rgba(20,20,20,0.2)" strokeWidth="14" strokeLinecap="round" />
            <path d="M132.7 29.2A78 78 0 0 1 152.9 42.7" fill="none" stroke="rgba(20,20,20,0.2)" strokeWidth="14" strokeLinecap="round" />
            <path d="M157.3 47.1A78 78 0 0 1 170.8 67.3" fill="none" stroke="rgba(20,20,20,0.2)" strokeWidth="14" strokeLinecap="round" />
            <path d="M173.2 73.1A78 78 0 0 1 177.9 96.9" fill="none" stroke="rgba(20,20,20,0.2)" strokeWidth="14" strokeLinecap="round" />
          </svg>
          <div style={{ marginTop: '-54px' }}>
            <div className="n" style={{ fontSize: '44px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{aqi}</div>
            <p className="t" style={{ fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>{rating.label}</p>
          </div>
        </div>
        <div style={{ flex: 1, alignSelf: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(11,36,51,0.2)', fontSize: '14px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500 }}>PM2.5</span>
            <span>{pm25} µg/m³</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(11,36,51,0.2)', fontSize: '14px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500 }}>PM10</span>
            <span>{pm10} µg/m³</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid rgba(11,36,51,0.2)', fontSize: '14px', fontWeight: 600 }}>
            <span style={{ fontWeight: 500 }}>Ozone</span>
            <span>{ozone} ppb</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '4px', position: 'relative', marginTop: 'auto' }}>
        <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#2fb457' }} />
        <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#f2c200' }} />
        <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#ff8a00' }} />
        <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#e5484d' }} />
        <i style={{ flex: 1, height: '8px', borderRadius: '4px', background: '#8e4ec6' }} />
        <span
          style={{
            position: 'absolute',
            left: '11%',
            top: '-5px',
            width: '4px',
            height: '18px',
            borderRadius: '2px',
            background: 'var(--art, #0b2433)',
            boxShadow: '0 0 0 2px var(--ar, #d4f1ff)',
          }}
        />
      </div>
    </section>
  )
}
