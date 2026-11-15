/* Places map — library revamp §8.11 (docs/agent-context/sections/library-revamp-design.md).
   Full-screen stylized overview board rendered from a list of place items.
   No fake map tiles: pins and cards come from real place data only. */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { BLUE, DEEP_BLUE } from './tokens.js'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import './place.css'

/* Pin anchor spots on the board, in % of the 390×844 canvas.
   First four reproduce the board positions (62,268) (288,372) (90,530) (152,318). */
const ANCHORS = [
  { x: 15.9, y: 31.8 },
  { x: 73.8, y: 44.1 },
  { x: 23.1, y: 62.8 },
  { x: 39.0, y: 37.7 },
  { x: 58.5, y: 24.0 },
  { x: 84.0, y: 31.5 },
  { x: 30.5, y: 49.5 },
  { x: 66.0, y: 57.5 },
  { x: 46.0, y: 70.0 },
  { x: 79.0, y: 67.0 },
]

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

function MapPinGlyph({ size = 18, width = 2.2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function UtensilsGlyph({ size = 18, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M5 3v5a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3" />
      <path d="M7 10v11" />
      <path d="M16 3c-1.6 1.6-1.6 7.4 0 9v9" />
    </svg>
  )
}

function ShopGlyph({ size = 28, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M4 9l1.2-5h13.6L20 9" />
      <path d="M4 9h16v2a3 3 0 0 1-6 0 3 3 0 0 1-5.9 0A3 3 0 0 1 4 11V9z" />
      <path d="M5 13.5V20h14v-6.5" />
      <path d="M10 20v-4.5h4V20" />
    </svg>
  )
}

function SearchGlyph({ size = 20, width = 2.2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  )
}

/* Board backdrop per §8.11: water #B7D4F0, parks #CDE4C5, white roads stroke 7–18. */
function BoardSvg() {
  return (
    <svg className="pl-map-board" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="390" height="844" fill="#E8E7E1" />
      <path d="M0 690c110-34 250 26 390-14v168H0z" fill="#B7D4F0" />
      <rect x="44" y="112" width="152" height="122" rx="14" fill="#CDE4C5" />
      <rect x="244" y="424" width="118" height="138" rx="12" fill="#CDE4C5" />
      <rect x="62" y="560" width="96" height="88" rx="12" fill="#CDE4C5" />
      <path d="M0 252h390" stroke="#fff" strokeWidth="12" />
      <path d="M0 470h390" stroke="#fff" strokeWidth="18" />
      <path d="M132 0v844" stroke="#fff" strokeWidth="8" />
      <path d="M298 0v844" stroke="#fff" strokeWidth="14" />
      <path d="M0 596L390 332" stroke="#fff" strokeWidth="7" />
      <path d="M0 646h390" stroke="#fff" strokeWidth="7" />
    </svg>
  )
}

function attributesOf(place) {
  return place?.attributes && typeof place.attributes === 'object' ? place.attributes : {}
}

function subFor(place) {
  const attributes = attributesOf(place)
  const bits = [attributes.type, attributes.cuisine, attributes.location]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, 2)
  return bits.join(' · ') || 'Saved place'
}

function pinGlyph(place) {
  const attributes = attributesOf(place)
  const food = ['cuisine', 'food', 'restaurant', 'cafe'].some((key) => String(attributes[key] || '').trim())
  return food ? <UtensilsGlyph /> : <MapPinGlyph />
}

function directionsUrl(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(place?.title || ''))}`
}

export default function PlacesMap({ places = [], onBack }) {
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(null)

  const normalized = useMemo(
    () => (Array.isArray(places) ? places : []).filter((place) => place && (place.title || place.attributes)),
    [places],
  )
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle
      ? normalized.filter((place) => String(place.title || '').toLowerCase().includes(needle))
      : normalized
  }, [normalized, query])

  const active = list.find((place) => place.id === activeId) || list[0] || null
  const activeIndex = active ? list.indexOf(active) : 0
  const activeAnchor = ANCHORS[activeIndex % ANCHORS.length]
  const goBack = onBack || (() => window.history.back())

  return (
    <motion.div
      className="pl-map-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Places map"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <BoardSvg />

      {active && (
        <span
          className="pl-map-ping"
          style={{ left: `${activeAnchor.x}%`, top: `${activeAnchor.y}%` }}
          aria-hidden="true"
        />
      )}

      {list.map((place, index) => {
        const anchor = ANCHORS[index % ANCHORS.length]
        const selected = active?.id === place.id
        return (
          <motion.button
            key={place.id ?? `place-${index}`}
            type="button"
            className={`pl-map-pin${selected ? ' on' : ''}`}
            style={{ left: `${anchor.x}%`, top: `${anchor.y}%` }}
            aria-label={place.title || 'Saved place'}
            aria-pressed={selected}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 22, delay: 0.05 + index * 0.04 }}
            whileTap={{ scale: 0.88 }}
            onClick={() => setActiveId(place.id ?? null)}
          >
            {pinGlyph(place)}
          </motion.button>
        )
      })}

      <div className="pl-map-top">
        <button type="button" className="pl-map-back pl-glass" aria-label="Back" onClick={goBack}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <label className="pl-map-search pl-glass">
          <SearchGlyph />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved places"
            aria-label="Search saved places"
          />
        </label>
      </div>

      {!list.length && (
        <p className="pl-map-hint">{normalized.length ? 'No places match your search' : 'No saved places yet'}</p>
      )}

      {active && (
        <motion.div
          className="pl-map-card pl-glass"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        >
          <CardThumb place={active} />
          <span className="pl-map-body">
            <span className="pl-map-name">{active.title || 'Saved place'}</span>
            <span className="pl-map-sub">{subFor(active)}</span>
          </span>
          {active.title && (
            <a className="pl-map-dir" href={directionsUrl(active)} target="_blank" rel="noreferrer" style={{ background: BLUE }}>
              Directions
            </a>
          )}
        </motion.div>
      )}
    </motion.div>
  )
}

function CardThumb({ place }) {
  const thumbnail = useItemThumbnail(place.thumbnailUrl ? { thumbnail_url: place.thumbnailUrl } : null)
  if (thumbnail) {
    return (
      <span className="pl-map-thumb">
        <img src={thumbnail} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      </span>
    )
  }
  const attributes = attributesOf(place)
  const food = ['cuisine', 'food', 'restaurant', 'cafe'].some((key) => String(attributes[key] || '').trim())
  return <span className="pl-map-thumb">{food ? <UtensilsGlyph size={28} /> : <ShopGlyph size={28} />}</span>
}
