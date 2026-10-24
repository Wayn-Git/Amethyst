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
  await page.route('**/api/**', route => route.fulfill({ json: {} }))
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
  await page.evaluate(() => window.renderWeather({ widgetId: 'glance.air', data: { european_aqi: 0, pm2_5: 0, pm10: 2, time: '2026-10-25T12:00' } }))
  await page.getByText('European AQI: 0', { exact: false }).waitFor()
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Music } = await import('/src/dashboard/widgets/Music.jsx')
    const node = document.createElement('div'); document.body.append(node)
    createRoot(node).render(React.createElement(Music, { data: { items: [], history: [{ title: 'Fixture track', artists: ['Fixture artist'], url: null }] } }))
  })
  await page.getByText('Nothing playing.', { exact: true }).waitFor()
  await page.getByText('Fixture track', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Feeds } = await import('/src/dashboard/widgets/Feeds.jsx')
    window.feedCalls = []
    window.fetch = async (url, options) => {
      window.feedCalls.push({ url, body: options?.body })
      const body = JSON.parse(options.body)
      const value = url.includes('/actions/') ? { draft_id: 'fixture', action: 'add', item: body } : { state: 'applied' }
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    }
    const node = document.createElement('div'); document.body.append(node)
    createRoot(node).render(React.createElement(Feeds, { data: { feeds: [], items: [] }, refresh: () => {} }))
  })
  await page.getByRole('button', { name: 'Add feed', exact: true }).click()
  await page.getByLabel('Feed URL', { exact: true }).fill('https://example.com/rss')
  await page.getByLabel('Tags (comma separated)', { exact: true }).fill('Code')
  await page.getByRole('button', { name: 'Review change', exact: true }).click()
  await page.getByRole('button', { name: 'Approve change', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.feedCalls.length), 1)
  await page.getByRole('button', { name: 'Reject change', exact: true }).click()
  await page.getByRole('button', { name: 'Add feed', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => JSON.parse(window.feedCalls[1].body)), { approved: false })
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: News } = await import('/src/dashboard/widgets/News.jsx')
    const node = document.createElement('div'); document.body.append(node)
    createRoot(node).render(React.createElement(News, { data: { items: [{ tag: 'Code', items: [{ feed_id: 1, title: 'Fixture news', url: 'https://example.com/news', published_at: '' }] }], errors: [{ feed_id: 2 }] } }))
  })
  await page.getByRole('region', { name: 'Code', exact: true }).waitFor()
  assert.equal(await page.getByRole('link', { name: 'Fixture news' }).getAttribute('href'), 'https://example.com/news')
  await page.getByText('Some feeds are unavailable;', { exact: false }).waitFor()
  console.log('All six public widget UI checks passed')
} finally { await browser.close() }
