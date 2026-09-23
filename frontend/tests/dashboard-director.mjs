// Isolated component regression; all action requests use test-only responses.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
const calls = []
let rejectAction = false
await page.route('**/api/**', route => {
  calls.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() })
  return route.fulfill(rejectAction ? { status: 410, json: { detail: 'Test request expired' } } : { json: {} })
})
try {
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/@vite/client`)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Director } = await import('/src/dashboard/widgets/Director.jsx')
    document.body.innerHTML = '<main id="test"></main>'
    window.mount = (widgetId, items) => {
      window.root ||= createRoot(document.getElementById('test'))
      window.root.render(React.createElement(Director, { widgetId, data: { items }, refresh: async () => { window.refreshed = true } }))
    }
  })
  await page.evaluate(() => window.mount('agent.feed', [{ id: 'fixture', title: 'Test turn', detail: '1 model call' }]))
  await page.getByText('Test turn', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button').count(), 0)
  await page.evaluate(() => window.mount('agent.running', [{ id: 'fixture', title: 'acting', detail: '1 tool call', conversation_id: 'test/id' }]))
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.waitForFunction(() => window.refreshed)
  assert.equal(calls.at(-1).path, '/api/conversations/test%2Fid/turn/stop')
  await page.evaluate(() => window.mount('need.approvals', [{ id: 'test', title: 'Test write', detail: 'high · Test reason', arguments: '{"path":"/test"}' }]))
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.getByRole('button', { name: 'Deny', exact: true }).click()
  assert.deepEqual(calls.slice(-2).map(call => call.body), [{ allow: true }, { allow: false }])
  assert.equal(calls.at(-1).path, '/api/confirmations/test')
  await page.evaluate(() => window.mount('need.decisions', [{ id: 'test-question', title: 'Decision waiting', questions: [{ question: 'Which folder?', options: [{ label: 'Test folder', description: 'Fixture option' }] }] }]))
  await page.getByLabel('Which folder?', { exact: true }).fill('Test folder')
  await page.getByRole('button', { name: 'Answer', exact: true }).click()
  assert.deepEqual(calls.at(-1), { path: '/api/questions/test-question', body: { answers: ['Test folder'] } })
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  assert.equal(calls.at(-1).path, '/api/questions/test-question/reject')
  rejectAction = true
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Test request expired' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Dismiss', exact: true }).isEnabled(), true)
  for (const id of ['agent.feed', 'agent.running', 'agent.audit', 'agent.errors', 'need.approvals', 'need.decisions']) {
    await page.evaluate(id => window.mount(id, []), id)
    await page.waitForFunction(() => document.querySelectorAll('li').length === 0)
    assert.equal(await page.getByRole('button').count(), 0)
  }
  console.log('Director component tests passed')
} finally { await browser.close() }
