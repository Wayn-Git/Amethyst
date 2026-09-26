/* The AMETHYST logo lockup.
 *
   The mark is fixed purple on a transparent ground, which disappears on the
   dark surfaces this interface uses. It gets a white chip so it reads in both
   themes; `size` is the chip, the glyph sits at ~64% of it. */

export default function BrandMark({ size = 22, className = '', glow = false, variant = 'amethyst', ...rest }) {
  if (variant === 'orange' || variant === 'vibe') {
    return (
      <svg
        viewBox="0 0 7 5"
        width={Math.round(size * (7 / 5))}
        height={size}
        fill="#f44e0f"
        className={`brand-mark brand-mark--orange ${className}`.trim()}
        aria-label="Brand Mark"
        {...rest}
      >
        <rect x="1" y="0" width="1" height="1" />
        <rect x="5" y="0" width="1" height="1" />
        <rect x="1" y="1" width="2" height="1" />
        <rect x="4" y="1" width="2" height="1" />
        <rect x="1" y="2" width="5" height="1" />
        <rect x="1" y="3" width="1" height="1" />
        <rect x="3" y="3" width="1" height="1" />
        <rect x="5" y="3" width="1" height="1" />
        <rect x="0" y="4" width="3" height="1" />
        <rect x="4" y="4" width="3" height="1" />
      </svg>
    )
  }

  return (
    <span
      className={`brand-mark ${className} ${glow ? 'is-glowing' : ''}`.trim()}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        borderRadius: size * 0.25,
        background: '#ffffff',
        boxShadow: glow 
          ? '0 0 12px 2px rgba(168, 85, 247, 0.4), inset 0 1px 1px rgba(0, 0, 0, 0.1)' 
          : 'inset 0 1px 1px rgba(0, 0, 0, 0.1)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
      aria-hidden="true"
      {...rest}
    >
      <img
        src="/logo.svg"
        alt=""
        draggable="false"
        style={{
          width: '70%',
          height: '70%',
          objectFit: 'contain',
          display: 'block',
          filter: glow ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' : 'none',
        }}
      />
    </span>
  )
}