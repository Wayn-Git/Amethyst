// Labelled fixtures only; no screenshots or live accounts.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { widgetDisplaySize } from '../src/dashboard/layout.js'
for (const id of ['glance.clock', 'glance.weather', 'glance.next-event', 'glance.music']) assert.equal(widgetDisplaySize(id, 'm'), 'm', `${id}: medium stays medium`)
const catalog = JSON.parse(readFileSync(new URL('../src/components/wigggle/catalog.json', import.meta.url)))
assert.equal(catalog.length, 92)
assert.equal(new Set(catalog.map(row => row.id)).size, 92)
assert.equal(existsSync(new URL('../src/components/kokonutui/bento-grid.tsx', import.meta.url)), false)
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' })
 page.setDefaultTimeout(15000)
 const errors = [], writes = [], outbound = []
 page.on('pageerror', error => errors.push(error.stack))
 page.on('console', message => { if (message.text().startsWith('Wigggle design preview failed:')) console.error(message.text()) })
 await page.route('**/api/**', route => { if (route.request().method() !== 'GET') writes.push(route.request().url()); return route.fulfill({ json: {} }) })
 await page.route('https://**/*', route => { outbound.push(route.request().url()); return route.abort() })
 await page.route('**/__wigggle__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div><button id="outside">Outside</button>' }))
 await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__wigggle__`)
 await page.evaluate(async () => {
  const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
  const { default: React } = await import('/node_modules/.vite/deps/react.js')
  const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
  const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
  const { default: WidgetSlot } = await import('/src/dashboard/WidgetSlot.jsx')
  const { DashboardContext } = await import('/src/dashboard/context.js')
  const { BentoGrid } = await import('/src/components/ui/bento/index.jsx')
  const { default: DesignCatalog } = await import('/src/components/wigggle/DesignCatalog.jsx')
  const { default: manifests } = await import('/src/dev/widgets/manifests.json')
  const { fixtures } = await import('/src/dev/widgets/fixtures.js')
  await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css')
  const h = React.createElement, root = createRoot(document.getElementById('proof')), noop = () => {}, manifest = manifests.find(row => row.id === 'glance.clock')
  const context = { now: new Date(), manifests, layout: { widgets: [{ id: 'glance.clock', size: 's' }] }, setEditing: noop, removeWidget: noop, openPalette: noop, resize: (id, patch) => { window.applied = { id, ...patch } }, addWidget: (id, size, design) => { window.added = { id, size, design } } }
  function Shell({ editing }) {
   const size = window.proofSize || 's'
   return h(BentoGrid, { className: 'home-layout-grid' }, h(WidgetSlot, { id: manifest.id, title: manifest.title, size, sizes: manifest.sizes, editing, grip: () => ({}), move: noop, resize: (id, patch) => { window.proofSize = patch.size; window.renderProof('edit') } }, h(WidgetPresentation, { manifest, size, data: { state: 'ready', payload: { zones: ['Europe/London'] }, synced_at: new Date().toISOString() }, refresh: noop })))
  }
  window.renderProof = (mode = 'shell') => root.render(h('main', { className: 'bento-foundation widget-home today-dashboard' }, h(DashboardContext.Provider, { value: context }, mode === 'designs' ? h(DesignCatalog) : h(Shell, { key: mode, editing: mode === 'edit' }))))
  window.renderLive = (id, design, size = 'm') => {
   const m = manifests.find(row => row.id === id)
   const payload = id === 'glance.weather' ? { ...fixtures[id], temperature: 17, timezone: 'UTC' } : fixtures[id]
   root.render(h('main', { className: 'bento-foundation widget-home today-dashboard' }, h(DashboardContext.Provider, { value: context }, h(BentoGrid, { className: 'home-layout-grid' }, h(WidgetSlot, { key: id, id, title: m.title, size, sizes: m.sizes, grip: () => ({}) }, h(WidgetPresentation, { manifest: m, size, design, data: { state: 'ready', payload, synced_at: new Date().toISOString() }, refresh: noop }))))))
  }
  window.renderProof()
 })
 const slot = page.locator('[data-slot-id="glance.clock"]')
 await slot.locator('.clock-time').waitFor().catch(async error => { console.error({ errors, body: await page.locator('body').innerText() }); throw error })
 const expanded = await slot.boundingBox()
 await slot.hover(); await slot.getByRole('button', { name: 'Collapse Clock', exact: true }).click()
 assert((await slot.boundingBox()).height <= 64, 'collapse frees grid tracks')
 assert.equal(await slot.locator('.today-slot-body').isVisible(), false)
 await slot.getByRole('button', { name: 'Expand Clock', exact: true }).click()
 assert.equal(Math.round((await slot.boundingBox()).height), Math.round(expanded.height))
 const trigger = slot.getByRole('button', { name: 'Menu Clock', exact: true })
 await trigger.click(); await page.getByRole('menuitem', { name: 'Settings', exact: true }).waitFor()
 assert.equal(await slot.locator('[role="menu"]').count(), 0, 'menu escapes card clipping')
 await page.keyboard.press('Escape'); await page.getByRole('menu').waitFor({ state: 'hidden' })
 assert(await trigger.evaluate(node => node === document.activeElement), 'Escape restores focus')
 await trigger.click(); await page.locator('#outside').click(); await page.getByRole('menu').waitFor({ state: 'hidden' })
 await page.evaluate(() => window.renderProof('edit'))
 await slot.getByRole('radiogroup', { name: 'Size Clock', exact: true }).getByRole('radio', { name: 'M', exact: true }).click()
 assert.equal(await slot.getAttribute('data-size'), 'm')
 assert.equal(await slot.locator('select').count(), 0)
 await page.evaluate(() => window.renderProof('designs'))
 let seen = 0
 for (const category of ['clock', 'calendar', 'weather', 'media', 'productivity', 'dashboard', 'stocks', 'sports']) {
  await page.getByRole('navigation', { name: 'Wigggle categories' }).getByRole('button', { name: new RegExp(`^${category}`) }).click()
  const examples = page.locator('.wigggle-design-example'), expected = catalog.filter(row => row.category === category).length
  assert.equal(await examples.count(), expected)
  await page.waitForFunction(() => ![...document.querySelectorAll('.wigggle-sample')].some(node => node.textContent.includes('Loading design…')))
  assert.equal(await examples.getByRole('alert').count(), 0, `${category}: all source designs render: ${await examples.filter({ has: page.getByRole('alert') }).evaluateAll(nodes => nodes.map(node => node.dataset.design).join(', '))}`)
  assert.equal(await examples.locator('header').filter({ hasText: 'Sample data' }).count(), expected)
  seen += expected
  if (category === 'clock') {
   await page.locator('[data-design="clock-sm-06"]').getByRole('button', { name: 'Apply to Clock', exact: true }).click()
   assert.deepEqual(await page.evaluate(() => window.applied), { id: 'glance.clock', size: 's', design: 'clock-sm-06' })
  }
  if (['stocks', 'sports'].includes(category)) assert.equal(await examples.getByRole('button', { name: /^(Add|Apply to)/ }).count(), 0)
  for (const width of [1280, 768, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${category} ${width}: overflow`)
  }
 }
 assert.equal(seen, 92)
 for (const design of catalog.filter(row => ['clock', 'weather', 'calendar'].includes(row.category))) {
  if (design.category === 'clock' && Number(design.id.split('-').at(-1)) > 9) continue
  const id = design.category === 'clock' ? 'glance.clock' : design.category === 'weather' ? 'glance.weather' : 'glance.next-event'
  await page.evaluate(({ id, design, size }) => window.renderLive(id, design, size), { id, design: design.id, size: design.size })
  const card = page.locator(`[data-widget="${id}"]`)
  await card.locator('.widget-content').waitFor()
  if (id === 'glance.weather') {
   await card.locator('.wigggle-live-weather').waitFor()
   await page.waitForFunction(() => !document.body.textContent.includes('Loading weather design…'))
   assert.equal(await card.getByText('Sample city', { exact: true }).count(), 0)
   if (design.id !== 'weather-sm-09') assert.match(await card.innerText(), /17/)
  }
  assert.equal(await card.getByRole('alert').count(), 0, `${design.id}: real data renders`)
  assert(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${design.id}: real card fits`)
 }
 assert.equal(seen, 92)
 assert.equal(outbound.some(url => /open-meteo|ipapi|geolocation|ipwho/i.test(url)), false)
 assert.deepEqual(writes, [])
 assert.deepEqual(errors, [])
 console.log('PASS Wigggle: 92 source designs, sample isolation, source apply, collapse, menu dismissal/focus, size controls, three widths; no screenshots')
} finally { await browser.close() }
