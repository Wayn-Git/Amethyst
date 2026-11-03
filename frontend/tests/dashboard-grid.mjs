import assert from 'node:assert/strict'
import {
  GRID_GEOMETRY, gridCellAt, gridPosition, gridSize, insertGridWidget, moveGridWidget,
  normalizeLayout, removeGridWidget, resizeGridWidget, validateLayout,
} from '../src/dashboard/grid.js'

const legacy = { widgets: [
  { id: 'a', size: 's', height: 250, design: 'clock-sm-01' },
  { id: 'b', size: 'm', height: 3, design: 'media-md-01' },
] }
const normalized = normalizeLayout(legacy)
assert.deepEqual(normalized.widgets.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })), [
  { id: 'a', x: 0, y: 0, w: 1, h: 1 }, { id: 'b', x: 1, y: 0, w: 2, h: 1 },
])
assert.equal(normalized.widgets[0].height, 250)
assert.equal(normalized.widgets[0].design, 'clock-sm-01')
assert.deepEqual(gridPosition(normalized.widgets[1]), { left: 186, top: 0, width: 356, height: 170 })
assert.deepEqual(gridSize('s'), { width: 170, height: 170 })
assert.deepEqual(gridSize('m'), { width: 356, height: 170 })
assert.deepEqual(gridSize('l'), { width: 356, height: 356 })
assert.deepEqual(gridCellAt({ x: 186, y: 186 }), { x: 1, y: 1 })
assert.equal(GRID_GEOMETRY.cellWidth, 170)
assert.equal(validateLayout(normalized.widgets), true)
assert.equal(validateLayout([{ id: 'left', size: 's', x: 0, y: 0, w: 1, h: 1 }, { id: 'right', size: 's', x: 1, y: 0, w: 1, h: 1 }]), true)
assert.equal(validateLayout([{ id: 'left', size: 's', x: 0, y: 0, w: 1, h: 1 }, { id: 'right', size: 's', x: 0, y: 0, w: 1, h: 1 }]), false)
assert.equal(validateLayout([{ id: 'same', size: 's', x: 0, y: 0, w: 1, h: 1 }, { id: 'same', size: 's', x: 1, y: 0, w: 1, h: 1 }]), false)
assert.equal(validateLayout([{ id: 'negative', size: 's', x: -1, y: 0, w: 1, h: 1 }]), false)

const moved = moveGridWidget(normalized.widgets, 'a', 1, 0)
assert.deepEqual(moved.map(({ id, x, y }) => ({ id, x, y })), [{ id: 'a', x: 1, y: 0 }, { id: 'b', x: 2, y: 0 }])
assert.equal(validateLayout(moved), true)
assert.equal(moveGridWidget(moved, 'missing', 0, 0), null)
assert.equal(moveGridWidget(moved, 'a', -1, 0), null)
assert.equal(resizeGridWidget(normalized.widgets, 'a', 'l').some(item => item.id === 'a' && item.w === 2 && item.h === 2), true)

const inserted = insertGridWidget(normalized.widgets, { id: 'c', size: 's', design: 'clock-sm-02' }, { x: 0, y: 0 })
assert.equal(validateLayout(inserted), true)
assert.equal(inserted.find(item => item.id === 'c').design, 'clock-sm-02')
assert.equal(removeGridWidget(inserted, 'c').length, normalized.widgets.length)
assert.equal(insertGridWidget(normalized.widgets, { id: 'a', size: 's' }), null)
for (const [id, size] of [['small', 's'], ['medium', 'm'], ['large', 'l']]) {
  const result = insertGridWidget([], { id, size })
  assert.equal(validateLayout(result), true)
}
const before = JSON.stringify(normalized.widgets)
moveGridWidget(normalized.widgets, 'a', 4, 3)
assert.equal(JSON.stringify(normalized.widgets), before)
let crowded = []
for (let index = 0; index < 32; index += 1) {
  crowded = insertGridWidget(crowded, { id: `widget.${index}`, size: ['s', 'm', 'l'][index % 3] })
  assert.equal(validateLayout(crowded), true)
}

const saved = { widgets: [{ id: 'a', size: 'm', x: 4, y: 2, w: 2, h: 1 }] }
assert.equal(normalizeLayout(saved), saved)
assert.deepEqual(normalizeLayout(saved).widgets[0], saved.widgets[0])
console.log('dashboard-grid: geometry, migration, atomic placement, and stable coordinates verified — ok')
