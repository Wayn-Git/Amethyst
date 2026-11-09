import { useMemo } from 'react'

/**
 * MistyForestBackdrop
 * Recreates the grayscale misty pine tree and mountain landscape background
 * from the second screenshot (media_1792927838915.jpg).
 */
export default function MistyForestBackdrop() {
  // Pre-generate deterministic tree silhouettes for foreground ridges
  const trees = useMemo(() => {
    const list = []
    // Left cluster
    for (let i = 0; i < 28; i++) {
      const x = i * 16 + (i % 3) * 6
      const h = 70 + ((i * 37) % 65)
      const y = 800 - h
      list.push({ x, y, h, w: 22 + (i % 4) * 4, opacity: 0.85 + (i % 3) * 0.05 })
    }
    // Right cluster
    for (let i = 0; i < 24; i++) {
      const x = 1440 - (i * 18 + (i % 3) * 8)
      const h = 60 + ((i * 43) % 70)
      const y = 800 - h
      list.push({ x, y, h, w: 24 + (i % 3) * 5, opacity: 0.82 + (i % 3) * 0.06 })
    }
    return list
  }, [])

  return (
    <div
      className="misty-forest-backdrop"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
        background: 'linear-gradient(180deg, #b8bcc4 0%, #cbd1dc 35%, #9fa5b0 75%, #595f6c 100%)',
        filter: 'grayscale(100%) contrast(108%)',
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 1440 800"
        preserveAspectRatio="xMidYMid slice"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      >
        <defs>
          <linearGradient id="mistGradTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#dbe0ea" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#9ba1ae" stopOpacity="0.1" />
          </linearGradient>

          <linearGradient id="mountainFar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4d8e0" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#a6acb8" stopOpacity="0.9" />
          </linearGradient>

          <linearGradient id="mountainMid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#878d99" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#4c515c" stopOpacity="0.95" />
          </linearGradient>

          <linearGradient id="mountainNear" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3d424c" />
            <stop offset="100%" stopColor="#1a1c22" />
          </linearGradient>

          <filter id="mistBlur">
            <feGaussianBlur stdDeviation="35" />
          </filter>
        </defs>

        {/* Distant Cloudy Sky with Soft Rolling Mist */}
        <rect width="1440" height="800" fill="url(#mistGradTop)" />
        <ellipse cx="600" cy="220" rx="600" ry="180" fill="#ffffff" opacity="0.65" filter="url(#mistBlur)" />
        <ellipse cx="1100" cy="180" rx="450" ry="160" fill="#ffffff" opacity="0.55" filter="url(#mistBlur)" />
        <ellipse cx="200" cy="300" rx="500" ry="200" fill="#e8ebf0" opacity="0.5" filter="url(#mistBlur)" />

        {/* Far Mountain Ridge */}
        <path
          d="M0 460 Q 280 320, 620 410 T 1180 350 Q 1320 380, 1440 430 L 1440 800 L 0 800 Z"
          fill="url(#mountainFar)"
        />

        {/* Middle Mountain Ridge with Rolling Fog */}
        <path
          d="M0 540 Q 320 450, 710 520 T 1250 470 Q 1380 490, 1440 550 L 1440 800 L 0 800 Z"
          fill="url(#mountainMid)"
        />

        {/* Middle Cloud Layer drifting across mountains */}
        <ellipse cx="720" cy="510" rx="680" ry="85" fill="#ffffff" opacity="0.45" filter="url(#mistBlur)" />
        <ellipse cx="280" cy="580" rx="420" ry="70" fill="#f0f3f8" opacity="0.55" filter="url(#mistBlur)" />

        {/* Near Dark Mountain Ridge & Pine slopes */}
        <path
          d="M0 640 Q 240 580, 520 630 T 1100 600 Q 1320 620, 1440 670 L 1440 800 L 0 800 Z"
          fill="url(#mountainNear)"
        />

        {/* Detailed Pine Tree Silhouettes in foreground / slopes */}
        {trees.map((t, idx) => (
          <g key={idx} opacity={t.opacity}>
            {/* Trunk */}
            <rect x={t.x + t.w * 0.45} y={t.y + t.h * 0.6} width={t.w * 0.1} height={t.h * 0.4} fill="#0d0e12" />
            {/* Pine needles tiered polygons */}
            <polygon
              points={`${t.x + t.w * 0.5},${t.y} ${t.x},${t.y + t.h * 0.38} ${t.x + t.w * 0.35},${t.y + t.h * 0.35} ${t.x + t.w * 0.5},${t.y} ${t.x + t.w * 0.65},${t.y + t.h * 0.35} ${t.x + t.w},${t.y + t.h * 0.38}`}
              fill="#181a20"
            />
            <polygon
              points={`${t.x + t.w * 0.5},${t.y + t.h * 0.25} ${t.x - 2},${t.y + t.h * 0.55} ${t.x + t.w * 0.3},${t.y + t.h * 0.5} ${t.x + t.w * 0.7},${t.y + t.h * 0.5} ${t.x + t.w + 2},${t.y + t.h * 0.55}`}
              fill="#14161b"
            />
            <polygon
              points={`${t.x + t.w * 0.5},${t.y + t.h * 0.42} ${t.x - 4},${t.y + t.h * 0.78} ${t.x + t.w + 4},${t.y + t.h * 0.78}`}
              fill="#0e1014"
            />
          </g>
        ))}

        {/* Low mist over the base of the trees */}
        <ellipse cx="720" cy="740" rx="800" ry="90" fill="#ffffff" opacity="0.3" filter="url(#mistBlur)" />
      </svg>
    </div>
  )
}
