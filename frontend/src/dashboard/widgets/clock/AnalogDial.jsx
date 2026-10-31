const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

export default function AnalogDial({ now, variant = 'roman', seconds = true }) {
  const hour = now.getHours() % 12
  const minute = now.getMinutes()
  const second = now.getSeconds()
  const major = variant === 'index' ? 12 : 0
  return <svg className={`clock-dial clock-dial--${variant}`} viewBox="0 0 200 200" role="presentation" aria-hidden="true" focusable="false">
    <circle className="clock-dial-face" cx="100" cy="100" r="98" />
    {variant !== 'split' && Array.from({ length: 60 }, (_, index) => {
      const tick = index % 5 === 0
      return <line key={index} className={tick ? 'clock-tick clock-tick-major' : 'clock-tick'} x1="100" y1={variant === 'index' ? 9 : 11} x2="100" y2={tick ? 19 : 15} transform={`rotate(${index * 6} 100 100)`} />
    })}
    {variant === 'index' && Array.from({ length: major }, (_, index) => {
      const angle = (index + 1) * Math.PI / 6
      return <circle key={index} className="clock-dial-dot" cx={100 + 75 * Math.sin(angle)} cy={100 - 75 * Math.cos(angle)} r={index % 3 === 0 ? 2.6 : 1.4} />
    })}
    {variant === 'roman' && ROMAN.map((numeral, index) => {
      const angle = (index + 1) * Math.PI / 6
      return <text key={numeral} className={index % 3 === 0 ? 'clock-numeral clock-numeral--major' : 'clock-numeral'} x={100 + 71 * Math.sin(angle)} y={100 - 71 * Math.cos(angle)}>{numeral}</text>
    })}
    {variant === 'split' && Array.from({ length: 12 }, (_, index) => {
      const angle = index * Math.PI / 6
      return <circle key={index} className="clock-dial-dot" cx={100 + 76 * Math.sin(angle)} cy={100 - 76 * Math.cos(angle)} r={index % 3 === 0 ? 2.4 : 1.2} />
    })}
    {variant === 'index' && <>
      <rect className="clock-date-window" x="73" y="119" width="54" height="24" rx="12" />
      <text className="clock-dial-date" x="100" y="135">{now.toLocaleDateString([], { weekday: 'short' }).toUpperCase()} {now.getDate()}</text>
    </>}
    <line className="clock-hand clock-hour-hand" x1="100" y1="106" x2="100" y2="58" transform={`rotate(${hour * 30 + minute / 2} 100 100)`} />
    <line className="clock-hand clock-minute-hand" x1="100" y1="108" x2="100" y2="34" transform={`rotate(${minute * 6} 100 100)`} />
    {seconds && <line className="clock-second-hand" x1="100" y1="114" x2="100" y2="27" transform={`rotate(${second * 6} 100 100)`} />}
    <circle className="clock-pin" cx="100" cy="100" r="4.5" />
    <circle className="clock-pin-dot" cx="100" cy="100" r="1.5" />
  </svg>
}
