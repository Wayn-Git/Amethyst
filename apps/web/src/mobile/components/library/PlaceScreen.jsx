/* Place detail screen — library revamp §8.10 (docs/agent-context/sections/library-revamp-design.md).
   Renders live item data only: sections without data are hidden. */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BLUE,
  CARD_SHADOW,
  DEEP_BLUE,
  INK,
  KIND_META,
  MUTED,
  STATUS_LABELS,
  canonicalKind,
  statusLabelFor,
} from './tokens.js'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import './place.css'

const httpUrl = (value) => {
  const text = String(value || '')
  return /^https?:\/\//i.test(text) ? text : ''
}

const PROGRESS_ORDER = ['unstarted', 'in_progress', 'completed']

const PLACE_TYPES = ['place', 'destination', 'restaurant', 'cafe', 'travel', 'food']
const FOOD_TYPES = ['restaurant', 'cafe', 'food']

/* Attribute rows (§8.10.6): attribute key → tile icon. */
const INFO_ROWS = [
  ['cuisine', 'utensils'],
  ['hours', 'clock'],
  ['best for', 'sparkle'],
  ['location', 'pin'],
  ['website', 'globe'],
]

const INFO_ICONS = {
  utensils: UtensilsIcon,
  clock: ClockIcon,
  sparkle: SparkleIcon,
  pin: PinIcon,
  globe: GlobeIcon,
}

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

function PinIcon({ size = 18, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function ClockIcon({ size = 18, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function GlobeIcon({ size = 18, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
    </svg>
  )
}

function UtensilsIcon({ size = 18, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M5 3v5a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3" />
      <path d="M7 10v11" />
      <path d="M16 3c-1.6 1.6-1.6 7.4 0 9v9" />
    </svg>
  )
}

function SparkleIcon({ size = 18, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
    </svg>
  )
}

function ShopIcon({ size = 22, width = 2 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M4 9l1.2-5h13.6L20 9" />
      <path d="M4 9h16v2a3 3 0 0 1-6 0 3 3 0 0 1-5.9 0A3 3 0 0 1 4 11V9z" />
      <path d="M5 13.5V20h14v-6.5" />
      <path d="M10 20v-4.5h4V20" />
    </svg>
  )
}

function SendIcon({ size = 18, width = 2.4 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}

function ArrowUpRightIcon({ size = 16, width = 2.4 }) {
  return (
    <svg {...svgProps} width={size} height={size} strokeWidth={width}>
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  )
}

/* Stylized map hero from the board: water #B7D4F0, parks #CDE4C5, white roads,
   ping r34 rgba(11,95,217,.14) under the pin. Decorative only. */
function MapHeroSvg() {
  return (
    <svg className="pl-hero-map" viewBox="0 0 358 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="358" height="250" fill="#E8E7E1" />
      <path d="M0 198c96-18 200 14 358-4v56H0z" fill="#B7D4F0" />
      <rect x="24" y="30" width="112" height="86" rx="14" fill="#CDE4C5" />
      <rect x="228" y="118" width="106" height="80" rx="12" fill="#CDE4C5" />
      <path d="M0 118h358" stroke="#fff" strokeWidth="10" />
      <path d="M118 0v250" stroke="#fff" strokeWidth="14" />
      <path d="M0 178L358 96" stroke="#fff" strokeWidth="8" />
      <path d="M0 246c96-20 210 12 358-8" stroke="#fff" strokeWidth="9" />
      <circle cx="150" cy="112" r="34" fill="rgba(11,95,217,.14)" />
    </svg>
  )
}

function attrValue(attributes, name) {
  const found = Object.entries(attributes || {}).find(([key]) => key.toLowerCase() === name)
  return found ? String(found[1] ?? '').trim() : ''
}

/* External link per contract: entity map action → item.url. */
function pickLink(item, actions) {
  const mapAction = actions.find((action) => /map|direction/i.test(`${action?.label || ''} ${action?.url || ''}`))
  return httpUrl(mapAction?.url) || httpUrl(item?.url)
}

function Hero({ item, link }) {
  const thumbnail = useItemThumbnail(item)
  return (
    <div className="pl-hero">
      {thumbnail ? (
        <img className="pl-hero-img" src={thumbnail} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
      ) : (
        <>
          <MapHeroSvg />
          <span className="pl-hero-pin" aria-hidden="true">
            <ShopIcon size={22} />
          </span>
        </>
      )}
      {link && (
        <motion.a
          className="pl-open-maps pl-glass"
          href={link}
          target="_blank"
          rel="noreferrer"
          whileTap={{ scale: 0.97 }}
          style={{ color: INK }}
        >
          Open in Maps
        </motion.a>
      )}
    </div>
  )
}

export default function PlaceScreen({ item, resources = [], onUpdate, showToast }) {
  const toast = showToast || (() => {})
  const entity = item?.entity && typeof item.entity === 'object' ? item.entity : {}
  const attributes = entity.attributes && typeof entity.attributes === 'object' ? entity.attributes : {}
  const actions = (Array.isArray(entity.actions) ? entity.actions : []).filter((action) => httpUrl(action?.url))
  const link = pickLink(item, actions)
  const kind = KIND_META[canonicalKind(item?.type || 'place')] || KIND_META.place
  const subtitle = String(entity.subtitle || '').trim()
  const canUpdate = Boolean(onUpdate) && item?.id != null && Number.isSafeInteger(Number(item.id))

  /* Your status (§8.10.5): Want to go / Planned / Visited — optimistic with rollback. */
  const labels = STATUS_LABELS.place
  const normalized = PROGRESS_ORDER.includes(item?.progress) ? item.progress : 'unstarted'
  const [override, setOverride] = useState(null)
  const [busy, setBusy] = useState(false)
  const progress = override || normalized

  const choose = async (next) => {
    if (busy || next === progress || !canUpdate) return
    const previous = progress
    setOverride(next)
    setBusy(true)
    try {
      await onUpdate({ progress: next })
    } catch (error) {
      setOverride(previous)
      toast(`Could not save status: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  /* Your notes (§8.10.8): saved on blur, optimistic with rollback. */
  const savedNotes = String(item?.notes ?? '')
  const [draft, setDraft] = useState(savedNotes)
  const [noteBusy, setNoteBusy] = useState(false)
  useEffect(() => {
    setDraft(String(item?.notes ?? ''))
  }, [item?.id])

  const commitNotes = async () => {
    if (noteBusy || !canUpdate || draft === savedNotes) return
    setNoteBusy(true)
    try {
      await onUpdate({ notes: draft })
    } catch (error) {
      setDraft(savedNotes)
      toast(`Could not save note: ${error.message}`)
    } finally {
      setNoteBusy(false)
    }
  }

  const infoRows = INFO_ROWS.map(([name, icon]) => [name, icon, attrValue(attributes, name)]).filter((row) => row[2])

  /* Details (§8.10.9): Type + Coordinates, plus matched resources when present. */
  const typeValue = attrValue(attributes, 'type') || kind.label
  const detailsRows = [['Type', typeValue]]
  const coordinates = attrValue(attributes, 'coordinates')
  if (coordinates) detailsRows.push(['Coordinates', coordinates])
  const matchedResources = (Array.isArray(resources) ? resources : []).filter(
    (resource) =>
      PLACE_TYPES.includes(String(resource?.type || '').toLowerCase()) &&
      (resource?.name || resource?.detail || resource?.url),
  )

  return (
    <motion.div
      className="pl-screen"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      <Hero item={item} link={link} />

      <h1 className="pl-h1">{item?.title || 'Untitled place'}</h1>
      <p className="pl-meta" style={{ color: MUTED }}>
        {kind.label}
        {subtitle ? ` · ${subtitle}` : ''}
      </p>

      {link && (
        <div className="pl-actions">
          <motion.a
            className="pl-btn pl-btn-blue"
            href={link}
            target="_blank"
            rel="noreferrer"
            whileTap={{ scale: 0.97 }}
            style={{ background: BLUE }}
          >
            <SendIcon />
            Directions
          </motion.a>
        </div>
      )}

      <section>
        <h2 className="pl-lbl">Your status</h2>
        <div className="pl-status" role="group" aria-label="Your status">
          {PROGRESS_ORDER.map((value) => (
            <motion.button
              key={value}
              type="button"
              className={`pl-st${progress === value ? ' on' : ''}`}
              aria-pressed={progress === value}
              aria-label={statusLabelFor('place', value)}
              disabled={busy || !canUpdate}
              whileTap={{ scale: 0.96 }}
              onClick={() => choose(value)}
            >
              {labels[value]}
            </motion.button>
          ))}
        </div>
      </section>

      {infoRows.length > 0 && (
        <section>
          <h2 className="pl-lbl">Info</h2>
          <div className="pl-grp">
            {infoRows.map(([name, icon, value]) => {
              const Icon = INFO_ICONS[icon]
              const isLink = name === 'website' && /^https?:\/\//i.test(value)
              return (
                <div className="pl-row" key={name}>
                  <span className="pl-ic">
                    <Icon />
                  </span>
                  {isLink ? (
                    <a className="pl-row-val" href={value} target="_blank" rel="noreferrer" style={{ color: DEEP_BLUE }}>
                      {value}
                    </a>
                  ) : (
                    <span className="pl-row-val">{value}</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {entity.synopsis && (
        <section>
          <h2 className="pl-lbl">Synopsis</h2>
          <div className="pl-card" style={{ boxShadow: CARD_SHADOW }}>
            <p className="pl-synopsis">{String(entity.synopsis)}</p>
          </div>
        </section>
      )}

      {actions.length > 0 && (
        <section>
          <h2 className="pl-lbl">Actions</h2>
          <div className="pl-grp">
            {actions.map((action, index) => (
              <a
                className="pl-row pl-row-link"
                key={`${action.label || 'open'}-${action.url}-${index}`}
                href={action.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="pl-ic">
                  <GlobeIcon />
                </span>
                <span className="pl-row-val" style={{ flex: 1 }}>
                  {action.label || 'Open'}
                </span>
                <ArrowUpRightIcon />
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="pl-lbl">Your notes</h2>
        <div className="pl-note" style={{ boxShadow: CARD_SHADOW }}>
          <textarea
            aria-label="Notes for this place"
            placeholder="Add what you want to try here, like stalls, food or opening times…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitNotes}
            disabled={noteBusy || !canUpdate}
            style={{ color: INK }}
          />
        </div>
      </section>

      {(detailsRows.length > 0 || matchedResources.length > 0) && (
        <section>
          <h2 className="pl-lbl">Details</h2>
          <div className="pl-grp">
            {detailsRows.map(([label, value]) => (
              <div className="pl-kv" key={label}>
                <span style={{ color: MUTED }}>{label}</span>
                <span style={{ fontWeight: 600, color: INK, textAlign: 'right' }}>{value}</span>
              </div>
            ))}
            {matchedResources.map((resource, index) => {
              const Icon = FOOD_TYPES.includes(String(resource?.type || '').toLowerCase()) ? UtensilsIcon : PinIcon
              const href = httpUrl(resource?.url)
              const content = (
                <>
                  <span className="pl-ic pl-ic-lg">
                    <Icon />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {resource?.name && <span className="pl-res-name">{String(resource.name)}</span>}
                    {resource?.detail && <span className="pl-res-detail">{String(resource.detail)}</span>}
                  </span>
                  {href && <ArrowUpRightIcon />}
                </>
              )
              return href ? (
                <a className="pl-row pl-row-link" key={`res-${index}`} href={href} target="_blank" rel="noreferrer">
                  {content}
                </a>
              ) : (
                <div className="pl-row" key={`res-${index}`}>
                  {content}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </motion.div>
  )
}
