// Real Today composition, all shipped manifests; synthetic API responses only.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixtures } from '../src/dev/widgets/fixtures.js'
import { SYSTEM_WIDGETS, preferredWidgetSize } from '../src/dashboard/layout.js'

const manifests = JSON.parse(readFileSync(new URL('../src/dev/widgets/manifests.json', import.meta.url)))
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
 page.setDefaultTimeout(10000)
 const errors = [], requests = []
 let layout = { widgets: manifests.map(m => ({ id: m.id, size: preferredWidgetSize(m), height: 3 })) }
 let calendarEnabled = true
 const settings = { 'task.free': { start: '10:15', end: '18:45', days: [0, 2], timezone: 'Asia/Kolkata' } }
 page.on('pageerror', e => errors.push(e.message))
 await page.addInitScript(() => {
  if (window.top !== window) return
  localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' }))
  localStorage.setItem('amethyst.ui.forceDesktop', '1')
 })
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON()
  requests.push({ path, body })
  let json = {}
  if (path === '/api/widgets') json = { widgets: manifests.map(manifest => ({ enabled: true, manifest })) }
  else if (path === '/api/layout') { if (body) layout = body; json = layout }
  else if (path === '/api/connectors/health') json = { configured: true, items: ['gmail', 'github', 'slack', 'googlecalendar'].map(id => ({ id, status: 'connected', account_id: `fixture-${id}`, can_connect: true })) }
  else if (path.includes('/settings')) {
   const id = path.split('/')[3]
   if (body) { settings[id] = body; if (id === 'task.agenda') calendarEnabled = body.enabled }
   json = settings[id] || { enabled: true, repos: [] }
  } else if (/\/(data|refresh)$/.test(path)) {
   const id = path.split('/')[3]
   const disabled = !calendarEnabled && ['task.agenda', 'glance.next-event', 'glance.travel', 'task.plan', 'task.free', 'task.conflicts', 'task.risk'].includes(id)
   json = { state: disabled ? 'not-connected' : 'ok', payload: disabled ? null : fixtures[id], synced_at: new Date().toISOString() }
  } else if (path.startsWith('/api/dashboard/search/library/')) json = { title: 'Fixture source note', widget_id: 'library', detail: 'First paragraph.\n\nSecond paragraph.' }
  else if (path.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => path.endsWith(p))) json = []
  await route.fulfill({ json })
 })
 const base = process.env.BASE || 'http://127.0.0.1:5177'
 await page.goto(`${base}/today`)
 const active = manifests.filter(m => !SYSTEM_WIDGETS.includes(m.id))
 await page.waitForFunction(count => document.querySelectorAll('[data-slot-id] .widget-content').length === count && !document.querySelector('.widget-skeleton'), active.length)
 const card = id => page.locator(`[data-slot-id="${id}"] [data-widget="${id}"]`)
 for (const manifest of active) {
  const node = card(manifest.id)
  assert.equal(await node.count(), 1, `${manifest.id} appears once on Today`)
  assert.equal(await node.getByRole('heading', { name: manifest.title, exact: true }).count(), 1)
  assert.equal(await node.locator('.widget-source').isVisible(), true, `${manifest.id}: source visible`)
  assert.equal(await node.getByRole('button', { name: `Refresh ${manifest.title}`, exact: true }).count(), 1)
 }
 assert.equal(await page.getByText('This widget could not render.', { exact: true }).count(), 0)
 for (const theme of ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']) {
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
  for (const width of [1440, 1024, 768, 390, 360]) {
   await page.setViewportSize({ width, height: 1000 })
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: page overflow`)
   const overflow = await page.locator('[data-slot-id] .widget-content').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 2 || node.getBoundingClientRect().bottom > node.closest('[data-slot-id]').getBoundingClientRect().bottom + 2).map(node => ({ id: node.closest('[data-widget]').dataset.widget, width: node.clientWidth, scroll: node.scrollWidth, bottom: node.getBoundingClientRect().bottom, slotBottom: node.closest('[data-slot-id]').getBoundingClientRect().bottom })))
   assert.deepEqual(overflow, [], `${theme} ${width}: content contained`)
  }
 }
 await page.setViewportSize({ width: 1440, height: 1000 })
 const plan = card('task.plan')
 await plan.getByText('Working hours settings', { exact: true }).click()
 assert.equal(await plan.getByLabel('Start', { exact: true }).inputValue(), '10:15')
 assert.equal(await plan.getByLabel('End', { exact: true }).inputValue(), '18:45')
 assert.equal(await plan.getByLabel('Mon', { exact: true }).isChecked(), true)
 assert.equal(await plan.getByLabel('Tue', { exact: true }).isChecked(), false)
 const before = requests.length
 await card('task.agenda').getByRole('button', { name: 'Stop calendar access and delete cached data', exact: true }).click()
 await card('glance.next-event').getByRole('button', { name: 'Check connection', exact: true }).waitFor()
 for (const id of ['task.agenda', 'glance.next-event', 'glance.travel', 'task.plan', 'task.free', 'task.conflicts', 'task.risk']) assert(requests.slice(before).some(r => r.path === `/api/widgets/${id}/refresh`), `${id}: calendar access change propagates`)
 assert.equal(await card('glance.next-event').getByText('Sample: design review', { exact: true }).count(), 0, 'deleted calendar data disappears from the card')
 await page.getByRole('button', { name: 'Home settings', exact: true }).click()
 const dialog = page.getByRole('dialog', { name: 'Home settings', exact: true })
 for (const name of ['Connections', 'Refresh status', 'Quiet hours', 'Keyboard shortcuts', 'Widget gallery']) {
  await dialog.getByRole('tab', { name, exact: true }).click()
  assert.equal(await dialog.getByRole('tabpanel').getByRole('heading', { name, exact: true, level: 3 }).isVisible(), true)
 }
 await dialog.getByRole('tab', { name: 'Quiet hours', exact: true }).focus()
 await page.keyboard.press('ArrowRight')
 assert.equal(await dialog.getByRole('tab', { name: 'Keyboard shortcuts', exact: true }).getAttribute('aria-selected'), 'true')
 await page.keyboard.press('Escape')
 for (const id of ['lib.inbox', 'lib.recent', 'lib.resurface', 'lib.dupes', 'lib.search']) assert.equal(await card(id).getByRole('link', { name: fixtures[id].items[0].title, exact: true }).getAttribute('href'), '/today?source=library&item=1', `${id}: source opens`)
 await card('lib.inbox').getByRole('link', { name: fixtures['lib.inbox'].items[0].title, exact: true }).click()
 await page.getByRole('region', { name: 'Source item', exact: true }).getByRole('heading', { name: 'Fixture source note', exact: true }).waitFor()
 assert.equal(await page.locator('.source-item-detail').evaluate(node => getComputedStyle(node).whiteSpace), 'pre-wrap')
 assert.deepEqual(errors, [])
 console.log(`PASS all ${manifests.length} Today components: ${active.length} live cards, four settings sections, source links, all nine themes, five widths, saved planning settings, calendar cache deletion propagation; no screenshots`)
} finally { await browser.close() }
