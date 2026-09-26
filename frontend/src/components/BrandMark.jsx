/* The AMETHYST logo lockup.
 *
   The mark is fixed purple on a transparent ground, which disappears on the
   dark surfaces this interface uses. It gets a white chip so it reads in both
   themes; `size` is the chip, the glyph sits at ~64% of it. */

export default function BrandMark({ size = 22, className = '', glow = false, raw = false, ...rest }) {
  if (raw) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="524.5 524 560 560"
        width={size}
        height={size}
        className={`brand-mark brand-mark--raw ${className}`.trim()}
        style={{
          display: 'block',
          flexShrink: 0,
          filter: glow ? 'drop-shadow(0 0 14px rgba(135, 63, 255, 0.6))' : undefined,
        }}
        aria-label="Amethyst Logo"
        {...rest}
      >
        <path fill="#873FFF" d="M804 536L684 651L791 1015L768 1018L644 888L572 889L806 1072L1038 887L968 887L843 1018L819 1015L927 651Z" />
        <path fill="#873FFF" d="M1016 701L928 722L847 986L960 870L1039 846Z" />
        <path fill="#873FFF" d="M595 701L570 845L651 870L763 985L682 722Z" />
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