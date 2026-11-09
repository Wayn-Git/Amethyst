// Synthetic desktop session; never sends a command to a real player.
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
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const calls = []
  let state = 'ok', fail = false
  const payload = {
    player_id: 'org.mpris.MediaPlayer2.spotify',
    active_player: 'spotify',
    album: 'Fixture album',
    track_id: '/track/1',
    status: 'Playing',
    items: [{ title: 'Desktop fixture', artists: ['Fixture artist'] }],
    controls: { play: true, pause: true, next: true, previous: false },
  }
  payload.artwork_url = 'https://artwork.test/cover.png'
  payload.players = [
    { ...payload, title: 'Desktop fixture' },
    { player_id: 'org.mpris.MediaPlayer2.browser', active_player: 'Browser', track_id: '/video/2', title: 'YouTube fixture', status: 'Paused', artists: ['Video fixture'], controls: { play: true } },
  ]

  await page.route('https://artwork.test/cover.png', route => route.fulfill({
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jPZkAAAAASUVORK5CYII=', 'base64'),
  }))

  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON()
    calls.push({ path, body })
    if (path.includes('/actions/')) {
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Player closed' } })
      return route.fulfill({ json: { draft_id: 'fixture', action: path.split('/').at(-1) } })
    }
    if (path.includes('/drafts/')) {
      if (body?.approved) payload.status = 'Paused'
      return route.fulfill({ json: { state: body?.approved ? 'applied' : 'denied' } })
    }
    return route.fulfill({ json: { state, payload, synced_at: new Date().toISOString() } })
  })

  await page.route('**/__music__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${base}/__music__`)

  // Step 1: Test settings drawer / full review view
  await page.evaluate(async () => {
    const { default: runtime } = await import('/@react-refresh')
    runtime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => x => x; window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-shell.css'); await import('/src/dashboard/widget-patterns.css')
    const { default: Frame } = await import('/src/dashboard/WidgetFrame.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    const h = React.createElement
    createRoot(document.getElementById('proof')).render(
      h('main', { className: 'widget-home home-shell bento-foundation' },
        h(DashboardContext.Provider, { value: { now: new Date(), layout: { widgets: [] }, removeWidget: () => {}, setEditing: () => {}, openWidget: () => {} } },
          h('section', { className: 'home-slot', style: { width: 280 } },
            h(Frame, { full: true, position: { size: 'm' }, manifest: { id: 'glance.music', title: 'Desktop music', source: { type: 'local' }, refresh: { mode: 'manual' }, empty: 'Open a desktop music player to start listening.' } })
          )
        )
      )
    )
  })

  const widget = page.locator('[data-widget="glance.music"]')
  await widget.getByText('Desktop fixture', { exact: true }).waitFor()
  await widget.locator('.music-art img').waitFor()
  await page.waitForFunction(() => document.querySelector('.music-art img')?.naturalWidth > 0)
  assert.equal(await widget.getByText('Fixture album', { exact: true }).count(), 1)
  assert.equal(await widget.getByRole('link', { name: /Connect/ }).count(), 0)
  assert.equal(await widget.getByLabel('Previous track', { exact: true }).isDisabled(), true)

  // Test pause and approval draft
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

  // Test next track and cancel
  await widget.getByLabel('Next track', { exact: true }).click()
  await widget.getByRole('button', { name: 'Cancel', exact: true }).click()
  await widget.getByLabel('Play music', { exact: true }).waitFor()
  assert.equal(calls.filter(c => c.path.includes('/drafts/')).at(-1).body.approved, false)

  // Test media player switching
  await widget.getByLabel('Media player', { exact: true }).selectOption('org.mpris.MediaPlayer2.browser')
  await widget.getByText('YouTube fixture', { exact: true }).waitFor()
  await widget.getByLabel('Play music', { exact: true }).click()
  assert.deepEqual(calls.filter(c => c.path.includes('/actions/')).at(-1).body, { player: 'org.mpris.MediaPlayer2.browser', track_id: '/video/2' })
  assert.equal(await widget.getByLabel('Media player', { exact: true }).isDisabled(), true)
  await widget.getByRole('button', { name: 'Cancel', exact: true }).click()

  // Test unavailable player
  payload.players = payload.players.slice(0, 1)
  await widget.getByLabel('Refresh Desktop music', { exact: true }).click()
  await widget.getByText('This player is no longer available. Choose another player above.', { exact: true }).waitFor()
  assert.equal(await widget.getByLabel('Play music', { exact: true }).count(), 0)
  await widget.getByLabel('Media player', { exact: true }).selectOption('')

  // Test player error
  fail = true
  await widget.getByLabel('Play music', { exact: true }).click()
  await widget.getByRole('alert').filter({ hasText: 'Player closed' }).waitFor()
  fail = false; state = 'empty'; payload.items = []; payload.active_player = null
  await widget.getByLabel('Refresh Desktop music', { exact: true }).click()
  await widget.getByText('Open a desktop music player to start listening.', { exact: true }).waitFor()
  assert.equal(await widget.getByLabel('Play music', { exact: true }).count(), 0)
  assert.equal(calls.some(c => /composio|connector|remote\/media/.test(c.path)), false)

  // Step 2: Test native card layouts (Small 170x170, Medium 356x170, Large 356x356) and designs
  payload.items = [{ title: 'Starboy', artists: ['The Weeknd'] }]
  payload.active_player = 'spotify'
  payload.album = 'Starboy Album'
  payload.status = 'Playing'
  payload.controls = { play: true, pause: true, next: true, previous: true }

  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    const h = React.createElement
    const manifest = { id: 'glance.music', title: 'Desktop music', sizes: ['s', 'm', 'l'], source: { type: 'local' }, refresh: { mode: 'manual' }, empty: 'Open a desktop player.' }
    const data = { state: 'ready', payload: {
      player_id: 'org.mpris.MediaPlayer2.spotify',
      active_player: 'spotify',
      album: 'Starboy Album',
      status: 'Playing',
      items: [{ title: 'Starboy', artists: ['The Weeknd'] }],
      artwork_url: 'https://artwork.test/cover.png',
      controls: { play: true, pause: true, next: true, previous: true },
    }, synced_at: new Date().toISOString() }

    const context = { now: new Date(), layout: { widgets: [] }, removeWidget: () => {}, setEditing: () => {}, openWidget: () => {}, manifests: [manifest] }
    const emptyData = { state: 'ready', payload: { items: [], active_player: null }, synced_at: new Date().toISOString() }
    const errorData = { state: 'ready', payload: { error: 'Connection failed' }, synced_at: new Date().toISOString() }

    const cards = [
      { id: 's', size: 's', design: 'media-md-01', data },
      { id: 'm', size: 'm', design: 'media-md-01', data },
      { id: 'l', size: 'l', design: 'media-md-01', data },
      { id: 'pill', size: 'm', design: 'media-md-02', data },
      { id: 'vinyl', size: 'm', design: 'media-md-03', data },
      { id: 'editorial', size: 'm', design: 'media-md-04', data },
      { id: 'immersive', size: 'l', design: 'media-md-05', data },
      { id: 'empty', size: 'm', design: 'media-md-01', data: emptyData },
      { id: 'error', size: 'm', design: 'media-md-01', data: errorData },
    ]

    createRoot(document.getElementById('proof')).render(
      h(DashboardContext.Provider, { value: context },
        h('main', { className: 'bento-foundation widget-home' },
          cards.map(s => h('div', { key: s.id, className: `slot-test-${s.id}`, style: { margin: 20 } },
            h(WidgetPresentation, { manifest, data: s.data, size: s.size, tile: true, refresh: () => {}, design: s.design })
          ))
        )
      )
    )
  })

  // Small assertions: 170x170, 3 controls, heart favorite
  const smallCard = page.locator('.slot-test-s [data-widget="glance.music"]')
  await smallCard.waitFor()
  const smallBox = await smallCard.boundingBox()
  assert.equal(Math.round(smallBox.width), 170, 'small width 170')
  assert.equal(Math.round(smallBox.height), 170, 'small height 170')
  assert.equal(await smallCard.locator('.music-art--s').count(), 1)
  assert.equal(await smallCard.locator('.music-favorite-btn').count(), 1)
  assert.equal(await smallCard.locator('.music-controls--small .music-ctrl-btn').count(), 3)

  // Test Heart favorite toggle
  const heartBtn = smallCard.locator('.music-favorite-btn')
  assert.equal(await heartBtn.getAttribute('aria-pressed'), 'false')
  await heartBtn.click()
  assert.equal(await heartBtn.getAttribute('aria-pressed'), 'true')
  assert.equal(await heartBtn.evaluate(el => el.classList.contains('is-favorited')), true)

  // Medium assertions: 356x170, 5 controls (prev, 15s back, play/pause, 15s forward, next)
  const medCard = page.locator('.slot-test-m [data-widget="glance.music"]')
  const medBox = await medCard.boundingBox()
  assert.equal(Math.round(medBox.width), 356, 'medium width 356')
  assert.equal(Math.round(medBox.height), 170, 'medium height 170')
  assert.equal(await medCard.locator('.music-art--m').count(), 1)
  assert.equal(await medCard.locator('.music-controls--medium .music-ctrl-btn').count(), 5)
  assert.equal(await medCard.getByLabel('Skip back 15 seconds').count(), 1)
  assert.equal(await medCard.getByLabel('Skip forward 15 seconds').count(), 1)

  // Large assertions: 356x356, 5 controls, bookmark + heart in header, large art
  const largeCard = page.locator('.slot-test-l [data-widget="glance.music"]')
  const largeBox = await largeCard.boundingBox()
  assert.equal(Math.round(largeBox.width), 356, 'large width 356')
  assert.equal(Math.round(largeBox.height), 356, 'large height 356')
  assert.equal(await largeCard.locator('.music-art--l').count(), 1)
  assert.equal(await largeCard.locator('.music-bookmark-btn').count(), 1)
  assert.equal(await largeCard.locator('.music-controls--large .music-ctrl-btn').count(), 5)

  // Pill variation assertions: Dynamic Island container, circle play button, progress bar
  const pillCard = page.locator('.slot-test-pill [data-widget="glance.music"]')
  assert.equal(await pillCard.locator('.music-body--island').count(), 1)
  assert.equal(await pillCard.locator('.music-ctrl-btn--circle').count(), 1)
  assert.equal(await pillCard.locator('.music-progress-bar').count(), 1)

  // Vinyl variation assertions: Vinyl Groove disc, concentric grooves, RPM chip
  const vinylCard = page.locator('.slot-test-vinyl [data-widget="glance.music"]')
  assert.equal(await vinylCard.locator('.music-body--vinyl').count(), 1)
  assert.equal(await vinylCard.locator('.music-vinyl-disc').count(), 1)
  assert.equal(await vinylCard.locator('.music-vinyl-grooves').count(), 1)
  assert.equal(await vinylCard.locator('.music-vinyl-rpm-chip').count(), 1)

  // Editorial variation assertions: Swiss typography, micro-label, editorial title, divider
  const editorialCard = page.locator('.slot-test-editorial [data-widget="glance.music"]')
  assert.equal(await editorialCard.locator('.music-body--editorial').count(), 1)
  assert.equal(await editorialCard.locator('.music-editorial-label').count(), 1)
  assert.equal(await editorialCard.locator('.music-title--editorial').count(), 1)
  assert.equal(await editorialCard.locator('.music-editorial-divider').count(), 1)

  // Immersive Cover variation assertions: Full-bleed artwork, center title, 5 controls, bookmark & heart
  const immersiveCard = page.locator('.slot-test-immersive [data-widget="glance.music"]')
  assert.equal(await immersiveCard.locator('.music-body--immersive').count(), 1)
  assert.equal(await immersiveCard.locator('.music-immersive-bg').count(), 1)
  assert.equal(await immersiveCard.locator('.music-immersive-top').count(), 1)
  assert.equal(await immersiveCard.locator('.music-title--immersive-center').textContent(), 'Starboy')
  assert.equal(await immersiveCard.locator('.music-controls--immersive-l .music-ctrl-btn').count(), 5)

  // Empty state card assertions: label top-left, empty prompt, quiet icon
  const emptyCard = page.locator('.slot-test-empty [data-widget="glance.music"]')
  assert.equal(await emptyCard.locator('.music-card--empty').count(), 1)
  assert.equal(await emptyCard.locator('.music-card-label').textContent(), 'Now Playing')
  assert.equal(await emptyCard.locator('.music-empty-desc').textContent(), 'Open a desktop music player to start listening.')

  // Error state card assertions: label top-left, hero —, error description role alert, Retry button
  const errorCard = page.locator('.slot-test-error [data-widget="glance.music"]')
  assert.equal(await errorCard.locator('.music-card--error').count(), 1)
  assert.equal(await errorCard.locator('.music-card-label').textContent(), 'Now Playing')
  assert.equal(await errorCard.locator('.music-state-hero').textContent(), '—')
  assert.equal(await errorCard.locator('.music-state-desc[role="alert"]').textContent(), 'Connection failed')
  assert.equal(await errorCard.locator('.music-retry-btn').textContent(), 'Retry')

  console.log('PASS desktop music: local player metadata, capability-disabled controls, approval/rejection, paused resume, error, idle, small/medium/large strict dimensions, favorite toggle, 15s seek, dynamic island, vinyl groove, editorial, and card empty/error states')
} finally {
  await browser.close()
}
