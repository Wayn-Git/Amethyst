/* The AMETHYST logo lockup.
 *
   The mark is fixed purple on a transparent ground, which disappears on the
   dark surfaces this interface uses. It gets a white chip so it reads in both
   themes; `size` is the chip, the glyph sits at ~64% of it. */

export default function BrandMark({ size = 22, className = '', glow = false, ...rest }) {
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