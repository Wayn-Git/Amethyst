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
    window.clockState = { size: 's', open: false, design: undefined }
    window.designChanges = []
    window.renderClock = patch => {
      if (typeof patch === 'string') patch = { size: patch }
      Object.assign(window.clockState, patch)
      const { size, open, design } = window.clockState
      root.render(
        h('main', { className: 'today-dashboard bento-foundation widget-home' }, h(DashboardContext.Provider, { value: { now: new Date('2026-10-28T23:59:59+05:30'), layout: { widgets: [{ id: manifest.id }] }, removeWidget: noop, setEditing: noop, changeDesign: (id, next) => { window.designChanges.push(next); window.renderClock({ design: next }) } } },
          h(BentoGrid, { className: 'home-layout-grid' }, h(WidgetSlot, { id: manifest.id, title: 'Clock', size, sizes: manifest.sizes, grip: noop }, h(WidgetFrame, { manifest, tile: true, size, design }))),
          open && h(Drawer, { title: 'Clock', onClose: () => window.renderClock({ open: false }) }, h('div', { className: 'widget-home' }, h(WidgetFrame, { manifest, full: true, design }))))
        )
      )
    }
    window.renderCatalog = () => root.render(h('main', { className: 'bento-foundation widget-home' }, h(DashboardContext.Provider, { value: { manifests: [{ ...manifest, group: 'glance' }], now: new Date(), layout: { widgets: [] }, addWidget: noop, removeWidget: noop, setEditing: noop } }, h(AddWidget))))
    window.renderClock()
  })
  const card = page.locator('[data-slot-id="glance.clock"]')
  const world = (scope, zone) => scope.locator('.clock-world').filter({ hasText: zone.replaceAll('_', ' ') })
  await card.locator('.clock-time').waitFor().catch(async error => { console.error({ errors, body: await page.locator('body').innerText() }); throw error })
  await page.clock.pauseAt(new Date('2026-10-28T23:59:59+05:30'))
  assert.equal(await card.locator('.clock-widget').getAttribute('data-clock-design'), 'clock-sm-01', 'minimal digital is the default face')
  assert.equal(await card.locator('.clock-seconds').count(), 0, 'small digital face hides seconds')
  await card.getByText('2 world clocks', { exact: true }).waitFor()
  assert.equal(await card.locator('.clock-world:visible').count(), 0, 'small shows the local instrument and saved-world count')

  await page.evaluate(() => window.renderClock({ size: 'm', design: 'clock-sm-02' }))
  await card.locator('.clock-seconds').waitFor()
  assert.match(await card.locator('.clock-time').innerText(), /11:59/)
  await page.clock.runFor(1000)
  assert.match(await card.locator('.clock-time').innerText(), /12:00/)
  assert.match(await card.locator('.clock-meta').innerText(), /ASIA\/(KOLKATA|CALCUTTA)/)
  assert.equal(await card.locator('.clock-seconds').innerText(), ':00')
  await page.clock.runFor(1000)
  assert.equal(await card.locator('.clock-seconds').innerText(), ':01')
  assert.equal(await card.locator('.clock-world').count(), 2, 'medium digital face shows two world clocks')
  assert.match(await world(card, 'America/Los_Angeles').innerText(), /11:30/)
  assert.match(await world(card, 'Pacific/Kiritimati').innerText(), /Oct 29/)
  assert.match(await world(card, 'Pacific/Kiritimati').locator('.clock-world-offset').innerText(), /GMT\+14/)
  await page.clock.resume()

  await page.evaluate(() => window.renderClock({ size: 'm', design: 'clock-sm-04' }))
  await card.locator('.clock-dial').waitFor()
  assert.equal(await card.locator('.clock-second-hand').count(), 1, 'analog face keeps the second hand')
  assert.equal(await card.locator('.clock-world').count(), 0, 'analog medium keeps world rows out of the dial')
  await card.getByText('2 world clocks saved', { exact: true }).waitFor()
  assert.equal(await card.locator('.clock-numeral').count(), 12)
  await page.evaluate(() => window.renderClock({ size: 'l', design: 'clock-sm-04' }))
  assert.equal(await card.locator('.clock-world').count(), 2, 'analog large shows saved world clocks beside the dial')

  await page.evaluate(() => window.renderClock({ size: 'm', design: 'clock-sm-08' }))
  assert.equal(await card.locator('.clock-world').count(), 2)
  await page.evaluate(() => window.renderClock({ size: 'l', design: 'clock-sm-09' }))
  assert.equal(await card.locator('.clock-worlds--ledger').count(), 1)
  assert.equal(await card.locator('.clock-world').count(), 2)

  await page.evaluate(() => window.renderClock({ size: 'm', design: 'clock-sm-01' }))
  await card.getByLabel('Menu Clock', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Clock', exact: true })
  const input = dialog.getByRole('textbox', { name: 'World clock timezone', exact: true })
  await input.fill('Not/AZone').catch(async error => { console.error({ errors, body: await page.locator('body').innerText() }); throw error })
  assert(await input.evaluate(node => node.getBoundingClientRect().height >= 44), 'timezone input touch target')
  assert(await dialog.getByRole('button', { name: 'Add clock', exact: true }).evaluate(node => node.getBoundingClientRect().height >= 44), 'add clock touch target')

  for (const name of ['Precision', 'Roman', 'World pair', 'World grid', 'World ledger', 'Minimal']) {
    await dialog.getByRole('radio', { name: new RegExp(name) }).click()
  }
  assert.equal(await card.locator('.clock-widget').getAttribute('data-clock-design'), 'clock-sm-01', 'face picker returns to the selected face')
  await dialog.getByRole('radio', { name: /Precision/ }).click()
  assert.equal(await card.locator('.clock-widget').getAttribute('data-clock-design'), 'clock-sm-02', 'face picker updates the tile immediately')
  await dialog.getByRole('radio', { name: /Minimal/ }).click()

  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Use a timezone' }).waitFor()
  assert.equal(writes.length, 0)
  await input.fill('US/Pacific')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'already shown' }).waitFor()
  assert.equal(writes.length, 0, 'timezone aliases cannot create duplicate clocks')
  failSave = true
  await input.fill('  Europe/London  ')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: 'Clock settings unavailable' }).waitFor()
  assert.equal(await input.inputValue(), '  Europe/London  ', 'failed save retains input')
  assert.equal(await world(dialog, 'Europe/London').count(), 0)
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
  await input.fill('Asia/Tokyo')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByText('4 of 4 world clocks', { exact: true }).waitFor()
  assert.equal(await input.count(), 0)
  await page.evaluate(() => window.renderClock({ size: 'l', design: 'clock-sm-08' }))
  assert.equal(await card.locator('.clock-world').count(), 4, 'large world grid shows four cities')
  await dialog.getByRole('button', { name: 'Remove America/Los_Angeles' }).click()
  await input.waitFor()
  await world(dialog, 'America/Los_Angeles').waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))

  zones = ['Not/AZone', ' Europe/London ']
  await card.getByRole('button', { name: 'Refresh Clock', exact: true }).focus()
  await page.keyboard.press('Enter')
  await card.getByText('Timezone unavailable', { exact: true }).waitFor()
  await world(card, 'Europe/London').waitFor()

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
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => window.renderClock({ size: 'm', design: 'clock-sm-05' }))
  assert.equal(await card.locator('.clock-second-hand').count(), 0, 'reduced motion removes every second hand')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

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
    assert.equal(await live.locator('.clock-picker').count(), 0, 'previews do not expose the face picker')
    assert(await live.locator('.clock-world').count() <= 2, `${size} gallery preview keeps world clocks bounded`)
    assert(await live.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${size} gallery preview fits`)
  }
  assert.equal(writes.length, previousWrites, 'browsing variants does not write settings')
  assert.deepEqual(errors, [])
  console.log('PASS clock: nine faces across digital, analog and world families; default face, seconds rules, world limits, face picker, saved clocks, alias validation, failed/pending saves, reduced motion, nine themes, three sizes and widths; no screenshots')
} finally { await browser.close() }
