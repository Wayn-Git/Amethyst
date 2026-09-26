/* The AMETHYST logo lockup.
 *
   The mark is fixed purple on a transparent ground, which disappears on the
   dark surfaces this interface uses. It gets a white chip so it reads in both
   themes; `size` is the chip, the glyph sits at ~64% of it. */

export default function BrandMark({ size = 24, variant = 'orange', className = '', glow = false, ...rest }) {
  const isOrange = variant === 'orange'
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
        borderRadius: Math.max(6, Math.round(size * 0.28)),
        background: isOrange 
          ? 'linear-gradient(135deg, #ff6622 0%, #e63e00 100%)' 
          : 'rgba(255, 255, 255, 0.08)',
        boxShadow: isOrange
          ? '0 2px 8px rgba(230, 62, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)'
          : (glow 
              ? '0 0 12px 2px rgba(168, 85, 247, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.1)' 
              : 'inset 0 1px 1px rgba(255, 255, 255, 0.08)'),
        border: isOrange ? '1px solid rgba(255, 255, 255, 0.2)' : '1px solid rgba(255, 255, 255, 0.12)',
      }}
      aria-hidden="true"
      {...rest}
    >
      <img
        src="/logo.svg"
        alt=""
        draggable="false"
        style={{
          width: '68%',
          height: '68%',
          objectFit: 'contain',
          display: 'block',
          filter: isOrange
            ? 'brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2))'
            : (glow ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' : 'none'),
        }}
      />
    </span>
  )
}