// Browser regression using fixture data only. Never contacts connected accounts.
// BASE=http://127.0.0.1:5177 OUT=/absolute/output/directory node tests/today-browser.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const candidates = readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse()
const executablePath = process.env.CHROMIUM_PATH || candidates.map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, timezoneId: 'Asia/Kolkata' })
await context.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper', view: 'library' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const now = new Date()
const ago = days => new Date(now.getTime() - days * 86400000).toISOString()
const ahead = hours => new Date(now.getTime() + hours * 3600000).toISOString()
let items = [
  { id: 'support', kind: 'email', title: 'GitHub support · account access', summary: 'Support asked for the affected repository. Send the details so they can investigate.', source: 'Gmail', external_id: 'thread-1', state: 'needs_reply', priority: true, occurred_at: ago(3), created_at: ago(3), updated_at: ago(1), follow_up_at: ago(1), url: 'https://github.com/contact' },
  { id: 'group', kind: 'message', title: 'Design group · Saturday review', summary: 'The group settled on a shorter walkthrough. They need your availability before confirming the time.', source: 'Discord', state: 'needs_reply', priority: false, occurred_at: ago(0), created_at: ago(1), updated_at: ago(0) },
  { id: 'waiting', kind: 'email', title: 'Waiting for the revised proposal', summary: 'You sent feedback on the scope. Waiting for the revised estimate.', source: 'Gmail', state: 'waiting', priority: false, occurred_at: ago(2), created_at: ago(2), updated_at: ago(1), follow_up_at: ahead(24) },
  { id: 'project', kind: 'project', title: 'Amethyst · a calmer daily workspace', summary: 'Next step: review the attention queue and connect the first source.', source: 'GitHub', state: 'backlog', priority: false, created_at: ago(2), updated_at: ago(1), url: 'https://github.com' },
]
let tasks = [
  { id: 1, title: 'Send the repository details to support', status: 'todo', important: true, due_at: ago(1) },
  { id: 2, title: 'Review Today on a smaller screen', status: 'todo', due_at: ahead(4) },
  { id: 3, title: 'Read the saved architecture notes', status: 'todo' },
]
let failTasks = false
let failItems = false
let mailCalls = 0
await page.route('**/api/**', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname
  let body = {}
  if (path === '/api/today/items') {
    if (failItems) return route.fulfill({ status: 503, json: { detail: 'Local tracking is unavailable' } })
    if (req.method() === 'POST') {
      body = { ...req.postDataJSON(), id: 'new-item', created_at: ago(0), updated_at: ago(0) }
      items.unshift(body)
    } else body = { items }
  } else if (path === '/api/today/messages/import') {
    const input = req.postDataJSON()
    assert.equal(input.source, 'WhatsApp')
    assert.ok(input.content.includes('Sam: Are you free?'))
    body = { id: 'imported', kind: 'message', title: input.title, source: input.source, state: input.state, summary: 'Latest 1 of 1 imported messages: Sam: Are you free?', created_at: ago(0), updated_at: ago(0) }
    items.unshift(body)
  } else if (path.startsWith('/api/today/items/')) {
    const id = path.split('/').pop(); items = items.map(i => i.id === id ? { ...i, ...req.postDataJSON() } : i); body = items.find(i => i.id === id)
  } else if (path === '/api/tasks') body = tasks
  else if (path.startsWith('/api/tasks/')) {
    if (failTasks) return route.fulfill({ status: 503, json: { detail: 'Could not complete the task' } })
    const id = Number(path.split('/').pop()); tasks = tasks.map(t => t.id === id ? { ...t, ...req.postDataJSON() } : t); body = tasks.find(t => t.id === id)
  } else if (path === '/api/calendar') body = [{ id: 1, title: 'Product review', starts_at: ahead(2), ends_at: ahead(3), location: 'Meet · Design team' }, { id: 2, title: 'Time for a walk', starts_at: ahead(5), ends_at: ahead(6) }]
  else if (path === '/api/library') body = { items: [{ id: 1, title: 'Designing a local-first application', kind: 'article', author: 'Engineering notes' }, { id: 2, title: 'A better way to plan your week', kind: 'video', author: 'Saved from YouTube' }, { id: 3, title: 'Small interfaces, thoughtful details', kind: 'article', author: 'Design notebook' }] }
  else if (path === '/api/today/mail') { mailCalls++; body = { items: [], error: 'Mail could not refresh. Check the Gmail connection in Skills & connectors.', refreshing: false } }
  else if (path === '/api/today/locations') body = { items: [{ name: 'Bengaluru, Karnataka, India', latitude: 12.97, longitude: 77.59 }] }
  else if (path === '/api/today/weather') body = { current: { temperature_2m: 24, weather_code: 2 }, updated_at: ago(0) }
  else if (path === '/api/health') body = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => path.endsWith(p))) body = []
  if (path.includes('/thumbnail')) return route.fulfill({ status: 404, body: '' })
  return route.fulfill({ json: body })
})
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177/')
  await page.getByRole('heading', { name: 'Needs your attention' }).waitFor()
  await page.getByText('GitHub support · account access', { exact: true }).waitFor()
  assert.match(page.url(), /\/today$/)
  assert.equal(mailCalls, 0, 'Mail must not block the initial dashboard')
  const day = page.locator('.day-shell')
  assert.equal(await day.evaluate(e => e.scrollWidth > e.clientWidth), false)
  await page.getByRole('button', { name: 'Set weather location' }).click()
  await page.getByRole('textbox', { name: 'City', exact: true }).fill('Bengaluru')
  await page.getByRole('button', { name: 'Find city', exact: true }).click()
  await page.getByRole('button', { name: 'Bengaluru, Karnataka, India', exact: true }).click()
  await page.getByRole('button', { name: /24°C · Cloudy/ }).waitFor()
  if (process.env.OUT) { mkdirSync(process.env.OUT, { recursive: true }); await page.screenshot({ path: join(process.env.OUT, 'today-desktop.png') }) }
  await page.getByRole('button', { name: /GitHub support · account access/ }).click()
  await page.getByRole('button', { name: 'Snooze 1 day', exact: true }).click()
  assert.equal(await page.getByText('GitHub support · account access', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Later & done', exact: true }).click()
  await page.getByRole('button', { name: /GitHub support · account access/ }).click()
  await page.getByRole('button', { name: 'Bring back', exact: true }).click()
  await page.getByRole('button', { name: 'Your turn', exact: true }).click()
  await page.getByText('GitHub support · account access', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Track something', exact: true }).click()
  await page.getByRole('textbox', { name: 'What are you tracking?' }).fill('Check the release notes')
  await page.getByRole('button', { name: 'Start tracking', exact: true }).click()
  await page.getByText('Check the release notes', { exact: true }).waitFor()
  await page.getByRole('button', { name: /Import a personal conversation/ }).click()
  await page.getByRole('textbox', { name: 'Conversation title', exact: true }).fill('Personal group')
  await page.getByLabel('Export file', { exact: true }).setInputFiles({ name: 'chat.txt', mimeType: 'text/plain', buffer: Buffer.from('24/10/26, 09:00 - Sam: Are you free?') })
  await page.getByRole('button', { name: 'Import conversation', exact: true }).click()
  await page.getByText('Personal group', { exact: true }).waitFor()
  failTasks = true
  await page.getByRole('button', { name: 'Complete Review Today on a smaller screen', exact: true }).click()
  await page.getByRole('button', { name: 'Complete Review Today on a smaller screen', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page.getByText('Mail could not refresh.', { exact: false }).waitFor()
  assert.equal(await page.getByText('No unread, starred, or important inbox messages.').count(), 0)
  await page.getByRole('button', { name: /^Tracked/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await day.evaluate(e => e.scrollWidth > e.clientWidth), false, 'Mobile must not overflow')
  const smallTargets = await day.locator('button:visible').evaluateAll(buttons => buttons.filter(b => { const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5 }).map(b => b.textContent))
  assert.deepEqual(smallTargets, [])
  // Dismiss a test failure toast before taking the review image.
  const toastClose = page.locator('[data-sonner-toast] button[aria-label="Close toast"]')
  if (await toastClose.count()) await toastClose.first().click()
  await page.waitForTimeout(5000)
  await page.locator('.day-header').scrollIntoViewIfNeeded()
  if (process.env.OUT) await page.screenshot({ path: join(process.env.OUT, 'today-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1080 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'graphite'; document.documentElement.dataset.themeMode = 'dark' })
  if (process.env.OUT) await page.screenshot({ path: join(process.env.OUT, 'today-dark.png') })
  failItems = true
  await page.reload()
  await page.getByText('Local tracking is unavailable', { exact: false }).first().waitFor()
  assert.equal(await page.getByRole('heading', { name: 'Keep the important threads close.' }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS root landing, independent sources, weather, tracking, snooze/restore, failed-write rollback, honest errors, mobile width, 44px targets, light/dark rendering')
} finally { await browser.close() }
