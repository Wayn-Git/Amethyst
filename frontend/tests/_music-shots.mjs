// Visual harness for Now Playing widget review screenshots.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
  await page.route('https://artwork.test/album.png', route => route.fulfill({
    contentType: 'image/png',
    // 1x1 purple png
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  }))
  await page.route('**/api/**', async route => {
    return route.fulfill({ json: { state: 'ready', payload: {}, synced_at: new Date().toISOString() } })
  })
  await page.route('**/__music_shots__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__music_shots__`)

  await page.evaluate(async () => {
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    const { default: runtime } = await import('/@react-refresh'); runtime.injectIntoGlobalHook(window)
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { WidgetPresentation } = await import('/src/dashboard/WidgetFrame.jsx')
    const { DashboardContext } = await import('/src/dashboard/context.js')
    await import('/src/index.css'); await import('/src/styles/ui-system.css'); await import('/src/dashboard/home.css'); await import('/src/dashboard/home-shell.css'); await import('/src/dashboard/widget-patterns.css'); await import('/src/dashboard/home-bento.css'); await import('/src/dashboard/widget-compositions.css')

    const h = React.createElement
    const manifest = { id: 'glance.music', title: 'Now Playing', sizes: ['s', 'm', 'l'], source: { type: 'local' }, refresh: { mode: 'manual' }, empty: 'No media playing' }
    const payload = {
      player_id: 'org.mpris.MediaPlayer2.spotify',
      active_player: 'Evermusic',
      album: 'Starboy',
      track_id: '/track/midnight-dr',
      status: 'Playing',
      items: [{ title: 'Midnight Drive', artists: ['The Weeknd'] }],
      artwork_url: 'https://artwork.test/album.png',
      controls: { play: true, pause: true, next: true, previous: true },
      players: [],
    }
    const data = { state: 'ready', payload, synced_at: new Date().toISOString() }
    const context = {
      now: new Date(),
      layout: { widgets: [{ id: 'glance.music', size: 's' }] },
      removeWidget: () => {},
      setEditing: () => {},
      openPalette: () => {},
      manifests: [manifest],
    }

    const emptyData = { state: 'ready', payload: { items: [], active_player: null }, synced_at: new Date().toISOString() }
    const errorData = { state: 'ready', payload: { error: 'Desktop player connection lost' }, synced_at: new Date().toISOString() }

    const cards = [
      { id: 's', label: '1. Evermusic · Small (170×170)', width: 170, height: 170, design: 'media-md-01', data },
      { id: 'm', label: '1. Evermusic · Medium (356×170)', width: 356, height: 170, design: 'media-md-01', data },
      { id: 'l', label: '1. Evermusic · Large (356×356)', width: 356, height: 356, design: 'media-md-01', data },
      { id: 's', label: '2. Dynamic Island · Small (170×170)', width: 170, height: 170, design: 'media-md-02', data },
      { id: 'm', label: '2. Dynamic Island · Medium (356×170)', width: 356, height: 170, design: 'media-md-02', data },
      { id: 'm', label: '3. Vinyl Groove · Medium (356×170)', width: 356, height: 170, design: 'media-md-03', data },
      { id: 'm', label: '4. Editorial · Medium (356×170)', width: 356, height: 170, design: 'media-md-04', data },
      { id: 'l', label: '5. Immersive Cover · Large (356×356)', width: 356, height: 356, design: 'media-md-05', data },
      { id: 'm', label: '5. Immersive Cover · Medium (356×170)', width: 356, height: 170, design: 'media-md-05', data },
      { id: 's', label: '5. Immersive Cover · Small (170×170)', width: 170, height: 170, design: 'media-md-05', data },
      { id: 'm', label: 'Empty State · Medium (356×170)', width: 356, height: 170, design: 'media-md-01', data: emptyData },
      { id: 'm', label: 'Error State · Medium (356×170)', width: 356, height: 170, design: 'media-md-01', data: errorData },
    ]

    createRoot(document.getElementById('proof')).render(
      h(DashboardContext.Provider, { value: context },
        h('main', { className: 'today-dashboard bento-foundation widget-home music-shots' },
          cards.map(({ id, label, width, height, design, data: cardData }, idx) =>
            h('section', { className: 'music-shot', key: `${id}-${idx}` },
              h('p', { className: 'music-shot-label' }, label),
              h('div', { className: 'music-shot-frame', style: { width, height } },
                h(WidgetPresentation, { manifest, data: cardData, size: id, tile: true, refresh: () => {}, design })
              )
            )
          )
        )
      )
    )

    const style = document.createElement('style')
    style.textContent = `
      html, body { background: #0b0b0d !important; color: #fff; }
      body { margin: 0; font: 400 13px/18px Inter, ui-sans-serif, system-ui, sans-serif; }
      .today-dashboard { background: #0b0b0d !important; min-height: 100vh; }
      .music-shots { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px; padding: 40px; }
      .music-shot { display: grid; gap: 12px; }
      .music-shot-label { margin: 0; color: #8e8e93; font: 500 13px/18px Inter, ui-sans-serif, system-ui, sans-serif; }
      .music-shot-frame { display: flex; min-width: 0; min-height: 0; }
      .music-shot-frame > .home-widget { width: 100%; height: 100%; }
      .music-shot-frame .today-slot-toolbar { display: none; }
    `
    document.head.append(style)
  })

  await page.locator('.music-title').first().waitFor()
  await page.evaluate(() => document.fonts.ready)

  const outDir = join(import.meta.dirname, '../../ui-review')
  await page.screenshot({ path: join(outDir, 'music-after.png'), fullPage: true })
  await page.locator('.music-shot-frame').nth(0).screenshot({ path: join(outDir, 'music-small.png') })
  await page.locator('.music-shot-frame').nth(1).screenshot({ path: join(outDir, 'music-medium.png') })
  await page.locator('.music-shot-frame').nth(2).screenshot({ path: join(outDir, 'music-large.png') })
  await page.locator('.music-shot-frame').nth(3).screenshot({ path: join(outDir, 'music-pill-small.png') })
  await page.locator('.music-shot-frame').nth(4).screenshot({ path: join(outDir, 'music-pill.png') })
  await page.locator('.music-shot-frame').nth(5).screenshot({ path: join(outDir, 'music-vinyl.png') })
  await page.locator('.music-shot-frame').nth(6).screenshot({ path: join(outDir, 'music-editorial.png') })
  await page.locator('.music-shot-frame').nth(7).screenshot({ path: join(outDir, 'music-immersive-large.png') })
  await page.locator('.music-shot-frame').nth(8).screenshot({ path: join(outDir, 'music-immersive-medium.png') })
  await page.locator('.music-shot-frame').nth(9).screenshot({ path: join(outDir, 'music-immersive-small.png') })
  await page.locator('.music-shot-frame').nth(10).screenshot({ path: join(outDir, 'music-empty.png') })
  await page.locator('.music-shot-frame').nth(11).screenshot({ path: join(outDir, 'music-error.png') })
  console.log('PASS: captured ui-review screenshots for all designs including Immersive Cover')
} finally {
  await browser.close()
}
