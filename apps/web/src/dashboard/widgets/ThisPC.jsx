import { memo, useMemo } from 'react'
import { variationNumber } from '../widgetVariations.js'
import './pc/pc.css'

function RingDial({ percent, label, sub, color = '#7c6cf0', track = 'rgba(255,255,255,0.15)', size = 96 }) {
  const radius = 38
  const stroke = 9
  const circumference = 2 * Math.PI * radius
  const filled = (percent / 100) * circumference

  return (
    <div className="pc-metric-col">
      <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
        <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`${label} ${percent}%`}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke={track} strokeWidth={stroke} />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            transform="rotate(-90 50 50)"
          />
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size > 80 ? '22px' : '18px',
            fontWeight: 600,
            letterSpacing: '-0.03em',
          }}
        >
          {percent}%
        </div>
      </div>
      <p className="pc-metric-label">{label}</p>
      {sub && <p className="pc-metric-sub">{sub}</p>}
    </div>
  )
}

function ConcentricRings({ cpu, mem, disk, size = 160 }) {
  const stroke = 12
  const center = size / 2

  const r1 = center - stroke
  const c1 = 2 * Math.PI * r1
  const f1 = (cpu / 100) * c1

  const r2 = r1 - stroke - 4
  const c2 = 2 * Math.PI * r2
  const f2 = (mem / 100) * c2

  const r3 = r2 - stroke - 4
  const c3 = 2 * Math.PI * r3
  const f3 = (disk / 100) * c3

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {/* Background tracks */}
      <circle cx={center} cy={center} r={r1} fill="none" stroke="#ff375f" strokeOpacity="0.25" strokeWidth={stroke} />
      <circle cx={center} cy={center} r={r2} fill="none" stroke="#a4f547" strokeOpacity="0.25" strokeWidth={stroke} />
      <circle cx={center} cy={center} r={r3} fill="none" stroke="#5ac8fa" strokeOpacity="0.25" strokeWidth={stroke} />

      {/* Progress arcs */}
      <circle
        cx={center}
        cy={center}
        r={r1}
        fill="none"
        stroke="#ff375f"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${f1} ${c1}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <circle
        cx={center}
        cy={center}
        r={r2}
        fill="none"
        stroke="#a4f547"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${f2} ${c2}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
      <circle
        cx={center}
        cy={center}
        r={r3}
        fill="none"
        stroke="#5ac8fa"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${f3} ${c3}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  )
}

function MeterColumn({ percent, label, sub, color = '#ff6a2b' }) {
  const totalPips = 14
  const activePips = Math.round((percent / 100) * totalPips)

  return (
    <div className="pc-metric-col">
      <div className="pc-meter-bar-track">
        {Array.from({ length: totalPips }).map((_, i) => (
          <i
            key={i}
            className="pc-meter-pip"
            style={{
              background: i < activePips ? color : 'rgba(255,255,255,0.15)',
            }}
          />
        ))}
      </div>
      <p className="pc-metric-label">{label}</p>
      <p className="pc-metric-sub">{percent}%</p>
    </div>
  )
}

export default memo(function ThisPC({ data, size = 'm', design }) {
  const variation = variationNumber(design)

  // Real data with fallback
  const cpuPercent = Number.isFinite(data?.cpu?.percent) ? Math.round(data.cpu.percent) : 34
  const cpuCores = data?.cpu?.cores ? `${data.cpu.cores} cores` : '8 cores'

  const memPercent = Number.isFinite(data?.memory?.percent) ? Math.round(data.memory.percent) : 39
  const memSub = data?.memory?.used_gb && data?.memory?.total_gb
    ? `${data.memory.used_gb} of ${data.memory.total_gb} GB`
    : '12.4 of 32 GB'

  const diskPercent = Number.isFinite(data?.disk?.percent) ? Math.round(data.disk.percent) : 61
  const diskSub = data?.disk?.name || 'Main drive'

  const apps = useMemo(() => {
    if (Array.isArray(data?.apps) && data.apps.length > 0) return data.apps
    return [
      { name: 'Browser', percent: 12 },
      { name: 'Code editor', percent: 9 },
      { name: 'Amethyst', percent: 6 },
    ]
  }, [data?.apps])

  // Small size (1x1)
  if (size === 's') {
    return (
      <section className="pc-widget pc-widget--colorful">
        <p className="pc-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          </svg>
          This PC
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
          <RingDial percent={cpuPercent} label="CPU" sub={cpuCores} color="#d4f53c" size={90} />
        </div>
      </section>
    )
  }

  // Large size (2x2)
  if (size === 'l') {
    return (
      <section className="pc-widget pc-widget--colorful">
        <p className="pc-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          </svg>
          This PC
        </p>
        <div className="pc-metrics-row" style={{ margin: '14px 0' }}>
          <RingDial percent={cpuPercent} label="CPU" sub={cpuCores} color="#d4f53c" size={88} />
          <RingDial percent={memPercent} label="Memory" sub={memSub} color="#d4f53c" size={88} />
          <RingDial percent={diskPercent} label="Disk" sub={diskSub} color="#d4f53c" size={88} />
        </div>

        {/* Timeline SVG Sparkline */}
        <div style={{ marginTop: 'auto', marginBottom: '8px' }}>
          <svg width="100%" height="60" viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
            <path
              d="M0 100 L46 80 L92 90 L138 50 L184 70 L230 40 L276 56 L323 30 L369 70 L415 50 L461 80 L507 60 L553 90 L600 70 L600 120 L0 120 Z"
              fill="rgba(255,255,255,0.12)"
            />
            <path
              d="M0 100 L46 80 L92 90 L138 50 L184 70 L230 40 L276 56 L323 30 L369 70 L415 50 L461 80 L507 60 L553 90 L600 70"
              fill="none"
              stroke="#d4f53c"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="pc-apps-list">
          <p style={{ margin: '0 0 4px', fontSize: '12px', opacity: 0.8, fontWeight: 600 }}>Top apps by CPU</p>
          {apps.map((app) => (
            <div key={app.name} className="pc-app-row">
              <span>{app.name}</span>
              <b>{app.percent}%</b>
            </div>
          ))}
        </div>
      </section>
    )
  }

  // Medium size (2x1) - 4 Distinct Style Concepts
  // Style 4: Terminal ($ stats)
  if (variation === 4) {
    const bar = (pct) => {
      const len = 20
      const filled = Math.round((pct / 100) * len)
      return '█'.repeat(filled) + '░'.repeat(len - filled)
    }

    return (
      <section className="pc-widget pc-terminal">
        <div className="pc-terminal-prompt">amethyst@pc ~ $ stats</div>
        <pre className="pc-terminal-pre">
          {`cpu    ${bar(cpuPercent)}  ${cpuPercent}%\nmem    ${bar(memPercent)}  ${memPercent}%\ndisk   ${bar(diskPercent)}  ${diskPercent}%`}
        </pre>
      </section>
    )
  }

  // Style 3: Level meters
  if (variation === 3) {
    return (
      <section className="pc-widget">
        <p className="pc-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          </svg>
          This PC
        </p>
        <div className="pc-meters-row">
          <MeterColumn percent={cpuPercent} label="CPU" color="#ff375f" />
          <MeterColumn percent={memPercent} label="Memory" color="#a4f547" />
          <MeterColumn percent={diskPercent} label="Disk" color="#5ac8fa" />
        </div>
      </section>
    )
  }

  // Style 2: Dot dials / Circular Dials
  if (variation === 2) {
    return (
      <section className="pc-widget pc-widget--colorful">
        <p className="pc-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
          </svg>
          This PC
        </p>
        <div className="pc-metrics-row">
          <RingDial percent={cpuPercent} label="CPU" sub={cpuCores} color="#d4f53c" size={88} />
          <RingDial percent={memPercent} label="Memory" sub={memSub} color="#d4f53c" size={88} />
          <RingDial percent={diskPercent} label="Disk" sub={diskSub} color="#d4f53c" size={88} />
        </div>
      </section>
    )
  }

  // Style 1 (Default): Apple-style Activity Rings
  return (
    <section className="pc-widget">
      <p className="pc-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
        </svg>
        This PC
      </p>
      <div className="pc-rings-wrapper">
        <ConcentricRings cpu={cpuPercent} mem={memPercent} disk={diskPercent} size={130} />
        <div className="pc-rings-legend">
          <div className="pc-legend-item">
            <i className="pc-legend-dot" style={{ background: '#ff375f' }} />
            <span>CPU</span>
            <span className="pc-legend-val">{cpuPercent}%</span>
          </div>
          <div className="pc-legend-item">
            <i className="pc-legend-dot" style={{ background: '#a4f547' }} />
            <span>Memory</span>
            <span className="pc-legend-val">{memPercent}%</span>
          </div>
          <div className="pc-legend-item">
            <i className="pc-legend-dot" style={{ background: '#5ac8fa' }} />
            <span>Disk</span>
            <span className="pc-legend-val">{diskPercent}%</span>
          </div>
        </div>
      </div>
    </section>
  )
})

