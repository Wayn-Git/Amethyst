import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { attachLiquidGlass, GLASS_OPTIONS } from './engine.js'

export {
  Glass,
  Button as GlisseButton,
  SegmentedControl as GlisseSegmentedControl,
  Switch as GlisseSwitch,
  Slider as GlisseSlider,
  TabBar as GlisseTabBar,
  Menu as GlisseMenu,
  SearchField as GlisseSearchField,
  Input as GlisseInput,
} from 'glisse'

export { attachLiquidGlass, paintRim, fitBackdropLens, GLASS_OPTIONS } from './engine.js'
export { useLiquidGlassManager, liquidGlassManager } from './liquidGlassManager.js'

/**
 * Hook to attach Liquid Glass refraction directly to a React ref
 */
export function useLiquidGlass(ref, options = GLASS_OPTIONS) {
  useEffect(() => {
    if (!ref.current) return
    const cleanup = attachLiquidGlass(ref.current, options)
    return () => cleanup()
  }, [ref, options])
}

/**
 * LiquidGlass component
 * Wraps content in Kelvin Zhang's Liquid Glass surface
 */
export const LiquidGlass = forwardRef(function LiquidGlass(
  { className = '', children, options = GLASS_OPTIONS, ...props },
  forwardedRef
) {
  const localRef = useRef(null)
  useImperativeHandle(forwardedRef, () => localRef.current)

  useLiquidGlass(localRef, options)

  return (
    <div
      ref={localRef}
      className={`lg-glass amethyst-liquid-glass ${className}`}
      data-liquid-glass="true"
      {...props}
    >
      {children}
    </div>
  )
})
