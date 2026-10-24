// Isolated fixture-only UI checks; no connectors, models or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
const ids = (process.env.TEST_WIDGETS || 'agent.brief').split(',')
const item = { id: 'task.today:7', title: 'Fixture task', detail: 'Fixture detail', href: '/today?source=task.today&item=7', widget_id: 'task.today', reason: 'In Today list' }
const manifests = ids.map(id => ({ enabled: true, manifest: { id, title: id, source: { type: 'llm' }, sizes: ['m'], refresh: { mode: 'manual' }, empty: 'Nothing to report from cached widgets.' } }))
let state = 'ok'
await page.route('**/api/**', route => {
  const url = new URL(route.request().url())
  let json = {}
  if (url.pathname === '/api/widgets') json = { widgets: manifests }
  else if (url.pathname === '/api/layout') json = { widgets: ids.map(id => ({ id, size: 'm', height: 4 })) }
  else if (url.pathname.endsWith('/items/7')) json = item
  else if (/\/widgets\/.*\/(data|refresh)$/.test(url.pathname)) json = { state, payload: { items: state === 'empty' ? [] : [item] }, synced_at: new Date().toISOString() }
  else if (url.pathname.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => url.pathname.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  const base = process.env.BASE || 'http://127.0.0.1:5177'
  await page.goto(base + '/today')
  const widget = page.locator('[data-widget="agent.brief"]')
  if (ids.includes('agent.brief')) {
    await widget.getByRole('link', { name: 'Fixture task' }).waitFor()
    assert.equal(await widget.getByRole('link').getAttribute('href'), item.href)
    await widget.getByRole('link').click()
    await page.getByRole('region', { name: 'Source item' }).getByRole('heading', { name: 'Fixture task' }).waitFor()
    state = 'empty'; await page.goto(base + '/today')
    await widget.getByText('Nothing to report from cached widgets.').first().waitFor()
    await widget.getByRole('button', { name: 'Disable model selection' }).waitFor()
  }
  console.log('PASS grounded insights UI: linked source item, honest empty state, optional model')
} finally { await browser.close() }
