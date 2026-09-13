import { useState } from 'react'
import StepGuide from './StepGuide.jsx'

/* Ingredients that follow the servings slider.
 *
 * Rescaling is arithmetic on numbers already in the payload, done here rather
 * than by asking the model again -- which is the whole point of extracting
 * `amount` as a number instead of baking "200g" into a string. */

/* Scaled quantities go fractional fast: a third of 1 egg is 0.333333. Two
   decimals, trailing zeros dropped, so 0.33 stays readable and 200 stays 200. */
function pretty(n) {
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n * 100) / 100)
}

export default function Recipe({ data }) {
  const base = Number(data.servings) || 1
  const [servings, setServings] = useState(base)
  const factor = servings / base

  return (
    <div className="widget widget-recipe">
      <label className="widget-servings">
        <span>Servings</span>
        {/* Native range input: a slider is a solved problem and a dependency
            for one would be a bad trade. */}
        <input
          type="range"
          min="1"
          max={Math.max(12, base * 2)}
          step="1"
          value={servings}
          onChange={(e) => setServings(Number(e.target.value))}
        />
        <output>{servings}</output>
      </label>

      <ul className="widget-ingredients">
        {(data.ingredients ?? []).map((ing, i) => (
          <li key={i}>
            <span className="widget-amount">{pretty(ing.amount * factor)} {ing.unit}</span>
            <span className="widget-ingredient">{ing.name}</span>
          </li>
        ))}
      </ul>

      {/* The method is a step guide and behaves like one -- same stepper, same
          timers -- rather than a second implementation of the same thing. */}
      {data.steps?.length ? <StepGuide data={{ steps: data.steps }} label="Method" /> : null}
    </div>
  )
}
