/* Product detail screen — library-revamp-design.md section 8.13.
   Self-contained per-kind screen; the parent view owns top/bottom chrome. */

import { useEffect, useState } from 'react'
import { motion, MotionConfig } from 'framer-motion'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import './product.css'

const EASE = [0.16, 1, 0.3, 1]
const PROGRESS_STEPS = ['unstarted', 'in_progress', 'completed']

/* Board labels for products (tokens.js STATUS_LABELS has no product entry). */
const STATUS_OPTIONS = {
  unstarted: 'Wishlist',
  in_progress: 'Ordered',
  completed: 'Owned',
}

const PRICE_KEYS = ['price', 'price_text', 'current price', 'cost', 'msrp', 'original price']

function BoxIcon({ size = 56 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 8.5v7a2 2 0 0 1-1.1 1.79l-7 3.5a2 2 0 0 1-1.8 0l-7-3.5A2 2 0 0 1 3 15.5v-7a2 2 0 0 1 1.1-1.79l7-3.5a2 2 0 0 1 1.8 0l7 3.5A2 2 0 0 1 21 8.5z" />
      <path d="M3.3 7.3 12 11.6l8.7-4.3M12 21.5V11.6M7.5 9.2l8-4" />
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

function ChevronRightIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 5l7 7-7 7" />
    </svg>
  )
}

function LinkIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
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

const KEY_OVERRIDES = { url: 'URL', asin: 'ASIN', sku: 'SKU', upc: 'UPC' }

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

export default function ProductScreen({ item, resources, onUpdate, showToast }) {
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

  const price = attr(...PRICE_KEYS)
  const meta = entity.subtitle || ''

  const kvRows = Object.entries(attributes)
    .filter(([key]) => !PRICE_KEYS.includes(key))
    .map(([key, value]) => [humanize(key), value])

  /* Where to buy — the saved page first, then entity actions. */
  const hasUrl = Boolean(item.url && /^https?:\/\//i.test(item.url))
  const actions = (Array.isArray(entity.actions) ? entity.actions : [])
    .filter((action) => /^https?:\/\//i.test(action?.url || ''))
  const shops = [
    ...(hasUrl ? [{ label: hostOf(item.url), url: item.url }] : []),
    ...actions.map((action) => ({ label: action.label || hostOf(action.url), url: action.url })),
  ]
  const seen = new Set()
  const shopRows = shops.filter((shop) => (seen.has(shop.url) ? false : (seen.add(shop.url), true)))

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
      <div className="pr-root">
        <Section>
          <div className="pr-hero">
            {thumb ? <img className="pr-hero-img" src={thumb} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : (
              <div className="pr-hero-art"><BoxIcon /></div>
            )}
            <span className="pr-tag">PRODUCT</span>
          </div>
        </Section>

        <Section delay={0.04} className="pr-title-row">
          <h1 className="pr-title">{item.title || ''}</h1>
          {(price || meta) && (
            <div className="pr-price-row">
              {price ? <span className="pr-price">{price}</span> : null}
              {meta ? <span className="pr-price-src">{meta}</span> : null}
            </div>
          )}
        </Section>

        <Section delay={0.08}>
          <h2 className="pr-label">Your status</h2>
          <div className="pr-status-row" role="group" aria-label="Product status">
            {PROGRESS_STEPS.map((step) => {
              const on = progress === step
              return (
                <motion.button
                  key={step}
                  type="button"
                  className={`pr-st${on ? ' on' : ''}`}
                  aria-pressed={on}
                  disabled={busy || !canUpdate}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => patch('progress', step, baseProgress, 'Could not save status')}
                >
                  {STATUS_OPTIONS[step]}
                </motion.button>
              )
            })}
          </div>
        </Section>

        {shopRows.length > 0 && (
          <Section delay={0.12}>
            <div className="pr-h2row">
              <h2 className="pr-h2">Where to buy</h2>
              <span className="pr-count">{shopRows.length} {shopRows.length === 1 ? 'store' : 'stores'}</span>
            </div>
            <div className="pr-card pr-shops-card">
              {shopRows.map((shop) => (
                <motion.a
                  key={shop.url}
                  className="pr-shop"
                  href={shop.url}
                  target="_blank"
                  rel="noreferrer"
                  whileTap={{ scale: 0.985 }}
                >
                  <span className="pr-shop-tile">{shop.label.charAt(0).toUpperCase()}</span>
                  <span className="pr-shop-body">
                    <span className="pr-shop-name">{shop.label}</span>
                    {price ? <span className="pr-shop-sub">{price}</span> : null}
                  </span>
                  <span className="pr-shop-arrow"><ArrowUpRightIcon /></span>
                </motion.a>
              ))}
            </div>
          </Section>
        )}

        {hasUrl && (
          <Section delay={0.16}>
            <h2 className="pr-label">Saved from</h2>
            <motion.a
              className="pr-card pr-from"
              href={item.url}
              target="_blank"
              rel="noreferrer"
              whileTap={{ scale: 0.985 }}
            >
              <span className="pr-from-tile">
                {thumb ? <img src={thumb} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <LinkIcon />}
              </span>
              <span className="pr-shop-body">
                <span className="pr-from-title">{item.title || hostOf(item.url)}</span>
                <span className="pr-from-sub">{hostOf(item.url)}</span>
              </span>
              <span className="pr-from-arrow"><ChevronRightIcon /></span>
            </motion.a>
          </Section>
        )}

        {kvRows.length > 0 && (
          <Section delay={0.2}>
            <h2 className="pr-label">Details</h2>
            <div className="pr-card pr-kv-card">
              {kvRows.map(([name, value]) => (
                <div key={name} className="pr-kv">
                  <span className="pr-kv-k">{name}</span>
                  <span className="pr-kv-v">{value}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section delay={0.24}>
          <div className="pr-h2row">
            <h2 className="pr-h2">Notes</h2>
            <motion.button
              type="button"
              className="pr-save"
              disabled={busy || !canUpdate || !notesDirty}
              whileTap={{ scale: 0.96 }}
              onClick={() => saveNotes('notes', notes, savedNotes, 'Notes saved')}
            >
              {busy ? 'Saving…' : 'Save note'}
            </motion.button>
          </div>
          <div className="pr-card pr-notes-card">
            <textarea
              className="pr-notes-input"
              value={notes}
              placeholder="Add size, model number or gift ideas…"
              aria-label="Notes"
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </div>
        </Section>

        <Section delay={0.28}>
          <div className="pr-h2row">
            <h2 className="pr-h2">Private notes</h2>
            <motion.button
              type="button"
              className="pr-save"
              disabled={busy || !canUpdate || !privateDirty}
              whileTap={{ scale: 0.96 }}
              onClick={() => saveNotes('private_notes', privateNotes, savedPrivate, 'Private notes saved')}
            >
              {busy ? 'Saving…' : 'Save note'}
            </motion.button>
          </div>
          <div className="pr-card pr-notes-card">
            <textarea
              className="pr-notes-input"
              value={privateNotes}
              placeholder="Only you can see this…"
              aria-label="Private notes"
              onChange={(event) => setDraft((current) => ({ ...current, private_notes: event.target.value }))}
            />
            <p className="pr-lock-hint"><LockIcon />Private — hidden from shared views</p>
          </div>
        </Section>

      </div>
    </MotionConfig>
  )
}
