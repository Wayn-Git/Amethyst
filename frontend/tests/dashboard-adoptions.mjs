// Synthetic payloads only; no accounts, source writes, or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const group = process.argv[2] || 'glance'
const fixtures = {
 glance: {
  'glance.clock': {},
  'glance.weather': { temperature: 22, timezone: 'Asia/Kolkata', hours: [{ time: '12:00', temperature: 22, rain: 10 }, { time: '13:00', temperature: 24, rain: 20 }] },
  'glance.air': { european_aqi: 0, pm2_5: 0, pm10: null, time: '2026-10-26T12:00' },
  'glance.sun': { sunrise: '2026-10-26T06:12', sunset: '2026-10-26T18:24', timezone: 'Asia/Kolkata' },
  'glance.next-event': { timezone: 'Asia/Kolkata', items: [{ id: 'event', title: 'Calendar fixture', start: '2026-10-26T07:00:00Z' }] },
  'glance.music': { active_player: 'Fixture player', status: 'Playing', player_id: 'fixture', controls: { pause: true }, items: [{ id: 'track', title: 'Fixture track', artists: ['Fixture artist'] }] },
  'glance.travel': { timezone: 'Asia/Kolkata', items: [{ id: 'route', title: 'Route fixture', detail: '12 minutes driving from home', start: '2026-10-26T07:00:00Z' }] },
 },
}
assert(fixtures[group], `Unknown group ${group}`)
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' })
 const errors = [], requests = []
 let state = 'ready'
 page.on('pageerror', e => errors.push(e.message))
 await page.clock.setFixedTime(new Date('2026-10-26T06:00:00Z'))
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  const body = route.request().postDataJSON()
  requests.push({ path, body })
  const id = path.match(/\/widgets\/([^/]+)/)?.[1]
  let json = {}
  if (/\/(data|refresh)$/.test(path)) json = { state, stale: state === 'stale', synced_at: '2026-10-26T05:59:00Z', payload: ['ready', 'stale'].includes(state) ? fixtures[group][id] : null, error: state === 'error' ? 'Fixture error' : null }
  if (path.includes('/actions/')) json = { draft_id: 'fixture', action: path.split('/').at(-1), item: body }
  if (path.includes('/drafts/')) json = { state: 'applied' }
  await route.fulfill({ json })
 })
 await page.route('**/__adoptions__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
 await page.goto((process.env.BASE || 'http://127.0.0.1:5177') + '/__adoptions__')
 await page.evaluate(async ids => {
  localStorage.clear()
  const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
  const { default: React } = await import('/node_modules/.vite/deps/react.js')
  const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
  const { default: WidgetFrame } = await import('/src/dashboard/WidgetFrame.jsx')
  const { default: WidgetSlot } = await import('/src/dashboard/WidgetSlot.jsx')
  const { DashboardContext } = await import('/src/dashboard/context.js')
  const { BentoGrid } = await import('/src/components/ui/bento/index.jsx')
  await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-shell.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css')
  const h = React.createElement, noop = () => {}
  const root = createRoot(document.getElementById('proof'))
  const context = { now: new Date(), layout: { widgets: ids.map(id => ({ id })) }, removeWidget: noop, setEditing: noop, connectSource: noop, openWidget: noop }
  window.renderGroup = (revision = 0, full = false) => root.render(h('main', { className: 'bento-foundation widget-home' }, h(DashboardContext.Provider, { value: context }, h(BentoGrid, { className: 'home-layout-grid' }, ...ids.map(id => h(WidgetSlot, { key: id, id, title: id, size: id.startsWith('glance.') ? 's' : 'm', sizes: ['s', 'm'], grip: noop }, h(WidgetFrame, { manifest: { id, title: id, source: { type: 'local' }, empty: 'Fixture empty', sizes: ['s', 'm'], refresh: { mode: 'manual' } }, tile: ['glance.clock', 'glance.weather', 'glance.next-event', 'glance.music'].includes(id), full, refreshVersion: revision })))))))
  window.renderGroup()
 }, Object.keys(fixtures[group]))
 const widget = id => page.locator(`[data-widget="${id}"]`)
 await page.waitForFunction(count => document.querySelectorAll('.widget-adoption').length === count && !document.querySelector('.widget-skeleton'), Object.keys(fixtures[group]).length)

 if (group === 'glance') {
  assert.deepEqual(await widget('glance.air').locator('.ui-stat > div').allTextContents(), ['0'])
  assert.match(await widget('glance.air').innerText(), /PM2.5\s+0 µg\/m³/)
  assert.match(await widget('glance.air').innerText(), /PM10\s+Unavailable/)
  assert.deepEqual(await widget('glance.sun').locator('.adoption-time').allTextContents(), ['06:12', '18:24'])
  assert.equal(await widget('glance.sun').locator('svg[role="img"]').count(), 0)
  assert.equal(await widget('glance.next-event').locator('.ui-stat > div').innerText(), '60min')
  assert.equal(await widget('glance.travel').locator('.adoption-route').innerText(), '12 minutes driving from home')
  assert.equal(await widget('glance.travel').locator('ul').evaluate(n => getComputedStyle(n).listStyleType), 'none')
  await widget('glance.travel').getByText('Home location settings', { exact: true }).click()
  await widget('glance.travel').getByLabel('Home location', { exact: true }).fill('Fixture address')
  await widget('glance.travel').getByRole('button', { name: 'Save location' }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/glance.travel/settings').body, { home: 'Fixture address', enabled: true })
  await widget('glance.music').getByRole('button', { name: 'Pause music' }).click()
  assert.equal(requests.filter(r => r.path.includes('/drafts/')).length, 0, 'playback waits for review')
  await widget('glance.music').getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path.includes('/drafts/')).body, { approved: false })
  await page.evaluate(() => window.renderGroup(0, true))
  await widget('glance.weather').getByText('Location settings', { exact: true }).waitFor()
  await widget('glance.weather').getByText('Location settings', { exact: true }).click()
  await widget('glance.weather').getByLabel('Latitude', { exact: true }).fill('0')
  await widget('glance.weather').getByLabel('Longitude', { exact: true }).fill('0')
  await widget('glance.weather').getByRole('button', { name: 'Save location' }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/glance.weather/settings' && r.body).body, { latitude: 0, longitude: 0 })
  await widget('glance.weather').getByText('Weather data and attribution', { exact: true }).click()
  assert.equal(await widget('glance.weather').getByRole('link', { name: 'Weather data by Open-Meteo' }).count(), 1)
 }

 await page.mouse.move(0, 0)
 for (const theme of ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']) {
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} page overflow at ${width}`)
   assert.deepEqual(await page.locator('.widget-adoption').evaluateAll(nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => ({ id: n.dataset.widget, width: n.clientWidth, children: [...n.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > n.getBoundingClientRect().right).map(el => [el.tagName, el.className, el.clientWidth, el.scrollWidth]) }))), [], `${theme} tile overflow at ${width}`)
  }
  const primary = page.locator('.widget-adoption .ui-button[data-variant="primary"]').first()
  if (await primary.count()) assert.equal(await primary.evaluate(async n => { n.getBoundingClientRect(); await Promise.all(n.getAnimations().map(a => a.finished)); return getComputedStyle(n).backgroundColor }), 'rgb(113, 50, 214)', `${theme} violet primary`)
 }
 for (const next of ['stale', 'loading', 'error', 'empty', 'not-connected', 'ready']) {
  state = next
  await page.evaluate(revision => window.renderGroup(revision, false), ['stale', 'loading', 'error', 'empty', 'not-connected', 'ready'].indexOf(next) + 1)
  if (next === 'loading') await page.getByLabel('Loading widget…').first().waitFor()
  if (next === 'error') await page.getByText('Fixture error', { exact: true }).first().waitFor()
  if (next === 'stale') await page.getByText('Stale', { exact: true }).first().waitFor()
  if (next === 'not-connected') await page.getByRole('button', { name: 'Connect', exact: true }).first().waitFor()
  if (next === 'empty') await page.getByText('Fixture empty', { exact: true }).first().waitFor()
  if (next === 'ready') await page.waitForFunction(() => !document.querySelector('.widget-skeleton') && !document.querySelector('.home-connect'))
 }
 await page.emulateMedia({ reducedMotion: 'reduce' })
 assert.equal(await page.locator('.widget-adoption button').first().evaluate(n => getComputedStyle(n).transitionDuration.split(',').every(v => parseFloat(v) === 0)), true)
 assert.deepEqual(errors, [])
 console.log(`PASS ${group}: patterns, real values, controls, states, nine themes, mobile/desktop, reduced motion`)
} finally { await browser.close() }
