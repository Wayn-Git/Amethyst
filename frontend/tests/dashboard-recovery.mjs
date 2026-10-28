// Every write component: fixture proposals, failed approvals, rejection and denial.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fixtures } from '../src/dev/widgets/fixtures.js'

const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } })
 page.setDefaultTimeout(10000)
 const errors = [], calls = []
 let failDecision = false, denyDecision = false
 page.on('pageerror', e => errors.push(e.message))
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname, body = route.request().postDataJSON()
  calls.push({ path, body })
  let json = {}
  if (path.endsWith('/settings')) json = { enabled: true, repos: [] }
  if (path.includes('/actions/')) json = { draft_id: 'fixture', action: path.split('/').at(-1), item: body }
  if (path.includes('/drafts/')) {
   if (failDecision) return route.fulfill({ status: 503, json: { detail: 'Fixture decision unavailable' } })
   json = { state: body.approved && !denyDecision ? 'applied' : 'denied' }
  }
  if (path === '/api/widgets/comm.tone/rewrite') json = { id: 1, text: 'Fixture generated rewrite', tone: body.tone, reference: 'fixture' }
  if (path === '/api/auth/microsoft/start') json = { auth_url: 'https://example.test/auth', state: 'fixture-auth' }
  if (path === '/api/auth/microsoft/poll/fixture-auth') json = { status: 'expired', connected: false }
  if (path === '/api/validation-fixture') return route.fulfill({ status: 422, json: { detail: [{ loc: ['body', 'days'], msg: 'Choose at least one working day' }] } })
  await route.fulfill({ json })
 })
 await page.route('**/__recovery__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
 await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__recovery__`)
 await page.evaluate(async () => {
  const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
  const { default: React } = await import('/node_modules/.vite/deps/react.js')
  const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
  const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
  const { DashboardContext } = await import('/src/dashboard/context.js')
  const { default: Drawer } = await import('/src/dashboard/Drawer.jsx')
  await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css')
  const h = React.createElement, root = createRoot(document.getElementById('proof')), noop = () => {}
  let version = 0
  window.mountRecovery = (id, payload) => root.render(h('main', { className: 'bento-foundation widget-home' }, h(DashboardContext.Provider, { value: { now: new Date(), layout: { widgets: [] }, openWidget: noop, removeWidget: noop, setEditing: noop } }, h(WidgetPresentation, { key: ++version, manifest: { id, title: id, source: { type: 'local' }, sizes: ['l'], empty: 'Fixture empty' }, full: true, data: { state: 'ready', payload }, refresh: async () => {} }))))
  window.mountPreview = (id, payload, preview = false) => root.render(h('main', { className: 'bento-foundation widget-home' }, h(DashboardContext.Provider, { value: { now: new Date(), layout: { widgets: [] }, openWidget: noop, removeWidget: noop, setEditing: noop } }, h(WidgetPresentation, { key: id, manifest: { id, title: id, source: { type: 'local' }, sizes: ['m'], empty: 'Fixture empty' }, tile: id.startsWith('glance.'), preview, data: { state: 'ready', payload }, refresh: async () => {} }))))
  window.mountNested = (inner = false) => root.render(h(React.Fragment, null,
   h(Drawer, { title: 'Outer settings', onClose: noop }, h('button', { onClick: () => window.mountNested(true) }, 'Open nested review')),
   inner && h(Drawer, { title: 'Inner review', onClose: () => window.mountNested(false) }, h('input', { 'aria-label': 'Inner field' }), h('button', null, 'Inner action'))))
 })
 const button = name => page.getByRole('button', { name, exact: true })
 const field = name => page.getByLabel(name, { exact: true }).or(page.getByRole('textbox', { name, exact: true }))
 const fill = async fields => { for (const [name, value] of fields) await field(name).fill(value) }
 const cases = [
  ...['agent.jobs', 'agent.delegated', 'agent.research'].map(id => ({ id, fields: [['Title', 'Retain this job'], ['Prompt', 'Retain this prompt'], ...(id === 'agent.jobs' ? [['Run at', '2099-01-01T12:00']] : [])], review: 'Review job' })),
  { id: 'agent.watchers', fields: [['Title', 'Retain this watcher'], ['Page URL or Gmail query', 'https://example.com/page']], review: 'Review watcher' },
  { id: 'task.habits', fields: [['Habit title', 'Retain this habit']], review: 'Create habit' },
  { id: 'task.goals', fields: [['Goal title', 'Retain this goal'], ['Target date', '2099-01-01']], review: 'Create goal' },
  { id: 'task.kanban', fields: [['Project name', 'Retain this project']], review: 'Create project' },
  { id: 'task.focus', open: async () => page.getByText('Timer settings', { exact: true }).click(), fields: [['Focus minutes', '45'], ['Break minutes', '10']], review: 'Save settings' },
  { id: 'need.drafts', open: async () => button('New draft').click(), fields: [['Recipient', 'fixture@example.com'], ['Subject', 'Retain this subject'], ['Draft text', 'Retain this draft']], review: 'Review new draft', approve: 'Approve local change' },
  { id: 'need.waiting', populated: true, open: async () => button('Draft nudge').click(), fields: [['Nudge text', 'Retain this nudge']], review: 'Review nudge draft', approve: 'Approve local change' },
  { id: 'comm.templates', open: async () => page.getByText('New template', { exact: true }).click(), fields: [['Template name', 'Retain this template'], ['Template subject', 'Retain this subject'], ['Template text', 'Retain this template body']], review: 'Review new template', approve: 'Approve local change' },
  { id: 'comm.reachout', fields: [['Name', 'Retain this birthday'], ['Birthday (MM-DD)', '10-28']], review: 'Review birthday', approve: 'Approve local change' },
  { id: 'comm.tone', populated: true, open: async () => { await field('Saved draft').selectOption('1'); await button('Generate rewrite').click() }, fields: [['Rewritten draft', 'Retain this rewrite']], review: 'Review rewrite', approve: 'Approve rewrite', reject: 'Reject rewrite' },
  { id: 'lib.capture', fields: [['Note title', 'Retain this note'], ['Note text', 'Retain this content']], review: 'Review note', approve: 'Approve save', reject: 'Reject save', denied: 'Note was not saved.' },
  { id: 'lib.readlater', fields: [['Article title', 'Retain this article'], ['Article URL', 'https://example.com/article']], review: 'Review URL', approve: 'Approve save', reject: 'Reject save' },
  { id: 'lib.highlights', open: async () => field('Source article').selectOption('1'), fields: [['Highlight title', 'Retain this highlight'], ['Highlight text', 'Retain this quote']], review: 'Review highlight', approve: 'Approve save', reject: 'Reject save' },
  { id: 'lib.collections', fields: [['Collection tag', 'Retain this collection']], review: 'Review collection' },
  { id: 'lib.daily', review: "Review create today's note", approve: 'Approve create', reject: 'Reject create' },
  { id: 'task.today', fields: [['New item title', 'Retain this task']], review: 'Add item' },
  { id: 'dev.appeal', fields: [['Case title', 'Retain this case'], ['Submitted date', '2026-10-28']], review: 'Review case' },
  { id: 'feed.rss', open: async () => button('Add feed').click(), fields: [['Feed URL', 'https://example.com/feed'], ['Tags (comma separated)', 'Design']], review: 'Review change' },
  { id: 'agent.knows', populated: true, fields: [['Memory 1', 'Retain this memory']], review: 'Review edit' },
  { id: 'agent.rules', populated: true, open: async () => field('Rule for Sample: read notes').selectOption('deny'), review: 'Review rule' },
  { id: 'agent.skills', populated: true, reviewRole: 'switch', review: 'Enable Sample: research' },
  { id: 'sys.model', populated: true, open: async () => field('Model provider').selectOption('Ollama'), fields: [['Model name', 'Retain this model']], review: 'Draft switch', approve: 'Approve', reject: 'Deny' },
  { id: 'dash.pin', populated: true, review: 'Remove Sample saved answer', approve: 'Approve removal', reject: 'Keep pin' },
  { id: 'glance.music', populated: true, review: 'Pause music', approve: 'Approve playback', reject: 'Cancel' },
 ]
 for (const sample of cases) {
  const payload = structuredClone(fixtures[sample.id])
  if (!sample.populated) payload.items = []
  await page.evaluate(({ id, payload }) => window.mountRecovery(id, payload), { id: sample.id, payload })
  await page.getByRole('heading', { name: sample.id, exact: true }).waitFor()
  if (sample.open) await sample.open()
  await fill(sample.fields || [])
  const review = () => page.getByRole(sample.reviewRole || 'button', { name: sample.review, exact: true }).click()
  await review()
  const approve = button(sample.approve || 'Approve change'), reject = button(sample.reject || 'Reject change')
  await approve.waitFor()
  failDecision = true
  await approve.click()
  await page.getByText('Fixture decision unavailable', { exact: true }).first().waitFor()
  assert.equal(await approve.isVisible(), true, `${sample.id}: failed decision remains retryable`)
  failDecision = false
  await reject.click()
  for (const [name, value] of sample.fields || []) {
   await field(name).waitFor({ state: 'attached' }).catch(async error => { console.error({ id: sample.id, name, errors, body: await page.locator('body').innerText(), labels: await page.locator('label').allTextContents() }); throw error })
   assert.equal(await field(name).inputValue(), value, `${sample.id}: rejection retains ${name}`)
  }
  // Non-form controls return to their list; form disclosures may need reopening.
  if (sample.id === 'feed.rss') await field('Feed URL').waitFor()
  await review()
  denyDecision = true
  await approve.click()
  await page.getByText(sample.denied || /Permission denied/).first().waitFor()
  denyDecision = false
  console.log(`CHECKED ${sample.id}: review, failed approval retry, rejected edit retention, permission denial`)
 }
 assert.deepEqual(errors, [])
 assert(calls.every(call => !/\/send(?:\/|$)/.test(call.path)), 'No sends')
 await page.evaluate(() => window.mountNested())
 await button('Open nested review').click()
 const inner = page.getByRole('dialog', { name: 'Inner review', exact: true })
 await inner.waitFor()
 for (let i = 0; i < 8; i++) {
  await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
  assert(await inner.evaluate(node => node.contains(document.activeElement)), 'Only the top review dialog traps focus')
 }
 await page.keyboard.press('Escape')
 await inner.waitFor({ state: 'hidden' })
 assert.equal(await button('Open nested review').evaluate(node => document.activeElement === node), true, 'closing nested review restores focus to the opener')
 await page.evaluate(() => window.mountPreview('lib.capture', { items: [] }, true))
 await page.locator('.is-preview').waitFor()
 assert.equal(await page.locator('.is-preview .widget-content').evaluate(node => node.inert), true, 'gallery previews expose no interactive write controls')
 assert.equal(await page.locator('.is-preview input').count(), 0, 'compact gallery previews do not mount hidden editors')
 await page.locator('.is-preview .widget-content').evaluate(node => { const button = document.createElement('button'); button.textContent = 'Fixture inert control'; node.append(button); button.focus() })
 assert.equal(await page.locator('.is-preview').evaluate(node => node.contains(document.activeElement)), false, 'preview is inert for keyboard focus')
 const validation = await page.evaluate(async () => {
  const { request } = await import('/src/dashboard/api.js')
  try { await request('/validation-fixture', 'PUT', {}) } catch (error) { return error.message }
 })
 assert.match(validation, /days: Choose at least one working day/)
 await page.evaluate(() => window.mountPreview('glance.next-event', { timezone: 'Not/AZone', items: [{ start: '2026-10-28T10:00:00Z', title: 'Fixture broken calendar' }] }))
 await page.getByText('This widget could not render.', { exact: true }).waitFor()
 await page.evaluate(() => window.mountPreview('glance.next-event', { timezone: 'UTC', items: [{ start: '2099-01-01T10:00:00Z', title: 'Fixture repaired calendar' }] }))
 await page.getByText('Fixture repaired calendar', { exact: true }).waitFor()
 assert.equal(await page.getByText('This widget could not render.', { exact: true }).count(), 0, 'Glance boundaries recover with new payloads')
 await page.evaluate(() => { window.open = () => null; window.mountRecovery('task.today', { items: [] }) })
 await button('Connect Microsoft To Do').waitFor()
 await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://untrusted.example', data: { type: 'microsoft_auth_success' } })))
 assert.equal(await button('Connect Microsoft To Do').isVisible(), true, 'OAuth connection cannot be spoofed by postMessage')
 await page.clock.install()
 await button('Connect Microsoft To Do').click()
 await button('Connecting…').waitFor()
 await page.clock.runFor(1600)
 await page.getByRole('alert').filter({ hasText: 'expired or failed' }).waitFor()
 assert.equal(await button('Connect Microsoft To Do').isEnabled(), true)
 await button('Connect Microsoft To Do').click()
 await button('Connecting…').waitFor()
 await page.evaluate(() => window.mountRecovery('lib.capture', { items: [] }))
 await button('Review note').waitFor()
 const polls = calls.filter(call => call.path.includes('/auth/microsoft/poll/')).length
 await page.clock.runFor(3000)
 assert.equal(calls.filter(call => call.path.includes('/auth/microsoft/poll/')).length, polls, 'OAuth polling stops on unmount')
 await page.evaluate(() => window.mountRecovery('task.deadlines', { items: [
  { id: 'done', title: 'Completed fixture', status: 'done', due_at: '2000-01-01T10:00:00Z', editable: true },
  { id: 'late', title: 'Overdue fixture', status: 'todo', due_at: '2000-01-01T10:00:00Z', editable: true },
  { id: 'bad', title: 'Missing date fixture', due_at: 'invalid', editable: true },
 ] }))
 await page.getByText('Completed fixture', { exact: true }).waitFor()
 assert.equal(await page.locator('.pilot-deadlines .ui-stat > div').first().innerText(), '1', 'completed deadlines are not overdue')
 assert.equal(await page.getByText('Due time unavailable', { exact: true }).count(), 1)
 await page.getByLabel('Actions Missing date fixture', { exact: true }).click()
 await button('Edit Missing date fixture').click()
 assert.equal(await field('Due').inputValue(), '', 'invalid legacy dates remain editable')
 assert.deepEqual(errors, [])
 console.log(`PASS ${cases.length} write widget flows; no accounts, external writes or screenshots`)
} finally { await browser.close() }
