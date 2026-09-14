import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './Icon.jsx'
import { useApp } from '../store.jsx'

/* Four-step onboarding wizard. Appears on first launch, lets the person
   choose their theme, accent, agent loader animation, and chat defaults
   before they see the composer for the first time. */

const ACCENT_PRESETS = [
  { id: 'blue', hex: '#3b82f6', label: 'Blue' },
  { id: 'purple', hex: '#8b5cf6', label: 'Purple' },
  { id: 'green', hex: '#10b981', label: 'Green' },
  { id: 'amber', hex: '#f59e0b', label: 'Amber' },
  { id: 'pink', hex: '#ec4899', label: 'Pink' },
  { id: 'slate', hex: '#64748b', label: 'Slate' },
]

const GUARD_MODES = [
  { id: 'read-only', icon: 'book', label: 'Read only', desc: 'Reads and plans. Makes no changes.' },
  { id: 'guard', icon: 'shield', label: 'Guard', desc: 'Asks before risky actions.' },
  { id: 'guard-auto-edit', icon: 'zap', label: 'Guard \u00b7 auto-edit', desc: 'File edits do not need approval.' },
  { id: 'full-access', icon: 'check-circle', label: 'Full access', desc: 'Runs commands and edits without asking.' },
]

const EFFORT_LEVELS = [
  { id: 'off', label: 'Off', desc: 'Answer directly, no reasoning' },
  { id: 'low', label: 'Low', desc: 'Fastest and cheapest' },
  { id: 'medium', label: 'Medium', desc: 'Balanced for routine work' },
  { id: 'high', label: 'High', desc: 'Default. Good for most tasks' },
  { id: 'extra-high', label: 'Extra high', desc: 'Deeper reasoning' },
  { id: 'max', label: 'Max', desc: 'Maximum reasoning effort' },
]

const AGENT_LOADERS = [
  { id: 'pixels', label: 'Pixels' },
  { id: 'halo', label: 'Halo' },
  { id: 'orbit', label: 'Orbit' },
  { id: 'wake', label: 'Wake' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'shift', label: 'Shift' },
  { id: 'ellipsis', label: 'Ellipsis' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'clock', label: 'Clock' },
  { id: 'drop', label: 'Drop' },
  { id: 'scanner', label: 'Scanner' },
  { id: 'card', label: 'Card' },
  { id: 'dial', label: 'Dial' },
  { id: 'beacon', label: 'Beacon' },
  { id: 'duet', label: 'Duet' },
  { id: 'tumble', label: 'Tumble' },
]

const slideVariants = {
  enter: (dir) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
}

export function LoaderIcon({ type }) {
  switch (type) {
    case 'pixels':
      return (
        <span className="ld-pixels">
          <i /><i /><i />
          <i /><i /><i />
        </span>
      )
    case 'halo':
      return <span className="ld-halo" />
    case 'orbit':
      return (
        <span className="ld-orbit">
          <i /><i /><i />
        </span>
      )
    case 'wake':
      return (
        <span className="ld-wake">
          <i /><i /><i />
        </span>
      )
    case 'pulse':
      return (
        <span className="ld-pulse">
          <i /><i /><i /><i />
        </span>
      )
    case 'shift':
      return (
        <span className="ld-shift">
          <i />
        </span>
      )
    case 'ellipsis':
      return (
        <span className="ld-ellipsis">
          <i /><i /><i />
        </span>
      )
    case 'ripple':
      return (
        <span className="ld-ripple">
          <i /><i />
        </span>
      )
    case 'clock':
      return (
        <span className="ld-clock">
          <i />
        </span>
      )
    case 'drop':
      return (
        <span className="ld-drop">
          <i />
        </span>
      )
    case 'scanner':
      return (
        <span className="ld-scanner">
          <i />
        </span>
      )
    case 'card':
      return (
        <span className="ld-card">
          <i />
        </span>
      )
    case 'dial':
      return <span className="ld-dial" />
    case 'beacon':
      return (
        <span className="ld-beacon">
          <i />
        </span>
      )
    case 'duet':
      return (
        <span className="ld-duet">
          <i /><i />
        </span>
      )
    case 'tumble':
      return (
        <span className="ld-tumble">
          <i />
        </span>
      )
    default:
      return (
        <span className="ld-pixels">
          <i /><i /><i />
          <i /><i /><i />
        </span>
      )
  }
}

function StepAppearance({ theme, setTheme, accentColor, setAccentColor, textSize, setTextSize, density, setDensity }) {
  const themes = [
    { id: 'system', label: 'System' },
    { id: 'graphite', label: 'Graphite' },
    { id: 'ink', label: 'Ink' },
    { id: 'nocturne', label: 'Nocturne' },
    { id: 'paper', label: 'Paper' },
    { id: 'sand', label: 'Sand' },
  ]

  const activeAccent = ACCENT_PRESETS.find((a) => a.hex.toLowerCase() === (accentColor || '#3b82f6').toLowerCase())?.label || 'Blue'

  return (
    <div className="ob-step">
      <h2 className="ob-title">Appearance</h2>
      <p className="ob-subtitle">Theme, accent, text size and density. The window behind follows along.</p>

      {/* Theme */}
      <div className="ob-section">
        <div className="ob-section-head">
          <Icon name="sun" size={15} />
          <span>Theme</span>
        </div>
        <div className="ob-theme-grid">
          {themes.map((t) => {
            const isActive = theme === t.id
            return (
              <button
                key={t.id}
                type="button"
                className={`ob-theme-card${isActive ? ' is-active' : ''}`}
                onClick={() => setTheme(t.id)}
              >
                <div className={`ob-theme-preview ob-theme-preview--${t.id}`}>
                  {t.id === 'system' ? (
                    <div className="ob-preview-split">
                      <div className="ob-preview-split-half ob-preview-split-half--light">
                        <div className="ob-preview-sk-bar" />
                        <div className="ob-preview-sk-line" />
                      </div>
                      <div className="ob-preview-split-half ob-preview-split-half--dark">
                        <div className="ob-preview-sk-bar" />
                        <div className="ob-preview-sk-line" />
                      </div>
                    </div>
                  ) : (
                    <div className="ob-preview-sk">
                      <div className="ob-preview-sk-bar" />
                      <div className="ob-preview-sk-line ob-preview-sk-line--long" />
                      <div className="ob-preview-sk-line ob-preview-sk-line--short" />
                    </div>
                  )}
                </div>
                <div className="ob-theme-label-row">
                  <span className="ob-theme-label">{t.label}</span>
                  {isActive && <Icon name="check" size={13} className="ob-theme-check" />}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Accent */}
      <div className="ob-section">
        <div className="ob-section-head">
          <Icon name="palette" size={15} />
          <span>Accent</span>
        </div>
        <div className="ob-accent-row">
          <div className="ob-accent-dots">
            {ACCENT_PRESETS.map((a) => {
              const isSelected = (accentColor || '#3b82f6').toLowerCase() === a.hex.toLowerCase()
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`ob-accent-dot${isSelected ? ' is-active' : ''}`}
                  style={{ '--dot-color': a.hex }}
                  onClick={() => setAccentColor(a.hex)}
                  aria-label={a.label}
                >
                  {isSelected && <Icon name="check" size={12} weight="bold" />}
                </button>
              )
            })}
          </div>
          <span className="ob-accent-label">{activeAccent}</span>
        </div>
      </div>

      {/* Text size */}
      <div className="ob-section">
        <div className="ob-section-head ob-section-head--spread">
          <span className="ob-section-head-title">
            <Icon name="type" size={15} />
            <span>Text size</span>
          </span>
          <span className="ob-text-pct">{textSize}%</span>
        </div>
        <div className="ob-slider-row">
          <button
            type="button"
            className="ob-slider-btn"
            onClick={() => setTextSize(Math.max(50, textSize - 5))}
            aria-label="Decrease text size"
          >
            A
          </button>
          <div className="ob-slider-track-wrap">
            <input
              type="range"
              min={50}
              max={200}
              step={5}
              value={textSize}
              onChange={(e) => setTextSize(Number(e.target.value))}
              className="ob-slider"
              style={{
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${(textSize - 50) / 1.5}%, var(--hairline-strong) ${(textSize - 50) / 1.5}%, var(--hairline-strong) 100%)`
              }}
            />
          </div>
          <button
            type="button"
            className="ob-slider-btn ob-slider-btn--lg"
            onClick={() => setTextSize(Math.min(200, textSize + 5))}
            aria-label="Increase text size"
          >
            A
          </button>
        </div>
      </div>

      {/* Density */}
      <div className="ob-section">
        <div className="ob-section-head">
          <Icon name="layers" size={15} />
          <span>Density</span>
        </div>
        <div className="ob-density-toggle">
          <button
            type="button"
            className={`ob-density-btn${density === 'comfortable' ? ' is-active' : ''}`}
            onClick={() => setDensity('comfortable')}
          >
            Comfortable
          </button>
          <button
            type="button"
            className={`ob-density-btn${density === 'compact' ? ' is-active' : ''}`}
            onClick={() => setDensity('compact')}
          >
            Compact
          </button>
        </div>
      </div>
    </div>
  )
}

function StepAgentLoader({ agentLoader, setAgentLoader }) {
  return (
    <div className="ob-step">
      <h2 className="ob-title">Agent loader</h2>
      <p className="ob-subtitle">The animation in the thinking row while an agent works.</p>

      <div className="ob-loader-grid">
        {AGENT_LOADERS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`ob-loader-card${agentLoader === l.id ? ' is-active' : ''}`}
            onClick={() => setAgentLoader(l.id)}
          >
            <span className="ob-loader-icon">
              <LoaderIcon type={l.id} />
            </span>
            <span className="ob-loader-label">{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function StepChatDefaults({ defaultGuard, setDefaultGuard, defaultEffort, setDefaultEffort, sendWith, setSendWith }) {
  return (
    <div className="ob-step">
      <h2 className="ob-title">Chat defaults</h2>
      <p className="ob-subtitle">How every new chat starts. The chips under the composer show the choice.</p>

      <div className="ob-section">
        <div className="ob-section-head">
          <Icon name="shield" size={15} />
          <span>New chats start in</span>
        </div>
        <div className="ob-guard-list">
          {GUARD_MODES.map((g) => {
            const isActive = defaultGuard === g.id
            return (
              <button
                key={g.id}
                type="button"
                className={`ob-guard-item${isActive ? ' is-active' : ''}`}
                onClick={() => setDefaultGuard(g.id)}
              >
                <span className="ob-guard-icon"><Icon name={g.icon} size={18} /></span>
                <span className="ob-guard-text">
                  <span className="ob-guard-label">{g.label}</span>
                  <span className="ob-guard-desc">{g.desc}</span>
                </span>
                {isActive && <Icon name="check" size={15} className="ob-check" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="ob-section">
        <div className="ob-section-head">
          <Icon name="brain" size={15} />
          <span>Reasoning effort</span>
        </div>
        <div className="ob-effort-grid">
          {EFFORT_LEVELS.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`ob-effort-btn${defaultEffort === e.id ? ' is-active' : ''}`}
              onClick={() => setDefaultEffort(e.id)}
            >
              <Icon name="brain" size={14} />
              <span>{e.label}</span>
            </button>
          ))}
        </div>
        <p className="ob-effort-hint">{EFFORT_LEVELS.find((e) => e.id === defaultEffort)?.desc}</p>
      </div>

      <div className="ob-section">
        <div className="ob-section-head">
          <Icon name="keyboard" size={15} />
          <span>Send messages with</span>
        </div>
        <div className="ob-density-toggle">
          <button
            type="button"
            className={`ob-density-btn${sendWith === 'enter' ? ' is-active' : ''}`}
            onClick={() => setSendWith('enter')}
          >
            <Icon name="wrap" size={13} /> Enter
          </button>
          <button
            type="button"
            className={`ob-density-btn${sendWith === 'ctrl-enter' ? ' is-active' : ''}`}
            onClick={() => setSendWith('ctrl-enter')}
          >
            <Icon name="keyboard" size={13} /> Ctrl Enter
          </button>
        </div>
        <p className="ob-toggle-hint">The other shortcut inserts a new line.</p>
      </div>
    </div>
  )
}

function StepDone({ onFinish }) {
  return (
    <div className="ob-step ob-step--done">
      <div className="ob-done-icon">
        <Icon name="check-circle" size={52} weight="light" />
      </div>
      <h2 className="ob-title">You&rsquo;re all set</h2>
      <p className="ob-subtitle">Everything is customisable from Settings at any time.</p>
      <button type="button" className="ob-finish-btn" onClick={onFinish}>
        Continue to Amethyst
      </button>
    </div>
  )
}

export default function OnboardingWizard() {
  const {
    theme, setTheme,
    accentColor, setAccentColor,
    textSize, setTextSize,
    density, setDensity,
    agentLoader, setAgentLoader,
    defaultGuard, setDefaultGuard,
    defaultEffort, setDefaultEffort,
    sendWith, setSendWith,
    onboardingDone, setOnboardingDone,
  } = useApp()

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)

  const next = useCallback(() => { setDir(1); setStep((s) => Math.min(s + 1, 3)) }, [])
  const prev = useCallback(() => { setDir(-1); setStep((s) => Math.max(s - 1, 0)) }, [])
  const finish = useCallback(() => setOnboardingDone(true), [setOnboardingDone])

  if (onboardingDone) return null

  const pages = [
    <StepAppearance
      key="appearance"
      theme={theme} setTheme={setTheme}
      accentColor={accentColor} setAccentColor={setAccentColor}
      textSize={textSize} setTextSize={setTextSize}
      density={density} setDensity={setDensity}
    />,
    <StepAgentLoader
      key="loader"
      agentLoader={agentLoader} setAgentLoader={setAgentLoader}
    />,
    <StepChatDefaults
      key="defaults"
      defaultGuard={defaultGuard} setDefaultGuard={setDefaultGuard}
      defaultEffort={defaultEffort} setDefaultEffort={setDefaultEffort}
      sendWith={sendWith} setSendWith={setSendWith}
    />,
    <StepDone key="done" onFinish={finish} />,
  ]

  const activeGuardObj = GUARD_MODES.find((g) => g.id === defaultGuard)
  const activeEffortObj = EFFORT_LEVELS.find((e) => e.id === defaultEffort)

  return (
    <div className="ob-overlay">
      <div className="ob-backdrop" />
      
      <div className="ob-container">
        <div className="ob-card">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="ob-page"
            >
              {pages[step]}
            </motion.div>
          </AnimatePresence>

          <div className="ob-footer">
            <div className="ob-dots">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`ob-dot${i === step ? ' is-active' : ''}${i < step ? ' is-done' : ''}`}
                />
              ))}
              <span className="ob-step-label">{step + 1} of 4</span>
            </div>
            <div className="ob-nav">
              {step > 0 && (
                <button type="button" className="ob-back-btn" onClick={prev}>
                  <Icon name="back" size={13} /> Back
                </button>
              )}
              {step < 3 ? (
                <button type="button" className="ob-continue-btn" onClick={next}>
                  Continue
                </button>
              ) : (
                <button type="button" className="ob-continue-btn" onClick={finish}>
                  Continue
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Step 2 (Agent Loader) live floating preview bar underneath modal */}
        {step === 1 && (
          <div className="ob-floating-preview ob-floating-preview--thinking">
            <span className="ob-preview-loader">
              <LoaderIcon type={agentLoader} />
            </span>
            <div className="ob-preview-status">
              <strong>Thinking</strong>
              <span>Working through the next step</span>
            </div>
            <span className="ob-preview-time">2.8s</span>
            <button type="button" className="ob-preview-pause" aria-label="Pause execution">
              <Icon name="pause" size={12} weight="fill" />
            </button>
          </div>
        )}

        {/* Step 3 (Chat Defaults) live floating preview bar underneath modal */}
        {step === 2 && (
          <div className="ob-floating-preview ob-floating-preview--composer">
            <div className="ob-composer-input-row">
              <div className="ob-composer-add-btn">
                <Icon name="plus" size={14} />
              </div>
              <span className="ob-composer-placeholder">
                Add a follow-up. {sendWith === 'enter' ? 'Enter' : 'Ctrl Enter'} sends.
              </span>
              <div className="ob-composer-send-btn">
                <Icon name="arrow-up-right" size={14} style={{ transform: 'rotate(-45deg)' }} />
              </div>
            </div>
            <div className="ob-composer-chips-row">
              <span className="ob-composer-chip">
                <Icon name="folder" size={12} />
                <span>sample-app</span>
                <Icon name="chevron" size={9} style={{ transform: 'rotate(90deg)' }} />
              </span>
              <span className="ob-composer-chip">
                <Icon name={activeGuardObj?.icon || 'shield'} size={12} />
                <span>{activeGuardObj?.label || 'Guard'}</span>
                <Icon name="chevron" size={9} style={{ transform: 'rotate(90deg)' }} />
              </span>
              <span className="ob-composer-chip">
                <Icon name="brain" size={12} />
                <span>{activeEffortObj?.label || 'High'}</span>
                <Icon name="chevron" size={9} style={{ transform: 'rotate(90deg)' }} />
              </span>
              <span className="ob-composer-chip ob-composer-chip--right">
                <Icon name="spark" size={12} />
                <span>Auto</span>
                <Icon name="chevron" size={9} style={{ transform: 'rotate(90deg)' }} />
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
