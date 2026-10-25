// Isolated dashboard backend and labelled synthetic data; no connectors or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { moveWidget, quietNow, resizeWidget, freshness, previewRows, rankNeeds } from '../src/dashboard/layout.js'

assert.deepEqual(moveWidget([{ id: 'a' }, { id: 'b' }], 'a', 'b'), [{ id: 'b' }, { id: 'a' }])
assert.deepEqual(resizeWidget({ id: 'a', size: 'm', height: 3 }, ['s', 'm', 'l'], 600, 100, 1200), { id: 'a', size: 'l', height: 4 })
assert.equal(resizeWidget({ id: 'a', size: 'm', height: 3 }, ['m'], 0, 100, 390, NaN).height, 4)
assert.equal(quietNow({ enabled: true, start: '22:00', end: '07:00', timezone: 'UTC' }, new Date('2026-10-24T23:00:00Z')), true)
assert.equal(freshness('not-a-date'), '—')
assert.equal(freshness('2026-10-25T10:00:00Z', new Date('2026-10-25T10:02:00Z')), '2m')
const fixtureItems = Array.from({ length: 8 }, (_, id) => ({ id, title: `Task fixture ${id}`, editable: false }))
const payload = { items: fixtureItems }
assert.equal(previewRows(payload).payload.items.length, 5)
assert.equal(previewRows(payload).count, 8)
assert.equal(payload.items.length, 8)
const grouped = previewRows({ items: [{ tag: 'A', items: fixtureItems }, { tag: 'B', items: fixtureItems }] })
assert.equal(grouped.count, 16)
assert.equal(grouped.payload.items.flatMap(group => group.items).length, 5)
assert.equal(rankNeeds([{ id: 'need.inbox' }, { id: 'need.overdue' }], { 'need.inbox': { payload: { items: [{ id: 1, subject: 'Mail fixture' }] } }, 'need.overdue': { payload: { items: [{ id: 2, title: 'Overdue fixture' }] } } })[0].title, 'Overdue fixture')
const base = process.env.BASE || 'http://127.0.0.1:5177'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
const ids = ['glance.clock', 'glance.weather', 'glance.next-event', 'glance.music', 'need.inbox', 'need.drafts', 'need.waiting', 'need.mentions', 'need.overdue', 'agent.brief', 'agent.feed', 'task.today', 'dev.prs', 'lib.resurface', 'feed.news']
const defaultLayout = { widgets: ids.map(id => ({ id, size: ['glance.clock', 'glance.next-event'].includes(id) ? 's' : 'm', height: 3 })) }
await fetch(`${backend}/api/layout`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(defaultLayout) })
await fetch(`${backend}/api/widgets/dash.quiet/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })
await fetch(`${backend}/api/widgets/glance.clock/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"zones":[]}' })
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
page.setDefaultTimeout(15000)
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
let offline = false, clockState = null, brokenClock = false, tasksState = 'ok'
const calls = []
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()); calls.push(url.pathname)
  if (url.pathname === '/api/dashboard/search') {
    const systems = [['dash.sync', 'Refresh status'], ['dash.quiet', 'Quiet hours'], ['dash.shortcuts', 'Keyboard shortcuts'], ['dash.gallery', 'Widget gallery']]
    return route.fulfill({ json: { items: systems.filter(([, title]) => title.toLowerCase().includes(url.searchParams.get('q').toLowerCase())).map(([id, title]) => ({ id, title, group: 'Widgets', href: `/today?widget=${id}` })) } })
  }
  if (url.pathname.startsWith('/api/widgets') || url.pathname === '/api/layout' || url.pathname === '/api/search') {
    if (offline) return route.abort('internetdisconnected')
    const id = url.pathname.match(/^\/api\/widgets\/([^/]+)\/(?:data|refresh)$/)?.[1]
    if (id === 'glance.clock' && (clockState || brokenClock)) return route.fulfill({ json: { state: clockState || 'ok', payload: brokenClock ? { zones: ['Invalid/Zone'] } : null, synced_at: new Date().toISOString(), error: clockState === 'error' ? 'Fixture failure' : null } })
    if (id === 'glance.weather') return route.fulfill({ json: { state: 'ok', payload: { set_location: true }, synced_at: new Date().toISOString() } })
    if (['glance.music', 'glance.next-event', 'need.inbox', 'dev.prs'].includes(id)) return route.fulfill({ json: { state: 'not-connected', payload: null } })
    if (id === 'task.today') return route.fulfill({ json: { state: tasksState, payload: tasksState === 'empty' ? { items: [] } : payload, synced_at: new Date().toISOString() } })
    if (['lib.resurface', 'agent.brief', 'agent.feed', 'need.drafts', 'need.waiting', 'feed.news'].includes(id)) return route.fulfill({ json: { state: 'empty', payload: { items: [], disabled: true, connected: false }, synced_at: new Date().toISOString() } })
    if (id === 'need.overdue') return route.fulfill({ json: { state: 'ok', payload: { items: [{ id: 1, title: 'Overdue fixture', due_at: '2020-01-01', source: 'task.today' }] }, synced_at: new Date().toISOString() } })
    if (id === 'need.mentions') return route.fulfill({ json: { state: 'ok', payload: { items: [{ id: 2, title: 'Mention fixture', source: 'github', at: '2026-10-25' }] }, synced_at: new Date().toISOString() } })
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
  await clock.locator('.home-clock').waitFor()
  assert.equal(calls.some(path => path.startsWith('/api/today') || path.includes('composio')), false)
  assert.equal(await page.locator('.home-glance > .home-widget').count(), 4)
  assert.equal(await page.locator('[data-widget^="dash."]').count(), 0)
  await page.getByRole('region', { name: 'Needs you', exact: true }).getByText('Overdue fixture', { exact: true }).waitFor()
  const tasks = page.locator('[data-widget="task.today"]')
  await tasks.getByText('Task fixture 4', { exact: true }).waitFor()
  assert.equal(await tasks.locator('li').count(), 5)
  assert.equal(await tasks.getByText('Edit in connected source.', { exact: true }).count(), 0)
  assert.equal(await tasks.getByText('connected source', { exact: true }).count(), 1)
  await tasks.getByRole('button', { name: 'Show all (8)' }).click()
  const all = page.getByRole('dialog', { name: 'Today list', exact: true })
  await all.waitFor()
  assert.equal(await all.locator('li').count(), 8)
  await page.keyboard.press('Escape')
  assert.equal(await tasks.getByRole('button', { name: 'Show all (8)' }).evaluate(el => el === document.activeElement), true)
  await tasks.getByRole('button', { name: 'Add item', exact: true }).click()
  await tasks.getByLabel('Title', { exact: true }).fill('Keep form fixture')
  tasksState = 'empty'
  await tasks.getByRole('button', { name: 'Refresh Today list', exact: true }).click()
  await tasks.getByText('No items.', { exact: true }).waitFor()
  assert.equal(await tasks.getByLabel('Title', { exact: true }).inputValue(), 'Keep form fixture')
  tasksState = 'ok'
  await tasks.getByRole('button', { name: 'Refresh Today list', exact: true }).click()
  await tasks.getByText('Task fixture 4', { exact: true }).waitFor()
  assert.equal(await tasks.getByLabel('Title', { exact: true }).inputValue(), 'Keep form fixture')
  await tasks.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Home settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Home settings', exact: true })
  for (const title of ['Refresh status', 'Quiet hours', 'Keyboard shortcuts', 'Widget gallery']) await settings.getByRole('heading', { name: title, exact: true }).waitFor()
  await settings.getByRole('button', { name: 'Snooze 1 hour', exact: true }).click()
  await settings.getByText('Quiet now. Automatic widget refresh paused.', { exact: true }).waitFor()
  await settings.getByRole('button', { name: 'Resume refresh', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Add widget', exact: true }).click()
  const gallery = page.getByRole('dialog', { name: 'Add widget', exact: true })
  await gallery.getByLabel('Search widgets', { exact: true }).fill('  clock  ')
  assert.equal(await gallery.getByRole('button', { name: 'Added Clock', exact: true }).isDisabled(), true)
  await gallery.getByLabel('Search widgets', { exact: true }).fill('backlog')
  await gallery.getByRole('button', { name: /^Add / }).click()
  await gallery.getByRole('button', { name: /^Added / }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Edit layout', exact: true }).click()
  const handle = page.getByRole('button', { name: 'Move Clock', exact: true })
  await handle.focus(); await page.keyboard.press('ArrowRight')
  await page.getByText('Layout saved', { exact: true }).waitFor()
  let layout = await (await fetch(`${backend}/api/layout`)).json()
  assert.equal(layout.widgets[1].id, 'glance.clock')
  await page.getByLabel('Size Clock', { exact: true }).selectOption('l')
  await page.getByText('Layout saved', { exact: true }).waitFor()
  const move = await handle.boundingBox()
  const target = await page.locator('[data-widget="glance.weather"]').boundingBox()
  await page.mouse.move(move.x + 20, move.y + 20); await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + 50, { steps: 8 }); await page.mouse.up()
  await page.getByText('Layout saved', { exact: true }).waitFor()
  layout = await (await fetch(`${backend}/api/layout`)).json()
  assert.equal(layout.widgets[0].id, 'glance.clock')
  const resize = page.getByRole('button', { name: 'Resize Clock', exact: true })
  await resize.scrollIntoViewIfNeeded(); const rect = await resize.boundingBox()
  await page.mouse.move(rect.x + 20, rect.y + 20); await page.mouse.down(); await page.mouse.move(rect.x + 20, rect.y + 140, { steps: 8 }); await page.mouse.up()
  await page.getByText('Layout saved', { exact: true }).waitFor()
  layout = await (await fetch(`${backend}/api/layout`)).json()
  assert.equal(layout.widgets.find(w => w.id === 'glance.clock').height, 4)
  await page.reload({ waitUntil: 'domcontentloaded' }); await clock.locator('.home-clock').waitFor()
  assert.equal((await (await fetch(`${backend}/api/layout`)).json()).widgets.find(w => w.id === 'glance.clock').size, 'l')
  await clock.getByLabel('Menu Clock', { exact: true }).click()
  await clock.getByRole('button', { name: 'Settings', exact: true }).click()
  const clockSettings = page.getByRole('dialog', { name: 'Clock', exact: true })
  await clockSettings.getByLabel('World clock timezone').fill('Europe/London')
  await clockSettings.getByRole('button', { name: 'Add clock', exact: true }).click()
  await clockSettings.getByRole('button', { name: 'Remove Europe/London' }).waitFor()
  await page.keyboard.press('Escape')
  for (const [state, text] of [['empty', 'No upcoming event'], ['not-connected', 'Connect source'], ['error', 'Fixture failure']]) {
    clockState = state; await page.reload({ waitUntil: 'domcontentloaded' })
    if (state === 'empty') await clock.locator('.home-clock').waitFor()
    else await clock.getByText(text, { exact: true }).waitFor()
  }
  clockState = 'loading'; await page.reload({ waitUntil: 'domcontentloaded' }); await clock.getByRole('status', { name: 'Loading widget…' }).waitFor()
  clockState = null; brokenClock = true
  await page.goto(base + '/today?widget=glance.clock', { waitUntil: 'domcontentloaded' })
  await clock.getByLabel('Menu Clock', { exact: true }).click(); await clock.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog', { name: 'Clock', exact: true }).getByText('This widget could not render.', { exact: true }).waitFor()
  brokenClock = false
  await page.goto(base + '/today?widget=dash.quiet', { waitUntil: 'domcontentloaded' }); await settings.waitFor()
  await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden' })
  await page.reload({ waitUntil: 'domcontentloaded' }); await clock.locator('.home-clock').waitFor()
  for (const title of ['Refresh status', 'Quiet hours', 'Keyboard shortcuts', 'Widget gallery']) {
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Spotlight Command Palette', exact: true })
    await palette.getByLabel('Spotlight search and commands').fill(title)
    await palette.getByText(title, { exact: true }).click()
    await settings.waitFor()
    await page.keyboard.press('Escape')
    await settings.waitFor({ state: 'hidden' })
  }
  await page.goto(base + '/today?widget=need.drafts', { waitUntil: 'domcontentloaded' })
  const draftSettings = page.getByRole('dialog', { name: 'Mail drafts to approve', exact: true })
  await draftSettings.waitFor()
  await page.keyboard.press('Escape')
  await draftSettings.waitFor({ state: 'hidden' })
  offline = true; await page.reload({ waitUntil: 'domcontentloaded' }); await clock.getByText('Stale data.', { exact: true }).waitFor()
  for (const theme of ['graphite', 'ink', 'nocturne', 'nvidia', 'paper', 'sand', 'claude', 'cursor', 'system']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(await page.locator('.widget-home').evaluate(el => el.scrollWidth > el.clientWidth), false)
    assert.deepEqual(await page.locator('.home-widget *').evaluateAll(nodes => nodes.filter(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight).map(el => el.className)), [])
    const badButtons = await page.locator('.widget-home button:visible').evaluateAll(nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5 || !(el.textContent.trim() || el.getAttribute('aria-label')) }).map(el => el.outerHTML))
    assert.deepEqual(badButtons, [])
  }
  }
  console.log('PASS Home: Morning hierarchy, merged needs, settings/gallery drawers, five-row previews, focus restore, keyboard/drag/resize, persistence, clock settings, states, offline, 1440/390px no nested scrolling, 44px targets')
} finally { await page.unrouteAll({ behavior: 'wait' }); await browser.close() }
