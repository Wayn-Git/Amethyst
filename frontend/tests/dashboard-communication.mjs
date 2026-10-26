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
  const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: backend + url.pathname + url.search })
    await route.fulfill({ response })
  })
  await page.route('**/__dashboard_fixture', route => route.fulfill({
    contentType: 'text/html',
    body: `<html><body><script type="module">
      import RefreshRuntime from '/@react-refresh'
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => type => type
      window.__vite_plugin_react_preamble_installed__ = true
    </script></body></html>`,
  }))
  await page.goto((process.env.BASE || 'http://127.0.0.1:5177') + '/__dashboard_fixture')
  await page.waitForFunction(() => window.__vite_plugin_react_preamble_installed__)
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
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Component } = await import('/src/dashboard/widgets/Communication.jsx')
    const host = document.createElement('div'); document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(Component, { widgetId: 'comm.newsletters', data: { items: [{ id: 'n', title: 'Newsletter fixture', suggestion: 'Consider unsubscribing in Gmail.' }] } }))
  })
  await page.getByText('Consider unsubscribing in Gmail.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: /unsubscribe/i }).count(), 0)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Component } = await import('/src/dashboard/widgets/Communication.jsx')
    const host = document.createElement('div'); document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(Component, { widgetId: 'comm.contacts', data: { items: [{ id: 'c', title: 'Contact fixture', person: 'them@example.org', at: '2026-10-01', threads: ['https://slack.com/thread'] }] } }))
  })
  await page.getByText(/Last contact:/).waitFor()
  await page.getByText('Shared threads', { exact: true }).click()
  assert.equal(await page.getByRole('link', { name: 'Shared thread', exact: true }).getAttribute('href'), 'https://slack.com/thread')
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Component } = await import('/src/dashboard/widgets/Reachout.jsx')
    const host = document.createElement('div'); document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(Component, { refresh: async () => {}, data: { days: 30, birthdays: [], items: [] } }))
  })
  await page.getByRole('spinbutton', { name: 'Days without contact' }).waitFor()
  assert.equal(await page.getByRole('spinbutton', { name: 'Days without contact' }).inputValue(), '30')
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Birthday fixture')
  await page.getByRole('textbox', { name: 'Birthday (MM-DD)' }).fill('10-25')
  const before = await (await fetch(backend + '/api/widgets/comm.reachout/settings')).json()
  await page.getByRole('button', { name: 'Review birthday', exact: true }).click()
  const review = page.getByRole('region', { name: 'Review reach-out settings' })
  await review.waitFor()
  assert.match(await review.innerText(), /Birthday fixture: 10-25/)
  assert.deepEqual(await (await fetch(backend + '/api/widgets/comm.reachout/settings')).json(), before)
  await review.getByRole('button', { name: 'Approve local change' }).click()
  await page.getByRole('button', { name: 'Review birthday', exact: true }).waitFor()
  const saved = await (await fetch(backend + '/api/widgets/comm.reachout/settings')).json()
  assert.equal(saved.days, 30)
  assert.equal(saved.birthdays[0].name, 'Birthday fixture')
  console.log('Five communication widgets: UI and gated local birthday passed')
} finally { await browser.close() }
