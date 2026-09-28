import { useRef, useEffect } from 'react'

/**
 * FlutedGlassGlow
 * Recreates the vertical fluted ribbed glass with warm fiery amber/orange ambient refraction
 * from the first onboarding screenshot (media_1792927836990.jpg).
 */
export default function FlutedGlassGlow({
  className = '',
  quote = '“Amethyst gives you total command of local intelligence and cloud power in one seamless canvas.”',
  author = 'Wayne · Amethyst Architecture',
}) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let dpr = window.devicePixelRatio || 1

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      render()
    }

    const render = () => {
      if (!ctx || width === 0 || height === 0) return

      // Dark background
      ctx.fillStyle = '#0a0808'
      ctx.fillRect(0, 0, width, height)

      // Ambient warm fiery gradient
      const grad = ctx.createLinearGradient(width * 0.1, height * 0.8, width * 0.8, height * 0.2)
      grad.addColorStop(0, '#7c2d12') // deep burnt orange
      grad.addColorStop(0.35, '#c2410c') // vibrant fiery orange
      grad.addColorStop(0.7, '#ea580c') // warm amber
      grad.addColorStop(1, '#180d08')

      ctx.save()
      ctx.globalAlpha = 0.85
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, width, height)
      ctx.restore()

      // Vertical fluted glass ribs simulation
      const ribWidth = 14
      const ribs = Math.ceil(width / ribWidth)

      for (let i = 0; i < ribs; i++) {
        const x = i * ribWidth
        // Fluted shadow on left edge of each rib
        const ribGrad = ctx.createLinearGradient(x, 0, x + ribWidth, 0)
        ribGrad.addColorStop(0, 'rgba(0, 0, 0, 0.45)')
        ribGrad.addColorStop(0.2, 'rgba(0, 0, 0, 0.1)')
        ribGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.12)')
        ribGrad.addColorStop(0.85, 'rgba(255, 255, 255, 0.04)')
        ribGrad.addColorStop(1, 'rgba(0, 0, 0, 0.4)')

        ctx.fillStyle = ribGrad
        ctx.fillRect(x, 0, ribWidth, height)
      }

      // Atmospheric vertical highlights
      ctx.save()
      ctx.filter = 'blur(30px)'
      const glow = ctx.createRadialGradient(width * 0.35, height * 0.65, 10, width * 0.35, height * 0.65, width * 0.7)
      glow.addColorStop(0, 'rgba(251, 146, 60, 0.5)')
      glow.addColorStop(0.5, 'rgba(234, 88, 12, 0.25)')
      glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, width, height)
      ctx.restore()
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    return () => ro.disconnect()
  }, [])

  return (
    <div
      className={`fluted-glass-container ${className}`}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: '#0a0808',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '36px 32px',
        boxSizing: 'border-box',
        color: '#ffffff',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          zIndex: 0,
        }}
      />

      {/* Top Header Logo */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: 'monospace',
            fontSize: 16,
            fontWeight: 700,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 7,
            background: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            backdropFilter: 'blur(8px)',
          }}
        >
          ⌘
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
          Amethyst
        </span>
      </div>

      {/* Bottom Quote from Screenshot 1 */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 380,
        }}
      >
        <p
          style={{
            margin: '0 0 10px',
            fontSize: 14.5,
            lineHeight: 1.55,
            color: 'rgba(255, 255, 255, 0.92)',
            textShadow: '0 1px 4px rgba(0,0,0,0.6)',
            fontStyle: 'normal',
          }}
        >
          {quote}
        </p>
        <span
          style={{
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'rgba(255, 255, 255, 0.65)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          {author}
        </span>
      </div>
    </div>
  )
}
