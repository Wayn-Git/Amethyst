// Isolated dashboard server; synthetic search fixtures; capture uses the real draft gate.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const base = process.env.BASE || 'http://127.0.0.1:5177'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
await fetch(`${backend}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets: ['dash.palette', 'lib.capture'].map(id => ({ id, size: 'm', height: 4 })) }) })
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.setDefaultTimeout(15000)
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
let failSearch = false
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/api/dashboard/search') return route.fulfill(failSearch ? { status: 503, json: { detail: 'Fixture unavailable' } } : { json: { items: ['Library', 'Tasks', 'Widgets', 'Actions', 'Widget items'].map((group, index) => ({ id: index, title: `Needle ${group} fixture`, group, href: '/today?widget=task.today' })) } })
  if (url.pathname.startsWith('/api/widgets') || url.pathname === '/api/layout') return route.fulfill({ response: await route.fetch({ url: backend + url.pathname + url.search }) })
  let json = {}
  if (url.pathname.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => url.pathname.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  await page.goto(base + '/today')
  await page.getByRole('button', { name: 'Open command palette', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Spotlight Command Palette' })
  await dialog.waitFor()
  await dialog.getByLabel('Spotlight search and commands').fill('needle')
  for (const group of ['Library', 'Tasks', 'Widgets', 'Actions', 'Widget items']) await dialog.getByText(`Needle ${group} fixture`, { exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Quick capture', exact: true }).click()
  const capture = dialog.getByRole('region', { name: 'Quick capture' })
  await capture.getByLabel('Note title', { exact: true }).fill('Palette note fixture')
  await capture.getByLabel('Note text', { exact: true }).fill('Palette text fixture')
  await capture.getByRole('button', { name: 'Review note', exact: true }).click()
  await capture.getByRole('button', { name: 'Approve save', exact: true }).waitFor()
  await capture.getByRole('button', { name: 'Reject save', exact: true }).click()
  await capture.getByText('Note was not saved.', { exact: true }).waitFor()
  await dialog.getByText('Needle Widgets fixture', { exact: true }).click()
  await page.waitForURL('**/today?widget=task.today')
  await page.locator('[data-widget="task.today"]').waitFor()
  await page.keyboard.press('Control+k')
  await dialog.waitFor()
  failSearch = true
  await dialog.getByLabel('Spotlight search and commands').fill('offlinefixture')
  await dialog.getByText('Local search unavailable: Fixture unavailable', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await dialog.getByLabel('Spotlight search and commands').fill('')
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.goto(base + '/today')
  await page.locator('[data-widget="lib.capture"]').getByLabel('Note title', { exact: true }).focus()
  await page.keyboard.press('Control+k')
  await dialog.waitFor()
  assert.equal(await dialog.getByLabel('Spotlight search and commands').evaluate(el => el === document.activeElement), true)
  console.log('PASS palette: all local source groups, source navigation, quick capture review/reject, global Ctrl+K, Escape, search failure')
} finally { await browser.close() }
