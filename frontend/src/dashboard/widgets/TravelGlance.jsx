import { useMemo } from 'react'
import { variationNumber } from '../widgetVariations.js'
import './travel/travel.css'

export default function TravelGlance({ data, size = 'm', design = 'travel-sm-01' }) {
  const variation = variationNumber(design)

  const items = Array.isArray(data?.items) ? data.items : []
  const firstItem = items[0]
  const destination = firstItem?.title || 'Design review'
  const durationMinutes = Number.isFinite(data?.duration_minutes) ? data.duration_minutes : 24
  const leaveInMinutes = Number.isFinite(data?.leave_in_minutes) ? data.leave_in_minutes : 25

  const styleName = variation === 2 ? 'darkmap' : variation === 3 ? 'transit' : variation === 4 ? 'ticket' : 'lightmap'

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="glance-travel" data-size="s">
        <p className="gtr-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 16l1.5-6h11L19 16M3 16h18v3H3zM7 19v2M17 19v2" />
          </svg>
          <span>Travel</span>
        </p>
        <div style={{ marginTop: 'auto' }}>
          <div className="n" style={{ fontSize: '52px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>
            {durationMinutes}<span style={{ fontSize: '18px', letterSpacing: 0, marginLeft: '4px' }}>min</span>
          </div>
          <p className="t" style={{ fontSize: '14px', fontWeight: 600, marginTop: '6px' }}>
            Leave in {leaveInMinutes} min
          </p>
          <p className="t" style={{ fontSize: '12px', opacity: 0.8, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            To {destination}
          </p>
        </div>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="glance-travel" data-size="l">
        <p className="gtr-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 16l1.5-6h11L19 16M3 16h18v3H3zM7 19v2M17 19v2" />
          </svg>
          <span>Travel time</span>
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '12px' }}>
          <div>
            <div className="n" style={{ fontSize: '72px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>
              {durationMinutes}<span style={{ fontSize: '22px', letterSpacing: 0, marginLeft: '6px' }}>min</span>
            </div>
            <p className="t" style={{ fontSize: '15px', fontWeight: 600, marginTop: '8px' }}>
              Leave in {leaveInMinutes} min
            </p>
            <p className="t" style={{ fontSize: '13px', opacity: 0.8, marginTop: '2px' }}>
              By car · arrive at {destination} by 10:30 AM
            </p>
          </div>
          <svg width="120" height="110" viewBox="0 0 190 170" role="img" aria-label="Route curve">
            <path d="M24 150C24 90 110 110 110 70S150 30 166 24" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray="1 12" />
            <circle cx="24" cy="150" r="10" fill="currentColor" />
            <circle cx="166" cy="24" r="14" fill="currentColor" />
            <circle cx="166" cy="24" r="5" fill="var(--tr, #30d158)" />
          </svg>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
          <div style={{ flex: 1, borderRadius: '16px', padding: '12px', background: 'rgba(0,0,0,0.06)' }}>
            <p className="t" style={{ fontSize: '12px', opacity: 0.75 }}>Fastest route</p>
            <p className="t" style={{ fontSize: '16px', fontWeight: 600, marginTop: '2px' }}>Via Ring Road</p>
          </div>
          <div style={{ flex: 1, borderRadius: '16px', padding: '12px', background: 'rgba(0,0,0,0.06)' }}>
            <p className="t" style={{ fontSize: '12px', opacity: 0.75 }}>Traffic</p>
            <p className="t" style={{ fontSize: '16px', fontWeight: 600, marginTop: '2px', color: '#1f9d55' }}>Light</p>
          </div>
        </div>
      </section>
    )
  }

  // Medium (2x1) with 4 styles
  if (styleName === 'darkmap') {
    return (
      <section className="glance-travel style-darkmap" data-size="m" data-style="darkmap">
        <svg width="100%" height="100%" viewBox="0 0 644 224" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
          <rect width="644" height="224" fill="#1f2321" />
          <path d="M470 224C500 192 560 200 600 178S644 172 644 170V224Z" fill="#1c2b38" />
          <rect x="292" y="14" width="96" height="64" rx="10" fill="#243026" />
          <rect x="540" y="96" width="76" height="52" rx="10" fill="#243026" />
          <path d="M-10 60L660 30" fill="none" stroke="#3a3f3c" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M-10 200L300 190L660 170" fill="none" stroke="#3a3f3c" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M110 -10L90 240" fill="none" stroke="#3a3f3c" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M330 -10L350 240" fill="none" stroke="#3a3f3c" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M560 -10L590 240" fill="none" stroke="#3a3f3c" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M258 160C300 152 336 150 400 128S520 92 562 60" fill="none" stroke="#171a18" strokeWidth="11" strokeLinecap="round" />
          <path d="M258 160C300 152 336 150 400 128S520 92 562 60" fill="none" stroke="#d4f53c" strokeWidth="6" strokeLinecap="round" />
          <circle cx="258" cy="160" r="11" fill="#171a18" />
          <circle cx="258" cy="160" r="6" fill="#d4f53c" />
          <circle cx="562" cy="60" r="16" fill="#ff6a2b" />
          <circle cx="562" cy="60" r="6" fill="#fff" />
        </svg>
        <div style={{ position: 'absolute', left: '14px', top: '14px', bottom: '14px', width: '190px', background: '#1d1d1f', color: '#fff', borderRadius: '22px', padding: '16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', boxShadow: '0 2px 14px rgba(0,0,0,0.35)' }}>
          <p className="gtr-label">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 16l1.5-6h11L19 16M3 16h18v3H3zM7 19v2M17 19v2" />
            </svg>
            <span>Travel time</span>
          </p>
          <div className="n" style={{ fontSize: '42px', letterSpacing: '-0.06em', lineHeight: 0.95, marginTop: '8px' }}>{durationMinutes} min</div>
          <span style={{ display: 'inline-block', background: '#d4f53c', color: '#141414', borderRadius: '99px', padding: '3px 8px', fontSize: '11px', fontWeight: 700, alignSelf: 'flex-start', marginTop: '6px' }}>
            Leave in {leaveInMinutes} min
          </span>
          <p className="t" style={{ marginTop: 'auto', fontSize: '11px', opacity: 0.8 }}>3:06 → 3:30 PM</p>
        </div>
      </section>
    )
  }

  if (styleName === 'transit') {
    return (
      <section className="glance-travel style-transit" data-size="m" data-style="transit">
        <p className="gtr-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 16l1.5-6h11L19 16M3 16h18v3H3zM7 19v2M17 19v2" />
          </svg>
          <span>Travel time</span>
        </p>
        <div style={{ position: 'absolute', right: '24px', top: '18px', textAlign: 'right' }}>
          <div className="n" style={{ fontSize: '30px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{durationMinutes} min</div>
          <p className="t" style={{ fontSize: '12px', fontWeight: 600, color: '#1f9d55', marginTop: '2px' }}>Leave in {leaveInMinutes} min</p>
        </div>
        <svg width="100%" height="110" viewBox="0 0 644 140" style={{ position: 'absolute', left: 0, bottom: '12px' }} aria-hidden="true">
          <line x1="60" y1="50" x2="584" y2="50" stroke="#e6e6ea" strokeWidth="8" strokeLinecap="round" />
          <line x1="60" y1="50" x2="190" y2="50" stroke="#1f9d55" strokeWidth="8" strokeLinecap="round" />
          <circle cx="60" cy="50" r="11" fill="#fff" stroke="#1f9d55" strokeWidth="4" />
          <text x="60" y="85" textAnchor="middle" fontSize="12" fontWeight="600" fontFamily="Inter" fill="#1d1d1f">You</text>
          <text x="60" y="102" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">3:06</text>
          <circle cx="235" cy="50" r="7" fill="#fff" stroke="#1d1d1f" strokeWidth="4" />
          <text x="235" y="85" textAnchor="middle" fontSize="12" fontWeight="600" fontFamily="Inter" fill="#1d1d1f">Ring Road</text>
          <text x="235" y="102" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">3:14</text>
          <circle cx="409" cy="50" r="7" fill="#fff" stroke="#1d1d1f" strokeWidth="4" />
          <text x="409" y="85" textAnchor="middle" fontSize="12" fontWeight="600" fontFamily="Inter" fill="#1d1d1f">Station Rd</text>
          <text x="409" y="102" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">3:22</text>
          <circle cx="584" cy="50" r="11" fill="#fff" stroke="#1d1d1f" strokeWidth="4" />
          <text x="584" y="85" textAnchor="middle" fontSize="12" fontWeight="600" fontFamily="Inter" fill="#1d1d1f">{destination}</text>
          <text x="584" y="102" textAnchor="middle" fontSize="11" fill="#6e6e73" fontFamily="Inter">3:30</text>
        </svg>
      </section>
    )
  }

  if (styleName === 'ticket') {
    return (
      <section className="glance-travel style-ticket" data-size="m" data-style="ticket">
        <div style={{ position: 'absolute', left: '18px', right: '18px', top: '16px', bottom: '16px', background: '#fff', borderRadius: '20px' }} />
        <div style={{ position: 'absolute', left: '38px', top: '28px', right: '190px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <p className="t" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.55 }}>FROM</p>
              <div className="n" style={{ fontSize: '44px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>3:06</div>
              <p className="t" style={{ fontSize: '12px', fontWeight: 600, opacity: 0.7, marginTop: '2px' }}>You · PM</p>
            </div>
            <div style={{ flex: 1, margin: '0 12px 24px', borderTop: '2px dashed rgba(29, 29, 31, 0.25)', position: 'relative', textAlign: 'center' }}>
              <span style={{ position: 'absolute', left: '50%', top: '-12px', transform: 'translateX(-50%)', background: '#fff', padding: '0 6px', color: '#1f9d55', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700 }}>
                {durationMinutes} min
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p className="t" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.55 }}>TO</p>
              <div className="n" style={{ fontSize: '44px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>3:30</div>
              <p className="t" style={{ fontSize: '12px', fontWeight: 600, opacity: 0.7, marginTop: '2px' }}>{destination} · PM</p>
            </div>
          </div>
        </div>
        <div style={{ position: 'absolute', right: '38px', top: '28px', bottom: '28px', width: '110px', borderLeft: '2px dashed rgba(29, 29, 31, 0.2)', paddingLeft: '18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <p className="t" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', opacity: 0.55 }}>LEAVE IN</p>
          <div className="n" style={{ fontSize: '32px', letterSpacing: '-0.06em', lineHeight: 0.95 }}>{leaveInMinutes}m</div>
          <div style={{ lineHeight: 0, overflow: 'hidden', height: '40px' }}>
            {[2, 5, 2, 3, 6, 2, 4, 2, 5, 3, 2, 6, 3].map((w, idx) => (
              <i key={idx} style={{ display: 'inline-block', width: `${w}px`, height: '40px', background: '#1d1d1f', marginRight: '2.5px' }} />
            ))}
          </div>
        </div>
      </section>
    )
  }

  // Default Medium (Light Map)
  return (
    <section className="glance-travel style-lightmap" data-size="m" data-style="lightmap">
      <svg width="100%" height="100%" viewBox="0 0 644 224" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }} aria-hidden="true">
        <rect width="644" height="224" fill="#f1eee7" />
        <path d="M470 224C500 192 560 200 600 178S644 172 644 170V224Z" fill="#cfe1f0" />
        <rect x="292" y="14" width="96" height="64" rx="10" fill="#dbe8cf" />
        <rect x="540" y="96" width="76" height="52" rx="10" fill="#dbe8cf" />
        <path d="M-10 60L660 30" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M-10 200L300 190L660 170" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M110 -10L90 240" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M330 -10L350 240" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M560 -10L590 240" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M-10 150C150 130 300 168 460 124S600 72 660 62" fill="none" stroke="#ddd7c8" strokeWidth="10" strokeLinecap="round" />
        <path d="M-10 150C150 130 300 168 460 124S600 72 660 62" fill="none" stroke="#fff" strokeWidth="7.5" strokeLinecap="round" />
        <path d="M258 160C300 152 336 150 400 128S520 92 562 60" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" />
        <path d="M258 160C300 152 336 150 400 128S520 92 562 60" fill="none" stroke="#1d1d1f" strokeWidth="6" strokeLinecap="round" />
        <path d="M400 128S440 112 470 104" fill="none" stroke="#ff9a3d" strokeWidth="6" strokeLinecap="round" />
        <circle cx="258" cy="160" r="11" fill="#fff" />
        <circle cx="258" cy="160" r="6" fill="#1d1d1f" />
        <circle cx="562" cy="60" r="16" fill="#ff6a2b" />
        <circle cx="562" cy="60" r="6" fill="#fff" />
      </svg>
      <div style={{ position: 'absolute', left: '14px', top: '14px', bottom: '14px', width: '190px', background: '#fff', color: '#1d1d1f', borderRadius: '22px', padding: '16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', boxShadow: '0 2px 14px rgba(0,0,0,0.18)' }}>
        <p className="gtr-label">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 16l1.5-6h11L19 16M3 16h18v3H3zM7 19v2M17 19v2" />
          </svg>
          <span>Travel time</span>
        </p>
        <div className="n" style={{ fontSize: '44px', letterSpacing: '-0.06em', lineHeight: 0.95, marginTop: '8px' }}>{durationMinutes} min</div>
        <span style={{ display: 'inline-block', background: '#d4f53c', color: '#141414', borderRadius: '99px', padding: '3px 8px', fontSize: '11px', fontWeight: 700, alignSelf: 'flex-start', marginTop: '6px' }}>
          Leave in {leaveInMinutes} min
        </span>
        <p className="t" style={{ marginTop: 'auto', fontSize: '11px', opacity: 0.8 }}>3:06 → 3:30 PM</p>
      </div>
    </section>
  )
}
