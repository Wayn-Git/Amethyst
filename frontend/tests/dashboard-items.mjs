// Isolated local backend, synthetic items, no connectors or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
const widgets = (process.env.TEST_WIDGETS || 'task.today').split(',')
await fetch(`${backend}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets: widgets.map(id => ({ id, size: 'm', height: 5 })) }) })
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.setDefaultTimeout(15000)
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (url.pathname.startsWith('/api/widgets') || url.pathname === '/api/layout') return route.fulfill({ response: await route.fetch({ url: backend + url.pathname + url.search }) })
  let json = {}
  if (url.pathname.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => url.pathname.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177', { waitUntil: 'domcontentloaded' })
  for (const id of widgets.filter(id => id.startsWith('task.'))) {
    const card = page.locator(`[data-widget="${id}"]`)
    const title = `Fixture ${id} ${Date.now()}`
    await card.getByRole('button', { name: 'Add item', exact: true }).click()
    await card.getByLabel('Title', { exact: true }).fill(title)
    if (['task.deadlines', 'task.reminders'].includes(id)) await card.getByLabel('Due', { exact: true }).fill('2026-10-20T12:30')
    await card.getByRole('button', { name: 'Review change', exact: true }).click()
    await card.getByRole('button', { name: 'Reject change', exact: true }).click()
    assert.equal(await card.locator('li').filter({ hasText: title }).count(), 0)
    await card.getByRole('button', { name: 'Review change', exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByRole('button', { name: `Edit ${title}`, exact: true }).click()
    await card.getByLabel('Title', { exact: true }).fill(`${title} edited`)
    await card.getByRole('button', { name: 'Review change', exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByRole('button', { name: `Complete ${title} edited`, exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByRole('button', { name: 'Add item', exact: true }).click()
    await card.getByLabel('Title', { exact: true }).fill(`${title} delete`)
    if (['task.deadlines', 'task.reminders'].includes(id)) await card.getByLabel('Due', { exact: true }).fill('2026-10-20T12:30')
    await card.getByRole('button', { name: 'Review change', exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByRole('button', { name: `Delete ${title} delete`, exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByRole('button', { name: `Delete ${title} delete`, exact: true }).waitFor({ state: 'hidden' })
    console.log(`${id}: inline add/edit/complete/delete and rejection passed`)
  }
} finally { await page.unrouteAll({ behavior: 'wait' }); await browser.close() }
