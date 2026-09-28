/** A `.btn`, extracted from the class string every button in the app already
 * built by hand. `busy` disables the button and is a separate concern from
 * `disabled` -- a caller can be mid-request without the control being
 * permanently unusable. */
export default function Button({
  variant = 'secondary', size = 'medium', loading = false, pill = false, icon, busy = false, disabled = false, className = '', children, ...rest
}) {
  const cls = [
    'btn',
    variant && `btn--${variant}`,
    `btn--${size}`,
    'ui-button',
    pill && 'btn--pill',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button type="button" className={cls} aria-busy={busy || loading || undefined} data-variant={variant} data-size={size} disabled={disabled || busy || loading} {...rest}>
      {icon}
      {children}
    </button>
  )
}
