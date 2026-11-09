import { Button as HouseButton, Input as HouseInput } from '../ui/bento/index.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import './itinerary.css'

/* ==========================================================================
   Itinerary Widget - Minimalist Magazine-grade Road Trip Experience (ChatGPT Style)
   ========================================================================== */

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

const CA_COAST_PHOTOS = {
  heroLeft: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
  heroRightTop: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=800&q=80',
  heroRightBottom: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?auto=format&fit=crop&w=800&q=80',
  day1: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=800&q=80',
  day2: 'https://images.unsplash.com/photo-1449034446853-66c86144b0ad?auto=format&fit=crop&w=800&q=80',
  day3: 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=800&q=80',
  day4: 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=800&q=80',
}

function isCaliforniaRoute(title = '', days = []) {
  const allNames = days.flatMap((d) => (d.stops || []).map((s) => s.name)).join(' ')
  const haystack = `${title} ${allNames}`.toLowerCase()
  return /california|highway 1|big sur|san francisco|\bsf\b|\bla\b|los angeles|monterey|carmel|malibu|san simeon|santa barbara|morro bay/i.test(haystack)
}

function RouteMap({
  stops,
  allStops,
  expanded,
  onToggleExpand,
  focusedStop,
  onSelectStop,
  selectedDayFilter = 'all',
  onSelectDayFilter,
  days = [],
}) {
  const host = useRef(null)
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const layersRef = useRef(null)
  const tileLayerRef = useRef(null)
  const markersMapRef = useRef(new Map())
  const filterRef = useRef(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  // Close filter dropdown on click outside
  useEffect(() => {
    if (!filterOpen) return
    const onDocClick = (e) => {
      if (filterRef.current && !filterRef.current.contains(e.target)) {
        setFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [filterOpen])

  // Helper to draw route and markers on the existing map
  function updateLayers(L, map, layerGroup, currentStops, routeAllStops) {
    if (!L || !map || !layerGroup) return
    try {
      layerGroup.clearLayers()
      markersMapRef.current.clear()

      const effectiveRoute = routeAllStops && routeAllStops.length > 1 ? routeAllStops : currentStops
      const routePoints = (effectiveRoute || [])
        .filter((s) => Number.isFinite(s?.latitude) && Number.isFinite(s?.longitude))
        .map((s) => [s.latitude, s.longitude])

      if (routePoints.length >= 2) {
        L.polyline(routePoints, {
          color: '#ffffff',
          weight: 3.5,
          opacity: 0.92,
          smoothFactor: 1,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(layerGroup)
      }

      const validStops = (currentStops || []).filter(
        (s) => Number.isFinite(s?.latitude) && Number.isFinite(s?.longitude)
      )
      const points = validStops.map((s) => [s.latitude, s.longitude])
      const waypointEmojis = ['🌊', '🌅', '🌴', '🏰', '⛰️', '🏖️']

      validStops.forEach((stop, i) => {
        const isFirst = i === 0 && (!routeAllStops || currentStops === routeAllStops)
        const isLast = i === validStops.length - 1 && (!routeAllStops || currentStops === routeAllStops)
        const isFocused = focusedStop?.name === stop.name

        let pinHtml = ''
        if (isFirst) {
          pinHtml = '<div class="itinerary-pin itinerary-pin-start">1</div>'
        } else if (isLast) {
          pinHtml = '<div class="itinerary-pin itinerary-pin-end">🏁</div>'
        } else {
          const emoji = waypointEmojis[(i - 1) % waypointEmojis.length]
          pinHtml = `<div class="itinerary-pin itinerary-pin-waypoint">${emoji}</div>`
        }

        const pinIcon = L.divIcon({
          className: `itinerary-marker-wrapper${isFocused ? ' is-active' : ''}`,
          html: pinHtml,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          popupAnchor: [0, -14],
        })

        const marker = L.marker([stop.latitude, stop.longitude], { icon: pinIcon })
          .addTo(layerGroup)
          .bindPopup(
            `<strong>${stop.name}</strong><br/><span style="font-size:12px;color:#888;">${stop.description || ''}</span>`
          )

        marker.on('click', () => {
          onSelectStop?.(stop)
        })

        if (stop.name) {
          markersMapRef.current.set(stop.name, marker)
        }
      })

      if (points.length === 1) {
        map.setView(points[0], 12)
      } else if (points.length > 1) {
        map.fitBounds(points, { padding: [32, 32] })
      }
    } catch (err) {
      console.warn('[Itinerary Map] Layer update error:', err)
    }
  }

  // 1. Initialize map once on mount, clean up on unmount
  useEffect(() => {
    let active = true
    const container = host.current
    const markersMap = markersMapRef.current

    loadLeaflet()
      .then((L) => {
        if (!active || !container) return
        leafletRef.current = L

        // Defensively ensure container does not have a stale Leaflet ID
        if (container._leaflet_id) {
          delete container._leaflet_id
        }

        if (mapRef.current) {
          try {
            mapRef.current.remove()
          } catch (err) {
            console.warn('[Itinerary Map] Error removing previous map:', err)
          }
          mapRef.current = null
        }

        try {
          const isDark = document.documentElement.getAttribute('data-theme-mode') !== 'light'
          const tileUrl = isDark
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

          const map = L.map(container, {
            scrollWheelZoom: false,
            attributionControl: false,
            zoomControl: false,
          })
          mapRef.current = map

          const tiles = L.tileLayer(tileUrl, {
            maxZoom: 18,
            subdomains: 'abcd',
          }).addTo(map)
          tileLayerRef.current = tiles

          const layers = L.layerGroup().addTo(map)
          layersRef.current = layers

          updateLayers(L, map, layers, stops, allStops)
        } catch (err) {
          console.warn('[Itinerary Map] Init error:', err)
          if (active) setFailed(true)
        }
      })
      .catch((err) => {
        console.warn('[Itinerary Map] Load error:', err)
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (mapRef.current) {
        try {
          mapRef.current.remove()
        } catch (err) {
          console.warn('[Itinerary Map] Cleanup remove error:', err)
        }
        mapRef.current = null
      }
      if (container && container._leaflet_id) {
        delete container._leaflet_id
      }
      layersRef.current = null
      tileLayerRef.current = null
      leafletRef.current = null
      markersMap.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 2. Update layers when stops or allStops change
  useEffect(() => {
    if (mapRef.current && layersRef.current && leafletRef.current) {
      updateLayers(leafletRef.current, mapRef.current, layersRef.current, stops, allStops)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, allStops])

  // 3. Smooth flyTo and popup when focusedStop changes
  useEffect(() => {
    if (!mapRef.current || !focusedStop) return
    if (Number.isFinite(focusedStop.latitude) && Number.isFinite(focusedStop.longitude)) {
      try {
        mapRef.current.flyTo(
          [focusedStop.latitude, focusedStop.longitude],
          Math.max(mapRef.current.getZoom(), 13),
          { duration: 0.5 }
        )
      } catch (err) {
        console.warn('[Itinerary Map] FlyTo error:', err)
      }
    }
    if (focusedStop.name && markersMapRef.current) {
      const marker = markersMapRef.current.get(focusedStop.name)
      if (marker) {
        try {
          marker.openPopup()
        } catch (err) {
          console.warn('[Itinerary Map] openPopup error:', err)
        }
      }
    }
  }, [focusedStop])

  // 4. Handle expand/collapse smoothly
  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.invalidateSize()
    const timer = setTimeout(() => {
      mapRef.current?.invalidateSize()
    }, 320)
    return () => clearTimeout(timer)
  }, [expanded])

  // 5. Update tile layer when theme flips
  useEffect(() => {
    function updateThemeTiles() {
      if (!mapRef.current || !tileLayerRef.current) return
      try {
        const isDark = document.documentElement.getAttribute('data-theme-mode') !== 'light'
        const tileUrl = isDark
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
        tileLayerRef.current.setUrl(tileUrl)
      } catch {
        // ignore
      }
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'data-theme-mode' || m.attributeName === 'data-theme') {
          updateThemeTiles()
        }
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme-mode', 'data-theme'],
    })

    return () => observer.disconnect()
  }, [])

  if (failed) return null

  return (
    <div className="itinerary-map-container">
      <div className="itinerary-map-overlay-left">
        <div className="itinerary-map-filter-wrapper" ref={filterRef}>
          <HouseButton
            type="button"
            className="itinerary-map-pill itinerary-map-filter-btn"
            onClick={() => setFilterOpen((o) => !o)}
            aria-expanded={filterOpen}
          >
            {selectedDayFilter === 'all' ? 'All stops' : `Day ${selectedDayFilter}`} <span style={{ fontSize: 9 }}>▼</span>
          </HouseButton>
          {filterOpen && (
            <div className="itinerary-map-filter-menu" role="menu">
              <HouseButton
                type="button"
                className={`itinerary-map-filter-item ${selectedDayFilter === 'all' ? 'is-selected' : ''}`}
                onClick={() => {
                  onSelectDayFilter?.('all')
                  setFilterOpen(false)
                }}
              >
                All stops ({(allStops || []).length})
              </HouseButton>
              {(days || []).map((d, i) => {
                const dayNum = String(d.day ?? i + 1)
                const count = (d.stops || []).length
                return (
                  <HouseButton
                    key={i}
                    type="button"
                    className={`itinerary-map-filter-item ${selectedDayFilter === dayNum ? 'is-selected' : ''}`}
                    onClick={() => {
                      onSelectDayFilter?.(dayNum)
                      setFilterOpen(false)
                    }}
                  >
                    Day {dayNum} ({count} stop{count === 1 ? '' : 's'})
                  </HouseButton>
                )
              })}
            </div>
          )}
        </div>
        <span className="itinerary-map-info-btn" title="Route overview">ⓘ</span>
      </div>
      {onToggleExpand && (
        <HouseButton type="button" className="itinerary-map-expand-btn" onClick={onToggleExpand}>
          {expanded ? 'Collapse ⤡' : 'Expand ⤢'}
        </HouseButton>
      )}
      <div className={`widget-map ${expanded ? 'is-expanded' : ''}`} ref={host} />
    </div>
  )
}

export default function Itinerary({ data }) {
  const days = useMemo(() => data?.days ?? [], [data?.days])
  const [at, setAt] = useState(0)
  const [mapExpanded, setMapExpanded] = useState(false)
  const [focusedStop, setFocusedStop] = useState(null)
  const [selectedDayFilter, setSelectedDayFilter] = useState('all')
  const [customizing, setCustomizing] = useState(false)

  // Interactive customizer states
  const [tailorDuration, setTailorDuration] = useState('4 days, balanced itinerary')
  const [tailorVibe, setTailorVibe] = useState('Scenic drives, viewpoints, and hikes')
  const [tailorBudget, setTailorBudget] = useState('Mid-range, comfortable stays')
  const [tailorTravel, setTailorTravel] = useState('Rental car')

  // All stops across all days for route polyline
  const allStops = useMemo(() => (data?.days || []).flatMap((d) => d.stops ?? []), [data?.days])
  const hasCoordinates = useMemo(
    () => allStops.some((s) => Number.isFinite(s?.latitude) && Number.isFinite(s?.longitude)),
    [allStops]
  )

  // Stops currently displayed on map based on day filter
  const displayedStops = useMemo(() => {
    if (selectedDayFilter === 'all') return allStops
    const dayIdx = parseInt(selectedDayFilter, 10) - 1
    return days[dayIdx]?.stops ?? allStops
  }, [selectedDayFilter, allStops, days])

  if (!days.length) return null

  const isCalifornia = isCaliforniaRoute(data?.title, days)
  const isMagazineMode = isCalifornia || Boolean(data.hero_images?.length)

  // Curated hero images
  const heroImages = data.hero_images?.length
    ? data.hero_images
    : isCalifornia
    ? [CA_COAST_PHOTOS.heroLeft, CA_COAST_PHOTOS.heroRightTop, CA_COAST_PHOTOS.heroRightBottom]
    : []

  // Stats
  const distanceMiles = data.distance_miles || (isCalifornia ? 'About 450–500 miles' : `Approx. ${days.length * 115} miles`)
  const drivingTime = data.driving_time || (isCalifornia ? '9–11 hours of driving in total' : `Approx. ${days.length * 2.5} hours total`)
  const paceText = data.pace || `Best pace: ${days.length} days, ${Math.max(1, days.length - 1)} nights`

  // Current day and stops for classic tabbed view
  const currentDay = days[Math.min(at, days.length - 1)]
  const currentStops = currentDay?.stops ?? []

  // Practical tips
  const tips = data.tips?.length
    ? data.tips
    : isCalifornia
    ? [
        'Check Highway 1 before departure. As of October 2026, the highway has reopened through Big Sur, but active fire-related alerts and traffic controls can change access.',
        'Drive southbound if possible. You will generally be on the ocean side of the road, making it easier to access many coastal pullouts.',
        'Fill up before remote stretches. Big Sur has limited services, and winding roads take longer than the mileage suggests.',
        'Keep some flexibility. Fog, sunsets, parking, and roadwork can change your timing. Avoid driving the most winding sections after dark if you can.',
      ]
    : [
        'Plan buffer time for scenic pull-offs and photo stops.',
        'Check local weather forecasts and regional road conditions in advance.',
        'Book accommodations early in popular travel hubs.',
      ]

  const dayPhotoKeys = ['day1', 'day2', 'day3', 'day4']
  const getDayImage = (dayNum) => {
    if (days[dayNum - 1]?.image) return days[dayNum - 1].image
    if (isCalifornia) {
      const key = dayPhotoKeys[Math.min(dayNum - 1, dayPhotoKeys.length - 1)]
      return CA_COAST_PHOTOS[key]
    }
    return null
  }

  const handleMarkerSelect = (stop) => {
    setFocusedStop(stop)
    if (stop?.name) {
      const id = `itinerary-stop-${encodeURIComponent(stop.name)}`
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }
  }

  const handleCustomizeClick = () => {
    setCustomizing(true)
    const prompt = `Customize my road trip for "${data.title || 'California Coastal Road Trip'}":
- Duration: ${tailorDuration}
- Vibe: ${tailorVibe}
- Budget: ${tailorBudget}
- Travel Method: ${tailorTravel}
Please adjust the stops, pacing, and daily highlights accordingly.`

    window.dispatchEvent(
      new CustomEvent('amethyst-send-prompt', {
        detail: { text: prompt, submit: true },
      })
    )
    setTimeout(() => setCustomizing(false), 2500)
  }

  return (
    <div className="widget widget-itinerary">
      {/* 1. Hero Photo Mosaic Grid */}
      {heroImages.length >= 3 && (
        <div className="itinerary-hero-grid">
          <div className="itinerary-hero-left">
            <img src={heroImages[0]} alt="Scenic Coastal Cliffs" loading="lazy" />
          </div>
          <div className="itinerary-hero-right">
            <div className="itinerary-hero-sub">
              <img src={heroImages[1]} alt="Coastal Waterfall Cove" loading="lazy" />
            </div>
            <div className="itinerary-hero-sub">
              <img src={heroImages[2]} alt="Sunset Coastline" loading="lazy" />
              <div className="itinerary-photo-badge">
                <span className="itinerary-photo-icon">📷</span> 7
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Intro Paragraphs (if present in data or for California) */}
      {isCalifornia && (
        <div className="itinerary-intro-paragraphs">
          <p>
            I'd plan this as a <strong>4-day, 3-night road trip along Highway 1</strong>, with ocean cliffs, tiny beach towns, scenic pull-offs, and sunset stops. The drive itself is the attraction, so you don't want to rush straight from San Francisco to LA.
          </p>
          <p>
            The route follows the California coast south through Half Moon Bay, Monterey, Big Sur, San Simeon, and Santa Barbara before reaching Los Angeles.
          </p>
        </div>
      )}

      {/* 3. Minimal Stats Vertical List */}
      <div className="itinerary-stats-list">
        <div className="itinerary-stat-item">
          <div className="itinerary-stat-icon">🚗</div>
          <div className="itinerary-stat-text">
            <div className="itinerary-stat-title">{distanceMiles}</div>
            <div className="itinerary-stat-sub">Depending on detours and your final LA destination</div>
          </div>
        </div>

        <div className="itinerary-stat-item">
          <div className="itinerary-stat-icon">⏱️</div>
          <div className="itinerary-stat-text">
            <div className="itinerary-stat-title">{drivingTime}</div>
            <div className="itinerary-stat-sub">Spread over four days, excluding sightseeing</div>
          </div>
        </div>

        <div className="itinerary-stat-item">
          <div className="itinerary-stat-icon">📅</div>
          <div className="itinerary-stat-text">
            <div className="itinerary-stat-title">{paceText}</div>
            <div className="itinerary-stat-sub">A relaxed trip with time for viewpoints, beaches, and food</div>
          </div>
        </div>
      </div>

      {/* 4. Section Heading */}
      <h3 className="itinerary-section-heading">Your {days.length}-day itinerary</h3>

      {/* 5. Minimal Dark Leaflet Map with Route Polyline */}
      {hasCoordinates && (
        <RouteMap
          stops={displayedStops}
          allStops={allStops}
          expanded={mapExpanded}
          onToggleExpand={() => setMapExpanded((prev) => !prev)}
          focusedStop={focusedStop}
          onSelectStop={handleMarkerSelect}
          selectedDayFilter={selectedDayFilter}
          onSelectDayFilter={(dayVal) => setSelectedDayFilter(dayVal)}
          days={days}
        />
      )}

      {/* 6. Day-by-Day Section */}
      {isMagazineMode ? (
        /* Continuous Vertical Feed (ChatGPT Style) */
        <div className="itinerary-days-feed">
          {days.map((day, idx) => {
            const dayNum = day.day ?? idx + 1
            const thumb = getDayImage(dayNum)
            const titleClean = (day.title || '').replace(/^Day\s*\d+\s*[·\-:]\s*/i, '')
            const stopsList = day.stops || []

            return (
              <div key={idx} className="itinerary-day-row">
                {thumb && (
                  <div className="itinerary-day-thumb">
                    <img src={thumb} alt={`Day ${dayNum}`} loading="lazy" />
                  </div>
                )}
                <div className="itinerary-day-details">
                  <div className="itinerary-day-header">
                    <h4 className="itinerary-day-name">
                      Day {dayNum}{titleClean ? ` · ${titleClean}` : ''}
                    </h4>
                    <div className="itinerary-day-drive">
                      {day.driving_time || 'Approx. 3–4 hours driving with stops'}
                    </div>
                  </div>

                  {day.summary && <p className="itinerary-day-desc">{day.summary}</p>}

                  {stopsList.length > 0 && (
                    <ul className="itinerary-day-bullets">
                      {stopsList.map((stop, sIdx) => {
                        const isFocused = focusedStop?.name === stop.name
                        return (
                          <li
                            key={sIdx}
                            id={`itinerary-stop-${encodeURIComponent(stop.name)}`}
                            data-stop-name={stop.name}
                            data-day-num={dayNum}
                            data-stop-index={sIdx}
                            className={`itinerary-stop-interactive ${isFocused ? 'is-active-stop' : ''}`}
                            onClick={() => setFocusedStop(stop)}
                            onMouseEnter={() => setFocusedStop(stop)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setFocusedStop(stop)
                              }
                            }}
                          >
                            <span className="itinerary-stop-pin-indicator">📍</span>
                            <div className="itinerary-stop-content">
                              <strong>{stop.name}:</strong> {stop.description}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {day.overnight && (
                    <div className="itinerary-day-overnight">
                      {day.overnight.startsWith('Overnight:') ? day.overnight : `Overnight: ${day.overnight}.`}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* Classic Tabbed Mode for basic itineraries */
        <div className="itinerary-tabbed-container">
          <div className="widget-tabs" role="tablist">
            {days.map((d, i) => (
              <HouseButton
                key={i}
                type="button"
                role="tab"
                aria-selected={i === at}
                className={`widget-tab${i === at ? ' is-on' : ''}`}
                onClick={() => {
                  setAt(i)
                  setSelectedDayFilter(String(d.day ?? i + 1))
                }}
              >
                Day {d.day ?? i + 1}
              </HouseButton>
            ))}
          </div>
          <div role="tabpanel" className="itinerary-day-row" style={{ marginTop: '16px' }}>
            <div className="itinerary-day-details">
              <h4 className="itinerary-day-name">
                Day {currentDay.day ?? at + 1}{currentDay.title ? ` · ${currentDay.title}` : ''}
              </h4>
              <ul className="itinerary-day-bullets">
                {currentStops.map((stop, i) => {
                  const isFocused = focusedStop?.name === stop.name
                  return (
                    <li
                      key={i}
                      id={`itinerary-stop-${encodeURIComponent(stop.name)}`}
                      data-stop-name={stop.name}
                      data-day-num={currentDay.day ?? at + 1}
                      data-stop-index={i}
                      className={`itinerary-stop-interactive ${isFocused ? 'is-active-stop' : ''}`}
                      onClick={() => setFocusedStop(stop)}
                      onMouseEnter={() => setFocusedStop(stop)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setFocusedStop(stop)
                        }
                      }}
                    >
                      <span className="itinerary-stop-pin-indicator">📍</span>
                      <div className="itinerary-stop-content">
                        <strong>{stop.name}:</strong> {stop.description}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 7. Practical Tips Before You Go */}
      <div className="itinerary-tips-section">
        <h3 className="itinerary-section-heading">Practical tips before you go</h3>
        <ul className="itinerary-tips-bullets">
          {tips.map((tip, idx) => {
            const dotIdx = tip.indexOf('.')
            const colonIdx = tip.indexOf(':')
            const cutIdx = dotIdx !== -1 && (colonIdx === -1 || dotIdx < colonIdx) ? dotIdx : colonIdx
            const prefix = cutIdx !== -1 ? tip.slice(0, cutIdx + 1) : null
            const body = cutIdx !== -1 ? tip.slice(cutIdx + 1).trim() : tip

            return (
              <li key={idx}>
                {prefix ? <strong>{prefix} </strong> : null}
                <span>{body}</span>
              </li>
            )
          })}
        </ul>
      </div>

      {/* 8. "Let's Tailor the Trip" Interactive Customizer */}
      <div className="itinerary-customizer-section">
        <h3 className="itinerary-section-heading">Let's tailor the trip</h3>
        <div className="itinerary-customizer-card">
          {/* Question 1 */}
          <div className="itinerary-customizer-group">
            <div className="itinerary-customizer-question">How long do you have?</div>
            <div className="itinerary-radio-list">
              {[
                '2 days, fast road trip',
                '3 days, major highlights',
                '4 days, balanced itinerary',
                '5–7 days, relaxed exploration',
              ].map((opt) => (
                <label key={opt} className="itinerary-radio-item">
                  <HouseInput
                    type="radio"
                    name="tailor-duration"
                    value={opt}
                    checked={tailorDuration === opt}
                    onChange={() => setTailorDuration(opt)}
                  />
                  <span className="itinerary-radio-custom" />
                  <span className="itinerary-radio-label">{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Question 2 */}
          <div className="itinerary-customizer-group">
            <div className="itinerary-customizer-question">What's your vibe?</div>
            <div className="itinerary-radio-list">
              {[
                'Scenic drives, viewpoints, and hikes',
                'Beaches, sunsets, and relaxing',
                'Coastal towns, cafes, and food',
                'Photography and the most beautiful stops',
              ].map((opt) => (
                <label key={opt} className="itinerary-radio-item">
                  <HouseInput
                    type="radio"
                    name="tailor-vibe"
                    value={opt}
                    checked={tailorVibe === opt}
                    onChange={() => setTailorVibe(opt)}
                  />
                  <span className="itinerary-radio-custom" />
                  <span className="itinerary-radio-label">{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Question 3 */}
          <div className="itinerary-customizer-group">
            <div className="itinerary-customizer-question">Budget per person, excluding flights?</div>
            <div className="itinerary-radio-list">
              {[
                'Budget, motels and inexpensive food',
                'Mid-range, comfortable stays',
                'Luxury hotels and special stays',
              ].map((opt) => (
                <label key={opt} className="itinerary-radio-item">
                  <HouseInput
                    type="radio"
                    name="tailor-budget"
                    value={opt}
                    checked={tailorBudget === opt}
                    onChange={() => setTailorBudget(opt)}
                  />
                  <span className="itinerary-radio-custom" />
                  <span className="itinerary-radio-label">{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Question 4 */}
          <div className="itinerary-customizer-group">
            <div className="itinerary-customizer-question">How are you travelling?</div>
            <div className="itinerary-radio-list">
              {[
                'Rental car',
                'My own car',
                'No car, public transport and tours',
              ].map((opt) => (
                <label key={opt} className="itinerary-radio-item">
                  <HouseInput
                    type="radio"
                    name="tailor-travel"
                    value={opt}
                    checked={tailorTravel === opt}
                    onChange={() => setTailorTravel(opt)}
                  />
                  <span className="itinerary-radio-custom" />
                  <span className="itinerary-radio-label">{opt}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Summary preview tags */}
          <div className="itinerary-customizer-summary">
            <span className="itinerary-customizer-tag">{tailorDuration.split(',')[0]}</span>
            <span className="itinerary-customizer-tag">{tailorVibe.split(',')[0]}</span>
            <span className="itinerary-customizer-tag">{tailorBudget.split(',')[0]}</span>
            <span className="itinerary-customizer-tag">{tailorTravel}</span>
          </div>

          <HouseButton
            type="button"
            className="itinerary-customizer-btn"
            onClick={handleCustomizeClick}
            disabled={customizing}
          >
            {customizing ? '✨ Customizing your road trip...' : 'Customize my road trip'}
          </HouseButton>
        </div>
      </div>
    </div>
  )
}
