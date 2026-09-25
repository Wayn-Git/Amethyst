// Shared widget markup and state transitions; no connectors or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const base = process.env.BASE || 'http://127.0.0.1:5177'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.route('**/__widget_primitives__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${base}/__widget_primitives__`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const { default: RefreshRuntime } = await import('/@react-refresh')
    RefreshRuntime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}
    window.$RefreshSig$ = () => type => type
    window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { WidgetCard, CardHeader, WidgetHeader, WidgetRow, WidgetChip, StateView, WidgetState } = await import('/src/dashboard/primitives.jsx')
    const h = React.createElement
    const root = createRoot(document.getElementById('proof'))
    window.renderPrimitives = (state = 'ok', options = {}) => root.render(
      h(WidgetCard, { as: options.as, className: 'home-widget', 'data-widget': 'fixture', 'aria-label': 'Fixture' },
        h(CardHeader, { className: 'bento-card-header' }, h(WidgetChip, { className: 'bento-badge' }, 'Badge')),
        h(WidgetHeader, { title: 'Fixture', count: 2, source: 'local', data: { state, synced_at: '2026-10-25T12:00:00Z' }, now: new Date('2026-10-25T12:02:00Z') }),
        h(WidgetState, { data: { state, error: options.error }, empty: 'No items.', editable: options.editable, disconnected: options.disconnected },
          h('div', { className: 'widget-content' }, h('input', { 'aria-label': 'Draft', defaultValue: '' }),
            h('ul', { className: 'widget-list' }, h(WidgetRow, { className: 'task-item-row', 'data-id': 'fixture' },
              h(WidgetChip, null, 'Ready'), h('button', { onClick: event => { event.currentTarget.textContent = 'Clicked' } }, 'Action'))))),
        h(StateView, { role: 'status', className: 'gallery-empty' }, 'Status')))
    window.renderPrimitives()
  })
  const card = page.getByRole('article', { name: 'Fixture' })
  await card.getByRole('heading', { name: 'Fixture' }).waitFor()
  assert.equal(await card.evaluate(el => el.tagName), 'ARTICLE')
  assert.equal(await card.locator(':scope > header.bento-card-header > span.bento-badge').textContent(), 'Badge')
  assert.equal(await card.locator('ul.widget-list > li.task-item-row[data-id="fixture"] > span.widget-chip').textContent(), 'Ready')
  assert.equal(await card.locator('.widget-header .widget-chip').textContent(), '2')
  assert.equal(await card.locator('.widget-freshness').textContent(), '2m')
  assert.equal(await card.getByRole('status').getAttribute('class'), 'gallery-empty')
  await card.getByRole('button', { name: 'Action' }).click()
  await card.getByRole('button', { name: 'Clicked' }).waitFor()
  await card.getByLabel('Draft').fill('Keep this draft')
  for (const state of ['empty', 'ok', 'stale', 'empty']) {
    await page.evaluate(state => window.renderPrimitives(state, { editable: true }), state)
    if (state === 'empty') await card.getByText('No items.', { exact: true }).waitFor()
    else if (state === 'stale') await card.getByText('Stale data.', { exact: true }).waitFor()
    else await card.getByText('No items.', { exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await card.getByLabel('Draft').inputValue(), 'Keep this draft')
  }
  await page.evaluate(() => window.renderPrimitives('empty'))
  await card.getByLabel('Draft').waitFor({ state: 'hidden' })
  await page.evaluate(() => window.renderPrimitives('loading'))
  await card.getByRole('status', { name: 'Loading widget…' }).waitFor({ state: 'attached' })
  assert.equal(await card.locator('.widget-skeleton > span').count(), 3)
  await page.evaluate(() => window.renderPrimitives('not-connected'))
  await card.getByText('Not connected. Required source or setting is unavailable.', { exact: true }).waitFor()
  assert.equal(await card.getByLabel('Draft').count(), 0)
  await page.evaluate(() => window.renderPrimitives('not-connected', { disconnected: true }))
  await card.getByLabel('Draft').waitFor()
  for (const error of ['Fixture failure', undefined]) {
    await page.evaluate(error => window.renderPrimitives('error', { error }), error)
    await card.getByRole('alert').getByText(error || 'This widget could not refresh.', { exact: true }).waitFor()
    assert.equal(await card.getByLabel('Draft').count(), 0)
  }
  await page.evaluate(() => window.renderPrimitives('ok', { as: 'section' }))
  await page.getByRole('region', { name: 'Fixture' }).waitFor()
  console.log('PASS shared widget primitives: unchanged tags/classes, attributes, row action, freshness, loading/empty/error/not-connected/stale and retained draft input')
} finally {
  await browser.close()
}
