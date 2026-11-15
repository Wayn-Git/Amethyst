/* Movie detail screen — library-revamp-design.md section 8.5.
   Self-contained per-kind screen; the parent view owns top/bottom chrome. */

import { useState } from 'react'
import { motion, MotionConfig } from 'framer-motion'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import { KIND_META, statusLabelFor, canonicalKind } from './tokens.js'
import './movie.css'

const EASE = [0.16, 1, 0.3, 1]
const PROGRESS_STEPS = ['unstarted', 'in_progress', 'completed']

/* Section blocks fade in on mount (0.3s, ease 0.16/1/0.3/1). */
function Section({ delay = 0, className, children }) {
  return (
    <motion.section
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay }}
    >
      {children}
    </motion.section>
  )
}

function PlayIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 001.54.84l10.6-6.86a1 1 0 000-1.68L9.54 4.3A1 1 0 008 5.14z" />
    </svg>
  )
}

const STAR_PATH = 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8L3.5 9.7l5.9-.8z'

function StarIcon({ filled }) {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={filled ? 1.5 : 1.8} strokeLinejoin="round" aria-hidden="true">
      <path d={STAR_PATH} />
    </svg>
  )
}

function StarBadgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={STAR_PATH} />
    </svg>
  )
}

function GlobeIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13.5 13.5 0 010 18M12 3a13.5 13.5 0 000 18" />
    </svg>
  )
}

function ArrowUpRightIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  )
}

function BubbleIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  )
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return String(url || '')
  }
}

/* item.duration is a display string elsewhere in the library; numbers are minutes. */
function formatRuntime(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string') return value.trim() || null
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours > 0 ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`
}

const KEY_OVERRIDES = { isbn: 'ISBN', asin: 'ASIN', imdb: 'IMDb', url: 'URL' }

function humanize(key) {
  const clean = String(key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const override = KEY_OVERRIDES[clean.toLowerCase()]
  if (override) return override
  return clean.replace(/\b\w/g, (char) => char.toUpperCase())
}

/* Hero band + poster/title block — rendered by the host above the tab strip
   on every tab (boards show hero + title persisting across Overview/Links/Notes). */
export function MovieHeader({ item }) {
  const thumb = useItemThumbnail(item)
  if (!item) return null

  const kind = canonicalKind(item.kind || 'movie')
  const palette = KIND_META[kind] || KIND_META.movie
  const entity = item.entity && typeof item.entity === 'object' ? item.entity : {}

  const attributes = {}
  for (const [key, value] of Object.entries(entity.attributes || {})) {
    const name = String(key).trim().toLowerCase()
    const text = String(value ?? '').trim()
    if (name && text) attributes[name] = text
  }
  const attr = (...keys) => {
    for (const key of keys) if (attributes[key]) return attributes[key]
    return null
  }

  const actions = (Array.isArray(entity.actions) ? entity.actions : [])
    .filter((action) => /^https?:\/\//i.test(action?.url || ''))
  const trailer = actions.find((action) => /trailer/i.test(`${action.label || ''} ${action.kind || ''}`)) || null

  const cert = attr('rated', 'certification', 'mpaa', 'mpaa_rating', 'age_rating', 'content_rating')
  const year = attr('year', 'release_year', 'released', 'release_date')
  const runtime = attr('runtime', 'running_time', 'duration', 'length') || formatRuntime(item.duration)
  const genre = (item.category && String(item.category)) || attr('genre', 'genres')
  const metaLine = [year, runtime, genre].filter(Boolean).join(' · ') || entity.subtitle || ''

  return (
    <>
      <Section>
        <div className="mv-hero" style={{ backgroundColor: palette.color }}>
          {thumb ? <img className="mv-hero-img" src={thumb} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
          {trailer ? (
            <motion.a className="mv-trailer" href={trailer.url} target="_blank" rel="noreferrer" whileTap={{ scale: 0.96 }}>
              <PlayIcon />
              <span>{trailer.label || 'Trailer'}</span>
            </motion.a>
          ) : null}
        </div>
      </Section>

      <Section delay={0.04} className="mv-poster-row">
        <div className="mv-poster">
          {thumb ? <img src={thumb} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
        </div>
        <div className="mv-poster-info">
          <h1 className="mv-title">{item.title || ''}</h1>
          {metaLine ? <p className="mv-meta">{metaLine}</p> : null}
          {(entity.rating || cert) ? (
            <div className="mv-chips">
              {entity.rating ? <span className="mv-chip mv-chip-score"><StarBadgeIcon />{String(entity.rating)}</span> : null}
              {cert ? <span className="mv-chip mv-chip-plain">{cert}</span> : null}
            </div>
          ) : null}
        </div>
      </Section>
    </>
  )
}

export default function MovieScreen({ item, resources, onUpdate, showToast }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!item) return null

  const kind = canonicalKind(item.kind || 'movie')
  const entity = item.entity && typeof item.entity === 'object' ? item.entity : {}

  const attributes = {}
  for (const [key, value] of Object.entries(entity.attributes || {})) {
    const name = String(key).trim().toLowerCase()
    const text = String(value ?? '').trim()
    if (name && text) attributes[name] = text
  }
  const attr = (...keys) => {
    for (const key of keys) if (attributes[key]) return attributes[key]
    return null
  }

  const actions = (Array.isArray(entity.actions) ? entity.actions : [])
    .filter((action) => /^https?:\/\//i.test(action?.url || ''))
  const trailer = actions.find((action) => /trailer/i.test(`${action.label || ''} ${action.kind || ''}`)) || null
  const watchActions = trailer ? actions.filter((action) => action !== trailer) : actions

  const synopsis = entity.synopsis || (typeof item.summary === 'string' ? item.summary.trim() : '')
  const cert = attr('rated', 'certification', 'mpaa', 'mpaa_rating', 'age_rating', 'content_rating')
  const year = attr('year', 'release_year', 'released', 'release_date')
  const runtime = attr('runtime', 'running_time', 'duration', 'length') || formatRuntime(item.duration)
  const genre = (item.category && String(item.category)) || attr('genre', 'genres')
  const metaLine = [year, runtime, genre].filter(Boolean).join(' · ') || entity.subtitle || ''

  const kvRows = Object.entries(attributes)
    .filter(([key]) => !(entity.rating && key === 'score'))
    .map(([key, value]) => [humanize(key), value])
  if (entity.rating) kvRows.push(['Score', String(entity.rating)])

  const canUpdate = item.id != null && Number.isSafeInteger(Number(item.id))
  const baseProgress = PROGRESS_STEPS.includes(item.progress) ? item.progress : 'unstarted'
  const ratingValue = item.rating == null ? null : Number(item.rating)
  const baseRating = ratingValue != null && Number.isFinite(ratingValue)
    ? Math.min(5, Math.max(1, Math.round(ratingValue)))
    : null
  const progress = draft?.progress ?? baseProgress
  const rating = draft && draft.rating !== undefined ? draft.rating : baseRating

  /* Optimistic patch: apply locally, persist, roll back + toast on failure. */
  const patch = async (field, value, base, message) => {
    if (busy || !canUpdate) return
    setDraft((current) => ({ ...current, [field]: value }))
    setBusy(true)
    try {
      await onUpdate({ [field]: value })
    } catch (error) {
      setDraft((current) => ({ ...current, [field]: base }))
      showToast(`${message}: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="mv-root">
        <Section delay={0.08}>
          <h2 className="mv-label">Your status</h2>
          <div className="mv-status-row" role="group" aria-label="Viewing status">
            {PROGRESS_STEPS.map((step) => {
              const on = progress === step
              return (
                <motion.button
                  key={step}
                  type="button"
                  className={`mv-st${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={busy || !canUpdate}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => patch('progress', step, baseProgress, 'Could not save status')}
                >
                  {statusLabelFor(kind, step)}
                </motion.button>
              )
            })}
          </div>
        </Section>

        <Section delay={0.12}>
          <h2 className="mv-label">Your rating</h2>
          <div className="mv-card mv-rating-card">
            <div className="mv-stars" role="group" aria-label="Rate this movie">
              {[1, 2, 3, 4, 5].map((value) => (
                <motion.button
                  key={value}
                  type="button"
                  className="mv-star"
                  aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  aria-pressed={rating === value}
                  disabled={busy || !canUpdate}
                  whileTap={{ scale: 0.88 }}
                  onClick={() => patch('rating', value === rating ? null : value, baseRating, 'Could not save rating')}
                >
                  <StarIcon filled={rating != null && rating >= value} />
                </motion.button>
              ))}
            </div>
            <p className="mv-score">
              <span className="mv-score-value">{rating ?? '–'}</span>
              <span className="mv-score-out"> / 5</span>
            </p>
          </div>
        </Section>

        <Section delay={0.16}>
          <h2 className="mv-label">Where to watch</h2>
          <div className="mv-card mv-watch-card">
            <div className="mv-watch-group" role="group" aria-label="How to watch">
              {['Stream', 'Rent', 'Buy'].map((mode, i) => {
                const action = watchActions[i] || null
                const href = action?.url || null
                const onClick = action ? undefined : (e) => e.preventDefault()
                return (
                  <motion.a
                    key={mode}
                    className={`mv-watch-pill${i === 0 ? ' on' : ''}`}
                    href={href || '#'}
                    target={href ? '_blank' : undefined}
                    rel="noreferrer"
                    aria-label={action ? `${mode}: ${action.label || hostOf(action.url)}` : mode}
                    disabled={!href}
                    whileTap={{ scale: 0.97 }}
                    onClick={onClick}
                  >
                    {mode}
                  </motion.a>
                )
              })}
            </div>
            <div className="mv-watch-note">
              <span className="mv-watch-ic"><GlobeIcon /></span>
              <span>Streaming services for your region show up here once we find them.</span>
            </div>
          </div>
        </Section>

        {synopsis ? (
          <Section delay={0.2}>
            <h2 className="mv-label">Synopsis</h2>
            <div className="mv-card mv-synopsis-card">
              <p>{synopsis}</p>
            </div>
          </Section>
        ) : null}

        {kvRows.length > 0 && (
          <Section delay={0.24}>
            <h2 className="mv-label">Details</h2>
            <div className="mv-card mv-kv-card">
              {kvRows.map(([name, value]) => (
                <div key={name} className="mv-kv">
                  <span className="mv-kv-k">{name}</span>
                  <span className="mv-kv-v">{value}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {item.url && /^https?:\/\//i.test(item.url) && (
          <Section delay={0.28}>
            <h2 className="mv-label">Saved from</h2>
            <motion.a className="mv-card mv-source-card" href={item.url} target="_blank" rel="noreferrer" whileTap={{ scale: 0.985 }}>
              <span className="mv-source-ic"><BubbleIcon /></span>
              <span className="mv-row-body">
                <span className="mv-source-title">The post you saved</span>
                <span className="mv-source-sub">Open the original</span>
              </span>
              <span className="mv-row-arrow"><ArrowUpRightIcon size={20} /></span>
            </motion.a>
          </Section>
        )}
      </div>
    </MotionConfig>
  )
}
