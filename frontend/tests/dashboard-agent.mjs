// Isolated components and dashboard API only; no connected accounts or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const base = process.env.BASE || 'http://127.0.0.1:5177'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
try {
  await page.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url())
    if (!url.pathname.startsWith('/api/widgets/agent.')) return route.fulfill({ json: {} })
    const response = await fetch(`${backend}${url.pathname}${url.search}`, { method: req.method(), headers: { 'Content-Type': 'application/json' }, ...(req.postData() ? { body: req.postData() } : {}) })
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
  })
  await page.goto(base)
  await page.evaluate(async () => {
    const React = await import('/node_modules/.vite/deps/react.js')
    const client = await import('/node_modules/.vite/deps/react-dom_client.js')
    const createRoot = client.createRoot || client.default.createRoot
    window.testMount = async (file, id, data) => {
      const { default: Component } = await import(`/src/dashboard/widgets/${file}.jsx`)
      window.testRoot ||= createRoot(document.getElementById('agent-test'))
      window.testRoot.render((React.createElement || React.default.createElement)(Component, { key: id, widgetId: id, data, refresh: async () => {} }))
    }
    document.body.innerHTML = '<div id="agent-test"></div>'
    await window.testMount('Jobs', 'agent.jobs', { items: [] })
  })
  await page.getByLabel('Title', { exact: true }).fill('UI fixture job')
  await page.getByLabel('Prompt', { exact: true }).fill('Read fixture')
  await page.getByLabel('Run at', { exact: true }).fill('2099-01-01T12:00')
  await page.getByRole('button', { name: 'Review job', exact: true }).click()
  await page.getByRole('button', { name: 'Approve change' }).click()
  await page.getByRole('button', { name: 'Review job', exact: true }).waitFor()
  const result = await fetch(`${backend}/api/widgets/agent.jobs/refresh`, { method: 'POST' })
  assert.equal(result.ok, true)
  const cached = await (await fetch(`${backend}/api/widgets/agent.jobs/data`)).json()
  assert.ok(cached.payload.items.some(i => i.title === 'UI fixture job'))
  console.log('agent.jobs UI passed')
  await page.evaluate(() => window.testMount('Jobs', 'agent.delegated', { items: [{ id: 1, title: 'Fixture queued', status: 'queued' }] }))
  await page.getByText('Fixture queued', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Run at', { exact: true }).count(), 0)
  await page.getByLabel('Title', { exact: true }).fill('UI delegated fixture')
  await page.getByLabel('Prompt', { exact: true }).fill('Read fixture')
  await page.getByRole('button', { name: 'Review job', exact: true }).click()
  await page.getByRole('button', { name: 'Approve change' }).click()
  await page.getByRole('button', { name: 'Review job', exact: true }).waitFor()
  console.log('agent.delegated UI passed')
  await page.evaluate(() => window.testMount('Jobs', 'agent.research', { available: false, items: [] }))
  await page.getByText('not available', { exact: true }).waitFor()
  assert.equal(await page.getByRole('form').count(), 0)
  await page.evaluate(() => window.testMount('Jobs', 'agent.research', { available: true, items: [{ id: 2, title: 'Research fixture', status: 'done', note_id: 123 }] }))
  await page.getByRole('link', { name: 'Open research note' }).waitFor()
  console.log('agent.research UI passed')
  await page.evaluate(() => window.testMount('Watchers', 'agent.watchers', { items: [] }))
  await page.getByLabel('Title', { exact: true }).fill('UI watcher fixture')
  await page.getByLabel('Kind', { exact: true }).selectOption('mailbox')
  await page.getByLabel('Page URL or Gmail query').fill('subject:fixture')
  assert.equal(await page.getByLabel('Poll minutes').getAttribute('min'), '15')
  await page.getByRole('button', { name: 'Review watcher' }).click()
  await page.getByRole('button', { name: 'Reject change' }).click()
  await page.getByRole('button', { name: 'Review watcher' }).waitFor()
  console.log('agent.watchers UI passed')
  await page.evaluate(() => window.testMount('Rules', 'agent.rules', { items: [{ id: 'write_fixture', title: 'write_fixture', decision: 'ask', can_allow: false }] }))
  const rule = page.getByRole('combobox', { name: 'Rule for write_fixture' })
  assert.equal(await rule.inputValue(), 'ask')
  assert.equal(await rule.locator('option[value="allow"]').evaluate(el => el.disabled), true)
  await rule.selectOption('deny')
  console.log('agent.rules UI passed')
  await page.evaluate(() => window.testMount('Usage', 'agent.usage', { window: 'Fixture session', items: [
    { id: 'local/fixture', title: 'Local fixture', location: 'local', calls: 1, input_tokens: 10, output_tokens: 5, latency_ms: 25 },
    { id: 'cloud/fixture', title: 'Cloud fixture', location: 'cloud', calls: 1, input_tokens: null, output_tokens: 5, latency_ms: 50, estimated_cost_usd: null }
  ] }))
  await page.getByText('Model latency: 25 ms', { exact: true }).waitFor()
  assert.equal(await page.getByText('Estimated cost: Unavailable', { exact: true }).count(), 1)
  assert.equal(await page.getByText(/Estimated cost:/).count(), 1)
  console.log('agent.usage UI passed')
} finally { await browser.close() }
