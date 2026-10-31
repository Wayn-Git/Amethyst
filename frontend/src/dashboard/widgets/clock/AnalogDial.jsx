const TICKS = Array.from({ length: 12 }, (_, index) => index)
const ROMAN = { 3: 'III', 6: 'VI', 9: 'IX', 12: 'XII' }

export default function AnalogDial({ now, label, variant = 'index', seconds = true, reducedMotion = false }) {
  const s = now.getSeconds()
  const minutes = now.getMinutes() + s / 60
  const hours = (now.getHours() % 12) + minutes / 60
  const secondAngle = (now.getMinutes() * 60 + s) * 6
  return <svg className={`clock-dial clock-dial--${variant}`} viewBox="0 0 100 100" role="img" aria-label={label}>
    <circle cx="50" cy="50" r="48" fill="#111113" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
    <g aria-hidden="true">
      {variant !== 'roman' && TICKS.map(index => {
        const major = index % 3 === 0
        return <line
          key={index}
          x1="50" y1={major ? 5 : 6.5}
          x2="50" y2={major ? 11 : 10.5}
          stroke="#8e8e93"
          strokeWidth={major ? 1.6 : 1}
          strokeLinecap="round"
          transform={`rotate(${index * 30} 50 50)`}
        />
      })}
      {variant === 'roman' && [3, 6, 9, 12].map(num => {
        const rad = (num * 30) * Math.PI / 180
        return <text
          key={num}
          x={50 + 35 * Math.sin(rad)}
          y={50 - 35 * Math.cos(rad) + 3}
          fill="#8e8e93"
          fontSize="7"
          fontWeight="600"
          fontFamily="Inter, sans-serif"
          textAnchor="middle"
        >{ROMAN[num]}</text>
      })}
      {variant === 'index' && <g>
        <rect x="39" y="60" width="22" height="12" rx="4" fill="rgba(255,255,255,0.06)" />
        <text x="50" y="68.5" fill="#8e8e93" fontSize="6.5" fontWeight="600" fontFamily="Inter, sans-serif" textAnchor="middle">{now.getDate()}</text>
      </g>}
      <line className="clock-hour-hand" x1="50" y1="54" x2="50" y2="26" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" transform={`rotate(${hours * 30} 50 50)`} />
      <line className="clock-minute-hand" x1="50" y1="54" x2="50" y2="14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" transform={`rotate(${minutes * 6} 50 50)`} />
      {seconds && <line
        className={`clock-second-hand${reducedMotion ? ' is-stepped' : ''}`}
        x1="50" y1="56" x2="50" y2="9"
        stroke="#ff9f0a" strokeWidth="1" strokeLinecap="round"
        style={{ transform: `rotate(${secondAngle}deg)`, transformOrigin: '50px 50px', transformBox: 'view-box' }}
      />}
      <circle cx="50" cy="50" r="2.2" fill="#ff9f0a" />
    </g>
  </svg>
}
