// Day 1 shell regression. Uses an isolated backend; no connectors or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { moveWidget, quietNow, resizeWidget } from '../src/dashboard/layout.js'

assert.deepEqual(moveWidget([{ id: 'a' }, { id: 'b' }], 'a', 'b'), [{ id: 'b' }, { id: 'a' }])
assert.deepEqual(resizeWidget({ id: 'a', size: 'm', height: 3 }, ['s', 'm', 'l'], 600, 100, 1200), { id: 'a', size: 'l', height: 4 })
assert.equal(resizeWidget({ id: 'a', size: 'm', height: 3 }, ['m'], 0, 100, 390, NaN).height, 4)
assert.equal(quietNow({ enabled: true, start: '22:00', end: '07:00', timezone: 'UTC' }, new Date('2026-10-24T23:00:00Z')), true)
const base = process.env.BASE || 'http://127.0.0.1:5177'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
const defaultLayout = { widgets: ['glance.clock', 'dash.sync', 'dash.quiet', 'dash.shortcuts', 'dash.gallery'].map(id => ({ id, size: 'm', height: id === 'dash.quiet' ? 4 : 3 })) }
await fetch(`${backend}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(defaultLayout) })
await fetch(`${backend}/api/widgets/dash.quiet/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
await fetch(`${backend}/api/widgets/glance.clock/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"zones":[]}' })
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(15000)
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
let offline = false, brokenClock = false, clockState = null
const calls = []
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()); calls.push(url.pathname)
  if (url.pathname.startsWith('/api/widgets') || url.pathname === '/api/layout') {
    if (offline) return route.abort('internetdisconnected')
    if (url.pathname === '/api/widgets/glance.clock/data' && (brokenClock || clockState)) return route.fulfill({ json: { state: clockState || 'ok', payload: brokenClock ? { zones: ['Invalid/Zone'] } : null, synced_at: new Date().toISOString(), error: clockState === 'error' ? 'Fixture failure' : null } })
    return route.fulfill({ response: await route.fetch({ url: backend + url.pathname + url.search }) })
  }
  let json = {}
  if (url.pathname.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => url.pathname.endsWith(p))) json = []
  return route.fulfill({ json })
})
const clock = page.locator('[data-widget="glance.clock"]')
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  console.log('Loaded Home')
  await clock.locator('.home-clock').waitFor()
  assert.equal(calls.some(path => path.startsWith('/api/today') || path.includes('composio')), false)
  assert.equal(await page.locator('.home-widget').count(), 5)
  await page.getByRole('button', { name: 'Edit layout', exact: true }).first().click()
  const handle = page.getByRole('button', { name: 'Move Clock', exact: true })
  await handle.focus(); await page.keyboard.press('ArrowRight')
  await page.getByText('Layout saved', { exact: true }).waitFor()
  let layout = await (await fetch(`${backend}/api/layout`)).json()
  assert.equal(layout.widgets[1].id, 'glance.clock')
  await page.getByLabel('Size Clock', { exact: true }).selectOption('l')
  await page.getByText('Layout saved', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'domcontentloaded' }); await clock.locator('.home-clock').waitFor()
  layout = await (await fetch(`${backend}/api/layout`)).json()
  assert.equal(layout.widgets.find(w => w.id === 'glance.clock').size, 'l')
  await page.getByRole('button', { name: 'Edit layout', exact: true }).first().click()
  await page.getByLabel('Size Clock', { exact: true }).selectOption('m')
  await page.getByText('Layout saved', { exact: true }).waitFor()
  const move = await page.getByRole('button', { name: 'Move Clock', exact: true }).boundingBox()
  const target = await page.locator('[data-widget="dash.sync"]').boundingBox()
  await page.mouse.move(move.x + 20, move.y + 20); await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 8 }); await page.mouse.up()
  await page.getByText('Layout saved', { exact: true }).waitFor()
  layout = await (await fetch(`${backend}/api/layout`)).json()
  assert.equal(layout.widgets[0].id, 'glance.clock')
  const resize = page.getByRole('button', { name: 'Resize Clock', exact: true })
  await resize.scrollIntoViewIfNeeded(); const rect = await resize.boundingBox()
  await page.mouse.move(rect.x + 20, rect.y + 20); await page.mouse.down(); await page.mouse.move(rect.x + 20, rect.y + 140, { steps: 8 }); await page.mouse.up()
  await page.getByText('Layout saved', { exact: true }).waitFor()
  layout = await (await fetch(`${backend}/api/layout`)).json()
  assert.equal(layout.widgets.find(w => w.id === 'glance.clock').height, 4)
  await page.getByRole('button', { name: 'Finish editing', exact: true }).first().click()
  console.log('Layout interactions passed')
  await page.getByLabel('World clock timezone').fill('Europe/London')
  await page.getByRole('button', { name: 'Add clock', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Europe/London' }).waitFor()
  await page.getByRole('button', { name: 'Snooze 1 hour', exact: true }).click()
  await page.getByText('Quiet now. Automatic widget refresh paused.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Refresh Clock', exact: true }).click()
  await page.getByRole('button', { name: 'Resume refresh', exact: true }).click()
  for (const [state, text] of [['loading', 'Loading widget…'], ['empty', 'Nothing to show yet.'], ['not-connected', 'Not connected. Required source or setting is unavailable.'], ['error', 'Fixture failure']]) {
    clockState = state; await page.reload({ waitUntil: 'domcontentloaded' }); await clock.getByText(text, { exact: true }).waitFor()
  }
  clockState = null; brokenClock = true
  await page.reload({ waitUntil: 'domcontentloaded' }); await clock.getByText('This widget could not render.', { exact: true }).waitFor()
  await page.locator('[data-widget="dash.shortcuts"] kbd').first().waitFor()
  brokenClock = false; await page.reload({ waitUntil: 'domcontentloaded' }); await clock.locator('.home-clock').waitFor()
  offline = true; await page.reload({ waitUntil: 'domcontentloaded' }); await clock.getByText('Stale data.', { exact: false }).waitFor()
  assert.equal(await page.locator('.home-widget').count(), 5)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.locator('.widget-home').evaluate(el => el.scrollWidth > el.clientWidth), false)
  const badButtons = await page.locator('.widget-home button:visible').evaluateAll(nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5 || !(el.textContent.trim() || el.getAttribute('aria-label')) }).map(el => el.outerHTML))
  assert.deepEqual(badButtons, [])
  console.log('PASS shell: drag, resize, keyboard move, SQLite layout reload, clock zones, quiet/snooze, manual refresh, five states, error isolation, offline reload, mobile width, accessible button names/targets')
} finally { await browser.close() }
