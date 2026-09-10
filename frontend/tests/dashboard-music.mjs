// Synthetic desktop session; never sends a command to a real player.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const base = process.env.BASE || 'http://127.0.0.1:5187'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const calls = []
  let state = 'ok', fail = false
  const payload = { player_id: 'org.mpris.MediaPlayer2.spotify', active_player: 'spotify', album: 'Fixture album', track_id: '/track/1', status: 'Playing', items: [{ title: 'Desktop fixture', artists: ['Fixture artist'] }], controls: { play: true, pause: true, next: true, previous: false } }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON()
    calls.push({ path, body })
    if (path.includes('/actions/')) {
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Player closed' } })
      return route.fulfill({ json: { draft_id: 'fixture', action: path.split('/').at(-1) } })
    }
    if (path.includes('/drafts/')) {
      if (body.approved) payload.status = 'Paused'
      return route.fulfill({ json: { state: body.approved ? 'applied' : 'denied' } })
    }
    return route.fulfill({ json: { state, payload, synced_at: new Date().toISOString() } })
  })
  await page.route('**/__music__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${base}/__music__`)
  await page.evaluate(async () => {
    const { default: runtime } = await import('/@react-refresh')
    runtime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => x => x; window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-shell.css'); await import('/src/dashboard/widget-patterns.css')
    const { default: Frame } = await import('/src/dashboard/WidgetFrame.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    const h = React.createElement
    createRoot(document.getElementById('proof')).render(h('main', { className: 'widget-home home-shell' }, h(DashboardContext.Provider, { value: { now: new Date(), layout: { widgets: [] }, removeWidget: () => {}, setEditing: () => {}, openWidget: () => {} } }, h('section', { className: 'home-slot', style: { width: 280 } }, h(Frame, { tile: true, position: { size: 'm' }, manifest: { id: 'glance.music', title: 'Desktop music', source: { type: 'local' }, refresh: { mode: 'manual' }, empty: 'Open a desktop music player to start listening.' } })))))
  })
  const widget = page.locator('[data-widget="glance.music"]')
  await widget.getByText('Desktop fixture', { exact: true }).waitFor()
  assert.equal(await widget.getByText('Fixture album', { exact: true }).count(), 1)
  assert.equal(await widget.getByRole('link', { name: /Connect/ }).count(), 0)
  assert.equal(await widget.getByLabel('Previous track', { exact: true }).isDisabled(), true)
  await widget.getByLabel('Pause music', { exact: true }).click()
  await widget.getByRole('button', { name: 'Approve playback' }).waitFor()
  assert.equal(calls.filter(c => c.path.includes('/drafts/')).length, 0)
  for (const width of [148, 180, 280]) {
    await widget.locator('..').evaluate((el, width) => el.style.width = `${width}px`, width)
    assert.equal(await widget.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `review overflow at ${width}`)
  }
  await widget.getByRole('button', { name: 'Approve playback' }).click()
  await widget.getByLabel('Play music', { exact: true }).waitFor()
  assert.equal(calls.find(c => c.path.includes('/drafts/')).body.approved, true)
  await widget.getByLabel('Next track', { exact: true }).click()
  await widget.getByRole('button', { name: 'Cancel', exact: true }).click()
  await widget.getByLabel('Play music', { exact: true }).waitFor()
  assert.equal(calls.filter(c => c.path.includes('/drafts/')).at(-1).body.approved, false)
  fail = true
  await widget.getByLabel('Play music', { exact: true }).click()
  await widget.getByRole('alert').filter({ hasText: 'Player closed' }).waitFor()
  fail = false; state = 'empty'; payload.items = []; payload.active_player = null
  await widget.getByLabel('Refresh Desktop music', { exact: true }).click()
  await widget.getByText('Open a desktop music player to start listening.', { exact: true }).waitFor()
  assert.equal(await widget.getByLabel('Play music', { exact: true }).count(), 0)
  assert.equal(calls.some(c => /composio|connector|remote\/media/.test(c.path)), false)
  console.log('PASS desktop music: local player metadata, capability-disabled controls, approval/rejection, paused resume, error, idle and narrow review layout')
} finally { await browser.close() }
