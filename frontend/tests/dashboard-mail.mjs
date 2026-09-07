import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
const id = process.env.TEST_WIDGET || 'need.inbox'
const calls = []
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  calls.push(path)
  let json = {}
  if (path === '/api/widgets') json = { widgets: [{ enabled: true, manifest: { id, title: id, sizes: ['m'], source: { type: 'local' }, refresh: { mode: 'poll', interval_s: 900 }, empty: 'No items.' } }] }
  else if (path === '/api/layout') json = { widgets: [{ id, size: 'm', height: 4 }] }
  else if (path.endsWith('/data')) json = { state: 'ok', synced_at: new Date().toISOString(), payload: { items: [{ id: 1, subject: 'Fixture subject', from: 'sender@example.com', date: '2026-10-24', snippet: 'Fixture snippet', reason: 'Direct question' }], ranked: true } }
  else if (path.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => path.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177')
  const widget = page.locator(`[data-widget="${id}"]`)
  await widget.getByText('Why: Direct question').waitFor()
  assert.equal(await widget.getByText('Fixture snippet').count(), 1)
  assert.equal(calls.some(path => /composio|send/.test(path)), false)
  console.log(`${id}: passed`)
} finally { await browser.close() }
