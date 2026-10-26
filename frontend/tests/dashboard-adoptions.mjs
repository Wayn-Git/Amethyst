// Synthetic payloads only; no accounts, source writes, or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const group = process.argv[2] || 'glance'
const fixtures = {
 glance: {
  'glance.clock': {},
  'glance.weather': { temperature: 22, timezone: 'Asia/Kolkata', hours: [{ time: '12:00', temperature: 22, rain: 10 }, { time: '13:00', temperature: 24, rain: 20 }] },
  'glance.air': { european_aqi: 0, pm2_5: 0, pm10: null, time: '2026-10-26T12:00' },
  'glance.sun': { sunrise: '2026-10-26T06:12', sunset: '2026-10-26T18:24', timezone: 'Asia/Kolkata' },
  'glance.next-event': { timezone: 'Asia/Kolkata', items: [{ id: 'event', title: 'Calendar fixture', start: '2026-10-26T07:00:00Z' }] },
  'glance.music': { active_player: 'Fixture player', status: 'Playing', player_id: 'fixture', controls: { pause: true }, items: [{ id: 'track', title: 'Fixture track', artists: ['Fixture artist'] }] },
  'glance.travel': { timezone: 'Asia/Kolkata', items: [{ id: 'route', title: 'Route fixture', detail: '12 minutes driving from home', start: '2026-10-26T07:00:00Z' }] },
 },
 needs: {
  'need.inbox': { items: [{ id: 'mail', from: 'Ada Lovelace', subject: 'Inbox fixture', unread: true, date: '2026-10-26', reason: 'Fixture reason' }] },
  'need.drafts': { items: [{ id: 1, subject: 'Draft fixture', recipient: 'ada@example.com', status: 'draft', snippet: 'Saved draft text' }] },
  'need.waiting': { days: 3, items: [{ id: 'waiting', manual_id: 1, subject: 'Waiting fixture', recipient: 'ada@example.com', source: 'manual', date: '2026-10-25' }] },
  'need.mentions': { items: [{ id: 'mention', title: 'Mention fixture', source: 'Slack', url: 'https://slack.com/fixture', at: '2026-10-26T05:00:00Z' }] },
  'need.overdue': { items: [{ id: 'overdue', title: 'Overdue fixture', source: 'tasks', due_at: '2026-10-25T05:00:00Z' }] },
  'need.decisions': { items: [{ id: 'question', title: 'Decision fixture', detail: 'A pending question', questions: [{ question: 'Which fixture?', options: [{ label: 'First', description: 'Fixture option' }] }] }] },
  'need.snoozed': { items: [{ id: 'snoozed', title: 'Snoozed fixture', source: 'tasks', until: '2026-10-26T05:00:00Z', return_state: 'ready' }] },
  'need.approvals': { items: [{ id: 'approval', title: 'Approval fixture', detail: 'Permission request', arguments: '{"fixture": true}' }], history: [{ id: 'past', title: 'Past decision', detail: 'Rejected fixture' }] },
  'need.lor-slack': { limited: true, items: [{ id: 'slack', title: 'Slack fixture', source: 'Slack', person: 'Grace Hopper', summary: 'Unanswered message', url: 'https://slack.com/dm' }] },
 },
 communication: {
  'comm.unread': { items: [{ id: 'ada', from: 'Ada Lovelace', items: [{ id: 'unread', subject: 'Unread fixture', snippet: 'Unread body', date: '2026-10-26' }] }] },
  'comm.thread-summary': { model_enabled: false, limited: true, items: [{ id: 'thread', title: 'Thread fixture', summary: 'Partial summary', source: 'Gmail', url: 'https://mail.google.com/mail/u/0/#all/fixture' }] },
  'comm.newsletters': { model_enabled: true, items: [{ id: 'newsletter', title: 'Newsletter fixture', suggestion: 'Consider unsubscribing in Gmail.', source: 'Gmail' }] },
  'comm.contacts': { items: [{ id: 'contact', title: 'Contact fixture', person: 'Grace Hopper', source: 'Slack', at: '2026-10-25T09:00:00Z', threads: ['https://slack.com/thread', 'javascript:alert(1)'] }] },
  'comm.reachout': { days: 30, birthdays: [], items: [{ id: 'reachout', title: 'Reachout fixture', reason: 'No recent contact', at: '2026-09-01T09:00:00Z' }] },
  'comm.templates': { items: [{ id: 1, title: 'Template fixture', subject: 'Template subject', snippet: 'Template text' }] },
  'comm.tone': { items: [{ id: 1, subject: 'Draft fixture', recipient: 'ada@example.com' }] },
 },
}
assert(fixtures[group], `Unknown group ${group}`)
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/New_York' })
 const errors = [], requests = []
 let state = 'ready'
 page.on('pageerror', e => errors.push(e.message))
 await page.clock.setFixedTime(new Date('2026-10-26T06:00:00Z'))
 await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  const body = route.request().postDataJSON()
  requests.push({ path, body })
  const id = path.match(/\/widgets\/([^/]+)/)?.[1]
  let json = {}
  if (/\/(data|refresh)$/.test(path)) json = { state, stale: state === 'stale', synced_at: '2026-10-26T05:59:00Z', payload: ['ready', 'stale'].includes(state) ? fixtures[group][id] : null, error: state === 'error' ? 'Fixture error' : null }
  if (path.includes('/actions/')) json = { draft_id: 'fixture', action: path.split('/').at(-1), item: body }
  if (path.includes('/drafts/')) json = { state: 'applied' }
  if (path === '/api/widgets/comm.tone/rewrite') json = { id: 1, tone: 'formal', text: 'Rewritten fixture', reference: 'fixture-revision' }
  if (path === '/api/widgets/comm.templates/templates/1') json = { id: 1, title: 'Template fixture', subject: 'Template subject', text: 'Template text' }
  await route.fulfill({ json })
 })
 await page.route('**/__adoptions__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
 await page.goto((process.env.BASE || 'http://127.0.0.1:5177') + '/__adoptions__')
 await page.evaluate(async ids => {
  localStorage.clear()
  const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
  const { default: React } = await import('/node_modules/.vite/deps/react.js')
  const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
  const { default: WidgetFrame } = await import('/src/dashboard/WidgetFrame.jsx')
  const { default: WidgetSlot } = await import('/src/dashboard/WidgetSlot.jsx')
  const { DashboardContext } = await import('/src/dashboard/context.js')
  const { BentoGrid } = await import('/src/components/ui/bento/index.jsx')
  await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-shell.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css')
  const h = React.createElement, noop = () => {}
  const root = createRoot(document.getElementById('proof'))
  const context = { now: new Date(), layout: { widgets: ids.map(id => ({ id })) }, removeWidget: noop, setEditing: noop, connectSource: noop, openWidget: noop }
  window.renderGroup = (revision = 0, full = false) => root.render(h('main', { className: 'bento-foundation widget-home' }, h(DashboardContext.Provider, { value: context }, h(BentoGrid, { className: 'home-layout-grid' }, ...ids.map(id => h(WidgetSlot, { key: id, id, title: id, size: id.startsWith('glance.') ? 's' : 'm', sizes: ['s', 'm'], grip: noop }, h(WidgetFrame, { manifest: { id, title: id, source: { type: 'local' }, empty: 'Fixture empty', sizes: ['s', 'm'], refresh: { mode: 'manual' } }, tile: ['glance.clock', 'glance.weather', 'glance.next-event', 'glance.music'].includes(id), full, refreshVersion: revision })))))))
  window.renderGroup()
 }, Object.keys(fixtures[group]))
 const widget = id => page.locator(`[data-widget="${id}"]`)
 await page.waitForFunction(count => document.querySelectorAll('.widget-adoption').length === count && !document.querySelector('.widget-skeleton'), Object.keys(fixtures[group]).length)

 if (group === 'glance') {
  assert.deepEqual(await widget('glance.air').locator('.ui-stat > div').allTextContents(), ['0'])
  assert.match(await widget('glance.air').innerText(), /PM2.5\s+0 µg\/m³/)
  assert.match(await widget('glance.air').innerText(), /PM10\s+Unavailable/)
  assert.deepEqual(await widget('glance.sun').locator('.adoption-time').allTextContents(), ['06:12', '18:24'])
  assert.equal(await widget('glance.sun').locator('svg[role="img"]').count(), 0)
  assert.equal(await widget('glance.next-event').locator('.ui-stat > div').innerText(), '60min')
  assert.equal(await widget('glance.travel').locator('.adoption-route').innerText(), '12 minutes driving from home')
  assert.equal(await widget('glance.travel').locator('ul').evaluate(n => getComputedStyle(n).listStyleType), 'none')
  await widget('glance.travel').getByText('Home location settings', { exact: true }).click()
  await widget('glance.travel').getByLabel('Home location', { exact: true }).fill('Fixture address')
  await widget('glance.travel').getByRole('button', { name: 'Save location' }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/glance.travel/settings').body, { home: 'Fixture address', enabled: true })
  await widget('glance.music').getByRole('button', { name: 'Pause music' }).click()
  assert.equal(requests.filter(r => r.path.includes('/drafts/')).length, 0, 'playback waits for review')
  await widget('glance.music').getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path.includes('/drafts/')).body, { approved: false })
  await page.evaluate(() => window.renderGroup(0, true))
  await widget('glance.weather').getByText('Location settings', { exact: true }).waitFor()
  await widget('glance.weather').getByText('Location settings', { exact: true }).click()
  await widget('glance.weather').getByLabel('Latitude', { exact: true }).fill('0')
  await widget('glance.weather').getByLabel('Longitude', { exact: true }).fill('0')
  await widget('glance.weather').getByRole('button', { name: 'Save location' }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/glance.weather/settings' && r.body).body, { latitude: 0, longitude: 0 })
  await widget('glance.weather').getByText('Weather data and attribution', { exact: true }).click()
  assert.equal(await widget('glance.weather').getByRole('link', { name: 'Weather data by Open-Meteo' }).count(), 1)
 }

 if (group === 'needs') {
  assert.equal(await widget('need.inbox').getByRole('img', { name: 'Ada Lovelace' }).innerText(), 'AL')
  assert.equal(await widget('need.mentions').getByRole('link', { name: 'Mention fixture' }).getAttribute('href'), 'https://slack.com/fixture')
  assert.equal(await widget('need.snoozed').getByText('Ready now', { exact: true }).count(), 1)
  assert.equal(await widget('need.overdue').getByText('Overdue', { exact: true }).count(), 1)
  await widget('need.approvals').getByRole('button', { name: 'Deny', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/confirmations/approval').body, { allow: false })
  await widget('need.decisions').getByLabel('Which fixture?', { exact: true }).fill('Fixture answer')
  await widget('need.decisions').getByRole('button', { name: 'Answer', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/questions/question').body, { answers: ['Fixture answer'] })
  await widget('need.drafts').getByRole('button', { name: 'Approve', exact: true }).click()
  await widget('need.drafts').getByRole('button', { name: 'Reject change', exact: true }).waitFor()
  assert.equal(requests.filter(r => r.path.includes('/drafts/fixture')).length, 0)
  await widget('need.drafts').getByRole('button', { name: 'Reject change', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/need.drafts/drafts/fixture').body, { approved: false })
  await widget('need.drafts').getByText('About local drafts', { exact: true }).click()
  assert.equal(await widget('need.drafts').getByRole('button', { name: 'Send (send scope disabled)' }).isDisabled(), true)
  await widget('need.drafts').getByText('New draft', { exact: true }).click()
  await widget('need.drafts').getByLabel('Recipient', { exact: true }).fill('fixture@example.com')
  await widget('need.drafts').getByLabel('Subject', { exact: true }).fill('New fixture')
  await widget('need.drafts').getByLabel('Draft text', { exact: true }).fill('Local text')
  await widget('need.drafts').getByRole('button', { name: 'Review new draft', exact: true }).click()
  await widget('need.drafts').getByRole('button', { name: 'Approve local change', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/need.drafts/actions/add').body, { recipient: 'fixture@example.com', subject: 'New fixture', text: 'Local text' })
  await widget('need.waiting').getByRole('button', { name: 'Draft nudge', exact: true }).click()
  assert.equal(await widget('need.waiting').getByLabel('Nudge text', { exact: true }).inputValue(), 'Following up on Waiting fixture.')
  await widget('need.waiting').getByRole('button', { name: 'Review nudge draft', exact: true }).click()
  await widget('need.waiting').getByRole('button', { name: 'Reject change', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/need.waiting/drafts/fixture').body, { approved: false })
  assert.equal(requests.some(r => /\/send\b/.test(r.path)), false)
 }

 if (group === 'communication') {
  assert.equal(await widget('comm.unread').getByText('1 unread shown', { exact: true }).count(), 1)
  assert.equal(await widget('comm.unread').getByText('Unread fixture', { exact: true }).count(), 1)
  await widget('comm.thread-summary').getByRole('button', { name: 'Enable summaries', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/comm.thread-summary/settings').body, { model_enabled: true })
  assert.equal(await widget('comm.newsletters').getByRole('button', { name: /unsubscribe/i }).count(), 0)
  await widget('comm.contacts').getByText('Shared threads', { exact: true }).click()
  assert.equal(await widget('comm.contacts').getByRole('link', { name: 'Shared thread', exact: true }).count(), 1)
  assert.equal(await widget('comm.contacts').getByRole('link', { name: 'Shared thread', exact: true }).getAttribute('href'), 'https://slack.com/thread')
  await widget('comm.reachout').getByText('Reminder settings and birthdays', { exact: true }).click()
  await widget('comm.reachout').getByLabel('Name', { exact: true }).fill('Birthday fixture')
  await widget('comm.reachout').getByLabel('Birthday (MM-DD)', { exact: true }).fill('10-26')
  await widget('comm.reachout').getByRole('button', { name: 'Review birthday', exact: true }).click()
  await widget('comm.reachout').getByRole('button', { name: 'Reject change', exact: true }).waitFor()
  assert.equal(requests.some(r => r.path.includes('/drafts/fixture')), false)
  await widget('comm.reachout').getByRole('button', { name: 'Reject change', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/comm.reachout/actions/configure').body, { days: 30, birthdays: [{ name: 'Birthday fixture', birthday: '10-26' }] })
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/comm.reachout/drafts/fixture').body, { approved: false })
  await widget('comm.templates').getByRole('button', { name: 'Use template', exact: true }).click()
  await widget('comm.templates').getByLabel('Draft recipient', { exact: true }).fill('fixture@example.com')
  await widget('comm.templates').getByRole('button', { name: 'Review template draft', exact: true }).click()
  await widget('comm.templates').getByRole('button', { name: 'Reject change', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/comm.templates/actions/use').body, { id: 1, recipient: 'fixture@example.com' })
  await widget('comm.templates').getByRole('button', { name: 'Edit template', exact: true }).click()
  await widget('comm.templates').getByLabel('Template name', { exact: true }).fill('Edited fixture')
  await widget('comm.templates').getByRole('button', { name: 'Review template edit', exact: true }).click()
  await widget('comm.templates').getByRole('button', { name: 'Approve local change', exact: true }).click()
  assert.equal(requests.find(r => r.path === '/api/widgets/comm.templates/actions/edit').body.title, 'Edited fixture')
  await widget('comm.tone').getByLabel('Saved draft', { exact: true }).selectOption('1')
  await widget('comm.tone').getByLabel('Tone', { exact: true }).selectOption('formal')
  await widget('comm.tone').getByRole('button', { name: 'Generate rewrite', exact: true }).click()
  await widget('comm.tone').getByLabel('Rewritten draft', { exact: true }).fill('Edited rewrite')
  await widget('comm.tone').getByRole('button', { name: 'Review rewrite', exact: true }).click()
  await widget('comm.tone').getByRole('button', { name: 'Reject rewrite', exact: true }).click()
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/comm.tone/actions/rewrite').body, { id: 1, tone: 'formal', text: 'Edited rewrite', reference: 'fixture-revision' })
  assert.deepEqual(requests.find(r => r.path === '/api/widgets/comm.tone/drafts/fixture').body, { approved: false })
  assert.equal(await page.locator('.widget-adoption .ui-ring, .widget-adoption .ui-gauge, .widget-adoption .ui-sparkline').count(), 0, 'no charts for correspondence')
  assert.equal(requests.some(r => /\/send\b/.test(r.path)), false)
 }

 const expandedId = { glance: 'glance.travel', needs: 'need.overdue', communication: 'comm.contacts' }[group]
 const original = fixtures[group][expandedId].items
 fixtures[group][expandedId].items = Array.from({ length: 6 }, (_, i) => ({ ...original[0], id: `expanded-${i}` }))
 await page.evaluate(() => window.renderGroup(80))
 await widget(expandedId).getByRole('button', { name: 'Show all (6)', exact: true }).click()
 const detail = page.getByRole('dialog', { name: expandedId, exact: true })
 await detail.waitFor()
 assert.equal(await detail.locator('.widget-adoption').count(), 1)
 assert.equal(await detail.locator('.widget-list > li').count(), 6)
 assert.equal(await detail.locator('.widget-adoption').evaluate(n => n.scrollWidth <= n.clientWidth + 1), true)
 await page.keyboard.press('Escape')
 await detail.waitFor({ state: 'hidden' })
 fixtures[group][expandedId].items = original

 await page.mouse.move(0, 0)
 for (const theme of ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']) {
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: 1000 })
   assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} page overflow at ${width}`)
   assert.deepEqual(await page.locator('.widget-adoption').evaluateAll(nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => ({ id: n.dataset.widget, width: n.clientWidth, children: [...n.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > n.getBoundingClientRect().right).map(el => [el.tagName, el.className, el.clientWidth, el.scrollWidth]) }))), [], `${theme} tile overflow at ${width}`)
  }
  const primary = page.locator('.widget-adoption .ui-button[data-variant="primary"]').first()
  if (await primary.count()) assert.equal(await primary.evaluate(async n => { n.getBoundingClientRect(); await Promise.all(n.getAnimations().map(a => a.finished)); return getComputedStyle(n).backgroundColor }), 'rgb(113, 50, 214)', `${theme} violet primary`)
 }
 for (const next of ['stale', 'loading', 'error', 'empty', 'not-connected', 'ready']) {
  state = next
  await page.evaluate(revision => window.renderGroup(revision, false), ['stale', 'loading', 'error', 'empty', 'not-connected', 'ready'].indexOf(next) + 1)
  if (next === 'loading') await page.getByLabel('Loading widget…').first().waitFor()
  if (next === 'error') await page.getByText('Fixture error', { exact: true }).first().waitFor()
  if (next === 'stale') await page.getByText('Stale', { exact: true }).first().waitFor()
  if (next === 'not-connected') await page.getByRole('button', { name: 'Connect', exact: true }).first().waitFor()
  if (next === 'empty') await page.getByText('Fixture empty', { exact: true }).first().waitFor()
  if (next === 'ready') await page.waitForFunction(() => !document.querySelector('.widget-skeleton') && !document.querySelector('.home-connect'))
 }
 await page.emulateMedia({ reducedMotion: 'reduce' })
 assert.equal(await page.locator('.widget-adoption button').first().evaluate(n => getComputedStyle(n).transitionDuration.split(',').every(v => parseFloat(v) === 0)), true)
 assert.deepEqual(errors, [])
 console.log(`PASS ${group}: patterns, real values, controls, states, nine themes, mobile/desktop, reduced motion`)
} finally { await browser.close() }
