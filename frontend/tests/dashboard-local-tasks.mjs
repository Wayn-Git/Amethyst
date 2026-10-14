// Synthetic local records, fixed clock and user timezone; no screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const backend = process.env.WIDGET_BACKEND || 'http://127.0.0.1:8017'
const widget = process.env.TEST_WIDGET || 'task.focus'
const names = { 'task.focus': 'Focus', 'task.habits': 'Habits', 'task.goals': 'Goals', 'task.kanban': 'Kanban' }
if (widget === 'task.focus') {
  const response = await fetch(`${backend}/api/widgets/task.focus/actions/stop`, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
  if (response.ok) { const draft = await response.json(); await fetch(`${backend}/api/widgets/task.focus/drafts/${draft.draft_id}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({approved:true})}) }
}
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ timezoneId: 'Asia/Kolkata' })
page.on('pageerror', e => console.error(e.message))
page.setDefaultTimeout(10000)
await page.clock.install({ time: new Date('2026-10-25T18:29:00Z') })
await page.route('**/api/**', async route => { const url = new URL(route.request().url()); await route.fulfill({ response: await route.fetch({ url: backend + url.pathname }) }) })
await page.route('**/local-widget-test', route => route.fulfill({ contentType: 'text/html', body: `<div id="root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module">import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js'; import Widget from '/src/dashboard/widgets/${names[widget]}.jsx'; async function refresh(){const r=await fetch('/api/widgets/${widget}/refresh',{method:'POST'}); await r.json(); const data=await (await fetch('/api/widgets/${widget}/data')).json(); createRootOnce.render(React.createElement(Widget,{data:data.payload,widgetId:'${widget}',refresh}));}const createRootOnce=ReactDOM.createRoot(document.getElementById('root'));refresh();</script>` }))
try {
  await page.goto((process.env.BASE || 'http://127.0.0.1:5177') + '/local-widget-test')
  if (widget === 'task.focus') {
    await page.getByLabel('Focus minutes', { exact: true }).fill('1')
    await page.getByRole('button', { name: 'Save settings', exact: true }).click()
    await page.getByRole('button', { name: 'Approve change', exact: true }).click()
    await page.getByRole('button', { name: 'Start focus', exact: true }).click()
    await page.getByRole('button', { name: 'Reject change', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Stop timer', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Start break', exact: true }).click()
    await page.getByRole('button', { name: 'Approve change', exact: true }).click()
    await page.getByRole('button', { name: 'Stop timer', exact: true }).click()
    await page.getByRole('button', { name: 'Approve change', exact: true }).click()
    await page.getByText(/Stopped/).first().waitFor()
  }
  if (widget === 'task.habits') {
    await page.getByLabel('Habit title', { exact: true }).fill('Read fixture')
    await page.getByRole('button', { name: 'Create habit', exact: true }).click()
    await page.getByRole('button', { name: 'Reject change', exact: true }).click()
    assert.equal(await page.getByText('Read fixture', { exact: true }).count(), 0)
    await page.getByLabel('Habit title', { exact: true }).fill('Read fixture')
    await page.getByRole('button', { name: 'Create habit', exact: true }).click()
    await page.getByRole('button', { name: 'Approve change', exact: true }).click()
    await page.getByRole('button', { name: 'Check in Read fixture', exact: true }).click()
    await page.getByRole('button', { name: 'Approve change', exact: true }).click()
    await page.getByText('1/1 daily · Streak: 1', { exact: true }).waitFor()
    await page.reload()
    await page.getByText('1/1 daily · Streak: 1', { exact: true }).waitFor()
  }
  if (widget === 'task.goals') {
    await page.getByLabel('Goal title', { exact: true }).fill('Learn fixture')
    await page.getByLabel('Target date', { exact: true }).fill('2026-10-26')
    await page.getByRole('button', { name: 'Create goal', exact: true }).click()
    await page.getByRole('button', { name: 'Approve change', exact: true }).click()
    await page.getByLabel('Progress for Learn fixture', { exact: true }).fill('75')
    await page.getByRole('button', { name: 'Update progress', exact: true }).click()
    await page.getByRole('button', { name: 'Reject change', exact: true }).click()
    await page.getByText('Target: 2026-10-26 · Progress: 0%', { exact: true }).waitFor()
    await page.getByLabel('Progress for Learn fixture', { exact: true }).fill('75')
    await page.getByRole('button', { name: 'Update progress', exact: true }).click()
    await page.getByRole('button', { name: 'Approve change', exact: true }).click()
    await page.getByText('Target: 2026-10-26 · Progress: 75%', { exact: true }).waitFor()
  }
  console.log(`${widget}: passed`)
} finally { await browser.close() }
