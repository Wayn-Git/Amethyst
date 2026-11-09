// Temporary visual harness for clock review screenshots. Not a test.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 620 }, timezoneId: 'Asia/Kolkata', locale: 'en-US' })
  await page.clock.setFixedTime(new Date(process.env.CLOCK_TIME || '2026-10-31T09:35:00Z'))
  await page.route('**/__clock_shots__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__clock_shots__`)
  await page.evaluate(async () => {
    const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-shell.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css'); await import('/src/dashboard/widget-compositions.css'); await import('/src/components/wiggle/wiggle.css').catch(() => {})
    const h = React.createElement
    const manifest = { id: 'glance.clock', title: 'Clock', sizes: ['s', 'm', 'l'], source: { type: 'local' }, refresh: { mode: 'manual' }, empty: 'No clocks' }
    const data = { state: 'ready', payload: { zones: ['Europe/London', 'America/New_York', 'Asia/Tokyo'] }, synced_at: '2026-10-31T09:35:00Z' }
    const context = { now: new Date('2026-10-31T09:35:00Z'), layout: { widgets: [{ id: 'glance.clock', size: 's' }] }, removeWidget: () => {}, setEditing: () => {}, openPalette: () => {}, manifests: [manifest] }
    const sizes = [{ id: 's', label: 'Small · 170 × 170', width: 170, height: 170 }, { id: 'm', label: 'Medium · 356 × 170', width: 356, height: 170 }, { id: 'l', label: 'Large · 356 × 356', width: 356, height: 356 }]
    createRoot(document.getElementById('proof')).render(h(DashboardContext.Provider, { value: context }, h('main', { className: 'today-dashboard bento-foundation widget-home clock-shots' }, sizes.map(({ id, label, width, height }) => h('section', { className: 'clock-shot', key: id }, h('p', { className: 'clock-shot-label' }, label), h('div', { className: 'clock-shot-frame', style: { width, height } }, h(WidgetPresentation, { manifest, data, size: id, tile: true, refresh: () => {}, design: 'clock-sm-01' })))))))
    const style = document.createElement('style')
    style.textContent = `
      html, body { background: #0b0b0d !important; color: #fff; }
      body { margin: 0; font: 400 13px/18px Inter, ui-sans-serif, system-ui, sans-serif; }
      .today-dashboard { background: #0b0b0d !important; min-height: 100vh; }
      .clock-shots { display: flex; align-items: flex-start; gap: 32px; padding: 40px; }
      .clock-shot { display: grid; gap: 12px; }
      .clock-shot-label { margin: 0; color: #8e8e93; font: 500 13px/18px Inter, ui-sans-serif, system-ui, sans-serif; }
      .clock-shot-frame { display: flex; min-width: 0; min-height: 0; }
      .clock-shot-frame > .home-widget { width: 100%; height: 100%; }
      .clock-shot-frame .today-slot-toolbar { display: none; }
    `
    document.head.append(style)
  })
  await page.locator('.clock-time').first().waitFor()
  await page.evaluate(() => document.fonts.ready)
  console.log(JSON.stringify(await page.evaluate(() => {
    const points = [[100, 150], [100, 220], [400, 150], [400, 220]].map(([x, y]) => ({ x, y, stack: document.elementsFromPoint(x, y).slice(0, 8).map(n => ({ tag: n.tagName, cls: typeof n.className === 'string' ? n.className : '', bg: getComputedStyle(n).backgroundColor, h: n.getBoundingClientRect().height, top: n.getBoundingClientRect().top })) }))
    const cards = [...document.querySelectorAll('.clock-card')].map(card => {
      const chain = []
      for (let n = card; n && n !== document.body; n = n.parentElement) {
        const s = getComputedStyle(n), r = n.getBoundingClientRect()
        chain.push({ tag: n.tagName, cls: typeof n.className === 'string' ? n.className : '', bg: s.backgroundColor, display: s.display, height: r.height, top: r.top, bottom: r.bottom, overflow: s.overflow, flex: s.flex, align: s.alignItems, minHeight: s.minHeight, padding: s.padding })
      }
      return chain
    })
    const overflow = [...document.querySelectorAll('.clock-time, .clock-world-reading, .clock-world-place, .clock-date, .clock-city')].map(node => ({ cls: node.className, text: node.textContent, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight }))
    return { points, cards, overflow }
  }), null, 2))
  const outDir = join(import.meta.dirname, '../../ui-review')
  await page.screenshot({ path: join(outDir, 'clock-after.png'), fullPage: true })
  await page.locator('.clock-shot-frame').first().screenshot({ path: join(outDir, 'clock-element.png') })
  console.log('saved ui-review/clock-after.png')
} finally { await browser.close() }
