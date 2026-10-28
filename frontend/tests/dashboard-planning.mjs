// Synthetic props and mocked requests; no account access or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  const saved = []
  await page.route('**/api/**', async route => {
    if (route.request().method() === 'PUT') saved.push(route.request().postDataJSON())
    await route.fulfill({ json: {} })
  })
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177')
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Planning } = await import('/src/dashboard/widgets/Planning.jsx')
    document.body.innerHTML = '<div id="test"></div>'
    window.dashboardTestRoot = createRoot(document.getElementById('test'))
    window.dashboardTestRoot.render(React.createElement(Planning, {
      widgetId: 'task.plan', refresh: async () => {}, data: { timezone: 'Asia/Kolkata', message: 'Proposed only', items: [{ id: 'fixture', title: 'Task fixture', detail: 'Proposed only', start: '2026-10-26T04:30:00Z', end: '2026-10-26T05:30:00Z' }] },
    }))
  })
  await page.getByText('Task fixture', { exact: true }).waitFor()
  assert.match(await page.locator('ul').innerText(), /10:00/)
  assert.equal(await page.getByRole('button', { name: /calendar/i }).count(), 0)
  await page.getByText('Working hours settings').click()
  await page.getByLabel('Start', { exact: true }).fill('09:00')
  await page.getByLabel('End', { exact: true }).fill('17:00')
  await page.getByLabel('Mon', { exact: true }).check()
  await page.getByRole('button', { name: 'Save working hours' }).click()
  await page.waitForTimeout(100)
  assert.deepEqual(saved, [{ start: '09:00', end: '17:00', timezone: 'Asia/Kolkata', days: [0] }])
  for (const title of ['set location', 'not available', 'Destination fixture']) {
    await page.evaluate(async title => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js')
      const { default: Travel } = await import('/src/dashboard/widgets/Travel.jsx')
      window.dashboardTestRoot.render(React.createElement(Travel, {
        refresh: async () => {}, data: { timezone: 'Asia/Kolkata', items: [{ id: 'travel', title,
          ...(title === 'Destination fixture' ? { detail: '11 minutes driving from home', start: '2026-10-26T04:30:00Z' } : {}),
        }] },
      }))
    }, title)
    await page.getByText(title, { exact: true }).waitFor()
  }
  assert.match(await page.locator('time').innerText(), /10:00/)
  await page.getByText('Home location settings', { exact: true }).click()
  await page.getByLabel('Home location').fill('Home fixture')
  await page.getByRole('button', { name: 'Save location' }).click()
  await page.waitForTimeout(100)
  assert.deepEqual(saved.at(-1), { home: 'Home fixture', enabled: true })
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: Travel } = await import('/src/dashboard/widgets/Travel.jsx')
    window.dashboardTestRoot.render(React.createElement(Travel, {
      refresh: async () => {}, data: { items: [], message: 'No upcoming event with a location.' },
    }))
  })
  await page.getByText('No upcoming event with a location.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'Save location' }).count(), 1)
  console.log('dashboard planning UI passed')
} finally { await browser.close() }
