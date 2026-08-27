// Fixture services only; no screenshots, real accounts, or playback changes.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(name => name.startsWith('chromium-')).sort().reverse().map(name => join(cache, name, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' })
  page.setDefaultTimeout(10000)
  const errors = [], requests = []
  let weather = { state: 'empty', payload: { set_location: true }, synced_at: null }
  let coordinates = {}, holdRefresh = false, releaseRefresh
  page.on('pageerror', error => errors.push(error.message))
  await page.route('https://**/*', route => route.abort())
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    requests.push({ path, method: request.method(), body: request.postData() })
    if (path === '/api/ping') return route.fulfill({ json: { ok: true } })
    if (path === '/api/widgets/glance.weather/settings') {
      if (request.method() === 'PUT') {
        coordinates = request.postDataJSON()
        weather = { state: 'ready', payload: { temperature: 17, hours: [], timezone: 'UTC' }, synced_at: '2026-10-30T10:00:00Z' }
      }
      return route.fulfill({ json: coordinates })
    }
    if (path.startsWith('/api/widgets/glance.weather/')) {
      if (holdRefresh && request.method() === 'POST') await new Promise(resolve => { releaseRefresh = resolve })
      return route.fulfill({ json: weather })
    }
    if (path.startsWith('/api/widgets/glance.next-event/') || path.startsWith('/api/widgets/task.agenda/')) return route.fulfill({ json: { state: 'not-connected', payload: null, error: 'Sign-in expired', synced_at: null } })
    throw new Error(`Unexpected API request: ${path}`)
  })
  await page.route('**/__setup__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__setup__`)
  await page.evaluate(async () => {
    const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: DesignCatalog } = await import('/src/components/wigggle/DesignCatalog.jsx')
    const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    const { default: catalog } = await import('/src/components/wigggle/catalog.json')
    const { targetsForDesign, designBlocker } = await import('/src/components/wigggle/designs.js')
    const { default: manifests } = await import('/src/dev/widgets/manifests.json')
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-bento.css')
    const h = React.createElement, root = createRoot(document.getElementById('proof')), noop = () => {}
    const context = { manifests, layout: { widgets: [] }, now: new Date(), resize: noop, addWidget: noop, removeWidget: noop, setEditing: noop, openPalette: noop, connections: { data: { configured: true, items: [{ id: 'googlecalendar', status: 'needs reconnect' }] }, refresh: noop }, connectSource: id => { window.connectedSource = id }, openWidget: id => { window.openedWidget = id } }
    window.missingDesigns = catalog.filter(design => !targetsForDesign(design, manifests).length).map(design => ({ id: design.id, blocker: designBlocker(design) }))
    window.renderSetupProof = (id, data, design) => root.render(h('main', { className: 'bento-foundation widget-home today-dashboard' }, h(DashboardContext.Provider, { value: context }, id ? h(WidgetPresentation, { manifest: manifests.find(row => row.id === id), size: 'm', design, data, refresh: noop }) : h(DesignCatalog))))
    window.renderSetupProof()
  })
  const missing = await page.evaluate(() => window.missingDesigns)
  assert(missing.length > 0)
  for (const design of missing) assert(design.blocker?.reason && design.blocker.requirements.length, `${design.id}: concrete blocker and requirements`)
  await page.getByRole('navigation', { name: 'Wigggle categories' }).getByRole('button', { name: /^stocks/ }).click()
  await page.locator('[data-design="stocks-sm-01"]').getByRole('button', { name: 'Setup & status', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Stocks 01 · Setup & status', exact: true })
  await dialog.getByText('Live integration unavailable', { exact: true }).waitFor()
  await dialog.getByText(/A live market-data provider is not implemented/).waitFor()
  assert.equal(await dialog.locator('input').count(), 0, 'unsupported integrations do not pretend to accept credentials')
  assert.equal(await dialog.getByRole('button', { name: /^(Connect|Add|Apply)/ }).count(), 0)
  await dialog.getByRole('button', { name: 'Back to designs', exact: true }).click()
  await page.getByRole('navigation', { name: 'Wigggle categories' }).getByRole('button', { name: /^weather/ }).click()
  await page.locator('[data-design="weather-sm-01"]').getByRole('button', { name: 'Setup & status', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Weather 01 · Setup & status', exact: true })
  await dialog.getByText('Choose a location', { exact: true }).waitFor()
  await dialog.getByText('Enter coordinates manually', { exact: true }).click()
  await dialog.getByLabel('Latitude', { exact: true }).fill('0')
  await dialog.getByLabel('Longitude', { exact: true }).fill('0')
  await dialog.getByRole('button', { name: 'Save location', exact: true }).click()
  await dialog.getByText('Data available', { exact: true }).waitFor()
  assert.deepEqual(coordinates, { latitude: 0, longitude: 0 })
  weather = { ...weather, state: 'error', error: 'Weather provider temporarily unavailable' }
  await dialog.getByRole('button', { name: 'Check live data', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Weather provider temporarily unavailable' }).waitFor()
  assert.equal(await dialog.getByLabel('Latitude', { exact: true }).inputValue(), '0', 'recovery retains settings')
  weather = { ...weather, state: 'ready', error: null }
  holdRefresh = true
  const before = requests.filter(row => row.path.endsWith('/refresh')).length
  await dialog.getByRole('button', { name: 'Check live data', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.widget-setup-screen .widget-buttons button:last-child').disabled)
  assert.equal(await dialog.getByRole('button', { name: 'Check live data', exact: true }).isDisabled(), true)
  assert.equal(requests.filter(row => row.path.endsWith('/refresh')).length, before + 1)
  releaseRefresh(); holdRefresh = false
  await dialog.getByText('Data available', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: 'Wigggle categories' }).getByRole('button', { name: /^calendar/ }).click()
  await page.locator('[data-design="calendar-sm-01"]').getByRole('button', { name: 'Setup & status', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Calendar 01 · Setup & status', exact: true })
  const sources = dialog.getByRole('group', { name: 'Live data source' })
  if (await sources.count()) await sources.getByRole('button', { name: 'Next event', exact: true }).click()
  await dialog.getByText('Sign-in expired', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Reconnect Google Calendar', exact: true }).click()
  assert.equal(await page.evaluate(() => window.connectedSource), 'googlecalendar')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.renderSetupProof('glance.weather', { state: 'error', payload: null, error: 'Cannot reach weather service' }))
  await page.getByRole('button', { name: 'Setup & status', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Weather · Setup & status', exact: true })
  await dialog.getByText('Cannot reach weather service', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: /^Connect/ }).count(), 0, 'local settings are not connector authentication')
  assert.equal(await dialog.getByRole('button', { name: 'Open widget', exact: true }).count(), 0, 'a failed source does not offer an unusable editor')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.renderSetupProof('glance.music', { state: 'empty', payload: { supported: false, players: [], items: [] } }))
  await page.getByRole('button', { name: 'Menu Desktop music', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Setup & status', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Desktop music · Setup & status', exact: true })
  await dialog.getByText('Desktop media is not supported on this host', { exact: true }).waitFor()
  await dialog.getByText(/Run Amethyst on Linux with busctl/).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'Open widget', exact: true }).count(), 0, 'an unsupported player has setup steps instead of dead controls')
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    assert(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${width}: setup screen fits`)
  }
  await page.keyboard.press('Escape')
  const actualWeather = { state: 'ready', synced_at: '2026-10-30T10:00:00Z', payload: { temperature: 0, humidity: 0, wind_speed: 0, feels_like: -2, precipitation: 0, weather_code: 0, is_day: 0, timezone: 'UTC', hours: [], daily: [{ date: '2026-10-30', temperature_max: 5, temperature_min: -3, weather_code: 3 }] } }
  await page.evaluate(data => window.renderSetupProof('glance.weather', data, 'weather-sm-09'), actualWeather)
  await page.getByText('Fri', { exact: true }).waitFor()
  assert.match(await page.locator('.wigggle-live-weather').innerText(), /5°/)
  assert.match(await page.locator('.wigggle-live-weather').innerText(), /-3°/)
  assert.equal(await page.getByText(/No daily forecast is cached/).count(), 0)
  await page.evaluate(async () => {
    const { liveWeather } = await import('/src/components/wigggle/WeatherContext.jsx')
    window.weatherProjection = liveWeather({ temperature: 0, humidity: 0, wind_speed: 0, feels_like: -2, precipitation: 0, weather_code: 0, is_day: 0, hours: [{ time: '2026-10-30T12:00', temperature: 1, weather_code: 2 }], daily: [{ date: '2026-10-30', temperature_max: 5, temperature_min: -3, weather_code: 3 }] }).weather.data
  })
  assert.deepEqual(await page.evaluate(() => [window.weatherProjection.humidity, window.weatherProjection.windSpeed, window.weatherProjection.chanceOfRain, window.weatherProjection.isDay, window.weatherProjection.daily.temperatureMin[0], window.weatherProjection.hourly.weatherCode[0]]), [0, 0, 0, false, -3, 2])
  assert.equal(requests.some(row => /\/actions\/|\/drafts\//.test(row.path)), false, 'setup never bypasses approval or changes playback')
  assert.deepEqual(errors, [])
  console.log('PASS setup: all blocked designs explained, real weather setup/save/refresh/error recovery, pending checks, calendar reconnect, local/media guidance, responsive dialogs; no screenshots')
} finally { await browser.close() }
