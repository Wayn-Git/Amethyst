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
 const ids = ['glance.clock', 'glance.weather', 'glance.next-event', 'glance.music', 'need.inbox', 'agent.brief', 'agent.feed', 'task.today', 'dev.prs', 'lib.resurface', 'feed.news']
 const catalogIds = [...ids, 'task.backlog', 'dash.sync', 'dash.quiet', 'dash.shortcuts', 'dash.gallery']
 const titles = { 'glance.clock': 'Clock', 'glance.weather': 'Weather', 'glance.next-event': 'Next event', 'glance.music': 'Now playing', 'need.inbox': 'Inbox', 'agent.brief': 'Morning brief', 'agent.feed': 'Agent activity', 'task.today': 'Today', 'dev.prs': 'Pull requests', 'lib.resurface': 'From your library', 'feed.news': 'News', 'task.backlog': 'Backlog', 'dash.sync': 'Refresh status', 'dash.quiet': 'Quiet hours', 'dash.shortcuts': 'Keyboard shortcuts', 'dash.gallery': 'Widget gallery' }
 const titleFor = id => titles[id] || id
 let layout = { widgets: ids.map(id => ({ id, size: id.startsWith('glance') ? 's' : 'm', height: 3 })) }
 const saves = []
 await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname
  let json = {}
  if (path === '/api/widgets') json = { widgets: catalogIds.map(id => ({ enabled: true, manifest: { id, title: titleFor(id), group: id.startsWith('glance') ? 'glance' : id.startsWith('task') ? 'tasks' : id.startsWith('dash') ? 'dashboard' : id.startsWith('need') ? 'needs-you' : id.startsWith('lib') ? 'library' : id.startsWith('dev') ? 'developer' : id.startsWith('feed') ? 'feed' : 'agent', sizes: ['s','m','l'], source: { type: 'local' }, refresh: { mode: 'manual' }, requires: [], empty: 'No fixture items.' } })) }
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
 assert.equal(await page.locator('.today-dashboard').evaluate(node => getComputedStyle(node).padding), '0px')
 for (const width of [360,390,768,1024,1440,2560]) {
  await page.setViewportSize({ width, height: 1000 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`)
  const boxes = await page.locator('.home-layout-grid > *').evaluateAll(nodes => nodes.map(n => { const b = n.getBoundingClientRect(); return { width: b.width, x: b.x, y: b.y, right: b.right, bottom: b.bottom } }))
  assert(boxes.every(b => b.width >= 250), `minimum width at ${width}`)
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
   const a = boxes[i], b = boxes[j]
   assert(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, `overlap at ${width}`)
  }
 }
 if (process.env.HOME_UI_SCREENSHOTS === '1') {
  await page.evaluate(() => { document.documentElement.dataset.theme = 'graphite'; document.documentElement.dataset.themeMode = 'dark' })
  for (const width of [1440,1024,768,390]) {
   await page.setViewportSize({ width, height: 1100 })
   await page.screenshot({ path: `/tmp/amethyst-today-review-${width}.png`, fullPage: false, animations: 'disabled' })
  }
 }
 for (const theme of ['graphite','ink','nocturne','nvidia','paper','sand','claude','cursor']) {
  const colors = await page.evaluate(theme => {
   document.documentElement.dataset.theme = theme
   document.documentElement.dataset.themeMode = ['graphite','ink','nocturne','nvidia'].includes(theme) ? 'dark' : 'light'
   const root = getComputedStyle(document.documentElement), home = getComputedStyle(document.querySelector('.today-widgets'))
   return { root: root.getPropertyValue('--ui-panel').trim(), home: home.getPropertyValue('--canvas').trim(), color: home.color }
  }, theme)
  assert.equal(colors.home, colors.root, `theme inheritance ${theme}`)
 }
 await page.setViewportSize({ width: 1440, height: 1000 })
 const originalAgentIndex = layout.widgets.findIndex(w => w.id === 'agent.feed')
 await page.getByRole('button', { name: 'Edit layout', exact: true }).click()
 await page.getByRole('button', { name: 'Move Agent activity', exact: true }).focus()
 await page.keyboard.press('ArrowDown')
 await page.waitForFunction(() => document.querySelector('.home-save-status').textContent === 'Layout saved')
 assert(saves.length > 0)
 assert.equal(layout.widgets[originalAgentIndex + 1].id, 'agent.feed')
 await page.getByRole('button', { name: 'Undo', exact: true }).click()
 await page.waitForFunction(() => document.querySelector('.home-save-status').textContent === 'Layout saved')
 assert.equal(layout.widgets[originalAgentIndex].id, 'agent.feed')
 await page.getByLabel('Size Agent activity', { exact: true }).selectOption('l')
 await page.waitForFunction(() => document.querySelector('[data-slot-id="agent.feed"]').dataset.size === 'l')
 await page.getByRole('button', { name: 'Collapse Agent activity', exact: true }).click()
 assert.equal(await page.locator('[data-slot-id="agent.feed"] > div[hidden]').count(), 1)
 await page.getByRole('button', { name: 'Expand Agent activity', exact: true }).click()
 await page.getByRole('button', { name: 'Add widget', exact: true }).first().click()
 await page.getByRole('dialog', { name: 'Add widget', exact: true }).waitFor()
 await page.keyboard.press('Shift+Tab')
 assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true)
 await page.getByLabel('Search widgets').fill('agent.feed')
 assert.equal(await page.locator('.home-catalog-row').count(), 1)
 await page.keyboard.press('Escape')
 await page.getByRole('dialog').waitFor({ state: 'hidden' })
 assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Add widget')
 await page.getByLabel('Size Agent activity', { exact: true }).selectOption('m')
 await page.getByRole('button', { name: 'Move Agent activity', exact: true }).scrollIntoViewIfNeeded()
 const from = await page.getByRole('button', { name: 'Move Agent activity', exact: true }).boundingBox()
 const to = await page.locator('[data-slot-id="task.today"]').boundingBox()
 const beforeDrag = layout.widgets.map(w => w.id)
 await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
 await page.mouse.down()
 await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 5 })
 assert.equal(await page.locator('.is-drag-target').count(), 1)
 await page.keyboard.press('Escape')
 await page.mouse.up()
 assert.deepEqual(layout.widgets.map(w => w.id), beforeDrag)
 await page.setViewportSize({ width: 390, height: 1000 })
 assert.equal(await page.getByRole('button', { name: 'Move Agent activity', exact: true }).isVisible(), false)
 await page.getByRole('button', { name: 'Move Agent activity up', exact: true }).click()
 assert.deepEqual(errors, [])
 await page.getByRole('button', { name: 'Finish editing', exact: true }).click()
 await page.getByRole('button', { name: 'Home settings', exact: true }).click()
 const settings = page.getByRole('dialog', { name: 'Home settings', exact: true })
 await settings.getByRole('tab', { name: 'Quiet hours', exact: true }).click()
 await settings.getByRole('button', { name: 'Save quiet hours', exact: true }).waitFor()
 await settings.getByRole('tab', { name: 'Keyboard shortcuts', exact: true }).click()
 await settings.getByRole('tabpanel', { name: 'Keyboard shortcuts', exact: true }).waitFor()
 await settings.getByRole('tab', { name: 'Widget gallery', exact: true }).click()
 await settings.getByLabel('Search widgets').fill('task.backlog')
 await settings.locator('.today-catalog-row').getByRole('button', { name: 'Add', exact: true }).click()
 await page.waitForFunction(() => document.querySelector('.home-save-status').textContent === 'Layout saved')
 assert(layout.widgets.some(w => w.id === 'task.backlog'))
 await page.keyboard.press('Escape')
 await settings.waitFor({ state: 'hidden' })
 await page.emulateMedia({ reducedMotion: 'reduce' })
 assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-layout').trim()), '0ms')
 assert.deepEqual(errors, [])
 console.log('PASS: Today 360–2560 without overlap, themes, edit/undo, catalog add, settings tabs, focus/Escape, mobile and reduced motion')
} finally { await browser.close() }
