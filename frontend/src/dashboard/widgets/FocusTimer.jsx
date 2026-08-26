import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon.jsx'

const PRESETS = [
  { label: '25m', seconds: 1500 },
  { label: '50m', seconds: 3000 },
  { label: '15m', seconds: 900 },
]

export function formatTimer(seconds) {
  const m = Math.floor(Math.max(0, seconds) / 60)
  const s = Math.max(0, seconds) % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function FocusTimer({ onComplete }) {
  const [preset, setPreset] = useState(1500)
  const [secondsRemaining, setSecondsRemaining] = useState(1500)
  const [isActive, setIsActive] = useState(false)

  // Restore state from localStorage on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('amethyst.focus_timer') || 'null')
      if (saved) {
        if (saved.isActive && saved.endTime) {
          const left = Math.round((saved.endTime - Date.now()) / 1000)
          if (left > 0) {
            setSecondsRemaining(left)
            setIsActive(true)
            if (saved.preset) setPreset(saved.preset)
            return
          }
        } else if (typeof saved.secondsRemaining === 'number') {
          setSecondsRemaining(saved.secondsRemaining)
          if (saved.preset) setPreset(saved.preset)
        }
      }
    } catch {
      // Ignore storage parse errors
    }
  }, [])

  // Save active timer state
  useEffect(() => {
    try {
      if (isActive) {
        const endTime = Date.now() + secondsRemaining * 1000
        localStorage.setItem('amethyst.focus_timer', JSON.stringify({ isActive: true, endTime, preset }))
      } else {
        localStorage.setItem('amethyst.focus_timer', JSON.stringify({ isActive: false, secondsRemaining, preset }))
      }
    } catch {
      // Ignore storage write errors
    }
  }, [isActive, secondsRemaining, preset])

  // Timer tick
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      setSecondsRemaining(current => {
        if (current <= 1) {
          setIsActive(false)
          clearInterval(interval)
          try {
            window.dispatchEvent(new CustomEvent('amethyst-focus-complete'))
            if (onComplete) onComplete()
          } catch {
            // Ignore callback error
          }
          return 0
        }
        return current - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [isActive, onComplete])

  const toggle = useCallback(() => {
    if (secondsRemaining <= 0) {
      setSecondsRemaining(preset)
      setIsActive(true)
    } else {
      setIsActive(active => !active)
    }
  }, [secondsRemaining, preset])

  const reset = useCallback(() => {
    setIsActive(false)
    setSecondsRemaining(preset)
  }, [preset])

  const addTime = useCallback((extraSeconds = 300) => {
    setSecondsRemaining(s => s + extraSeconds)
  }, [])

  const selectPreset = useCallback((p) => {
    setPreset(p.seconds)
    setSecondsRemaining(p.seconds)
    setIsActive(false)
  }, [])

  return (
    <article className={`bento-timer-card${isActive ? ' is-running' : ''}`} aria-label="Focus timer">
      <header className="bento-card-header">
        <div className="bento-timer-title-wrap">
          <span className="bento-pulse-dot" aria-hidden="true" />
          <span className="bento-badge">Focus Timer</span>
        </div>
        <div className="bento-timer-presets" role="radiogroup" aria-label="Timer presets">
          {PRESETS.map(p => (
            <button
              key={p.label}
              type="button"
              className={`bento-preset-btn${preset === p.seconds ? ' is-active' : ''}`}
              onClick={() => selectPreset(p)}
              disabled={isActive}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="bento-timer-body">
        <time className="bento-timer-digits" dateTime={`PT${secondsRemaining}S`}>
          {formatTimer(secondsRemaining)}
        </time>

        <div className="bento-timer-controls">
          <button
            type="button"
            className="bento-timer-play-btn"
            onClick={toggle}
            aria-label={isActive ? 'Pause timer' : 'Start timer'}
          >
            <Icon name={isActive ? 'pause' : 'play'} size={22} />
            <span>{isActive ? 'Pause' : 'Start'}</span>
          </button>

          <button
            type="button"
            className="bento-timer-secondary-btn"
            onClick={() => addTime(300)}
            title="Add 5 minutes"
            aria-label="Add 5 minutes"
          >
            +5m
          </button>

          <button
            type="button"
            className="bento-timer-secondary-btn"
            onClick={reset}
            title="Reset timer"
            aria-label="Reset timer"
          >
            <Icon name="refresh" size={16} />
          </button>
        </div>
      </div>
    </article>
  )
}
