import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SPANS, SYSTEM_WIDGETS, GLANCE_WIDGETS, NEED_WIDGETS } from '../src/dashboard/layout.js'
import { WIDGETS } from '../src/dashboard/registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const homeCssPath = path.resolve(__dirname, '../src/dashboard/home.css')
const cssContent = fs.readFileSync(homeCssPath, 'utf8')

// 1. Check layout spans & constants
assert.deepEqual(SPANS, { s: 3, m: 6, l: 12 })
assert.ok(SYSTEM_WIDGETS.includes('dash.gallery'))
assert.ok(GLANCE_WIDGETS.includes('glance.clock'))
assert.ok(GLANCE_WIDGETS.includes('glance.weather'))
assert.ok(GLANCE_WIDGETS.includes('glance.music'))
assert.ok(WIDGETS['glance.clock'])
assert.ok(WIDGETS['glance.weather'])
assert.ok(WIDGETS['glance.music'])

// 2. Check essential theme gradient & animation tokens in home.css
assert.ok(cssContent.includes('--widget-solar'), 'home.css must define --widget-solar gradient token')
assert.ok(cssContent.includes('--widget-sky'), 'home.css must define --widget-sky gradient token')
assert.ok(cssContent.includes('--widget-emerald'), 'home.css must define --widget-emerald gradient token')
assert.ok(cssContent.includes('--widget-vinyl'), 'home.css must define --widget-vinyl token')
assert.ok(cssContent.includes('@keyframes soundwave-flutter'), 'home.css must define soundwave-flutter keyframe')
assert.ok(cssContent.includes('prefers-reduced-motion'), 'home.css must include reduced-motion media query')

console.log('PASS Dashboard Studio tokens and widget registry verified')
