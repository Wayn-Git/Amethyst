// Run against the built app served by the desktop backend. APIs and device position are fixtures.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const base = process.env.BASE || 'http://127.0.0.1:8000'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, geolocation: { latitude: 0, longitude: 0 }, permissions: ['geolocation'] })
 const page = await context.newPage()
 const errors = [], requests = [], loaded = []
 page.on('pageerror', e => errors.push(e.message))
 page.on('request', r => loaded.push(r.url()))
 const manifestRows = [
  ['glance.clock', 'Clock', 'clock', 's'], ['glance.weather', 'Weather', 'cloud', 'm'],
  ['glance.air', 'Air quality', 'wind', 's'], ['glance.sun', 'Sunrise and sunset', 'sun', 's'],
  ['glance.travel', 'Travel time', 'globe-west', 'm'], ['glance.music', 'Desktop music', 'music', 'm'],
  ['glance.next-event', 'Next event', 'calendar', 's'],
 ]
 const manifests = manifestRows.map(([id, title, icon, smallest]) => ({ enabled: true, manifest: { id, title, icon, description: `Capability of ${title}.`, group: 'glance', sizes: smallest === 's' ? ['s', 'm', 'l'] : ['m', 'l'], requires: [], source: { type: 'local' }, refresh: { mode: 'manual' }, empty: `No ${title.toLowerCase()} fixture.` } }))
 const original = { widgets: manifests.map(({ manifest }) => ({ id: manifest.id, size: manifest.id === 'glance.clock' ? 'l' : 'm', height: 3 })) }
 let layout = structuredClone(original), failSearch = false
 let weatherSettings = { latitude: 12, longitude: 34 }, travelSettings = { home: 'Saved origin', enabled: true }
 const payloads = {
  'glance.clock': {},
  'glance.weather': { temperature: 22, timezone: 'Asia/Kolkata', hours: Array.from({ length: 6 }, (_, i) => ({ time: `2026-10-26T${12 + i}:00`, temperature: 20 + i, rain: 0 })) },
  'glance.air': { european_aqi: 26, pm2_5: 8.1, pm10: 14.4, time: '2026-10-26T12:00' },
  'glance.sun': { sunrise: '2026-10-26T06:12', sunset: '2026-10-26T18:24', timezone: 'Asia/Kolkata' },
  'glance.travel': { items: [{ id: 'route', title: 'Fixture meeting', detail: '12 minutes driving from home' }] },
  'glance.music': { items: [] }, 'glance.next-event': { items: [] },
 }
 await page.addInitScript(() => {
  localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' }))
  localStorage.setItem('amethyst.ui.forceDesktop', '1')
  window.originalPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
 })
 await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname, body = route.request().postDataJSON()
  requests.push({ path, body, query: url.search })
  let json = {}
  if (path === '/api/widgets') json = { widgets: manifests }
  else if (path === '/api/layout') { if (body) layout = body; json = layout }
  else if (path === '/api/widgets/glance.weather/settings') { if (body) weatherSettings = body; json = weatherSettings }
  else if (path === '/api/widgets/glance.travel/settings') { if (body) travelSettings = body; json = travelSettings }
  else if (path === '/api/today/locations') {
   if (failSearch) return route.fulfill({ status: 503, json: { detail: 'Fixture search unavailable' } })
   json = { items: [{ name: 'Fixture City', latitude: 51.5, longitude: -0.12 }] }
  }
  else if (/\/(data|refresh)$/.test(path)) {
   const id = path.split('/')[3]
   json = { state: id === 'glance.next-event' ? 'not-connected' : id === 'glance.music' ? 'empty' : 'ok', payload: payloads[id] || {}, synced_at: '2026-10-26T12:00:00Z' }
  }
  else if (path.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => path.endsWith(p))) json = []
  await route.fulfill({ json })
 })
 await page.goto(`${base}/today`)
 await page.locator('.home-layout-grid .bento-grid').waitFor()
 const card = id => page.locator(`.home-layout-grid [data-widget="${id}"]`)
 await card('glance.air').getByText('European AQI', { exact: true }).waitFor()
 await page.getByRole('button', { name: 'Change location', exact: true }).click()
 const weather = page.getByRole('dialog', { name: 'Weather', exact: true })
 await weather.getByRole('button', { name: 'Use device location', exact: true }).click()
 await weather.getByText('Location saved for Weather, Air quality, and Sunrise and sunset.', { exact: true }).waitFor()
 assert.deepEqual(weatherSettings, { latitude: 0, longitude: 0 })
 for (const id of ['glance.weather', 'glance.air', 'glance.sun']) assert(requests.some(r => r.path === `/api/widgets/${id}/refresh`), `${id} refreshes after location save`)
 assert.equal(requests.some(r => r.path === '/api/widgets/glance.travel/refresh'), false)

 await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (_success, fail) => fail({ code: 1 }) })
 const puts = () => requests.filter(r => r.path === '/api/widgets/glance.weather/settings' && r.body).length
 const beforeDenial = puts()
 await weather.getByRole('button', { name: 'Use device location', exact: true }).click()
 await weather.getByRole('alert').filter({ hasText: 'Location access was denied' }).waitFor()
 assert.equal(puts(), beforeDenial)
 failSearch = true
 await weather.getByLabel('City', { exact: true }).fill('Fixture')
 await weather.getByRole('button', { name: 'Find city', exact: true }).click()
 await weather.getByRole('alert').filter({ hasText: 'Fixture search unavailable' }).waitFor()
 failSearch = false
 await weather.getByRole('button', { name: 'Find city', exact: true }).click()
 await weather.getByRole('button', { name: 'Fixture City', exact: true }).click()
 await weather.getByText('Location saved for Weather, Air quality, and Sunrise and sunset.', { exact: true }).waitFor()
 assert.deepEqual(weatherSettings, { latitude: 51.5, longitude: -0.12 })

 await weather.getByText('Enter coordinates manually', { exact: true }).click()
 await weather.getByLabel('Latitude', { exact: true }).fill('91')
 const beforeInvalid = puts()
 await weather.getByRole('button', { name: 'Save location', exact: true }).click()
 assert.equal(puts(), beforeInvalid)
 await weather.getByLabel('Latitude', { exact: true }).fill('0')
 await weather.getByLabel('Longitude', { exact: true }).fill('0')
 await weather.getByRole('button', { name: 'Save location', exact: true }).click()
 await weather.getByText('Location saved for Weather, Air quality, and Sunrise and sunset.', { exact: true }).waitFor()
 assert.deepEqual(weatherSettings, { latitude: 0, longitude: 0 })

 await page.evaluate(() => { navigator.geolocation.getCurrentPosition = success => { window.pendingPosition = success } })
 await weather.getByRole('button', { name: 'Use device location', exact: true }).click()
 assert.equal(await weather.getByRole('button', { name: 'Finding your location…', exact: true }).isDisabled(), true)
 const beforeClose = puts()
 await page.keyboard.press('Escape')
 await weather.waitFor({ state: 'hidden' })
 await page.evaluate(() => window.pendingPosition({ coords: { latitude: 1, longitude: 2 } }))
 assert.equal(puts(), beforeClose, 'closing cancels a pending device lookup before saving')
 await page.evaluate(() => { navigator.geolocation.getCurrentPosition = window.originalPosition })

 await card('glance.travel').getByText('Home location settings', { exact: true }).click()
 assert.equal(await card('glance.travel').getByLabel('Home location', { exact: true }).inputValue(), 'Saved origin')
 await card('glance.travel').getByRole('button', { name: 'Use current location', exact: true }).click()
 await card('glance.travel').getByText('Current location filled. Save to use it as your trip origin.', { exact: true }).waitFor()
 assert.equal(await card('glance.travel').getByLabel('Home location', { exact: true }).inputValue(), '0, 0')
 assert.equal(travelSettings.home, 'Saved origin', 'trip origin requires Save')
 await card('glance.travel').getByRole('button', { name: 'Save location', exact: true }).click()
 await card('glance.travel').getByText('Trip origin saved.', { exact: true }).waitFor()
 assert.deepEqual(travelSettings, { home: '0, 0', enabled: true })

 await page.getByRole('button', { name: 'Edit layout', exact: true }).click()
 await page.getByRole('button', { name: 'Fit widgets', exact: true }).click()
 await page.getByText('Widget sizes fitted', { exact: true }).waitFor()
 assert.deepEqual(layout.widgets.map(w => w.id), original.widgets.map(w => w.id))
 assert.equal(layout.widgets.find(w => w.id === 'glance.clock').size, 's')
 assert.equal(layout.widgets.find(w => w.id === 'glance.air').size, 's')
 assert.equal(await page.locator('[data-slot-id="glance.sun"]').getAttribute('data-size'), 'wide')
 await page.getByRole('button', { name: 'Undo', exact: true }).click()
 await page.waitForFunction(() => document.querySelector('[data-slot-id="glance.clock"]').dataset.size === 'l')
 assert.deepEqual(layout, original)
 await page.getByRole('button', { name: 'Finish editing', exact: true }).click()

 await page.getByRole('button', { name: 'Add widget', exact: true }).click()
 const catalog = page.getByRole('dialog', { name: 'Add widget', exact: true })
 assert.equal(await catalog.locator('.catalog-card-grid').first().evaluate(n => getComputedStyle(n).display), 'grid')
 assert((await catalog.locator('.catalog-thumbnail svg').evaluateAll(nodes => new Set(nodes.map(n => n.innerHTML)).size)) > 3)
 await page.keyboard.press('Escape')
 for (const theme of ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']) {
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
  for (const width of [1440, 1024, 768, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} page overflow at ${width}`)
   assert.deepEqual(await page.locator('.home-layout-grid .home-widget').evaluateAll(nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.dataset.widget)), [], `${theme} tile overflow at ${width}`)
  }
  assert.equal(await card('glance.weather').evaluate(n => getComputedStyle(n).borderRadius), '24px')
  assert.equal(await page.locator('.bento-grid').evaluate(n => getComputedStyle(n).gap), '16px')
 }
 assert.deepEqual(await page.locator('.home-layout-grid .widget-refresh, .home-layout-grid .widget-menu > summary, .today-actions button').evaluateAll(nodes => nodes.filter(n => { const r = n.getBoundingClientRect(); return r.width < 44 || r.height < 44 }).map(n => n.getAttribute('aria-label'))), [], '44px action targets')
 await page.emulateMedia({ reducedMotion: 'reduce' })
 assert.equal(await card('glance.weather').locator('.pilot-number').evaluate(n => getComputedStyle(n).animationName), 'none')
 if (new URL(base).port === '8000') assert(loaded.some(url => /\/assets\/index-[^/]+\.js/.test(url)), 'checks the desktop bundle')
 assert.deepEqual(errors, [])
 console.log('PASS served desktop: bento/catalog, city/device/manual location, denial/retry/cancel, shared refresh, saved trip origin, fit/undo, nine themes, mobile, reduced motion')
} finally { await browser.close() }
