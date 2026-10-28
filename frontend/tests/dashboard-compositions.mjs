// Labelled fixtures only. Exercise real tile geometry without capturing images.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixtures } from '../src/dev/widgets/fixtures.js'
import { WIDGET_PRESENTATIONS, PRESENTATIONS } from '../src/dashboard/presentation.js'
const manifests = JSON.parse(readFileSync(new URL('../src/dev/widgets/manifests.json', import.meta.url)))
assert.deepEqual(Object.keys(WIDGET_PRESENTATIONS).sort(), manifests.map(m => m.id).sort())
assert.equal(Object.values(PRESENTATIONS).flat().length, manifests.length, 'Exactly one composition family per widget')
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
 page.setDefaultTimeout(10000)
 const errors = [], issues = []
 page.on('pageerror', e => errors.push(e.message))
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON()
  let json = { enabled: true, repos: [], latitude: 12, longitude: 77 }
  if (path.includes('/actions/')) json = { draft_id: 'fixture', action: path.split('/').at(-1), item: body }
  if (path.includes('/drafts/')) json = { state: 'denied' }
  await route.fulfill({ json })
 })
 await page.route('**/__compositions__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
 await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__compositions__`)
 await page.evaluate(async () => {
  const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
  const { default: React } = await import('/node_modules/.vite/deps/react.js')
  const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
  const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
  const { default: WidgetSlot } = await import('/src/dashboard/WidgetSlot.jsx')
  const { DashboardContext } = await import('/src/dashboard/context.js')
  const { BentoGrid } = await import('/src/components/ui/bento/index.jsx')
  await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-shell.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css')
  const h = React.createElement, root = createRoot(document.getElementById('proof')), noop = () => {}
  window.renderComposition = (manifest, payload, size, state = 'ready') => root.render(h('main', { className: 'bento-foundation widget-home today-dashboard', style: { padding: 16 } }, h(DashboardContext.Provider, { value: { now: new Date(), layout: { widgets: [] }, manifests: [manifest], removeWidget: noop, setEditing: noop, openPalette: noop, quietSettings: {} } }, h(BentoGrid, { className: 'home-layout-grid' }, h(WidgetSlot, { key: manifest.id, id: manifest.id, title: manifest.title, size, sizes: manifest.sizes, grip: noop }, h(WidgetPresentation, { manifest, size, tile: ['glance.clock','glance.weather','glance.next-event','glance.music'].includes(manifest.id), data: { state, payload, synced_at: new Date().toISOString() }, refresh: noop }))))))
 })
 const render = async (id, size, payload = fixtures[id]) => {
  await page.evaluate(({ manifest, payload, size }) => window.renderComposition(manifest, payload, size), { manifest: manifests.find(m => m.id === id), payload, size })
  await page.locator(`.today-slot-body > [data-widget="${id}"]`).waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('.widget-skeleton')].some(n => n.checkVisibility()))
  assert.equal(await page.getByText('This widget could not render.', { exact: true }).count(), 0, id)
 }
 for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1000 })
  for (const manifest of manifests) {
   const structures = []
   for (const size of manifest.sizes) {
    await render(manifest.id, size)
    const result = await page.locator('.today-slot-body > .home-widget').evaluate(node => {
     const body = node.querySelector('.widget-content'), slot = node.closest('[data-slot-id]'), r = body.getBoundingClientRect(), s = slot.getBoundingClientRect()
     const preview = node.querySelector(':scope > .widget-content > .widget-preview')
     const actions = [...node.querySelectorAll('.widget-footer button, .widget-menu > summary, .widget-workbench.is-inline button')].filter(n => n.checkVisibility())
     return { id: node.dataset.widget, size: node.dataset.size, view: node.dataset.view, width: body.clientWidth, scroll: body.scrollWidth, height: body.clientHeight, scrollHeight: body.scrollHeight, previewHeight: preview?.clientHeight, previewScroll: preview?.scrollHeight, contained: r.bottom <= s.bottom + 2,
      clipped: preview ? preview.scrollHeight > preview.clientHeight + 2 : node.dataset.size !== 'l' && body.scrollHeight > body.clientHeight + 2,
      small: actions.filter(n => { const b = n.getBoundingClientRect(); return b.width < 44 || b.height < 44 }).map(n => n.getAttribute('aria-label')),
      structure: preview ? [...preview.querySelectorAll('*')].map(n => n.tagName).join(',') : [...body.querySelectorAll('.is-inline *')].map(n => n.tagName).join(',') }
    })
    if (result.scroll > result.width + 2 || !result.contained || result.clipped || result.small.length) issues.push({ width, ...result, structure: undefined })
    structures.push(result.structure)
   }
   if (manifest.sizes.includes('m') && manifest.sizes.includes('l') && !['clock', 'weather', 'sun', 'air', 'player', 'timer'].includes(WIDGET_PRESENTATIONS[manifest.id]) && manifest.id !== 'glance.next-event') assert.notEqual(structures[manifest.sizes.indexOf('m')], structures[manifest.sizes.indexOf('l')], `${manifest.id}: M preview and L workbench have distinct structures`)
   // All native controls remain reachable from the compact face.
   await render(manifest.id, manifest.sizes[0])
   if (manifest.id !== 'dash.palette') {
    await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').click()
    const dialog = page.getByRole('dialog', { name: manifest.title, exact: true })
    await dialog.waitFor()
    assert.equal(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth + 2), true, `${manifest.id}: sheet fits`)
    await page.keyboard.press('Tab')
    assert(await dialog.evaluate(n => n.contains(document.activeElement)), `${manifest.id}: sheet contains focus`)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog[open]'))
   }
  }
  console.log(`CHECKED all 80 compositions at ${width}px: allowed sizes, working controls, detail focus`)
 }
 assert.deepEqual(issues, [], 'Every compact preview fits the real tile; controls meet 44px targets')
 // Long source strings and crowded lists must not spill out of the compact face.
 for (const manifest of manifests.filter(m => m.sizes.includes('m') && !['clock','weather','sun','air','player','timer'].includes(WIDGET_PRESENTATIONS[m.id]) && m.id !== 'glance.next-event')) {
  const payload = structuredClone(fixtures[manifest.id]), long = 'Long source text '.repeat(30)
  if (payload.items?.[0]) payload.items = Array.from({ length: 8 }, (_, i) => ({ ...payload.items[0], id: `long-${i}`, title: long, subject: long, from: long, fact: long, summary: long, detail: long, reason: long }))
  await render(manifest.id, 'm', payload)
  const overflow = await page.locator('.widget-preview').evaluateAll(nodes => nodes.filter(n => n.scrollHeight > n.clientHeight + 2 || n.scrollWidth > n.clientWidth + 2).map(n => ({ id: n.closest('[data-widget]').dataset.widget, height: n.clientHeight, scroll: n.scrollHeight })))
  issues.push(...overflow)
 }

 assert.deepEqual(issues, [], 'Long metadata and eight rows fit every compact surface')
 // Draft, review and rejection survive a resize and repeated native sheet openings.
 await render('lib.capture', 'l')
 await page.getByLabel('Note title', { exact: true }).fill('Retain across sizes')
 await page.getByLabel('Note text', { exact: true }).fill('Fixture body')
 await render('lib.capture', 'm')
 assert.equal(await page.getByLabel('Note title', { exact: true }).isVisible(), false)
 await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').click()
 await page.getByRole('dialog', { name: 'Capture', exact: false }).waitFor()
 assert.equal(await page.getByLabel('Note title', { exact: true }).inputValue(), 'Retain across sizes')
 await page.getByRole('button', { name: 'Review note', exact: true }).click()
 await page.getByRole('button', { name: 'Approve save', exact: true }).waitFor()
 await page.keyboard.press('Escape')
 await page.locator('dialog[open]').waitFor({ state: 'hidden' })
 await render('lib.capture', 'l')
 await page.getByRole('button', { name: 'Reject save', exact: true }).click()
 assert.equal(await page.getByLabel('Note title', { exact: true }).inputValue(), 'Retain across sizes')
 await render('glance.weather', 'm')
 await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').click()
 await page.getByLabel('City', { exact: true }).fill('Retain this location')
 await page.keyboard.press('Escape')
 await page.locator('dialog[open]').waitFor({ state: 'hidden' })
 await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').click()
 assert.equal(await page.getByLabel('City', { exact: true }).inputValue(), 'Retain this location')
 await page.keyboard.press('Escape')
 await page.locator('dialog[open]').waitFor({ state: 'hidden' })
 await page.emulateMedia({ reducedMotion: 'no-preference' })
 await render('lib.capture', 'm')
 // Record render events and RAF intervals, not screenshots or inferred FPS claims.
 const cdp = await page.context().newCDPSession(page)
 await cdp.send('Performance.enable')
 const start = (await cdp.send('Performance.getMetrics')).metrics
 await page.evaluate(() => {
  window.framesMeasured = []
  window.measurement = new Promise(resolve => {
   let last, count = 0
   const next = at => { if (last) window.framesMeasured.push(at - last); last = at; if (++count < 90) requestAnimationFrame(next); else resolve() }
   requestAnimationFrame(next)
  })
 })
 const began = performance.now()
 await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').evaluate(n => n.click())
 await page.getByRole('dialog', { name: manifests.find(m => m.id === 'lib.capture').title, exact: true }).waitFor()
 const responseMs = Math.round(performance.now() - began)
 const properties = await page.locator('dialog[open]').evaluate(n => n.getAnimations().flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)))
 assert(properties.length > 0 && properties.every(k => ['transform', 'opacity'].includes(k)), 'Sheet entry animates compositor properties only')
 await page.keyboard.press('Escape')
 await page.waitForFunction(() => !document.querySelector('dialog[open]'))
 await render('lib.capture', 'l')
 const resizeProperties = await page.locator('.widget-content').evaluate(n => n.getAnimations().flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset','computedOffset','easing','composite'].includes(k)))
 assert(resizeProperties.length > 0 && resizeProperties.every(k => ['transform','opacity'].includes(k)), 'Resize feedback uses transform/opacity')
 await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').hover()
 await page.mouse.down()
 assert.equal(await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').evaluate(n => getComputedStyle(n).transitionProperty), 'transform')
 await page.mouse.up()
 await page.evaluate(() => window.measurement)
 const frames = await page.evaluate(() => window.framesMeasured.sort((a,b) => a-b))
 const end = (await cdp.send('Performance.getMetrics')).metrics
 const delta = name => Math.round(((end.find(m => m.name === name)?.value || 0) - (start.find(m => m.name === name)?.value || 0)) * 1000)
 console.log(`PROFILE sheet/close/resize/press: sheet response ${responseMs}ms; RAF median ${frames[Math.floor(frames.length / 2)].toFixed(1)}ms, p95 ${frames[Math.floor(frames.length * .95)].toFixed(1)}ms; layout ${delta('LayoutDuration')}ms, style ${delta('RecalcStyleDuration')}ms (headless Chromium, ${frames.length} intervals)`)
 await page.locator('dialog[open]').waitFor()
 await page.emulateMedia({ reducedMotion: 'reduce' })
 assert.equal(await page.locator('dialog[open]').evaluate(n => getComputedStyle(n).animationName), 'none')
 assert.equal(await page.locator('.today-slot-body > .home-widget > .widget-footer > .widget-open').evaluate(n => getComputedStyle(n).transitionDuration), '0s')
 assert.deepEqual(errors, [])
 console.log('PASS all 80 compositions, persistent draft/review/location edits, focus, compositor properties and reduced motion; no screenshots')
} finally { await browser.close() }
