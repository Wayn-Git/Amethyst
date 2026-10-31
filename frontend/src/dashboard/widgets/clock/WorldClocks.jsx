import Button from '../../../components/ui/AppButton.jsx'
import { canonicalZone, cityName, timeParts, timeText, zoneDate, zoneLabel, zoneOffset } from './helpers.js'

export default function WorldClocks({ now, zones, variant = 'rows', limit, remove, busy }) {
  const shown = typeof limit === 'number' ? zones.slice(0, limit) : zones
  if (!shown.length) return null
  return <ul className={`clock-worlds clock-worlds--${variant}`} aria-label="World clocks">
    {shown.map((value, index) => {
      const zone = canonicalZone(value)
      return <li className="clock-world" key={`${value}-${index}`}>
        <span className="clock-world-place">
          <strong title={zoneLabel(value)}>{cityName(value)}</strong>
          <small title={zoneLabel(value)}>{zoneLabel(value)}</small>
        </span>
        {zone ? <span className="clock-world-reading">
          <time dateTime={now.toISOString()}>{timeText(timeParts(now, zone))}</time>
          <small className="clock-world-date">{zoneDate(now, zone)}</small>
          <small className="clock-world-offset">{zoneOffset(now, zone)}</small>
        </span> : <span className="clock-world-invalid">Timezone unavailable</span>}
        {remove && <Button size="small" variant="ghost" className="clock-world-remove" disabled={busy} aria-label={`Remove ${value}`} onClick={() => remove(index)}>Remove</Button>}
      </li>
    })}
  </ul>
}
