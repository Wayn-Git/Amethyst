/* Game detail screen — library-revamp-design.md section 8.8.
   Self-contained per-kind screen; the parent view owns top/bottom chrome. */

import { useEffect, useState } from 'react'
import { motion, MotionConfig } from 'framer-motion'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import { statusLabelFor, canonicalKind } from './tokens.js'
import './game.css'

const EASE = [0.16, 1, 0.3, 1]
const PROGRESS_STEPS = ['unstarted', 'in_progress', 'completed']
const PLATFORM_KEYS = ['platforms', 'platform', 'available on']
const PLATFORM_SPLIT = /\s*(?:\/|,|·|\||\band\b)\s*/i

function GamepadIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12.5a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5 5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM8 10v4M6 12h4M15.5 11h.01M18 13.5h.01" />
    </svg>
  )
}

function ArrowUpRightIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  )
}

function ChevronRightIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function LockIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
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

const KEY_OVERRIDES = { url: 'URL', esrb: 'ESRB', pegi: 'PEGI' }

function humanize(key) {
  const clean = String(key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const override = KEY_OVERRIDES[clean.toLowerCase()]
  if (override) return override
  return clean.replace(/\b\w/g, (char) => char.toUpperCase())
}

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

/* Hero band + title — host renders above the tab strip on every tab (§8.8). */
export function GameHeader({ item }) {
  const thumb = useItemThumbnail(item)
  if (!item) return null

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
  /* Platform chips for the hero — split compound strings, max 4. */
  const platformRaw = attr(...PLATFORM_KEYS) || ''
  const platforms = platformRaw
    .split(PLATFORM_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4)
  const genre = attr('genre', 'genres', 'category') || (item.category && String(item.category).trim()) || ''
  const metaLine = [attr('developer', 'studio'), genre].filter(Boolean).join(' · ') || entity.subtitle || ''

  return (
    <>
      <Section>
        <div className="gm-hero">
          {thumb ? <img className="gm-hero-img" src={thumb} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
          {platforms.length > 0 && (
            <div className="gm-chips">
              {platforms.map((label) => (
                <span key={label} className="gm-chip">{label}</span>
              ))}
            </div>
          )}
        </div>
      </Section>
      <Section delay={0.04} className="gm-title-row">
        <h1 className="gm-title">{item.title || ''}</h1>
        {metaLine ? <p className="gm-meta">{metaLine}</p> : null}
      </Section>
    </>
  )
}

export default function GameScreen({ item, resources, onUpdate, showToast }) {
  const thumb = useItemThumbnail(item)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  /* Keep typed notes while status saves refresh the item prop. */
  useEffect(() => {
    setDraft((current) => {
      const typed = { notes: current?.notes, private_notes: current?.private_notes }
      const saved = {
        notes: typeof item?.notes === 'string' ? item.notes : '',
        private_notes: typeof item?.private_notes === 'string' ? item.private_notes : '',
      }
      const kept = {}
      for (const field of ['notes', 'private_notes']) {
        if (typeof typed[field] === 'string' && typed[field] !== saved[field]) kept[field] = typed[field]
      }
      return Object.keys(kept).length ? kept : null
    })
  }, [item?.id, item?.progress, item?.rating, item?.notes, item?.private_notes])

  if (!item) return null

  const kind = canonicalKind(item.kind || 'game')
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

  /* Platform chips for the hero — split compound strings, max 4. */
  const platformRaw = attr(...PLATFORM_KEYS) || ''
  const kvRows = Object.entries(attributes)
    .filter(([key]) => key !== 'price' && !(entity.rating && key === 'score'))
    .map(([key, value]) => [humanize(key), value])
  if (entity.rating) kvRows.push(['Score', String(entity.rating)])

  const actions = (Array.isArray(entity.actions) ? entity.actions : [])
    .filter((action) => /^https?:\/\//i.test(action?.url || ''))

  const hasUrl = Boolean(item.url && /^https?:\/\//i.test(item.url))

  const canUpdate = item.id != null && Number.isSafeInteger(Number(item.id))
  const baseProgress = PROGRESS_STEPS.includes(item.progress) ? item.progress : 'unstarted'
  const progress = draft?.progress ?? baseProgress

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

  const savedNotes = typeof item.notes === 'string' ? item.notes : ''
  const savedPrivate = typeof item.private_notes === 'string' ? item.private_notes : ''
  const notes = draft?.notes ?? savedNotes
  const privateNotes = draft?.private_notes ?? savedPrivate

  const saveNotes = async (field, value, base, doneLabel) => {
    if (busy || !canUpdate || value === base) return
    setBusy(true)
    try {
      await onUpdate({ [field]: value })
      showToast(doneLabel)
    } catch (error) {
      setDraft((current) => ({ ...current, [field]: base }))
      showToast(`Could not save notes: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  const notesDirty = notes !== savedNotes
  const privateDirty = privateNotes !== savedPrivate

  return (
    <MotionConfig reducedMotion="user">
      <div className="gm-root">
        {hasUrl && (
          <Section delay={0.08}>
            <motion.a
              className="gm-card gm-source"
              href={item.url}
              target="_blank"
              rel="noreferrer"
              whileTap={{ scale: 0.985 }}
            >
              <span className="gm-avatar">{thumb ? <img src={thumb} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : hostOf(item.url).charAt(0).toUpperCase() || 'S'}</span>
              <span className="gm-row-body">
                <span className="gm-source-title">{hostOf(item.url)}</span>
                {entity.subtitle ? <span className="gm-source-sub">{entity.subtitle}</span> : null}
              </span>
              <span className="gm-open">
                Open
                <ArrowUpRightIcon />
              </span>
            </motion.a>
          </Section>
        )}

        <Section delay={0.12}>
          <h2 className="gm-label">Your status</h2>
          <div className="gm-status-row" role="group" aria-label="Game status">
            {PROGRESS_STEPS.map((step) => {
              const on = progress === step
              return (
                <motion.button
                  key={step}
                  type="button"
                  className={`gm-st${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={busy || !canUpdate}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => patch('progress', step, baseProgress, 'Could not save status')}
                >
                  {statusLabelFor('game', step)}
                </motion.button>
              )
            })}
          </div>
        </Section>

        {kvRows.length > 0 && (
          <Section delay={0.16}>
            <h2 className="gm-label">At a glance</h2>
            <div className="gm-card gm-kv-card">
              {kvRows.map(([name, value]) => (
                <div key={name} className="gm-kv">
                  <span className="gm-kv-k">{name}</span>
                  <span className="gm-kv-v">{value}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {entity.synopsis ? (
          <Section delay={0.2}>
            <h2 className="gm-label">About</h2>
            <div className="gm-card gm-about-card">
              <p>{entity.synopsis}</p>
            </div>
          </Section>
        ) : null}

        {actions.length > 0 && (
          <Section delay={0.24}>
            <h2 className="gm-label">Links</h2>
            <div className="gm-card gm-rows-card">
              {actions.map((action) => (
                <motion.a
                  key={`${action.label}-${action.url}`}
                  className="gm-row"
                  href={action.url}
                  target="_blank"
                  rel="noreferrer"
                  whileTap={{ scale: 0.985 }}
                >
                  <span className="gm-row-ic"><GamepadIcon /></span>
                  <span className="gm-row-body">
                    <span className="gm-row-title">{action.label || 'Open'}</span>
                    <span className="gm-row-sub">{hostOf(action.url)}</span>
                  </span>
                  <span className="gm-row-arrow"><ChevronRightIcon /></span>
                </motion.a>
              ))}
            </div>
          </Section>
        )}

        <Section delay={0.28}>
          <div className="gm-h2row">
            <h2 className="gm-h2">Notes</h2>
            <motion.button
              type="button"
              className="gm-save"
              disabled={busy || !canUpdate || !notesDirty}
              whileTap={{ scale: 0.96 }}
              onClick={() => saveNotes('notes', notes, savedNotes, 'Notes saved')}
            >
              {busy ? 'Saving…' : 'Save note'}
            </motion.button>
          </div>
          <div className="gm-card gm-notes-card">
            <textarea
              className="gm-notes-input"
              value={notes}
              placeholder="Add your thoughts about this game…"
              aria-label="Notes"
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </div>
        </Section>

        <Section delay={0.32}>
          <div className="gm-h2row">
            <h2 className="gm-h2">Private notes</h2>
            <motion.button
              type="button"
              className="gm-save"
              disabled={busy || !canUpdate || !privateDirty}
              whileTap={{ scale: 0.96 }}
              onClick={() => saveNotes('private_notes', privateNotes, savedPrivate, 'Private notes saved')}
            >
              {busy ? 'Saving…' : 'Save note'}
            </motion.button>
          </div>
          <div className="gm-card gm-notes-card">
            <textarea
              className="gm-notes-input"
              value={privateNotes}
              placeholder="Only you can see this…"
              aria-label="Private notes"
              onChange={(event) => setDraft((current) => ({ ...current, private_notes: event.target.value }))}
            />
            <p className="gm-lock-hint"><LockIcon />Private — hidden from shared views</p>
          </div>
        </Section>
      </div>
    </MotionConfig>
  )
}
