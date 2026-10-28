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
  await page.clock.install({ time: new Date('2026-10-28T23:59:58+05:30') })
  await page.clock.pauseAt(new Date('2026-10-28T23:59:59+05:30'))
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
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css')
    const h = React.createElement, noop = () => {}, manifest = { id: 'glance.clock', title: 'Clock', sizes: ['s', 'm', 'l'], source: { type: 'local' }, refresh: { mode: 'manual' }, empty: 'No clocks' }
    const root = createRoot(document.getElementById('proof'))
    window.renderClock = (size = 's', open = false) => root.render(
      h('main', { className: 'today-dashboard bento-foundation widget-home' }, h(DashboardContext.Provider, { value: { now: new Date('2026-10-28T23:59:59+05:30'), layout: { widgets: [{ id: manifest.id }] }, removeWidget: noop, setEditing: noop, openWidget: () => window.renderClock(size, true) } },
        h(BentoGrid, { className: 'home-layout-grid' }, h(WidgetSlot, { id: manifest.id, title: 'Clock', size, sizes: manifest.sizes, grip: noop }, h(WidgetFrame, { manifest, tile: true, size }))),
        open && h(Drawer, { title: 'Clock', onClose: () => window.renderClock(size, false) }, h('div', { className: 'widget-home' }, h(WidgetFrame, { manifest, full: true }))))
      )
    )
    window.renderClock()
  })
  const card = page.locator('[data-slot-id="glance.clock"]')
  const world = (scope, zone) => scope.locator('.world-clock').filter({ hasText: zone.replaceAll('_', ' ') })
  await card.locator('.clock-dial').waitFor().catch(async error => { console.error({ errors, body: await page.locator('body').innerText() }); throw error })
  await world(card, 'America/Los_Angeles').waitFor()
  assert.match(await world(card, 'America/Los_Angeles').innerText(), /11:29/)
  assert.match(await world(card, 'Pacific/Kiritimati').innerText(), /Oct 29/)
  await page.clock.runFor(1000)
  assert.match(await card.locator('.home-clock').innerText(), /12:00/)
  assert.match(await card.locator('.clock-date').innerText(), /Oct 29/)
  assert.equal(await card.locator('.clock-minute-hand').getAttribute('transform'), 'rotate(0 100 100)')
  await page.clock.resume()
  await card.getByLabel('Menu Clock', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await card.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Clock', exact: true })
  const input = dialog.getByRole('textbox', { name: 'World clock timezone', exact: true })
  await input.fill('Not/AZone').catch(async error => { console.error({ errors, body: await page.locator('body').innerText() }); throw error })
  assert(await input.evaluate(node => node.getBoundingClientRect().height >= 44), 'timezone input touch target')
  assert(await dialog.getByRole('button', { name: 'Add clock', exact: true }).evaluate(node => node.getBoundingClientRect().height >= 44), 'add clock touch target')
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
  await world(card, 'Europe/London').waitFor()
  assert.deepEqual(writes.at(-1).zones, ['America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/London'])
  await input.fill('Asia/Tokyo')
  await dialog.getByRole('button', { name: 'Add clock', exact: true }).click()
  await dialog.getByText('4 of 4 world clocks', { exact: true }).waitFor()
  await world(card, 'Asia/Tokyo').waitFor()
  assert.equal(await input.count(), 0)
  await dialog.getByRole('button', { name: 'Remove America/Los_Angeles' }).click()
  await input.waitFor()
  await world(card, 'America/Los_Angeles').waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  zones = ['Not/AZone', ' Europe/London ']
  await card.getByRole('button', { name: 'Refresh Clock', exact: true }).focus()
  await page.keyboard.press('Enter')
  await card.getByText('Timezone unavailable', { exact: true }).waitFor()
  await world(card, 'Europe/London').waitFor()
  for (const theme of ['paper', 'graphite', 'ink', 'nocturne', 'nvidia', 'sand', 'claude', 'cursor', 'system']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    for (const width of [1440, 768, 390]) for (const size of ['s', 'm', 'l']) {
      await page.setViewportSize({ width, height: 1000 })
      await page.evaluate(size => window.renderClock(size), size)
      assert(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1), `${theme} ${width} ${size}: card overflow`)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: page overflow`)
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await card.locator('.clock-digits').evaluate(node => getComputedStyle(node).animationName), 'none')
  assert.deepEqual(errors, [])
  console.log('PASS clock: live midnight rollover, saved world clocks, alias validation, failed/pending saves, max/remove, immediate card updates, invalid cache, nine themes, three sizes and widths; no screenshots')
} finally { await browser.close() }
