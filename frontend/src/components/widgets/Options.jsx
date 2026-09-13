import { useState } from 'react'

/* Selectable cards, single or multi.
 *
 * The selection is local and goes nowhere: nothing here calls a model or the
 * API. It exists so a list of choices can be held against each other and marked
 * up while deciding, which is what people were doing in their heads. */

export default function Options({ data }) {
  const multi = data.selection_mode === 'multi'
  const [chosen, setChosen] = useState(() => new Set())

  const toggle = (i) => {
    setChosen((prev) => {
      if (!multi) return new Set(prev.has(i) ? [] : [i])
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="widget widget-options-w">
      <div className="widget-head">
        <span className="widget-count">{multi ? 'Choose any' : 'Choose one'}</span>
      </div>

      {/* A radiogroup and a set of checkboxes are genuinely different controls
          to a screen reader, so the role follows `selection_mode` rather than
          being one generic list with styling on top. */}
      <ul className="widget-cards" role={multi ? 'group' : 'radiogroup'}>
        {(data.options ?? []).map((option, i) => {
          const on = chosen.has(i)
          return (
            <li key={i}>
              <button
                type="button"
                className={`widget-card-option${on ? ' is-on' : ''}`}
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={on}
                onClick={() => toggle(i)}
              >
                <span className={`widget-tick${multi ? ' is-box' : ''}`} aria-hidden="true" />
                <span className="widget-card-text">
                  <strong>{option.title}</strong>
                  {option.description && <span>{option.description}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
