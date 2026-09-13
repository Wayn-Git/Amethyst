import { useEffect, useRef, useState } from 'react'

/* Day tabs, stop cards, and a map when there is something to put on one.
 *
 * The map is the optional half, deliberately. `latitude` and `longitude` are
 * nullable in the schema because a model asked for "three days in Kyoto" knows
 * the stops long before it knows their coordinates, and inventing them would be
 * the one kind of error a map makes convincing. So the stop list is the widget
 * and the map is an addition to it: no coordinates, no map, and the cards are
 * unchanged. */

/* Leaflet is loaded only when a day actually has coordinates to show. A chunk
   this size should not be in the bundle for the eleven other widget types, and
   `import()` is what keeps it out. */
let leafletPromise = null
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = Promise.all([
      import('leaflet'),
      import('leaflet/dist/leaflet.css'),
    ]).then(([mod]) => mod.default ?? mod)
  }
  return leafletPromise
}

function Map({ stops }) {
  const host = useRef(null)
  const map = useRef(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let dead = false

    loadLeaflet().then((L) => {
      if (dead || !host.current) return
      map.current = L.map(host.current, { scrollWheelZoom: false, attributionControl: true })
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map.current)

      const points = stops.map((s) => [s.latitude, s.longitude])
      points.forEach(([lat, lon], i) => {
        L.marker([lat, lon])
          .addTo(map.current)
          .bindPopup(`${i + 1}. ${stops[i].name}`)
      })
      // `fitBounds` on a single point zooms to the maximum; `setView` is what
      // that case actually wants.
      if (points.length === 1) map.current.setView(points[0], 13)
      else map.current.fitBounds(points, { padding: [24, 24] })
    }).catch(() => {
      // Offline, or the chunk would not load. The stop list above still says
      // everything the map was going to.
      if (!dead) setFailed(true)
    })

    return () => {
      dead = true
      map.current?.remove()
      map.current = null
    }
  }, [stops])

  if (failed) return null
  return <div className="widget-map" ref={host} />
}

export default function Itinerary({ data }) {
  const days = data.days ?? []
  const [at, setAt] = useState(0)
  if (!days.length) return null

  const day = days[Math.min(at, days.length - 1)]
  const stops = day.stops ?? []
  const located = stops.filter(
    (s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude),
  )

  return (
    <div className="widget widget-itinerary">

      <div className="widget-tabs" role="tablist">
        {days.map((d, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === at}
            className={`widget-tab${i === at ? ' is-on' : ''}`}
            onClick={() => setAt(i)}
          >
            Day {d.day ?? i + 1}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        <ol className="widget-stops">
          {stops.map((stop, i) => (
            <li key={i}>
              <span className="widget-step-n">{i + 1}</span>
              <div className="widget-step-body">
                <h4>{stop.name}</h4>
                <p>{stop.description}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Keyed by day so switching tabs builds a new map rather than panning
            a stale one that still holds the previous day's markers. */}
        {located.length > 0 && <Map key={at} stops={located} />}
      </div>
    </div>
  )
}
