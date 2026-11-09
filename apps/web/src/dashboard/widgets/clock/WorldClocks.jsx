import Button from '../../../components/ui/AppButton.jsx'
import { canonicalZone, cityName, dayRelation, formatTime, offsetLabel, relativeOffset } from './helpers.js'

export default function WorldClocks({ now, zones, variant = 'medium', remove, busy }) {
  if (!zones.length) return null
  return <ul className={`clock-worlds clock-worlds--${variant}`} aria-label="World clocks">
    {zones.map((value, index) => {
      const zone = canonicalZone(value)
      const time = zone ? formatTime(now, zone) : null
      return <li className="clock-world" key={`${value}-${index}`}>
        <span className="clock-world-place">
          <strong title={zone || String(value)}>{cityName(zone || value)}</strong>
          {zone ? <small>{dayRelation(now, zone)}, {offsetLabel(relativeOffset(now, zone))}</small> : <small>Timezone unavailable</small>}
        </span>
        {time && <span className="clock-world-reading">
          <time dateTime={now.toISOString()}>{time.text}</time>
          {time.period && <small className="clock-world-period">{time.period}</small>}
        </span>}
        {remove && <Button size="small" variant="ghost" className="clock-world-remove" disabled={busy} aria-label={`Remove ${value}`} onClick={() => remove(index)}>Remove</Button>}
      </li>
    })}
  </ul>
}
