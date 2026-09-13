import { useEffect, useRef, useState } from 'react'
import Button from '../ui/Button.jsx'
import Icon from '../Icon.jsx'

/* One step on screen at a time.
 *
 * The whole reason this is not a numbered list: a list of twelve steps is read
 * by losing your place in it. Showing one, with the count beside it, means the
 * reader's position is the interface's job rather than theirs. */

/* Reset between steps is done by the caller's `key`, not by an effect here:
   a new step is a new timer, and remounting says that in one prop rather than
   in a synchronise-back-to-props effect that runs on every render. */
function Timer({ seconds }) {
  const [left, setLeft] = useState(seconds)
  const [running, setRunning] = useState(false)
  const tick = useRef(null)

  useEffect(() => {
    if (!running) return undefined
    tick.current = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          clearInterval(tick.current)
          setRunning(false)
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(tick.current)
  }, [running])

  const mins = Math.floor(left / 60)
  const secs = String(Math.floor(left % 60)).padStart(2, '0')
  const done = left === 0

  return (
    <div className={`widget-timer${done ? ' is-done' : ''}`}>
      <span className="widget-timer-clock">{mins}:{secs}</span>
      <Button
        size="small"
        variant={running ? 'ghost' : 'primary'}
        onClick={() => (done ? (setLeft(seconds), setRunning(true)) : setRunning((r) => !r))}
      >
        {done ? 'Again' : running ? 'Pause' : 'Start'}
      </Button>
    </div>
  )
}

export default function StepGuide({ data, label }) {
  const steps = data.steps ?? []
  const [at, setAt] = useState(0)
  if (!steps.length) return null

  const step = steps[Math.min(at, steps.length - 1)]
  const last = at >= steps.length - 1

  return (
    <div className="widget widget-steps">
      <div className="widget-head">
        {label ? <h4 className="widget-section">{label}</h4> : <span />}
        <span className="widget-count">{at + 1} / {steps.length}</span>
      </div>

      {/* The progress bar is the only thing that says how much is left, so it
          is a real element rather than a decoration on the heading. */}
      <div
        className="widget-progress"
        role="progressbar"
        aria-valuenow={at + 1}
        aria-valuemin={1}
        aria-valuemax={steps.length}
      >
        <span style={{ width: `${((at + 1) / steps.length) * 100}%` }} />
      </div>

      <div className="widget-step">
        <div className="widget-step-n">{at + 1}</div>
        <div className="widget-step-body">
          <h4>{step.title}</h4>
          <p>{step.text}</p>
          {step.timer_seconds ? <Timer key={at} seconds={step.timer_seconds} /> : null}
        </div>
      </div>

      <div className="widget-nav">
        <Button size="small" variant="ghost" disabled={at === 0} onClick={() => setAt((n) => n - 1)}>
          <Icon name="back" size={13} /> Back
        </Button>
        <Button size="small" disabled={last} onClick={() => setAt((n) => n + 1)}>
          Next <Icon name="chevron" size={13} />
        </Button>
      </div>
    </div>
  )
}
