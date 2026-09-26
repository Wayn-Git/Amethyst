/* The AMETHYST brand logo mark.
 *
 * Standalone faceted crystal vector in luminous Amethyst purple tones.
 */

export default function BrandMark({ size = 22, className = '', glow = false, chip = false, ...rest }) {
  if (chip) {
    return (
      <span
        className={`brand-mark brand-mark--chip ${className} ${glow ? 'is-glowing' : ''}`.trim()}
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
          borderRadius: Math.max(5, Math.round(size * 0.25)),
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
        aria-hidden="true"
        {...rest}
      >
        <BrandMark size={Math.round(size * 0.7)} glow={glow} />
      </span>
    )
  }

  const gradId = `amethyst-facet-${Math.round(size)}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="524.5 524 560 560"
      width={size}
      height={size}
      className={`brand-mark ${className} ${glow ? 'is-glowing' : ''}`.trim()}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        filter: glow ? 'drop-shadow(0 2px 10px rgba(139, 92, 246, 0.5))' : undefined,
      }}
      aria-label="Amethyst Logo"
      {...rest}
    >
      <defs>
        <linearGradient id={`${gradId}-center`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="60%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id={`${gradId}-left`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#9333ea" />
        </linearGradient>
        <linearGradient id={`${gradId}-right`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7e22ce" />
          <stop offset="100%" stopColor="#581c87" />
        </linearGradient>
      </defs>
      {/* Center Main Crystal Pillar */}
      <path fill={`url(#${gradId}-center)`} d="M804 536L684 651L791 1015L768 1018L644 888L572 889L806 1072L1038 887L968 887L843 1018L819 1015L927 651Z" />
      {/* Right Facet */}
      <path fill={`url(#${gradId}-right)`} d="M1016 701L928 722L847 986L960 870L1039 846Z" />
      {/* Left Facet */}
      <path fill={`url(#${gradId}-left)`} d="M595 701L570 845L651 870L763 985L682 722Z" />
    </svg>
  )
}