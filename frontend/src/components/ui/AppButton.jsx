/** A `.btn`, extracted from the class string every button in the app already
 * built by hand. `busy` disables the button and is a separate concern from
 * `disabled` -- a caller can be mid-request without the control being
 * permanently unusable. */
export default function Button({
  variant,
  size,
  loading = false,
  pill = false,
  icon,
  busy = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const classTokens = className ? className.trim().split(/\s+/) : []
  const hasBtnClass = classTokens.some((c) => c === 'btn' || c.startsWith('btn--') || c === 'ui-button')
  const isPlainVariant = variant === 'plain' || variant === 'unstyled' || variant === 'raw'
  const isCustom = isPlainVariant || (Boolean(className) && !hasBtnClass && variant === undefined && size === undefined)

  const resolvedVariant = isCustom
    ? undefined
    : (variant ?? (classTokens.some((c) => c.startsWith('btn--')) ? undefined : 'secondary'))

  const resolvedSize = isCustom
    ? undefined
    : (size ?? (classTokens.some((c) => c.startsWith('btn--sm') || c.startsWith('btn--lg') || c.startsWith('btn--icon')) ? undefined : 'medium'))

  const cls = isCustom
    ? [pill && 'btn--pill', className].filter(Boolean).join(' ')
    : [
        'btn',
        resolvedVariant && `btn--${resolvedVariant}`,
        resolvedSize && `btn--${resolvedSize}`,
        'ui-button',
        pill && 'btn--pill',
        className,
      ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      className={cls}
      aria-busy={busy || loading || undefined}
      data-variant={resolvedVariant}
      data-size={resolvedSize}
      disabled={disabled || busy || loading}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
