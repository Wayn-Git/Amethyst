// Synthetic clock settings and browser time only; no accounts or screenshots.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kolkata', locale: 'en-US' })
  page.setDefaultTimeout(10000)
  const errors = [], writes = []
  let zones = ['America/Los_Angeles', 'Pacific/Kiritimati'], failSave = false, releaseSave
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.install({ time: new Date('2026-10-28T23:58:00+05:30') })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/ping') return route.fulfill({ json: { ok: true } })
    if (request.method() === 'PUT') {
      writes.push(request.postDataJSON())
      if (releaseSave) await new Promise(resolve => { releaseSave = resolve })
      if (failSave) return route.fulfill({ status: 503, json: { detail: 'Clock settings unavailable' } })
      zones = request.postDataJSON().zones
      return route.fulfill({ json: { zones } })
    }
    assert.match(path, /^\/api\/widgets\/glance\.clock\/(data|refresh)$/)
    await route.fulfill({ json: { state: 'ready', payload: { zones }, synced_at: new Date().toISOString() } })
  })
  await page.route('**/__clock__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__clock__`)
  await page.evaluate(async () => {
    const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: WidgetFrame } = await import('/src/dashboard/WidgetFrame.jsx')
    const { default: WidgetSlot } = await import('/src/dashboard/WidgetSlot.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    const { BentoGrid } = await import('/src/components/ui/bento/index.jsx')
    const { default: Drawer } = await import('/src/dashboard/Drawer.jsx')
    const { default: AddWidget } = await import('/src/dashboard/AddWidget.jsx')
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css'); await import('/src/dashboard/catalog.css')
    const h = React.createElement, noop = () => {}, manifest = { id: 'glance.clock', title: 'Clock', sizes: ['s', 'm', 'l'], source: { type: 'local' }, refresh: { mode: 'manual' }, empty: 'No clocks' }
    const root = createRoot(document.getElementById('proof'))
    window.clockState = { size: 's', design: 'clock-sm-01', open: false }
    window.renderClock = patch => {
      if (typeof patch === 'string') patch = { size: patch }
      Object.assign(window.clockState, patch)
      const { size, design, open } = window.clockState
      root.render(
        h('main', { className: 'today-dashboard bento-foundation widget-home' }, h(DashboardContext.Provider, { value: { now: new Date('2026-10-28T23:59:59+05:30'), layout: { widgets: [{ id: manifest.id }] }, removeWidget: noop, setEditing: noop, changeDesign: (_id, val) => window.renderClock({ design: val }) } },
          h(BentoGrid, { className: 'home-layout-grid' }, h(WidgetSlot, { id: manifest.id, title: 'Clock', size, sizes: manifest.sizes, grip: noop }, h(WidgetFrame, { manifest, tile: true, size, design }))),
          open && h(Drawer, { title: 'Clock', onClose: () => window.renderClock({ open: false }) }, h('div', { className: 'widget-home' }, h(WidgetFrame, { manifest, full: true, design }))))
        )
      )
    }
    window.renderCatalog = () => root.render(h('main', { className: 'bento-foundation widget-home' }, h(DashboardContext.Provider, { value: { manifests: [{ ...manifest, group: 'glance' }], now: new Date(), layout: { widgets: [] }, addWidget: noop, removeWidget: noop, setEditing: noop } }, h(AddWidget))))
    window.renderClock()
  })
  const card = page.locator('[data-slot-id="glance.clock"]')
  const world = (scope, zone) => scope.locator('.clock-world').filter({ hasText: zone.split('/').at(-1).replaceAll('_', ' ') })
  await card.locator('.clock-time').waitFor().catch(async error => { console.error({ errors, body: await page.locator('body').innerText() }); throw error })
  await page.clock.pauseAt(new Date('2026-10-28T23:59:59+05:30'))

  // Small size verification
  assert.equal(await card.locator('.clock-city').innerText(), 'Kolkata', 'small shows local city name')
  assert.match(await card.locator('.clock-time').innerText(), /11:59/, 'small shows formatted time without leading zero')
  assert.equal(await card.locator('.clock-world').count(), 0, 'small has no world clock rows')
  assert.equal(await card.locator('.clock-date').count(), 0, 'small has no date')
  const cardButton = card.locator('.clock-card')
  assert.match(await cardButton.getAttribute('aria-label'), /Clock, Kolkata, 11:59 PM/, 'card has accessible label')

  // Minute rollover test
  await page.clock.runFor(2000)
  assert.match(await card.locator('.clock-time').innerText(), /12:00/)
  assert.match(await cardButton.getAttribute('aria-label'), /Clock, Kolkata, 12:00 AM/)
  await page.clock.resume()

  // Medium size verification
  await page.evaluate(() => window.renderClock({ size: 'm' }))
  await card.locator('.clock-medium').waitFor()
  assert.equal(await card.locator('.clock-city').innerText(), 'Kolkata')
  assert.match(await card.locator('.clock-time').innerText(), /12:00/)
  assert.equal(await card.locator('.clock-date').innerText(), 'Thu 29 Oct')
  assert.equal(await card.locator('.clock-medium-rule').count(), 1, 'medium has vertical hairline')
  assert.equal(await card.locator('.clock-world').count(), 2, 'medium shows saved world clocks')
  assert.match(await world(card, 'America/Los_Angeles').innerText(), /11:30/)
  assert.match(await world(card, 'America/Los_Angeles').innerText(), /Yesterday, -12:30/)
  assert.match(await world(card, 'Pacific/Kiritimati').innerText(), /Oct 29|Today/)

  // Large size verification
  await page.evaluate(() => window.renderClock({ size: 'l' }))
  await card.locator('.clock-large').waitFor()
  const dial = card.locator('.clock-dial')
  assert.equal(await dial.count(), 1, 'large has analog dial')
  assert.equal(await dial.getAttribute('role'), 'img', 'analog dial has role="img"')
  assert.equal(await card.locator('.clock-second-hand').count(), 1, 'analog face has second hand')
  assert.equal(await card.locator('.clock-second-hand').getAttribute('stroke'), '#ff9f0a', 'second hand is accent orange')
  assert.equal(await card.locator('.clock-world').count(), 2, 'large shows saved world clocks below')
  assert.equal(await card.locator('.clock-large-rule').count(), 1, 'large has divider hairline')

  // Click target and settings drawer verification
  await cardButton.click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('.clock-world-settings').waitFor()
  assert.equal(await dialog.locator('.clock-picker-option').count(), 9, 'dialog shows all 9 clock face variations in settings')
  const input = dialog.getByRole('textbox', { name: 'World clock timezone', exact: true })
  assert(await input.evaluate(node => node.getBoundingClientRect().height >= 44), 'timezone input touch target')
  assert(await dialog.getByRole('button', { name: 'Add clock', exact: true }).evaluate(node => node.getBoundingClientRect().height >= 44), 'add clock touch target')

  // Timezone validation tests
  await input.fill('Not/AZone')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Use a timezone' }).waitFor()
  assert.equal(writes.length, 0)

  // Face variation selection in drawer
  await dialog.getByRole('radio', { name: /Roman/ }).click()
  await page.waitForFunction(() => window.clockState.design === 'clock-sm-04')

  await input.fill('US/Pacific')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'already shown' }).waitFor()
  assert.equal(writes.length, 0, 'timezone aliases cannot create duplicate clocks')

  // Save error handling
  failSave = true
  await input.fill('  Europe/London  ')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Clock settings unavailable' }).waitFor()
  assert.equal(await input.inputValue(), '  Europe/London  ', 'failed save retains input')
  assert.equal(await world(dialog, 'Europe/London').count(), 0)

  // Successful save
  failSave = false
  releaseSave = true
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('dialog form button').disabled)
  assert.equal(await dialog.getByRole('button', { name: 'Remove America/Los_Angeles' }).isDisabled(), true)
  await input.press('Enter')
  assert.equal(writes.length, 2, 'only one settings write may be in flight')
  releaseSave(); releaseSave = null
  await world(dialog, 'Europe/London').waitFor()
  assert.deepEqual(writes.at(-1).zones, ['America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/London'])

  // 4 clocks limit
  await input.fill('Asia/Tokyo')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByText('4 of 4 world clocks', { exact: true }).waitFor()
  assert.equal(await input.count(), 0)

  // Remove clock
  await dialog.getByRole('button', { name: 'Remove America/Los_Angeles' }).click()
  await input.waitFor()
  await world(dialog, 'America/Los_Angeles').waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))

  // Overflow checks across themes and viewports
  for (const theme of ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [1440, 768, 390]) for (const size of ['s', 'm', 'l']) for (const design of ['clock-sm-01', 'clock-sm-04', 'clock-sm-09']) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(({ size, design }) => window.renderClock({ size, design }), { size, design })
      assert(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${theme} ${width} ${size} ${design}: card overflow`)
      assert(await card.locator('.clock-widget').evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1), `${theme} ${width} ${size} ${design}: clock overflow`)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: page overflow`)
    }
  }

  // Reduced motion
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => window.renderClock({ size: 'l' }))
  assert.equal(await card.locator('.clock-second-hand').evaluate(el => getComputedStyle(el).transitionDuration), '1s')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await card.locator('.clock-second-hand').evaluate(el => getComputedStyle(el).transitionDuration), '0s', 'reduced motion steps the second hand')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // Catalog / Preview verification
  const previousWrites = writes.length
  await page.evaluate(() => window.renderCatalog())
  await page.getByRole('button', { name: 'Choose Clock', exact: true }).click()
  const preview = page.getByLabel('Clock S preview', { exact: true })
  await preview.locator('.clock-time').waitFor()
  assert.equal(await preview.locator('.clock-world').count(), 0)
  for (const size of ['M', 'L', 'S']) {
    await page.getByRole('radio', { name: size, exact: true }).click()
    const live = page.getByLabel(`Clock ${size} preview`, { exact: true })
    await live.locator(`[data-clock-size='${size.toLowerCase()}']`).waitFor()
    assert.equal(await live.locator('input:visible').count(), 0, 'previews do not expose settings')
    assert(await live.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${size} gallery preview fits`)
  }
  assert.equal(writes.length, previousWrites, 'browsing variants does not write settings')
  assert.deepEqual(errors, [])
  console.log('PASS clock: small/medium/large native layouts; digital and analog; timezone validation; settings; reduced motion; nine themes')
} finally { await browser.close() }
