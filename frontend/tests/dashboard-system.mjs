// Synthetic fixtures; no connected accounts or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
const ids = ['dev.unpushed', 'sys.vault', 'sys.notify', 'need.approvals', 'sys.model']
await fetch(`${backend}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets: ids.map(id => ({ id, size: 'm', height: 5 })) }) })
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.setDefaultTimeout(10000)
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
let activeModel = { provider: 'local_fixture', model: 'local-model', location: 'local' }
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/api/widgets/sys.model/data') return route.fulfill({ json: { state: 'ok', payload: { active: activeModel, providers: [{ name: 'local_fixture', model: 'local-model', location: 'local' }, { name: 'cloud_fixture', model: 'cloud-model', location: 'cloud' }] } } })
  if (url.pathname === '/api/widgets/sys.model/actions/switch') {
    assert.deepEqual(route.request().postDataJSON(), { provider: 'cloud_fixture', model: 'cloud-model' })
    return route.fulfill({ json: { draft_id: 'model-fixture', item: route.request().postDataJSON(), state: 'awaiting-approval' } })
  }
  if (url.pathname === '/api/widgets/sys.model/drafts/model-fixture') {
    const approved = route.request().postDataJSON().approved
    if (approved) activeModel = { provider: 'cloud_fixture', model: 'cloud-model', location: 'cloud' }
    return route.fulfill({ json: { state: approved ? 'applied' : 'denied' } })
  }
  if (url.pathname === '/api/widgets/sys.notify/data') return route.fulfill({ json: { state: 'ok', payload: { items: [{ id: 1, title: 'Reminder fixture', detail: 'Due 12:00' }] } } })
  if (url.pathname === '/api/widgets/need.approvals/data') return route.fulfill({ json: { state: 'ok', payload: { items: [], history: [{ id: 1, title: 'Gate fixture', detail: 'denied' }] } } })
  if (url.pathname.startsWith('/api/widgets') || url.pathname === '/api/layout') return route.fulfill({ response: await route.fetch({ url: backend + url.pathname + url.search }) })
  let json = {}
  if (url.pathname.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => url.pathname.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-widget="sys.vault"]').getByText('0 files · 0 bytes', { exact: true }).waitFor()
  await page.locator('[data-widget="sys.notify"]').getByText('Reminder fixture', { exact: true }).waitFor()
  const approvals = page.locator('[data-widget="need.approvals"]')
  await approvals.getByText('Approval history', { exact: true }).waitFor()
  assert.equal(await approvals.getByRole('button', { name: 'Approve', exact: true }).count(), 0)
  const git = page.locator('[data-widget="dev.unpushed"]')
  await git.getByLabel('Local repository paths (one per line)', { exact: true }).fill('/tmp/amethyst-missing-widget-fixture')
  await git.getByRole('button', { name: 'Save repositories', exact: true }).click()
  await git.getByText('Repository details unavailable', { exact: true }).waitFor()
  await git.getByText('Working tree: unknown', { exact: true }).waitFor()
  const model = page.locator('[data-widget="sys.model"]')
  await model.getByText('local_fixture / local-model · local', { exact: true }).waitFor()
  for (const decision of ['Deny', 'Approve']) {
    await model.getByLabel('Model provider', { exact: true }).selectOption('cloud_fixture')
    assert.equal(await model.getByLabel('Model name', { exact: true }).inputValue(), 'cloud-model')
    await model.getByRole('button', { name: 'Draft switch', exact: true }).click()
    await model.getByText('Switch default to cloud_fixture / cloud-model?', { exact: true }).waitFor()
    await model.getByRole('button', { name: decision, exact: true }).click()
    await model.getByRole('button', { name: 'Draft switch', exact: true }).waitFor({ state: 'visible' })
    await page.waitForFunction(() => !document.querySelector('[data-widget="sys.model"] form button')?.disabled)
  }
  await model.getByText('cloud_fixture / cloud-model · cloud', { exact: true }).waitFor()
  console.log('Dashboard system and durable approval UI passed')
} catch (error) { console.error(await page.locator('[data-widget="sys.model"]').textContent()); throw error } finally { await browser.close() }
