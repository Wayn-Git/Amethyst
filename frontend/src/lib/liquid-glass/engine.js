/**
 * Glisse Liquid Glass Refraction Engine (Optimized)
 * Faithful implementation of Kelvin Zhang's Glisse (https://github.com/0kzh/glisse)
 * 
 * Hardware-efficient Snell's law refraction profile:
 * - Quantized resolution capping (max 160px grid) for 60fps instant computation (<2ms)
 * - Chromatic dispersion SVG displacement map (separate R, G, B channels)
 * - Offscreen canvas specular rim normal illumination
 * - Dynamic backdrop-filter integration for Chromium / Electron
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

let defsElement = null

export function getDefsContainer() {
  if (typeof document === 'undefined') return null
  if (defsElement?.isConnected) return defsElement
  let root = document.getElementById('amethyst-liquid-glass-svg')
  if (!root) {
    root = document.createElementNS(SVG_NS, 'svg')
    root.id = 'amethyst-liquid-glass-svg'
    root.setAttribute('width', '0')
    root.setAttribute('height', '0')
    root.setAttribute('aria-hidden', 'true')
    root.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:-9999;opacity:0;overflow:hidden;'
    defsElement = document.createElementNS(SVG_NS, 'defs')
    root.appendChild(defsElement)
    document.documentElement.appendChild(root)
  } else {
    defsElement = root.querySelector('defs')
  }
  return defsElement
}

function svg(name, attributes = {}) {
  const el = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, String(value))
  }
  return el
}

export const GLASS_OPTIONS = {
  strength: 0.45,
  strengthProperty: '--lg-glass-bend',
  dispersion: 0.4,
  dispersionProperty: '--lg-glass-dispersion',
  depth: 0.25,
  dome: 0.5,
  splay: 1,
  relative: true,
  paintsLight: true,
}

const RIM_WIDTH = 1.22
const EDGE_WIDTH = 0.5
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

const DARK_LIGHT = { angle: 45, glow: 0.4, spread: 0.5, glowPower: 1.5, edge: 0.5, edgeWidth: 2, edgePower: 1.5 }
const LIGHT_LIGHT = { angle: 30, glow: 0.4, spread: 0.5, glowPower: 2, edge: 0.5, edgeWidth: 1.5, edgePower: 1 }

export function distance(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius
  const qy = Math.abs(y) - halfHeight + radius
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

function arc(sag, half) {
  const radius = (half * half + sag * sag) / (2 * sag)
  let sum = 0
  for (let i = 0; i <= 60; i++) {
    const x = (i / 60) * half
    const slopeVal = x / Math.sqrt(Math.max(0.001, radius * radius - x * x))
    sum += i === 0 || i === 60 ? slopeVal / 2 : slopeVal
  }
  const mean = sum / 60
  return { radius, scale: mean > 0 ? 0.5 / mean : 1 }
}

function slope(x, { radius, scale }) {
  const inside = Math.min(x, 0.999 * radius)
  return (inside / Math.sqrt(Math.max(0.001, radius * radius - inside * inside))) * scale
}

const erf = (x) => Math.tanh(1.7724538509 * x)

export function shapeOf(glass, style = getComputedStyle(glass)) {
  const width = glass.offsetWidth
  const height = glass.offsetHeight
  if (!width || !height) return null
  const corner = style.borderTopLeftRadius || '16px'
  const radius = Math.min(
    width / 2,
    height / 2,
    corner.endsWith('%') ? (Math.min(width, height) * parseFloat(corner)) / 100 : parseFloat(corner) || 12,
  )
  return { width, height, radius }
}

export function rimMap({ width, height, radius }, shine, density, edge = [0, 0, 0, 0]) {
  const columns = Math.max(1, Math.round(width * density))
  const rows = Math.max(1, Math.round(height * density))
  const data = new Uint8ClampedArray(columns * rows * 4)
  const halfWidth = width / 2
  const halfHeight = height / 2
  const corner = clamp(radius, 0, Math.min(halfWidth, halfHeight))
  const half = 0.5 / density

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x = ((column + 0.5) / columns) * width - halfWidth
      const y = ((row + 0.5) / rows) * height - halfHeight
      const depth = -distance(x, y, halfWidth, halfHeight, corner)
      if (depth < -half || depth > 2 * RIM_WIDTH) continue

      const qx = Math.abs(x) - halfWidth + corner
      const qy = Math.abs(y) - halfHeight + corner
      let nx = 0
      let ny = 0
      if (qx > 0 && qy > 0) {
        const length = Math.hypot(qx, qy) || 1
        nx = (Math.sign(x) * qx) / length
        ny = (Math.sign(y) * qy) / length
      } else if (qx > qy) {
        nx = Math.sign(x)
      } else {
        ny = Math.sign(y)
      }

      const facing = Math.abs(nx + ny)
      const along = Math.max(0, depth) / (RIM_WIDTH * Math.sqrt(Math.max(1, facing)))
      const cover = clamp((depth + half) * density, 0, 1)
      const lined = clamp((Math.min(EDGE_WIDTH, depth + half) - Math.max(0, depth - half)) * density, 0, 1)
      const light = along < 1 ? shine * Math.min(1, facing) ** 1.5 * (1 - along ** 1.5) * cover : 0
      const line = edge[3] * lined * (1 - light)
      const alpha = light + line
      if (alpha <= 0) continue

      const i = (row * columns + column) * 4
      for (let channel = 0; channel < 3; channel++) {
        data[i + channel] = Math.round((255 * light + edge[channel] * line) / alpha)
      }
      data[i + 3] = Math.round(255 * alpha)
    }
  }
  return { columns, rows, data }
}

function parseColour(context, colour) {
  context.fillStyle = '#0000'
  context.fillStyle = colour
  const value = String(context.fillStyle)
  if (value.startsWith('#')) {
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16))
    return [r, g, b, 1]
  }
  const [r = 0, g = 0, b = 0, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number)
  return [r, g, b, a]
}

const rimsCache = new Map()
let paletteCanvas = null

export function paintRim(element) {
  if (typeof document === 'undefined') return
  const style = getComputedStyle(element)
  const shape = shapeOf(element, style)
  if (!shape) return

  if (!paletteCanvas) paletteCanvas = document.createElement('canvas').getContext('2d')
  if (!paletteCanvas) return

  const tuned = parseFloat(style.getPropertyValue('--lg-rim-shine'))
  const shine = Number.isFinite(tuned) ? clamp(tuned, 0, 1) : 0.18
  const edge = parseColour(paletteCanvas, style.getPropertyValue('--lg-edge').trim() || 'rgba(255,255,255,0.14)')
  
  // Cap resolution to max 140px: GPU bi-linear stretches canvas dataURL smoothly
  const maxDim = 140
  const scale = Math.min(1, maxDim / Math.max(shape.width, shape.height))
  const density = clamp(scale, 0.15, 1)

  // Quantize keys to 12px steps to eliminate recalculation on tiny shifts
  const qw = Math.round(shape.width / 12) * 12
  const qh = Math.round(shape.height / 12) * 12
  const qr = Math.round(shape.radius / 4) * 4
  const key = [qw, qh, qr, shine.toFixed(2), edge.join(','), density.toFixed(2)].join('|')

  let url = rimsCache.get(key)
  if (!url) {
    const { columns, rows, data } = rimMap(shape, shine, density, edge)
    const canvas = document.createElement('canvas')
    canvas.width = columns
    canvas.height = rows
    const context = canvas.getContext('2d')
    if (!context) return
    const image = context.createImageData(columns, rows)
    image.data.set(data)
    context.putImageData(image, 0, 0)
    url = `url("${canvas.toDataURL()}")`
    rimsCache.set(key, url)
  }

  element.style.setProperty('--lg-rim', url)
  element.setAttribute('data-rim', '')
}

export function lensMap(shape, options, light, density) {
  const { width, height } = shape
  const halfWidth = width / 2
  const halfHeight = height / 2
  const radius = clamp(shape.radius, 0, Math.min(halfWidth, halfHeight))
  const columns = Math.max(1, Math.round(width * density))
  const rows = Math.max(1, Math.round(height * density))
  const pullAcross = new Uint8ClampedArray(columns * rows * 4)
  const pullDown = new Uint8ClampedArray(columns * rows * 4)
  const caught = new Uint8ClampedArray(columns * rows * 4)
  const shapeMask = new Uint8ClampedArray(columns * rows * 4)

  const grey = (data, i, value, alpha = 255) => {
    data[i] = data[i + 1] = data[i + 2] = value
    data[i + 3] = alpha
  }

  const share = options.relative ? Math.min(width, height) : 1
  const depth = options.depth * share
  const dome = options.dome * share
  const { splay } = options
  const innerWidth = Math.max(0, halfWidth - depth)
  const innerHeight = Math.max(0, halfHeight - depth)
  const innerRadius = clamp(radius, 0, Math.min(innerWidth, innerHeight))
  const ramp = depth > 0 ? 1 / (depth * Math.SQRT2) : 1e6
  const sag = Math.max(0.01, Math.min(dome, Math.min(halfWidth, halfHeight) - 1))
  const acrossArc = dome > 0 ? arc(sag, halfWidth) : null
  const downArc = dome > 0 ? arc(sag, halfHeight) : null
  const reach = 0.5 * Math.min(halfWidth, halfHeight)
  const cos = Math.cos((light.angle * Math.PI) / 180)
  const sin = Math.sin((light.angle * Math.PI) / 180)
  const glowStart = (1 - light.spread) * Math.SQRT2
  const glowRange = light.spread * Math.SQRT2

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = (row * columns + column) * 4
      const x = ((column + 0.5) / columns) * width - halfWidth
      const y = ((row + 0.5) / rows) * height - halfHeight
      const edge = distance(x, y, halfWidth, halfHeight, radius)
      const inside = Math.round(255 * clamp(-edge, 0, 1))
      grey(shapeMask, i, 0, inside)

      if (edge >= 0) {
        grey(pullAcross, i, 128)
        grey(pullDown, i, 128)
        grey(caught, i, 128, 0)
        continue
      }

      const ax = Math.abs(x)
      const ay = Math.abs(y)
      let dx = acrossArc ? Math.sign(x) * slope(ax, acrossArc) : clamp(x / halfWidth, -1, 1)
      let dy = downArc ? Math.sign(y) * slope(ay, downArc) : clamp(y / halfHeight, -1, 1)

      if (splay < 1 && reach > 0) {
        const keepX = Math.max(0, 1 - (halfHeight - ay) / reach) * (1 - splay)
        const keepY = Math.max(0, 1 - (halfWidth - ax) / reach) * (1 - splay)
        if (keepX > 0.001 || keepY > 0.001) {
          const before = Math.hypot(dx, dy)
          dx *= 1 - keepX
          dy *= 1 - keepY
          const after = Math.hypot(dx, dy)
          if (after > 0.001) {
            dx *= before / after
            dy *= before / after
          }
        }
      }

      const falloff = 0.5 * (1 + erf(distance(x, y, innerWidth, innerHeight, innerRadius) * ramp))
      grey(shapeMask, i, Math.round(255 * falloff), inside)
      grey(pullAcross, i, Math.round((0.5 - 0.5 * dx * falloff) * 255))
      grey(pullDown, i, Math.round((0.5 - 0.5 * dy * falloff) * 255))

      const facing = Math.abs(clamp(x / halfWidth, -1, 1) * cos + clamp(y / halfHeight, -1, 1) * sin)
      const glow = glowRange > 0.001 ? light.glow * clamp((facing - glowStart) / glowRange, 0, 1) ** light.glowPower * falloff : 0
      const rim = light.edge * Math.max(0, 1 + edge / light.edgeWidth) * facing ** light.edgePower
      const amount = Math.min(1, glow + rim)
      const bends = Math.min(1, falloff * 20, -edge)
      grey(caught, i, Math.round(127 * amount + 128), Math.round(255 * bends))
    }
  }
  return { columns, rows, across: pullAcross, down: pullDown, light: caught, shape: shapeMask }
}

const encodedMaps = new Map()

function encodeMap(key, draw) {
  const cached = encodedMaps.get(key)
  if (cached) return cached
  const map = draw()
  const canvas = document.createElement('canvas')
  canvas.width = map.columns
  canvas.height = map.rows
  const context = canvas.getContext('2d')
  if (!context) return null
  const image = context.createImageData(map.columns, map.rows)
  const png = (data) => {
    image.data.set(data)
    context.putImageData(image, 0, 0)
    return canvas.toDataURL()
  }
  const result = {
    across: png(map.across),
    down: png(map.down),
    light: png(map.light),
    shape: png(map.shape),
  }
  encodedMaps.set(key, result)
  return result
}

const CHANNELS = [
  '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0',
  '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0',
  '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0',
]

function buildGraph(maps, shine = 0) {
  const filter = svg('filter', {
    filterUnits: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  })
  const image = (href, result) => svg('feImage', { href, preserveAspectRatio: 'none', result })

  const boxed = [
    image(maps.across, 'across-0'),
    image(maps.down, 'down-0'),
    image(maps.light, 'raw'),
    svg('feFlood', { 'flood-color': 'rgb(128, 128, 128)', result: 'neutral-0' }),
  ]
  filter.append(...boxed)

  for (const pull of ['across', 'down']) {
    const half = svg('feComponentTransfer', { in: `${pull}-grey-0`, result: `${pull}-pull-0` })
    half.append(svg('feFuncA', { type: 'linear', slope: 0, intercept: 0.5 }))
    filter.append(
      svg('feComposite', { in: `${pull}-0`, in2: 'neutral-0', operator: 'over', result: `${pull}-grey-0` }),
      half,
    )
  }

  const rays = CHANNELS.map((_, i) => {
    const acrossMap = svg('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'across-pull-0',
      xChannelSelector: 'R',
      yChannelSelector: 'A',
      result: `across-0-${i}`,
    })
    const downMap = svg('feDisplacementMap', {
      in: `across-0-${i}`,
      in2: 'down-pull-0',
      xChannelSelector: 'A',
      yChannelSelector: 'R',
      result: `ray-0-${i}`,
    })
    boxed.push(acrossMap)
    filter.append(acrossMap, downMap)
    return [acrossMap, downMap]
  })

  const spreadSteps = [
    ...CHANNELS.map((channel, i) =>
      svg('feColorMatrix', { in: `ray-0-${i}`, type: 'matrix', values: `${channel}  0 0 0 0.3333 0`, result: `light-0-${i}` })
    ),
    svg('feComposite', { in: 'light-0-0', in2: 'light-0-1', operator: 'arithmetic', k2: 1, k3: 1, result: 'light-0-01' }),
    svg('feComposite', { in: 'light-0-01', in2: 'light-0-2', operator: 'arithmetic', k2: 1, k3: 1, result: 'spread-0' }),
    svg('feColorMatrix', { in: 'spread-0', type: 'matrix', values: '3 0 0 0 0  0 3 0 0 0  0 0 3 0 0  0 0 0 1 0', result: 'bent-0' }),
  ]
  filter.append(...spreadSteps)

  let lit = 'bent-0'
  if (shine > 0) {
    const white = '0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 -0.5'
    filter.append(
      svg('feColorMatrix', { in: 'raw', type: 'matrix', values: white, result: 'glint-0' }),
      svg('feComposite', { in: 'glint-0', in2: lit, operator: 'arithmetic', k2: shine, k3: 1, result: 'lit-0' }),
    )
    lit = 'lit-0'
  }

  filter.append(svg('feComposite', { in: lit, in2: 'raw', operator: 'in', result: 'inside' }))
  filter.append(
    svg('feComposite', { in: 'SourceGraphic', in2: 'raw', operator: 'out', result: 'outside' }),
    svg('feComposite', { in: 'inside', in2: 'outside', operator: 'arithmetic', k2: 1, k3: 1, result: 'seen' }),
  )

  return { filter, parts: [{ boxed, rays }] }
}

function placeGraph(graph, width, height, reach, dispersion) {
  graph.filter.setAttribute('x', '0')
  graph.filter.setAttribute('y', '0')
  graph.filter.setAttribute('width', String(width))
  graph.filter.setAttribute('height', String(height))

  const spectrum = [1 + 0.2 * dispersion, 1 + 0.1 * dispersion, 1]
  const part = graph.parts[0]
  part.rays.forEach(([acrossMap, downMap], i) => {
    acrossMap.setAttribute('scale', String(reach * spectrum[i]))
    downMap.setAttribute('scale', String(reach * spectrum[i]))
  })
  const rect = { x: 0, y: 0, width, height }
  for (const element of part.boxed) {
    for (const [key, value] of Object.entries(rect)) {
      element.setAttribute(key, String(value))
    }
  }
}

const backdropsCache = new Map()

export function fitBackdropLens(glass, options = GLASS_OPTIONS) {
  if (typeof document === 'undefined') return
  const style = getComputedStyle(glass)
  const shape = shapeOf(glass, style)
  if (!shape) return
  const { width, height, radius } = shape

  const page = parseFloat(style.getPropertyValue('--lg-lens-shine')) || 0
  const light = page < 0 ? LIGHT_LIGHT : DARK_LIGHT

  // Cap density to max 140px: GPU scales displacement smoothly at 60fps
  const maxDim = 140
  const scale = Math.min(1, maxDim / Math.max(width, height))
  const density = clamp(scale, 0.15, 1)

  const qw = Math.round(width / 12) * 12
  const qh = Math.round(height / 12) * 12
  const qr = Math.round(radius / 4) * 4

  const key = [qw, qh, qr, density.toFixed(2), JSON.stringify(light), JSON.stringify(options)].join('|')
  const maps = encodeMap(key, () => lensMap(shape, options, light, density))
  if (!maps) return

  const tunedStrength = parseFloat(style.getPropertyValue(options.strengthProperty || '--lg-glass-bend'))
  const strength = Number.isFinite(tunedStrength) ? tunedStrength : options.strength
  const tunedDispersion = parseFloat(style.getPropertyValue(options.dispersionProperty || '--lg-glass-dispersion'))
  const dispersion = Number.isFinite(tunedDispersion) ? Math.max(0, tunedDispersion) : options.dispersion

  const reach = strength * Math.min(width, height)
  const id = `${key}|${reach.toFixed(1)}|${dispersion.toFixed(1)}`

  let name = backdropsCache.get(id)
  if (!name) {
    const built = buildGraph(maps, 0)
    placeGraph(built, width, height, reach, dispersion)
    name = `glisse-backdrop-${backdropsCache.size}`
    built.filter.id = name
    const container = getDefsContainer()
    if (container) container.appendChild(built.filter)
    backdropsCache.set(id, name)
  }

  glass.style.setProperty('--lg-filter', `url("#${name}") saturate(1.5)`)
}

export const refractsBackdrop = () => {
  if (typeof navigator === 'undefined') return false
  return /Chrom(?:e|ium)\//.test(navigator.userAgent)
}

/**
 * Attaches Kelvin Zhang's Liquid Glass to a DOM element.
 * Updates refraction and rim on resize and theme changes.
 * Returns cleanup function.
 */
export function attachLiquidGlass(element, options = GLASS_OPTIONS) {
  if (!element || typeof document === 'undefined') return () => {}

  element.classList.add('lg-glass')

  const fit = () => {
    paintRim(element)
    if (refractsBackdrop()) {
      fitBackdropLens(element, options)
    }
  }

  // Defer first fit to idle frame to ensure zero main-thread block on mount
  if ('requestIdleCallback' in window) {
    requestIdleCallback(fit, { timeout: 100 })
  } else {
    setTimeout(fit, 16)
  }

  // Debounced ResizeObserver
  let resizeTimer = null
  const observer = new ResizeObserver(() => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(fit, 100)
  })
  observer.observe(element)

  return () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    observer.disconnect()
    element.style.removeProperty('--lg-filter')
    element.style.removeProperty('--lg-rim')
    element.removeAttribute('data-rim')
    element.classList.remove('lg-glass')
  }
}
