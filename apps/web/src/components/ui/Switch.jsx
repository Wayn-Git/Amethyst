/** A real switch with support for colored states. */

export default function Switch({ on, onChange, label, disabled = false, tone = 'default', className = '' }) {
  const toneClass = tone && tone !== 'default' ? ` switch--${tone}` : ''
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`switch${toneClass}${on ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => onChange?.(!on)}
    >
      <span className="switch-knob" />
    </button>
  )
}
