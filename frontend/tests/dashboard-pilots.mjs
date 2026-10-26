// Synthetic payloads only; no connectors, backend writes or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kolkata' })
 const errors = [], requests = []
 page.on('pageerror', e => errors.push(e.message))
 await page.clock.setFixedTime(new Date('2026-10-26T06:00:00Z'))
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  requests.push({ path, body: route.request().postDataJSON() })
  let json = {}
  if (path.includes('/actions/')) json = { draft_id: 'fixture', action: path.split('/').at(-1), item: route.request().postDataJSON() }
  if (path.includes('/drafts/')) json = { state: 'applied' }
  await route.fulfill({ json })
 })
 await page.route('**/__pilots__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
 await page.goto((process.env.BASE || 'http://127.0.0.1:5177') + '/__pilots__')
 await page.evaluate(async () => {
  const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
  const { default: React } = await import('/node_modules/.vite/deps/react.js')
  const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
  const { BentoGrid, Tile, ConnectTile } = await import('/src/components/ui/bento/index.jsx')
  const { WidgetState } = await import('/src/dashboard/primitives.jsx')
  const { ClockFace } = await import('/src/dashboard/widgets/Clock.jsx')
  const { WeatherFace } = await import('/src/dashboard/widgets/Weather.jsx')
  const { default: Mail } = await import('/src/dashboard/widgets/Mail.jsx')
  const { default: Items } = await import('/src/dashboard/widgets/Items.jsx')
  const { default: Focus } = await import('/src/dashboard/widgets/Focus.jsx')
  const { default: Director } = await import('/src/dashboard/widgets/Director.jsx')
  await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/widget-pilots.css')
  const h = React.createElement, now = Date.now(), refresh = async () => {}
  const tasks = [{ id: 'one', title: 'Fixture task', editable: true }, { id: 'two', title: 'Remote fixture', editable: false }]
  const deadlines = [{ id: 'old', title: 'Overdue fixture', due_at: new Date(now - 3600000).toISOString() }, { id: 'today', title: 'Today fixture', due_at: new Date(now + 3600000).toISOString() }, { id: 'later', title: 'Future fixture', due_at: new Date(now + 86400000).toISOString() }]
  const pilots = [
   ['glance.clock', 'dark', ClockFace, { now: new Date(now) }],
   ['glance.weather', 'accent', WeatherFace, { data: { temperature: 22, timezone: 'Asia/Kolkata', rain_alert: true } }],
   ['need.inbox', 'light', Mail, { data: { items: [{ id: 'mail', from: 'Ada Lovelace', subject: 'Fixture subject', unread: true, reason: 'Fixture reason', date: 'Today' }] } }],
   ['task.today', 'light', Items, { data: { items: tasks } }],
   ['task.deadlines', 'light', Items, { data: { items: deadlines } }],
   ['task.focus', 'light', Focus, { data: { focus_minutes: 25, items: [] } }],
   ['agent.feed', 'dark', Director, { data: { items: [{ id: 'trace', title: 'Fixture turn', detail: '2 tool calls completed' }] } }],
  ]
  window.pilotRoot = createRoot(document.getElementById('proof'))
  window.renderPilots = (loading = false, active = false) => window.pilotRoot.render(h('main', { className: 'bento-foundation widget-home' }, h(BentoGrid, null,
   ...pilots.map(([id, tone, Component, props]) => h(Tile, { key: id, tone, size: id.startsWith('glance') ? 's' : 'm', className: 'widget-pilot', 'data-widget': id }, h('h2', null, id), h('div', { className: 'widget-content' }, h(WidgetState, { data: { state: loading ? 'loading' : 'ready' } }, h(Component, { ...props, ...(active && id === 'task.focus' ? { data: { items: [{ id: 'timer', mode: 'focus', started_at: new Date(now - 60000).toISOString(), duration_s: 1500 }] } } : {}), widgetId: id, refresh }))))),
   h(ConnectTile, { source: 'GitHub', size: 's', onConnect: () => { window.connected = true } })
  )))
  window.renderPilots()
 })
 await page.getByText('Fixture task', { exact: true }).waitFor()
 await page.getByRole('switch', { name: 'Rank with model' }).click()
 assert.equal(requests.find(r => r.path === '/api/widgets/need.inbox/settings').body.model_enabled, true)
 assert.equal(await page.getByRole('img', { name: 'Ada Lovelace' }).innerText(), 'AL')
 assert.equal(await page.getByRole('img', { name: 'Completed in current list: 0 / 2', exact: true }).count(), 1)
 assert.deepEqual(await page.locator('.pilot-deadlines .ui-stat > div').allTextContents(), ['1', '1'])
 await page.getByRole('checkbox', { name: 'Toggle complete Fixture task' }).click()
 await page.getByRole('button', { name: 'Reject change', exact: true }).click()
 assert.equal(requests.find(r => r.path.endsWith('/actions/complete')).body.id, 'one')
 await page.getByLabel('New item title').first().fill('Inline fixture')
 await page.getByRole('button', { name: 'Add item' }).first().click()
 await page.getByRole('button', { name: 'Approve change', exact: true }).click()
 assert.equal(requests.find(r => r.path === '/api/widgets/task.today/actions/add').body.title, 'Inline fixture')
 await page.getByRole('button', { name: 'Start focus', exact: true }).click()
 await page.getByRole('button', { name: 'Reject change', exact: true }).click()
 assert.equal(requests.find(r => r.path === '/api/widgets/task.focus/actions/start').body.mode, 'focus')
 await page.evaluate(() => window.renderPilots(false, true))
 assert.equal(await page.getByLabel('Time remaining', { exact: true }).innerText(), '24:00')
 await page.getByRole('button', { name: 'Stop timer' }).click()
 await page.getByRole('button', { name: 'Reject change', exact: true }).click()
 await page.getByRole('button', { name: 'Connect', exact: true }).click()
 assert.equal(await page.evaluate(() => window.connected), true)
 for (const theme of ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']) {
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} overflow ${width}`)
  }
 }
 await page.setViewportSize({ width: 1440, height: 1000 })
 const heights = () => page.locator('.widget-pilot').evaluateAll(nodes => nodes.map(n => Math.round(n.getBoundingClientRect().height)))
 const loaded = await heights()
 await page.evaluate(() => window.renderPilots(true))
 await page.getByLabel('Loading widget…').first().waitFor()
 assert.deepEqual(await heights(), loaded, 'loading preserves tile geometry')
 await page.evaluate(() => window.renderPilots())
 await page.getByText('Fixture task', { exact: true }).waitFor()
 await page.emulateMedia({ reducedMotion: 'reduce' })
 assert.equal(await page.locator('.pilot-number').first().evaluate(n => getComputedStyle(n).animationName), 'none')
 assert.equal(await page.locator('.ui-ring circle').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s')
 assert.deepEqual(errors, [])
 console.log('PASS pilot anatomy, real counts, gated controls, timer, Connect, nine themes, 390/1440, loading geometry, reduced motion')
} finally { await browser.close() }
