// Synthetic component fixtures; no connected accounts or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177')
  await page.evaluate(async () => {
    const React = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Component } = await import('/src/dashboard/widgets/Communication.jsx')
    document.body.innerHTML = '<div id="fixture"></div>'
    ReactDOM.createRoot(document.getElementById('fixture')).render(React.default.createElement(Component, { widgetId: 'need.lor-slack', data: { limited: true, items: [{ id: 'D1', title: 'DM fixture', source: 'Slack', url: 'https://slack.com/fixture' }] } }))
  })
  await page.getByRole('link', { name: 'DM fixture' }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'DM fixture' }).getAttribute('href'), 'https://slack.com/fixture')
  assert.match(await page.locator('#fixture').innerText(), /Results limited/)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Component } = await import('/src/dashboard/widgets/Communication.jsx')
    const host = document.createElement('div'); document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(Component, { widgetId: 'comm.thread-summary', refresh: async () => {}, data: { model_enabled: true, items: [{ id: 's', title: 'Thread fixture', summary: 'Summary fixture', url: 'https://mail.google.com/mail/u/0/#all/a' }] } }))
  })
  await page.getByText('Summary fixture', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Disable summaries' }).count(), 1)
  console.log('Communication UI passed')
} finally { await browser.close() }
