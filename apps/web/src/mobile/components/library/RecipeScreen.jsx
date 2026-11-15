import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { parseRecipe } from '../../views/recipeParser.js'
import { useItemThumbnail } from '../../thumbnailLoader.jsx'
import { BLUE, DEEP_BLUE, INK, MUTED, KIND_META, canonicalKind } from './tokens.js'
import './recipe.css'

/* Recipe detail + cooking mode.
   Pixel source of truth: docs/agent-context/sections/library-revamp-design.md §8.6, §8.7. */

const EASE = [0.16, 1, 0.3, 1]

/* ---------- icon helpers ---------- */

function Icon({ children, size = 16, sw = 2, filled = false, color = 'currentColor' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={filled ? 'none' : color}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const CHECK = <path d="M5 12.5l4.5 4.5L19 7.5" />
const CLOCK = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
)
const PERSON = (
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-3.9 3.6-6 8-6s8 2.1 8 6" />
  </>
)
const SIGNAL = <path d="M6 20v-5M12 20v-9M18 20V7" />
const CLOSE = <path d="M6 6l12 12M18 6L6 18" />
const LIST = (
  <>
    <path d="M9 6h12M9 12h12M9 18h12" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </>
)
const CHEVRON_LEFT = <path d="M15 5l-7 7 7 7" />
const CHEVRON_RIGHT = <path d="M9 5l7 7-7 7" />
const PLAY = <path d="M8 5.5v13l11-6.5z" />
const PAUSE = <path d="M9 5v14M15 5v14" />
const PHONE = (
  <>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18h2" />
  </>
)

/* ---------- text splitting ---------- */

const QTY_KEYWORDS = 'to taste|to serve|as needed|a pinch|for garnish|for frying|for dusting|for greasing|optional'
const KEY_TAIL_RE = new RegExp(`^(.+?)\\s+(${QTY_KEYWORDS})$`, 'i')
const QTY_TAIL_RE = /^(.+?)\s+(\d[\d.,/×x]*(?:\s*[a-zA-Zµ°%][a-zA-Zµ°%./-]*)?|\([^)]+\))$/
const QTY_HEAD_RE = /^(\d[\d.,/×x]*(?:\s*[a-zA-Zµ°%][a-zA-Zµ°%./-]*)?)\s+(.+)$/

function splitIngredient(raw) {
  const text = String(raw || '').trim()
  if (!text) return { raw: '', name: '', qty: '' }
  const key = text.match(KEY_TAIL_RE)
  if (key) return { raw: text, name: key[1].replace(/[,;]$/, ''), qty: key[2].toLowerCase() }
  const tail = text.match(QTY_TAIL_RE)
  if (tail) return { raw: text, name: tail[1].replace(/[,;]$/, ''), qty: tail[2] }
  const head = text.match(QTY_HEAD_RE)
  if (head) return { raw: text, name: head[2], qty: head[1] }
  return { raw: text, name: text, qty: '' }
}

const STEP_SPLIT_RE = /^(.+?)\s*(?:\s[\u2014\u2013]\s|\s\/\s|\s*:\s)(.+)$/
const STEP_MINUTES_RE = /\b(\d+)\s*(?:minutes?|mins?)\b/i

function splitStep(raw) {
  const text = String(raw || '').trim()
  if (!text) return { title: '', sub: '', minutes: 0 }
  const split = text.match(STEP_SPLIT_RE)
  const timeMatch = text.match(STEP_MINUTES_RE)
  return {
    title: (split ? split[1] : text).trim(),
    sub: split ? split[2].trim() : '',
    minutes: timeMatch ? Math.max(1, parseInt(timeMatch[1], 10) || 0) : 0,
  }
}

/* ---------- checklist persistence (item.checklist [{text, done}]) ---------- */

function parseChecklist(raw) {
  let list = raw
  if (typeof list === 'string') {
    try { list = JSON.parse(list) } catch { list = [] }
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((entry) => entry && typeof entry === 'object' && String(entry.text || '').trim())
    .map((entry) => ({ text: String(entry.text).trim(), done: Boolean(entry.done || entry.checked) }))
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/* Hero band + title — the host renders this above the tab strip on every tab
   (boards show hero + title persisting across Overview/Links/Notes, §8.6). */
export function RecipeHeader({ item }) {
  const thumb = useItemThumbnail(item)
  if (!item) return null

  const kind = canonicalKind(item.kind)
  const kindMeta = KIND_META[kind] || KIND_META.other
  const entity = item.entity && typeof item.entity === 'object' ? item.entity : {}
  const attrs = entity.attributes && typeof entity.attributes === 'object' ? entity.attributes : {}
  const servingsRaw = attrs.servings ?? attrs.serves ?? attrs.yield ?? entity.servings
  const servingsMatch = servingsRaw != null && servingsRaw !== '' ? String(servingsRaw).match(/\d+(?:\.\d+)?/) : null
  const servings = servingsMatch && Number(servingsMatch[0]) > 0 ? servingsMatch[0].replace(/\.0$/, '') : ''
  const difficulty = attrs.difficulty || entity.difficulty || ''
  const heroChips = []
  if (item.duration) heroChips.push({ icon: CLOCK, label: String(item.duration) })
  if (servings) heroChips.push({ icon: PERSON, label: `Serves ${servings}` })
  if (difficulty) heroChips.push({ icon: SIGNAL, label: String(difficulty) })

  let host = ''
  try { host = item.url ? new URL(item.url).hostname.replace(/^www\./, '') : '' } catch { host = '' }
  const metaLine = [kindMeta.label, host].filter(Boolean).join(' · ')

  return (
    <>
      <section className="rc-hero">
        {thumb && (
          <img
            className="rc-hero-img"
            src={thumb}
            alt=""
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        )}
        {heroChips.length > 0 && (
          <div className="rc-hero-chips">
            {heroChips.map((chip) => (
              <span key={chip.label} className="rc-hero-chip">
                <Icon size={15} sw={2.2} color="#fff">{chip.icon}</Icon>
                {chip.label}
              </span>
            ))}
          </div>
        )}
      </section>
      <h1 className="rc-h1">{item.title}</h1>
      {metaLine && <p className="rc-meta">{metaLine}</p>}
    </>
  )
}

export default function RecipeScreen({ item, resources = [], sourceText = '', onUpdate, showToast }) {

  const [cooking, setCooking] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [panelOpen, setPanelOpen] = useState(false)
  const [wakeOn, setWakeOn] = useState(true)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [timerRunning, setTimerRunning] = useState(false)
  const bodyRef = useRef(null)

  const recipe = useMemo(() => {
    const text = [
      ...(resources || [])
        .filter((resource) => String(resource?.type || '').toLowerCase() === 'recipe')
        .map((resource) => resource.detail || ''),
      sourceText || '',
    ].filter(Boolean).join('\n\n')
    return parseRecipe(text)
  }, [resources, sourceText])

  const ingredients = useMemo(() => recipe.ingredients.map(splitIngredient).filter((ing) => ing.raw), [recipe])
  const steps = useMemo(() => recipe.steps.map(splitStep).filter((step) => step.title || step.sub), [recipe])

  const storedChecklist = useMemo(() => parseChecklist(item?.checklist), [item?.checklist])
  const [checklist, setChecklist] = useState(storedChecklist)
  useEffect(() => { setChecklist(storedChecklist) }, [storedChecklist])

  const canUpdate = item?.id != null
    && Number.isSafeInteger(Number(item.id))
    && typeof onUpdate === 'function'

  const doneFor = (text) => checklist.some((entry) => entry.text === text && entry.done)
  const doneCount = ingredients.filter((ing) => doneFor(ing.raw)).length
  const pct = ingredients.length ? Math.round((doneCount / ingredients.length) * 100) : 0

  const toggle = (text) => {
    const willCheck = !doneFor(text)
    let next
    if (!checklist.length) {
      if (!willCheck) return
      next = ingredients.map((ing) => ({ text: ing.raw, done: ing.raw === text }))
    } else {
      const exists = checklist.some((entry) => entry.text === text)
      next = exists
        ? checklist.map((entry) => (entry.text === text ? { ...entry, done: willCheck } : entry))
        : [...checklist, { text, done: willCheck }]
    }
    const previous = checklist
    setChecklist(next)
    if (!canUpdate) return
    onUpdate({ checklist: next }).catch((error) => {
      setChecklist(previous)
      showToast?.(`Could not save ingredients: ${error.message}`)
    })
  }

  const hasRecipe = ingredients.length > 0 || steps.length > 0

  /* Cooking mode state */
  const step = steps[stepIndex] || steps[0]
  const stepMinutes = step ? step.minutes : 0

  useEffect(() => {
    setSecondsLeft(stepMinutes * 60)
    setTimerRunning(false)
  }, [stepIndex, stepMinutes])

  useEffect(() => {
    if (!timerRunning || secondsLeft <= 0) return undefined
    const id = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(id)
  }, [timerRunning, secondsLeft])

  useEffect(() => {
    if (secondsLeft === 0) setTimerRunning(false)
  }, [secondsLeft])

  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 })
  }, [stepIndex])

  const wakeSupported = typeof navigator !== 'undefined' && Boolean(navigator.wakeLock?.request)
  useEffect(() => {
    if (!cooking || !wakeOn || !navigator.wakeLock?.request) return undefined
    let lock
    let cancelled = false
    navigator.wakeLock.request('screen').then((value) => {
      if (cancelled) value.release()
      else lock = value
    }).catch(() => {})
    return () => {
      cancelled = true
      lock?.release()
    }
  }, [cooking, wakeOn])

  const needList = useMemo(() => {
    if (!ingredients.length) return []
    const pending = ingredients.filter((ing) => !doneFor(ing.raw))
    const checked = ingredients.filter((ing) => doneFor(ing.raw))
    return [...pending, ...checked].slice(0, 2)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredients, checklist])

  const startCooking = () => {
    setStepIndex(0)
    setPanelOpen(false)
    setCooking(true)
  }

  const finish = () => {
    setCooking(false)
    setStepIndex(0)
    setPanelOpen(false)
    showToast?.('Cooking mode closed')
  }

  const nextStep = () => {
    if (stepIndex + 1 < steps.length) setStepIndex(stepIndex + 1)
    else finish()
  }

  const toggleTimer = () => {
    if (secondsLeft <= 0) setSecondsLeft(stepMinutes * 60)
    setTimerRunning((running) => !running)
  }

  const resetTimer = () => {
    setTimerRunning(false)
    setSecondsLeft(stepMinutes * 60)
  }

  if (!item) return null

  return (
    <>
      <div className="rc">
        {ingredients.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.06 }}
          >
            <header className="rc-head">
              <span className="rc-lbl">Ingredients</span>
              <span className="rc-count" style={{ color: MUTED }}>{doneCount} of {ingredients.length}</span>
            </header>
            <div
              className="rc-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={ingredients.length}
              aria-valuenow={doneCount}
            >
              <div className="rc-progress-fill" style={{ width: `${pct}%`, background: BLUE }} />
            </div>
            <div className="rc-card rc-pad">
              {ingredients.map((ing, index) => {
                const done = doneFor(ing.raw)
                return (
                  <motion.label
                    key={`${index}-${ing.raw}`}
                    className={`rc-ing-row ${done ? 'done' : ''}`}
                    whileTap={{ scale: 0.985 }}
                  >
                    <input
                      type="checkbox"
                      className="rc-sr"
                      checked={done}
                      onChange={() => toggle(ing.raw)}
                    />
                    <span className={`rc-circle ${done ? 'on' : ''}`} aria-hidden="true">
                      <Icon size={16} sw={3} color="#fff">{CHECK}</Icon>
                    </span>
                    <span className="rc-ing-name">{ing.name}</span>
                    {ing.qty && <span className="rc-ing-qty">{ing.qty}</span>}
                  </motion.label>
                )
              })}
            </div>
          </motion.section>
        )}

        {steps.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.12 }}
          >
            <header className="rc-head">
              <span className="rc-lbl">Steps</span>
              <span className="rc-count" style={{ color: MUTED }}>{steps.length} steps</span>
            </header>
            <div className="rc-card rc-pad">
              {steps.map((entry, index) => (
                <div key={`${index}-${entry.title}`} className="rc-step-row">
                  <span className="rc-step-num" style={{ color: DEEP_BLUE }}>{index + 1}</span>
                  <span className="rc-step-body">
                    <span className="rc-step-title" style={{ color: INK }}>{entry.title}</span>
                    {entry.sub && <span className="rc-step-sub" style={{ color: MUTED }}>{entry.sub}</span>}
                  </span>
                  {entry.minutes > 0 && <span className="rc-step-time">{entry.minutes} min</span>}
                </div>
              ))}
            </div>
          </motion.section>
        )}

        {steps.length > 0 && (
          <motion.button
            type="button"
            className="rc-cookbtn"
            whileTap={{ scale: 0.97 }}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.18 }}
            onClick={startCooking}
          >
            <Icon size={18} filled color="#fff">{PLAY}</Icon>
            Start cooking
          </motion.button>
        )}

        {!hasRecipe && (
          <motion.section
            className="rc-card rc-empty"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: 0.06 }}
          >
            <span className="rc-lbl">Recipe content</span>
            <p>No ingredient or step sections were saved for this item.</p>
            {sourceText && <pre className="rc-raw">{sourceText}</pre>}
          </motion.section>
        )}
      </div>

      <AnimatePresence>
        {cooking && steps.length > 0 && step && (
          <motion.div
            key="rc-cook"
            className="rc-cook"
            role="dialog"
            aria-modal="true"
            aria-label="Cooking mode"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <header className="rc-cook-top">
              <motion.button
                type="button"
                className="rc-glassbtn"
                aria-label="Exit cooking mode"
                whileTap={{ scale: 0.9 }}
                onClick={finish}
              >
                <Icon size={18} sw={2.6}>{CLOSE}</Icon>
              </motion.button>
              <div className="rc-cook-title">
                <div className="rc-cook-name">{item.title}</div>
                <div className="rc-cook-step-sub">Step {stepIndex + 1} of {steps.length}</div>
              </div>
              <motion.button
                type="button"
                className="rc-glassbtn"
                aria-label="Show ingredients"
                aria-expanded={panelOpen}
                whileTap={{ scale: 0.9 }}
                onClick={() => setPanelOpen((open) => !open)}
              >
                <Icon size={22} sw={2}>{LIST}</Icon>
              </motion.button>
            </header>

            <div
              className="rc-cook-progress"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={stepIndex + 1}
            >
              {steps.map((_, index) => (
                <span key={index} className={`rc-cook-bar ${index <= stepIndex ? 'on' : ''}`} />
              ))}
            </div>

            <div className="rc-cook-body" ref={bodyRef}>
              <motion.div
                key={stepIndex}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE }}
              >
                <div className="rc-cook-num" style={{ color: DEEP_BLUE }}>{stepIndex + 1}</div>
                <h1 className="rc-cook-h1">{step.title}</h1>
                {step.sub && <p className="rc-cook-subline">{step.sub}</p>}

                {needList.length > 0 && (
                  <div>
                    <span className="rc-lbl rc-need-lbl">You need</span>
                    <div className="rc-need">
                      {needList.map((ing) => {
                        const done = doneFor(ing.raw)
                        return (
                          <span key={ing.raw} className="rc-cook-chip">
                            <span className={`rc-circle ${done ? 'on' : ''}`} aria-hidden="true">
                              <Icon size={13} sw={3.2} color="#fff">{CHECK}</Icon>
                            </span>
                            <span className="rc-cook-chip-name">{ing.name}</span>
                            {ing.qty && <span className="rc-cook-chip-qty">{ing.qty}</span>}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {step.minutes > 0 && (
                  <div className="rc-timer">
                    <span className="rc-lbl">Timer</span>
                    <div className="rc-timer-digits">{formatClock(secondsLeft)}</div>
                    <div className="rc-timer-btns">
                      <motion.button
                        type="button"
                        className="rc-timer-start"
                        whileTap={{ scale: 0.97 }}
                        onClick={toggleTimer}
                      >
                        <Icon size={16} filled color="#fff">{timerRunning ? PAUSE : PLAY}</Icon>
                        {timerRunning ? 'Pause' : 'Start'}
                      </motion.button>
                      <motion.button
                        type="button"
                        className="rc-timer-reset"
                        whileTap={{ scale: 0.97 }}
                        onClick={resetTimer}
                      >
                        Reset
                      </motion.button>
                    </div>
                  </div>
                )}

                <div className="rc-wake">
                  <Icon size={22} color="#3A3A3C" sw={2}>{PHONE}</Icon>
                  <span className="rc-wake-label">Keep screen on</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={wakeOn}
                    aria-label="Keep screen on"
                    className={`rc-switch ${wakeOn ? 'on' : ''}`}
                    disabled={!wakeSupported}
                    onClick={() => setWakeOn((on) => !on)}
                  >
                    <span className="rc-switch-knob" />
                  </button>
                </div>
              </motion.div>
            </div>

            <div className="rc-cook-foot">
              <motion.button
                type="button"
                className="rc-glassbtn rc-cook-prev"
                aria-label="Previous step"
                disabled={stepIndex === 0}
                whileTap={stepIndex === 0 ? undefined : { scale: 0.9 }}
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
              >
                <Icon size={24} sw={2.4}>{CHEVRON_LEFT}</Icon>
              </motion.button>
              <motion.button type="button" className="rc-cook-next" whileTap={{ scale: 0.97 }} onClick={nextStep}>
                {stepIndex + 1 < steps.length ? (
                  <>
                    <span>Next: {steps[stepIndex + 1].title}</span>
                    <Icon size={20} sw={2.4}>{CHEVRON_RIGHT}</Icon>
                  </>
                ) : (
                  'Finish'
                )}
              </motion.button>
            </div>

            <AnimatePresence>
              {panelOpen && (
                <>
                  <motion.div
                    key="rc-cook-dim"
                    className="rc-cook-dim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={() => setPanelOpen(false)}
                  />
                  <motion.div
                    key="rc-cook-panel"
                    className="rc-cook-panel"
                    role="region"
                    aria-label="Ingredients"
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'tween', duration: 0.28, ease: EASE }}
                  >
                    <div className="rc-panel-head">
                      <span className="rc-lbl">Ingredients</span>
                      <button type="button" className="rc-panel-done" onClick={() => setPanelOpen(false)}>
                        Done
                      </button>
                    </div>
                    <div className="rc-panel-list">
                      {ingredients.map((ing, index) => {
                        const done = doneFor(ing.raw)
                        return (
                          <div key={`${index}-${ing.raw}`} className={`rc-ing-row rc-row-static ${done ? 'done' : ''}`}>
                            <span className={`rc-circle ${done ? 'on' : ''}`} aria-hidden="true">
                              <Icon size={16} sw={3} color="#fff">{CHECK}</Icon>
                            </span>
                            <span className="rc-ing-name">{ing.name}</span>
                            {ing.qty && <span className="rc-ing-qty">{ing.qty}</span>}
                          </div>
                        )
                      })}
                      {ingredients.length === 0 && (
                        <p className="rc-panel-none">No ingredients saved for this recipe.</p>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
