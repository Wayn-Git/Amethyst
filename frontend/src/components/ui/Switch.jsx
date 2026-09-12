/** A real switch, not a text button saying "On".

 * The old control labelled its state with a word, which made every row's
 * most important fact the thing you had to read. A switch carries its state
 * in its shape -- the same way the macOS interfaces this dialog imitates do
 * -- so "is this on" is answered at a glance, from across the panel. */

export default function Switch({ on, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`switch${on ? ' is-on' : ''}`}
      onClick={() => onChange?.(!on)}
    >
      <span className="switch-knob" />
    </button>
  )
}
