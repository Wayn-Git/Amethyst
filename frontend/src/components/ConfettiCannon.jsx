/**
 * Lightweight pure canvas confetti cannon with zero external dependencies.
 * Spawns squircle/rectangle confetti particles with physics and removes canvas on completion.
 */

export function triggerConfetti() {
  if (typeof document === 'undefined') return

  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.top = '0'
  canvas.style.left = '0'
  canvas.style.width = '100vw'
  canvas.style.height = '100vh'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = '99999'
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }

  const dpr = window.devicePixelRatio || 1
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  ctx.scale(dpr, dpr)

  const colors = ['#873FFF', '#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#06B6D4']
  const particleCount = 70
  const particles = []

  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: window.innerWidth * (0.4 + Math.random() * 0.2),
      y: window.innerHeight * 0.6,
      w: Math.random() * 8 + 6,
      h: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 16,
      vy: -(Math.random() * 14 + 10),
      rotation: Math.random() * 360,
      vRotation: (Math.random() - 0.5) * 12,
      opacity: 1,
      gravity: 0.45,
    })
  }

  let startTime = performance.now()
  function animate(now) {
    const elapsed = now - startTime
    if (elapsed > 2200) {
      canvas.remove()
      return
    }

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

    for (const p of particles) {
      p.x += p.vx
      p.y += p.vy
      p.vy += p.gravity
      p.vx *= 0.98
      p.rotation += p.vRotation
      p.opacity = Math.max(0, 1 - elapsed / 2200)

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate((p.rotation * Math.PI) / 180)
      ctx.globalAlpha = p.opacity
      ctx.fillStyle = p.color
      // Render subtle squircle rectangle
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }

    requestAnimationFrame(animate)
  }

  requestAnimationFrame(animate)
}
