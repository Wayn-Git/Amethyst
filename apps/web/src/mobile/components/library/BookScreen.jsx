/* Book detail screen — library-revamp-design.md section 8.9.
   Self-contained per-kind screen; the parent view owns top/bottom chrome. */

import { useEffect, useState } from 'react'
import { motion, MotionConfig } from 'framer-motion'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import { statusLabelFor, canonicalKind } from './tokens.js'
import './book.css'

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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  )
}

function ChevronRightIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function LinkIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 13.5a4.6 4.6 0 006.5 0l2.6-2.6a4.6 4.6 0 00-6.5-6.5l-1.5 1.5" />
      <path d="M13.5 10.5a4.6 4.6 0 00-6.5 0l-2.6 2.6a4.6 4.6 0 006.5 6.5l1.5-1.5" />
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

const KEY_OVERRIDES = { isbn: 'ISBN', asin: 'ASIN', url: 'URL' }

function humanize(key) {
  const clean = String(key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const override = KEY_OVERRIDES[clean.toLowerCase()]
  if (override) return override
  return clean.replace(/\b\w/g, (char) => char.toUpperCase())
}

/* Cover-on-paper hero + title block — host renders above the tab strip on
   every tab (boards show hero + title persisting across Overview/Links/Notes). */
export function BookHeader({ item }) {
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
  const author = (item.author && String(item.author)) || attr('author', 'authors') || ''
  const year = attr('year', 'published', 'publication_year', 'publication_date', 'publish_year')
  const pages = attr('pages', 'page_count', 'number_of_pages', 'pages_count')
  const metaLine = [author, year, pages].filter(Boolean).join(' · ') || entity.subtitle || ''
  const chips = []
  for (const value of [item.category && String(item.category), attr('format', 'binding', 'edition')]) {
    if (value && !chips.includes(value)) chips.push(value)
  }

  return (
    <>
      <Section>
        <div className="bk-panel">
          {thumb ? (
            <img className="bk-book-img" src={thumb} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
          ) : (
            <div className="bk-book">
              <span className="bk-spine" />
              <div className="bk-book-title">{item.title || ''}</div>
              {author ? <div className="bk-book-author">{author}</div> : null}
            </div>
          )}
        </div>
      </Section>
      <Section delay={0.04} className="bk-head">
        <h1 className="bk-title">{item.title || ''}</h1>
        {metaLine ? <p className="bk-meta">{metaLine}</p> : null}
        {chips.length > 0 && (
          <div className="bk-chips">
            {chips.map((chip) => <span key={chip} className="bk-chip">{chip}</span>)}
          </div>
        )}
      </Section>
    </>
  )
}

export default function BookScreen({ item, resources, onUpdate, showToast }) {
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  /* Keep typed notes while a status save refreshes the item prop. */
  useEffect(() => {
    setDraft((current) => {
      const typedNotes = current?.notes
      const savedNotes = typeof item?.notes === 'string' ? item.notes : ''
      if (typeof typedNotes === 'string' && typedNotes !== savedNotes) return { notes: typedNotes }
      return null
    })
  }, [item?.id, item?.progress, item?.notes])

  if (!item) return null

  const kind = canonicalKind(item.kind || 'book')
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

  const kvRows = []
  if (author && !attributes.author) kvRows.push(['Author', author])
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'author' || key === 'authors') continue
    kvRows.push([humanize(key), value])
  }

  const canUpdate = item.id != null && Number.isSafeInteger(Number(item.id))
  const baseProgress = PROGRESS_STEPS.includes(item.progress) ? item.progress : 'unstarted'
  const progress = draft?.progress ?? baseProgress
  const savedNotes = typeof item.notes === 'string' ? item.notes : ''
  const notes = draft?.notes ?? savedNotes
  const notesDirty = notes !== savedNotes

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

  const saveNotes = async () => {
    if (busy || !canUpdate || !notesDirty) return
    setBusy(true)
    try {
      await onUpdate({ notes })
      showToast('Notes saved')
    } catch (error) {
      setDraft((current) => ({ ...current, notes: savedNotes }))
      showToast(`Could not save notes: ${error.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="bk-root">
        <Section delay={0.08}>
          <h2 className="bk-label">Your status</h2>
          <div className="bk-status-row" role="group" aria-label="Reading status">
            {PROGRESS_STEPS.map((step) => {
              const on = progress === step
              return (
                <motion.button
                  key={step}
                  type="button"
                  className={`bk-st${on ? ' on' : ''}`}
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

        {entity.synopsis || (typeof item.summary === 'string' && item.summary.trim()) ? (
          <Section delay={0.12}>
            <h2 className="bk-label">Synopsis</h2>
            <div className="bk-card bk-synopsis-card">
              <p>{entity.synopsis || item.summary.trim()}</p>
            </div>
          </Section>
        ) : null}

        {actions.length > 0 && (
          <Section delay={0.16}>
            <h2 className="bk-label">Where to get it</h2>
            <div className="bk-card bk-rows-card">
              {actions.map((action) => (
                <motion.a
                  key={`${action.label}-${action.url}`}
                  className="bk-row"
                  href={action.url}
                  target="_blank"
                  rel="noreferrer"
                  whileTap={{ scale: 0.985 }}
                >
                  <span className="bk-row-ic"><GlobeIcon /></span>
                  <span className="bk-row-body">
                    <span className="bk-row-title">{action.label || 'Open'}</span>
                    <span className="bk-row-sub">{hostOf(action.url)}</span>
                  </span>
                  <span className="bk-row-arrow"><ArrowUpRightIcon /></span>
                </motion.a>
              ))}
            </div>
          </Section>
        )}

        {kvRows.length > 0 && (
          <Section delay={0.2}>
            <h2 className="bk-label">Details</h2>
            <div className="bk-card bk-kv-card">
              {kvRows.map(([name, value]) => (
                <div key={name} className="bk-kv">
                  <span className="bk-kv-k">{name}</span>
                  <span className="bk-kv-v">{value}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {item.url && /^https?:\/\//i.test(item.url) && (
          <Section delay={0.24}>
            <h2 className="bk-label">Saved from</h2>
            <motion.a className="bk-card bk-source-card" href={item.url} target="_blank" rel="noreferrer" whileTap={{ scale: 0.985 }}>
              <span className="bk-source-ic"><LinkIcon /></span>
              <span className="bk-row-body">
                <span className="bk-source-title">{hostOf(item.url)}</span>
                <span className="bk-source-sub">Open the original</span>
              </span>
              <span className="bk-row-arrow"><ChevronRightIcon /></span>
            </motion.a>
          </Section>
        )}

        <Section delay={0.28}>
          <div className="bk-h2row">
            <h2 className="bk-h2">Notes</h2>
            <motion.button
              type="button"
              className="bk-save"
              disabled={busy || !canUpdate || !notesDirty}
              whileTap={{ scale: 0.96 }}
              onClick={saveNotes}
            >
              {busy ? 'Saving…' : 'Save note'}
            </motion.button>
          </div>
          <div className="bk-card bk-notes-card">
            <textarea
              className="bk-notes-input"
              value={notes}
              placeholder="Add your personal thoughts or private notes here…"
              aria-label="Notes"
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </div>
        </Section>
      </div>
    </MotionConfig>
  )
}
