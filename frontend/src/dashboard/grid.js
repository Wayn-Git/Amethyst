export const GRID_GEOMETRY = Object.freeze({ cellWidth: 170, rowHeight: 170, gap: 16, insetX: 0, insetY: 0 })
export const GRID_FOOTPRINTS = Object.freeze({ s: [1, 1], m: [2, 1], l: [2, 2], wide: [2, 1], tall: [1, 2] })

const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000

export function footprint(size) {
  const [w, h] = GRID_FOOTPRINTS[size] || []
  return w ? { w, h } : null
}

export function collides(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function validateLayout(widgets) {
  if (!Array.isArray(widgets)) return false
  const ids = new Set()
  for (let i = 0; i < widgets.length; i += 1) {
    const item = widgets[i], expected = footprint(item?.size)
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !expected) return false
    ids.add(item.id)
    if (![item.x, item.y, item.w, item.h].every(integer) || item.w < 1 || item.h < 1 || item.w !== expected.w || item.h !== expected.h) return false
    for (let j = 0; j < i; j += 1) if (collides(item, widgets[j])) return false
  }
  return true
}

export function gridPosition(item, geometry = GRID_GEOMETRY) {
  return {
    left: geometry.insetX + item.x * (geometry.cellWidth + geometry.gap),
    top: geometry.insetY + item.y * (geometry.rowHeight + geometry.gap),
    width: item.w * geometry.cellWidth + (item.w - 1) * geometry.gap,
    height: item.h * geometry.rowHeight + (item.h - 1) * geometry.gap,
  }
}

export function gridSize(size, geometry = GRID_GEOMETRY) {
  const dimensions = footprint(size)
  if (!dimensions) return null
  const { width, height } = gridPosition({ x: 0, y: 0, ...dimensions }, geometry)
  return { width, height }
}

export function gridCellAt(point, geometry = GRID_GEOMETRY) {
  const x = Math.max(0, Math.floor((point.x - geometry.insetX) / (geometry.cellWidth + geometry.gap)))
  const y = Math.max(0, Math.floor((point.y - geometry.insetY) / (geometry.rowHeight + geometry.gap)))
  return { x, y }
}

export function findNearestPosition(widgets, item, origin = item) {
  const occupied = widgets.filter(other => other.id !== item.id)
  const maxRadius = (occupied.length + 2) * 2 + item.w + item.h
  for (let distance = 0; distance <= maxRadius; distance += 1) {
    const candidates = []
    for (let dy = -distance; dy <= distance; dy += 1) {
      const dx = distance - Math.abs(dy), y = origin.y + dy
      if (y < 0) continue
      if (integer(origin.x + dx) && integer(y)) candidates.push({ x: origin.x + dx, y })
      if (dx && integer(origin.x - dx) && integer(y)) candidates.push({ x: origin.x - dx, y })
    }
    candidates.sort((a, b) => a.y - b.y || a.x - b.x)
    for (const position of candidates) {
      const candidate = { ...item, ...position }
      if (occupied.every(other => !collides(candidate, other))) return position
    }
  }
  return null
}

function placementOrder(a, b) { return a.y - b.y || a.x - b.x || a.id.localeCompare(b.id) }

// The active widget wins; widgets displaced by it are restored in stable source order.
export function placeWidget(widgets, id, patch) {
  const active = widgets.find(item => item.id === id)
  if (!active || !patch || ![patch.x ?? active.x, patch.y ?? active.y].every(integer)) return null
  const size = patch.size || active.size, sizeFootprint = footprint(size)
  if (!sizeFootprint) return null
  const proposed = { ...active, ...patch, ...sizeFootprint, size, id: active.id }
  if (active.x === proposed.x && active.y === proposed.y && active.size === proposed.size) return widgets
  const others = widgets.filter(item => item.id !== id)
  const displaced = others.filter(item => collides(proposed, item))
  const kept = others.filter(item => !displaced.includes(item))
  const placed = [proposed, ...kept]
  for (const item of displaced.sort(placementOrder)) {
    const position = findNearestPosition(placed, item, item)
    if (!position) return null
    placed.push({ ...item, ...position })
  }
  const result = placed.sort((a, b) => widgets.findIndex(item => item.id === a.id) - widgets.findIndex(item => item.id === b.id))
  return validateLayout(result) ? result : null
}

export const moveGridWidget = (widgets, id, x, y) => placeWidget(widgets, id, { x, y })
export const resizeGridWidget = (widgets, id, size) => placeWidget(widgets, id, { size })
export const removeGridWidget = (widgets, id) => widgets.some(item => item.id === id) ? widgets.filter(item => item.id !== id) : widgets

export function insertGridWidget(widgets, item, origin = { x: 0, y: 0 }) {
  if (!item || widgets.some(existing => existing.id === item.id)) return null
  const dimensions = footprint(item.size)
  if (!dimensions || !integer(origin.x) || !integer(origin.y)) return null
  const candidate = { ...item, ...dimensions, ...origin }
  const position = findNearestPosition(widgets, candidate, origin)
  if (!position) return null
  const result = [...widgets, { ...candidate, ...position }]
  return validateLayout(result) ? result : null
}

export function normalizeLayout(layout) {
  const source = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : { widgets: [] }
  const widgets = Array.isArray(source.widgets) ? source.widgets : []
  const explicit = widgets.every(item => item && integer(item.x) && integer(item.y) && footprint(item.size))
  if (explicit && widgets.every(item => {
    const size = footprint(item.size)
    return item.w === size.w && item.h === size.h
  }) && validateLayout(widgets)) return source

  const placed = []
  const ordered = [...widgets].sort((a, b) => {
    const hasA = integer(a?.x) && integer(a?.y), hasB = integer(b?.x) && integer(b?.y)
    if (hasA !== hasB) return hasA ? -1 : 1
    return hasA ? a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)) : widgets.indexOf(a) - widgets.indexOf(b)
  })
  for (const old of ordered) {
    const size = footprint(old?.size) ? old.size : 'm'
    const dimensions = footprint(size)
    const item = { ...old, size, ...dimensions }
    const origin = integer(old?.x) && integer(old?.y) ? { x: old.x, y: old.y } : { x: 0, y: 0 }
    const position = findNearestPosition(placed, item, origin)
    if (!position) return { ...source, widgets }
    placed.push({ ...item, ...position })
  }
  return { ...source, widgets: widgets.map(item => placed.find(value => value.id === item.id)) }
}
