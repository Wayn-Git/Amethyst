// Render real widgets with mocked API responses; no external services or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177')
  const result = await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Weather } = await import('/src/dashboard/widgets/Weather.jsx')
    window.fetch = async () => new Response('{}', { headers: { 'content-type': 'application/json' } })
    document.body.innerHTML = '<div id="proof"></div>'
    const root = createRoot(document.getElementById('proof'))
    window.renderWeather = props => root.render(React.createElement(Weather, { refresh: () => {}, ...props }))
    window.renderWeather({ data: { set_location: true } })
    return true
  })
  assert.equal(result, true)
  await page.getByText('Set location', { exact: true }).waitFor()
  await page.getByLabel('Latitude', { exact: true }).fill('0')
  await page.getByLabel('Longitude', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Save location' }).click()
  assert.equal(await page.getByRole('link', { name: 'Weather data by Open-Meteo' }).count(), 1)
  await page.evaluate(() => window.renderWeather({ widgetId: 'glance.sun', data: { sunrise: null, sunset: null, timezone: 'UTC' } }))
  await page.getByText('Sunrise: Unavailable · Sunset: Unavailable · UTC', { exact: true }).waitFor()
  console.log('glance.weather, glance.sun UI passed')
} finally { await browser.close() }
