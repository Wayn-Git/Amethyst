import assert from 'node:assert'
import {
  distance,
  rimMap,
  lensMap,
  GLASS_OPTIONS,
} from '../src/lib/liquid-glass/engine.js'
import * as Glisse from 'glisse'

console.log('Testing Glisse Liquid Glass Engine...')

// 1. Verify Glisse package exports
assert.ok(Glisse.Glass, 'Glisse.Glass must be exported')
assert.ok(Glisse.Button, 'Glisse.Button must be exported')
assert.ok(Glisse.SegmentedControl, 'Glisse.SegmentedControl must be exported')
assert.ok(Glisse.Switch, 'Glisse.Switch must be exported')
console.log('PASS  Glisse package exports verified')

// 2. Test signed distance function (distance to rounded rectangle)
const centerDist = distance(0, 0, 100, 50, 10)
assert.ok(centerDist < 0, 'Distance inside rounded rectangle must be negative')
const edgeDist = distance(100, 0, 100, 50, 10)
assert.strictEqual(Math.round(edgeDist), 0, 'Distance on edge must be 0')
const outsideDist = distance(120, 0, 100, 50, 10)
assert.ok(outsideDist > 0, 'Distance outside rounded rectangle must be positive')
console.log('PASS  distance() function is accurate')

// 3. Test rimMap generation
const shape = { width: 200, height: 100, radius: 16 }
const rim = rimMap(shape, 0.3, 1, [255, 255, 255, 0.1])
assert.ok(rim.columns > 0 && rim.rows > 0, 'rimMap must return valid columns and rows')
assert.strictEqual(rim.data.length, rim.columns * rim.rows * 4, 'rimMap data length must equal columns*rows*4')
console.log('PASS  rimMap() produces valid RGBA pixel buffer')

// 4. Test lensMap generation (Snell\'s law displacement buffer)
const light = { angle: 45, glow: 0.4, spread: 0.5, glowPower: 1.5, edge: 0.5, edgeWidth: 2, edgePower: 1.5 }
const lens = lensMap(shape, GLASS_OPTIONS, light, 1)
assert.strictEqual(lens.across.length, lens.columns * lens.rows * 4, 'across pull map must match size')
assert.strictEqual(lens.down.length, lens.columns * lens.rows * 4, 'down pull map must match size')
assert.strictEqual(lens.light.length, lens.columns * lens.rows * 4, 'caught light map must match size')
assert.strictEqual(lens.shape.length, lens.columns * lens.rows * 4, 'shape mask must match size')
console.log('PASS  lensMap() generates across, down, light, and shape buffers')

console.log('\nAll Liquid Glass tests passed successfully!')
