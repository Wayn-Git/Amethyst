import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fixtures } from '../src/dev/widgets/fixtures.js'
import manifests from '../src/dev/widgets/manifests.json' with { type: 'json' }
import { widgetVariations } from '../src/dashboard/widgetVariations.js'

const ids = ['glance.clock', 'glance.weather', 'glance.music', 'glance.next-event', 'glance.air', 'glance.sun', 'glance.travel']
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(name => name.startsWith('chromium-')).sort().reverse().map(name => join(cache, name, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Kolkata', locale: 'en-US' })
  page.setDefaultTimeout(10000)
  await page.route('**/api/**', route => route.fulfill({ json: { zones: [] } }))
  await page.route('**/__variations__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__variations__`)
  await page.evaluate(async () => {
    const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-bento.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/widget-compositions.css')
    const root = createRoot(document.getElementById('proof'))
    window.renderVariation = ({ manifest, payload, size, design }) => root.render(React.createElement(DashboardContext.Provider, { value: { now: new Date('2026-11-03T10:15:00Z'), layout: { widgets: [{ id: manifest.id, size, design }] }, removeWidget() {}, setEditing() {}, openPalette() {} } }, React.createElement('main', { className: 'today-dashboard bento-foundation widget-home' }, React.createElement(WidgetPresentation, { manifest, data: { state: 'ready', payload, synced_at: '2026-11-03T10:15:00Z' }, size, design, tile: true, refresh() {} }))))
  })

  for (const id of ids) {
    const manifest = manifests.find(item => item.id === id)
    const payload = fixtures[id]
    assert(manifest && payload, `${id} has a renderer manifest and test fixture`)
    const signatures = []
    for (const size of manifest.sizes.filter(value => ['s', 'm', 'l'].includes(value))) {
      for (const item of widgetVariations(id)) {
        await page.evaluate(args => window.renderVariation(args), { manifest, payload, size, design: item.id })
        await page.locator('.home-widget[data-widget]').waitFor()
        signatures.push({ size, ...await page.locator('.home-widget').evaluate(node => {
          const content = node.querySelector('.widget-content > *')
          const specific = node.querySelector('.clock-widget')
          const face = specific?.querySelector('.clock-layout, .clock-dial')
          const surface = content?.querySelector('.tugan-card, .wg-card, .music-card') || content?.firstElementChild
          return { design: node.dataset.design, layout: `${face?.className || ''}|${specific?.querySelector('.clock-dial')?.getAttribute('class') || ''}`, background: surface ? getComputedStyle(surface).backgroundColor : '', text: content?.textContent?.trim().slice(0, 80) }
        }) })
      }
    }
    if (id === 'glance.clock') {
      for (const size of manifest.sizes.filter(value => ['s', 'm', 'l'].includes(value))) {
        const designs = signatures.filter(item => item.size === size && item.design?.startsWith('clock-'))
        assert.equal(new Set(designs.map(item => `${item.layout}:${item.text}`)).size, widgetVariations(id).length, `${size}: each Clock design renders a distinct composition`)
      }
    } else {
      for (const size of manifest.sizes.filter(value => ['s', 'm', 'l'].includes(value))) {
        const designs = signatures.filter(item => item.size === size)
        assert.equal(new Set(designs.map(item => item.background)).size, widgetVariations(id).length, `${id} ${size}: each design renders a distinct surface`)
      }
    }
  }
  console.log('PASS glance design variations: distinct renderer output across every supported size')
} finally { await browser.close() }
