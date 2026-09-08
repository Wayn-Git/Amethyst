// Synthetic Composio fixtures; no connected accounts or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
await fetch(`${backend}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets: [{ id: 'sys.connectors', size: 'm', height: 8 }] }) })
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.setDefaultTimeout(10000)
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
let fail = false, offline = false, connects = 0, reads = 0
const payload = { configured: true, items: [
  { id: 'gmail', status: 'needs reconnect', last_success: '2026-10-24T01:00:00Z', can_connect: true },
  { id: 'googlecalendar', status: 'not set up', last_success: null, can_connect: true },
  { id: 'slack', status: 'connected', last_success: null, can_connect: true, retry_at: 2000000000, circuit_open: true },
] }
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (url.pathname.startsWith('/api/widgets/sys.connectors/')) {
    ++reads
    if (offline) return route.abort('internetdisconnected')
    return route.fulfill({ json: { state: 'ok', payload, synced_at: '2026-10-24T01:00:00Z' } })
  }
  if (url.pathname.match(/^\/api\/connectors\/[^/]+\/connect$/)) {
    ++connects
    if (fail) return route.fulfill({ status: 503, json: { detail: 'Connect Link unavailable' } })
    assert.equal(route.request().method(), 'POST')
    assert.equal(route.request().postData(), null)
    return route.fulfill({ json: { redirect_url: 'https://connect.composio.dev/link/fixture' } })
  }
  if (url.pathname.startsWith('/api/widgets') || url.pathname === '/api/layout') return route.fulfill({ response: await route.fetch({ url: backend + url.pathname + url.search }) })
  let json = {}
  if (url.pathname.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => url.pathname.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177', { waitUntil: 'domcontentloaded' })
  const widget = page.locator('[data-widget="sys.connectors"]')
  await widget.getByText('needs reconnect', { exact: true }).waitFor()
  await widget.getByText('not set up', { exact: true }).waitFor()
  await widget.getByText('connected', { exact: true }).waitFor()
  await widget.getByText('Circuit open', { exact: false }).waitFor()
  await widget.getByRole('button', { name: 'Reconnect gmail', exact: true }).focus()
  await page.keyboard.press('Enter')
  const link = widget.getByRole('link', { name: 'Open Connect Link for gmail' })
  await link.waitFor()
  assert.equal(await link.getAttribute('href'), 'https://connect.composio.dev/link/fixture')
  assert.equal(await link.getAttribute('rel'), 'noreferrer')
  await page.waitForFunction(() => !document.querySelector('[data-widget="sys.connectors"] button:disabled'))
  await widget.getByRole('button', { name: 'Connect googlecalendar', exact: true }).click()
  await widget.getByRole('link', { name: 'Open Connect Link for googlecalendar' }).waitFor()
  assert.equal(connects, 2)
  const cached = await page.evaluate(() => localStorage.getItem('amethyst.widgets.sys.connectors'))
  assert.equal(cached.includes('connect.composio.dev'), false)
  fail = true
  await page.waitForFunction(() => !document.querySelector('[data-widget="sys.connectors"] button:disabled'))
  await widget.getByRole('button', { name: 'Reconnect slack', exact: true }).click()
  await widget.getByRole('alert').getByText('Connect Link unavailable', { exact: true }).waitFor()
  payload.items[0].status = 'connected'
  await widget.getByRole('button', { name: 'Refresh Connector health and reconnect', exact: true }).click()
  await widget.getByText('needs reconnect', { exact: true }).waitFor({ state: 'hidden' })
  assert.ok(reads >= 3)
  offline = true
  await page.reload({ waitUntil: 'domcontentloaded' })
  await widget.getByText('Stale data.', { exact: false }).waitFor()
  assert.equal(await widget.getByRole('link').count(), 0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await widget.evaluate(el => el.scrollWidth > el.clientWidth), false)
  for (const theme of ['paper', 'graphite']) {
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
    const bad = await widget.locator('button:visible').evaluateAll(nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5 || !(el.textContent.trim() || el.getAttribute('aria-label')) }).map(el => el.outerHTML))
    assert.deepEqual(bad, [])
  }
  console.log('PASS sys.connectors: health, Connect Link, reconnect, keyboard, error, cache, offline, mobile, button names/targets')
} finally { await browser.close() }
