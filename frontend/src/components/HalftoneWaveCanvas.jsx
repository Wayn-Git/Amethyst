import { useRef, useEffect } from 'react'

/**
 * HalftoneWaveCanvas
 * Renders an organic 3D halftone stipple wave on an HTML5 canvas.
 * Directly recreates the high-density dot matrix wave art from the onboarding screenshot.
 *
 * Honors:
 * - Aesthetic-Usability Effect: Evocative generative art increases perceived system polish
 * - Doherty Threshold: Highly optimized 60fps canvas loop with requestAnimationFrame
 * - Accessibility & Reduced Motion: Freezes on a beautiful static frame if prefers-reduced-motion is active
 */
export default function HalftoneWaveCanvas({
  className = '',
  dotSpacing = 10,
  maxDotRadius = 4.8,
  minDotRadius = 0.6,
  themeAccent = null,
  monochrome = true,
  interactive = true,
}) {
  const canvasRef = useRef(null)
  const animFrameRef = useRef(null)
  const mouseRef = useRef({ x: -1000, y: -1000, active: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let dpr = window.devicePixelRatio || 1
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    let startTime = performance.now()

    const renderFrame = (now) => {
      if (!ctx || width === 0 || height === 0) return

      const time = prefersReduced ? 1.5 : (now - startTime) * 0.00065
      ctx.clearRect(0, 0, width, height)

      // Background fill is pure clean canvas
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      const cols = Math.ceil(width / dotSpacing) + 2
      const rows = Math.ceil(height / dotSpacing) + 2

      const mx = mouseRef.current.x
      const my = mouseRef.current.y
      const hasMouse = mouseRef.current.active && interactive

      ctx.fillStyle = monochrome ? '#0a0a0c' : (themeAccent || '#18181b')

      // Grid loop over canvas with organic wave deformation
      for (let r = -1; r < rows; r++) {
        for (let c = -1; c < cols; c++) {
          const x = c * dotSpacing
          const y = r * dotSpacing

          // Normalized coordinates centered on the wave crest
          const nx = (x - width * 0.58) / (width * 0.45)
          const ny = (y - height * 0.42) / (height * 0.45)

          // 3D topographical contour function
          const wave1 = Math.sin(nx * 2.8 + ny * 1.9 + time * 0.6)
          const wave2 = Math.cos(nx * 1.7 - ny * 2.6 + time * 0.45)
          const radial = Math.sin(Math.sqrt(nx * nx + ny * ny) * 3.4 - time * 0.5)

          let mouseDisp = 0
          if (hasMouse) {
            const dist = Math.hypot(x - mx, y - my)
            if (dist < 140) {
              mouseDisp = Math.sin(dist * 0.06 - time * 3) * (1 - dist / 140) * 0.5
            }
          }

          // Composite elevation [0..1]
          let elevation = (wave1 * 0.42 + wave2 * 0.36 + radial * 0.22 + mouseDisp + 1) * 0.5
          elevation = Math.max(0, Math.min(1, elevation))

          // Sharp density cutoff for the organic topographic silhouette
          // Points at the crest get large dots; valleys taper off
          const curved = Math.pow(elevation, 2.4)
          const radius = minDotRadius + curved * (maxDotRadius - minDotRadius)

          // Don't render ultra-faint dots to preserve clean whitespace
          if (radius < 0.8) continue

          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      if (!prefersReduced) {
        animFrameRef.current = requestAnimationFrame(renderFrame)
      }
    }

    renderFrame(performance.now())

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        active: true,
      }
    }

    const handleMouseLeave = () => {
      mouseRef.current.active = false
    }

    if (interactive && !prefersReduced) {
      canvas.addEventListener('mousemove', handleMouseMove, { passive: true })
      canvas.addEventListener('mouseleave', handleMouseLeave, { passive: true })
    }

    return () => {
      ro.disconnect()
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      if (interactive && !prefersReduced) {
        canvas.removeEventListener('mousemove', handleMouseMove)
        canvas.removeEventListener('mouseleave', handleMouseLeave)
      }
    }
  }, [dotSpacing, maxDotRadius, minDotRadius, monochrome, themeAccent, interactive])

  return (
    <div
      className={`halftone-wave-container ${className}`}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#ffffff',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
      {/* Subtle vignette/fade edge overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          boxShadow: 'inset 0 0 40px rgba(0, 0, 0, 0.04)',
        }}
      />
    </div>
  )
}
