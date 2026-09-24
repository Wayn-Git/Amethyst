import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const base = process.env.BASE || 'http://127.0.0.1:5177'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
 const errors = []; page.on('pageerror', e => (errors.push(e.message), console.error(e.message)))
 const ids = ['glance.clock', 'glance.weather', 'agent.feed', 'task.today', 'dev.prs']
 let layout = { widgets: ids.map(id => ({ id, size: id.startsWith('glance') ? 's' : 'm', height: 3 })) }
 const saves = []
 await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname
  let json = {}
  if (path === '/api/widgets') json = { widgets: ids.map(id => ({ enabled: true, manifest: { id, title: id, group: id.startsWith('glance') ? 'glance' : id.startsWith('task') ? 'tasks' : 'agent', sizes: ['s','m','l'], source: { type: 'local' }, refresh: { mode: 'manual' }, requires: [], empty: 'No fixture items.' } })) }
  if (path === '/api/layout') { if (route.request().method() === 'PUT') { layout = route.request().postDataJSON(); saves.push(layout) }; json = layout }
  if (/\/(data|refresh)$/.test(path)) json = { state: 'empty', payload: { items: [] }, synced_at: new Date().toISOString() }
  return route.fulfill({ json })
 })
 await page.route('**/__home_proof__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
 await page.goto(`${base}/__home_proof__`)
 await page.evaluate(async () => {
  const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
  const { default: React } = await import('/node_modules/.vite/deps/react.js')
  const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
  const storeSource = await (await fetch('/src/store.jsx')).text()
  const routerUrl = storeSource.match(/from "([^"]*react-router-dom[^"]*)"/)[1]
  const { BrowserRouter } = await import(routerUrl)
  const { AppProvider } = await import('/src/store.jsx')
  const { default: Home } = await import('/src/dashboard/Home.jsx')
  const homeSource = await (await fetch('/src/dashboard/Home.jsx')).text()
  const { Toaster } = await import(homeSource.match(/from "([^"]*sonner[^"]*)"/)[1])
  await import('/src/index.css'); await import('/src/styles/ui-system.css')
  createRoot(document.getElementById('proof')).render(React.createElement(BrowserRouter, null, React.createElement(AppProvider, null, React.createElement(Home), React.createElement(Toaster))))
 })
 await page.getByRole('button', { name: 'Edit layout', exact: true }).waitFor()
 await page.locator('[data-slot-id="agent.feed"]').waitFor()
 for (const width of [360,390,768,1024,1440,2560]) {
  await page.setViewportSize({ width, height: 1000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`)
  const boxes = await page.locator('.home-layout-grid > .home-slot').evaluateAll(nodes => nodes.map(n => ({ width: n.getBoundingClientRect().width, x: n.getBoundingClientRect().x })))
  assert(boxes.every(b => b.width >= 250), `minimum width at ${width}`)
 }
 for (const theme of ['graphite','ink','nocturne','nvidia','paper','sand','claude','cursor']) {
  const colors = await page.evaluate(theme => {
   document.documentElement.dataset.theme = theme
   document.documentElement.dataset.themeMode = ['graphite','ink','nocturne','nvidia'].includes(theme) ? 'dark' : 'light'
   const root = getComputedStyle(document.documentElement), home = getComputedStyle(document.querySelector('.home-shell'))
   return { root: root.getPropertyValue('--canvas').trim(), home: home.getPropertyValue('--canvas').trim(), color: home.color }
  }, theme)
  assert.equal(colors.home, colors.root, `theme inheritance ${theme}`)
 }
 await page.setViewportSize({ width: 1440, height: 1000 })
 await page.getByRole('button', { name: 'Edit layout', exact: true }).click()
 await page.getByRole('button', { name: 'Move agent.feed', exact: true }).focus()
 await page.keyboard.press('ArrowDown')
 await page.waitForFunction(() => document.querySelector('.home-save-status').textContent === 'Layout saved')
 assert(saves.length > 0)
 assert.equal(layout.widgets[3].id, 'agent.feed')
 await page.getByRole('button', { name: 'Undo', exact: true }).click()
 await page.waitForFunction(() => document.querySelector('.home-save-status').textContent === 'Layout saved')
 assert.equal(layout.widgets[2].id, 'agent.feed')
 await page.getByLabel('Size agent.feed', { exact: true }).selectOption('l')
 await page.waitForFunction(() => document.querySelector('[data-slot-id="agent.feed"]').dataset.size === 'l')
 await page.getByRole('button', { name: 'Collapse agent.feed', exact: true }).click()
 assert.equal(await page.locator('[data-slot-id="agent.feed"] > div[hidden]').count(), 1)
 await page.getByRole('button', { name: 'Expand agent.feed', exact: true }).click()
 await page.getByRole('button', { name: 'Add widget', exact: true }).click()
 await page.getByRole('dialog', { name: 'Add widget', exact: true }).waitFor()
 await page.keyboard.press('Shift+Tab')
 assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true)
 await page.getByLabel('Search widgets').fill('agent.feed')
 assert.equal(await page.locator('.home-catalog-row').count(), 1)
 await page.keyboard.press('Escape')
 await page.getByRole('dialog').waitFor({ state: 'hidden' })
 assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Add widget')
 await page.getByLabel('Size agent.feed', { exact: true }).selectOption('m')
 const from = await page.getByRole('button', { name: 'Move agent.feed', exact: true }).boundingBox()
 const to = await page.locator('[data-slot-id="dev.prs"]').boundingBox()
 const beforeDrag = layout.widgets.map(w => w.id)
 await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
 await page.mouse.down()
 await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 5 })
 assert.equal(await page.locator('.is-drag-target').count(), 1)
 await page.keyboard.press('Escape')
 await page.mouse.up()
 assert.deepEqual(layout.widgets.map(w => w.id), beforeDrag)
 await page.setViewportSize({ width: 390, height: 1000 })
 assert.equal(await page.getByRole('button', { name: 'Move agent.feed', exact: true }).isVisible(), false)
 await page.getByRole('button', { name: 'Move agent.feed up', exact: true }).click()
 assert.deepEqual(errors, [])
 console.log('PASS: Home grid 360–2560, keyboard reorder/resize, save/undo, collapse, catalog, Escape/focus restoration, mobile controls')
} finally { await browser.close() }
