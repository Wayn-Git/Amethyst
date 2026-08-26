// Isolated local backend, synthetic items, no connectors or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
const widgets = (process.env.TEST_WIDGETS || 'task.today').split(',')
async function api(path, body) {
  const response = await fetch(`${backend}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(response.status, 200)
  return response.json()
}
if (widgets.includes('need.overdue')) {
  for (const widget of ['task.today', 'task.deadlines', 'task.reminders']) {
    const draft = await api(`/widgets/${widget}/actions/add`, { title: `Overdue fixture ${widget}`, due_at: '2020-01-01T00:00:00Z' })
    await api(`/widgets/${widget}/drafts/${draft.draft_id}`, { approved: true })
  }
}
await fetch(`${backend}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets: widgets.map(id => ({ id, size: 'm', height: 5 })) }) })
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.setDefaultTimeout(15000)
page.on('pageerror', error => console.error(error.message))
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (widgets.includes('need.snoozed') && url.pathname === '/api/widgets/need.snoozed/data') return route.fulfill({ json: { state: 'ok', synced_at: new Date().toISOString(), payload: { items: [
    { id: '1', title: 'Snooze fixture ready', source: 'task.today', until: '2026-10-24T01:00:00Z', return_state: 'ready' },
    { id: '2', title: 'Snooze fixture later', source: 'task.deadlines', until: '2026-10-24T18:00:00Z', return_state: 'scheduled' },
  ] } } })
  if (widgets.includes('lib.resurface') && url.pathname === '/api/widgets/lib.resurface/data') return route.fulfill({ json: { state: 'ok', synced_at: new Date().toISOString(), payload: { items: [{ id: 1, title: 'Old seeds fixture', kind: 'note', reason: 'Recent capture: Gardening', excerpt: 'Plant seeds' }] } } })
  if (widgets.includes('lib.dupes') && url.pathname === '/api/widgets/lib.dupes/data') return route.fulfill({ json: { state: 'ok', synced_at: new Date().toISOString(), payload: { items: [{ id: 2, title: 'Duplicate fixture', kind: 'article', reason: 'Same url: Original fixture', duplicate_of: 1 }] } } })
  if (widgets.includes('lib.search') && url.pathname === '/api/widgets/lib.search/data') return route.fulfill({ json: { state: 'ok', synced_at: new Date().toISOString(), payload: { query: 'Fixture query', degraded: 'offline', items: [{ id: 3, title: 'Search result fixture', kind: 'note', excerpt: 'Matched passage fixture' }] } } })
  if (widgets.includes('task.agenda') && url.pathname === '/api/widgets/task.agenda/data') return route.fulfill({ json: { state: 'ok', synced_at: new Date().toISOString(), payload: { timezone: 'UTC', today: '2026-10-24', week_start: '2026-10-19', items: [
    { id: 'past', title: 'Earlier fixture', start: '2026-10-19T10:00:00Z', end: '2026-10-19T11:00:00Z', all_day: false },
    { id: 'today', title: 'Agenda fixture', start: '2026-10-24T10:00:00Z', end: '2026-10-24T11:00:00Z', all_day: false },
    { id: 'day', title: 'All day fixture', start: '2026-10-25T00:00:00Z', end: '2026-10-26T00:00:00Z', all_day: true },
  ] } } })
  if (widgets.includes('dev.appeal') && /\/api\/widgets\/dev.appeal\/cases\/\d+\/follow-up$/.test(url.pathname)) return route.fulfill({ json: { text: 'Unsent follow-up fixture' } })
  if (url.pathname.startsWith('/api/widgets') || url.pathname === '/api/layout') return route.fulfill({ response: await route.fetch({ url: backend + url.pathname + url.search }) })
  let json = {}
  if (url.pathname.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => url.pathname.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177', { waitUntil: 'domcontentloaded' })
  if (widgets.includes('dev.backup')) {
    const card = page.locator('[data-widget="dev.backup"]')
    await card.getByLabel('Local repository paths (one per line)', { exact: true }).fill('/tmp/amethyst-missing-widget-fixture')
    await card.getByRole('button', { name: 'Save repositories', exact: true }).click()
    await card.getByText('No readable local clone', { exact: true }).waitFor()
    await card.getByLabel('Local repository paths (one per line)', { exact: true }).fill('relative-path')
    await card.getByRole('button', { name: 'Save repositories', exact: true }).click()
    await card.getByRole('alert').waitFor()
  }
  if (widgets.includes('dev.appeal')) {
    const card = page.locator('[data-widget="dev.appeal"]')
    await card.getByLabel('Case title', { exact: true }).fill('Support fixture')
    await card.getByLabel('Submitted date', { exact: true }).fill('2020-01-01')
    await card.getByRole('button', { name: 'Review case', exact: true }).click()
    await card.getByRole('button', { name: 'Reject change', exact: true }).click()
    assert.equal(await card.locator('strong').filter({ hasText: 'Support fixture' }).count(), 0)
    await card.getByRole('button', { name: 'Review case', exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.locator('strong').filter({ hasText: 'Support fixture' }).waitFor()
    await card.getByRole('button', { name: 'Mark reply received', exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByText(/Status: Reply/).waitFor()
    await card.getByRole('button', { name: 'Draft follow-up', exact: true }).click()
    await card.getByText('Unsent follow-up fixture', { exact: true }).waitFor()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByText('Unsent follow-up: Unsent follow-up fixture', { exact: true }).waitFor()
  }
  if (widgets.includes('task.agenda')) {
    const card = page.locator('[data-widget="task.agenda"]')
    await card.getByText('Agenda fixture', { exact: true }).waitFor()
    assert.equal(await card.getByText('Earlier fixture', { exact: true }).count(), 0)
    await card.getByText(/All day ·/).waitFor()
    await card.getByRole('button', { name: 'Week', exact: true }).click()
    await card.getByText('Earlier fixture', { exact: true }).waitFor()
    await card.getByRole('button', { name: 'Agenda', exact: true }).click()
    assert.equal(await card.getByText('Earlier fixture', { exact: true }).count(), 0)
    await card.getByRole('button', { name: 'Stop calendar access and delete cached data', exact: true }).click()
    await card.getByRole('button', { name: 'Enable calendar access', exact: true }).waitFor()
    assert.equal(await card.getByText('Agenda fixture', { exact: true }).count(), 0)
    assert.equal(await card.getByRole('button', { name: 'Add item', exact: true }).count(), 0)
  }
  if (widgets.includes('lib.resurface')) {
    const card = page.locator('[data-widget="lib.resurface"]')
    await card.getByText('Old seeds fixture', { exact: true }).waitFor()
    await card.getByText('Recent capture: Gardening', { exact: true }).waitFor()
  }
  if (widgets.includes('lib.recent')) await page.locator('[data-widget="lib.recent"]').getByText('No saved items.', { exact: true }).waitFor()
  if (widgets.includes('lib.inbox')) await page.locator('[data-widget="lib.inbox"]').getByText('No saved items.', { exact: true }).waitFor()
  if (widgets.includes('need.snoozed')) {
    const card = page.locator('[data-widget="need.snoozed"]')
    await card.getByText('Snooze fixture ready', { exact: true }).waitFor()
    await card.getByText(/Ready now/).waitFor()
    await card.getByText(/Returns today/).waitFor()
    assert.equal(await card.getByRole('button', { name: 'Add item', exact: true }).count(), 0)
    console.log('need.snoozed: ready and scheduled states rendered')
  }
  if (widgets.includes('need.overdue')) {
    await page.getByLabel('Menu Needs you', { exact: true }).click()
    await page.getByRole('button', { name: 'Overdue items', exact: true }).click()
    const card = page.locator('[data-widget="need.overdue"]')
    for (const widget of ['task.today', 'task.deadlines', 'task.reminders']) await card.getByText(`Overdue fixture ${widget}`, { exact: true }).first().waitFor()
    assert.equal(await card.getByRole('button', { name: 'Add item', exact: true }).count(), 0)
    await page.keyboard.press('Escape')
    console.log('need.overdue: three source lists rendered')
  }
  if (widgets.includes('lib.dupes')) {
    const card = page.locator('[data-widget="lib.dupes"]')
    await card.getByText('Duplicate fixture', { exact: true }).waitFor()
    await card.getByText('Same url: Original fixture', { exact: true }).waitFor()
    assert.equal(await card.getByRole('button', { name: /delete|merge/i }).count(), 0)
  }
  if (widgets.includes('lib.ask')) {
    const card = page.locator('[data-widget="lib.ask"]')
    await card.getByLabel('Ask your notes', { exact: true }).fill('')
    await card.getByRole('button', { name: 'Ask', exact: true }).click()
    await card.getByText('not in your notes', { exact: true }).waitFor()
  }
  if (widgets.includes('lib.search')) {
    const card = page.locator('[data-widget="lib.search"]')
    await card.getByText('Search result fixture', { exact: true }).waitFor()
    await card.getByText('Matched passage fixture', { exact: true }).waitFor()
    await card.getByText('Keyword results only; semantic search unavailable.', { exact: true }).waitFor()
    await card.getByLabel('Search Library', { exact: true }).fill('')
    await card.getByRole('button', { name: 'Search', exact: true }).click()
    await card.getByRole('button', { name: 'Search', exact: true }).waitFor({ state: 'visible' })
    assert.equal(await card.getByRole('alert').count(), 0)
  }
  if (widgets.includes('lib.capture')) {
    const card = page.locator('[data-widget="lib.capture"]')
    await card.getByLabel('Note title', { exact: true }).fill('Browser note fixture')
    await card.getByLabel('Note text', { exact: true }).fill('Browser body fixture')
    await card.getByRole('button', { name: 'Review note', exact: true }).click()
    await card.getByText('Browser body fixture', { exact: true }).waitFor()
    await card.getByRole('button', { name: 'Reject save', exact: true }).click()
    await card.getByText('Note was not saved.', { exact: true }).waitFor()
    await page.keyboard.press('Control+k')
    await page.getByRole('dialog', { name: 'Spotlight Command Palette' }).waitFor()
    await page.keyboard.press('Escape')
  }
  for (const id of widgets.filter(id => (id.startsWith('task.') && id !== 'task.agenda') || id === 'dev.recovery')) {
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
    if (id === 'task.deadlines') await card.getByText(/overdue$/).first().waitFor()
    await card.getByLabel(`Actions ${title}`, { exact: true }).click()
    await card.getByRole('button', { name: `Edit ${title}`, exact: true }).click()
    await card.getByLabel('Title', { exact: true }).fill(`${title} edited`)
    await card.getByRole('button', { name: 'Review change', exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByLabel(`Actions ${title} edited`, { exact: true }).click()
    await card.getByRole('button', { name: `Complete ${title} edited`, exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByRole('button', { name: 'Add item', exact: true }).click()
    await card.getByLabel('Title', { exact: true }).fill(`${title} delete`)
    if (['task.deadlines', 'task.reminders'].includes(id)) await card.getByLabel('Due', { exact: true }).fill('2026-10-20T12:30')
    await card.getByRole('button', { name: 'Review change', exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByLabel(`Actions ${title} delete`, { exact: true }).click()
    await card.getByRole('button', { name: `Delete ${title} delete`, exact: true }).click()
    await card.getByRole('button', { name: 'Approve change', exact: true }).click()
    await card.getByRole('region', { name: 'Review item change' }).waitFor({ state: 'hidden' })
    await card.getByRole('button', { name: `Delete ${title} delete`, exact: true }).waitFor({ state: 'hidden' })
    console.log(`${id}: inline add/edit/complete/delete and rejection passed`)
  }
} finally { await page.unrouteAll({ behavior: 'wait' }); await browser.close() }
