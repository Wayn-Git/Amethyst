/* The AMETHYST logo lockup.
 *
   The mark is fixed purple on a transparent ground, which disappears on the
   dark surfaces this interface uses. It gets a white chip so it reads in both
   themes; `size` is the chip, the glyph sits at ~64% of it. */

export default function BrandMark({ size = 22, className = '', ...rest }) {
  return (
    <span
      className={`brand-mark ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
      {...rest}
    >
      <img src="/logo.svg" alt="" draggable="false" />
    </span>
  )
}