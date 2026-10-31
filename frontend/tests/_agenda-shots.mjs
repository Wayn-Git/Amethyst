// Visual harness for Agenda widget review screenshots.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })

try {
  const page = await browser.newPage({ viewport: { width: 1250, height: 900 }, timezoneId: 'Europe/London', locale: 'en-US' })
  await page.clock.setFixedTime(new Date('2026-10-31T10:00:00Z'))
  await page.route('**/api/**', async route => {
    return route.fulfill({ json: { state: 'ready', payload: {}, synced_at: new Date().toISOString() } })
  })
  await page.route('**/__agenda_shots__', route => route.fulfill({ contentType: 'text/html', body: '<div id="proof"></div>' }))
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/__agenda_shots__`)

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
    const manifest = { id: 'task.agenda', title: 'Agenda', sizes: ['m', 'l'], source: { type: 'composio', toolkit: 'googlecalendar' }, refresh: { mode: 'poll', interval_s: 900 }, empty: 'No upcoming events this week.' }

    const payload = {
      items: [
        { id: '1', title: 'Product Review & Roadmap', start: '2026-10-31T14:00:00Z', end: '2026-10-31T15:00:00Z', all_day: false, location: 'Design Studio B' },
        { id: '2', title: 'Quarterly Planning Sync', start: '2026-10-31T16:30:00Z', end: '2026-10-31T17:30:00Z', all_day: false, location: 'Virtual Room 4' },
        { id: '3', title: 'Engineering All Hands', start: '2026-11-01T11:00:00Z', end: '2026-11-01T12:00:00Z', all_day: false, location: 'Auditorium' },
        { id: '4', title: 'UX Architecture Review', start: '2026-11-02T09:30:00Z', end: '2026-11-02T10:30:00Z', all_day: false, location: 'Lab 2' },
      ],
      timezone: 'Europe/London',
      week_start: '2026-10-26',
      today: '2026-10-31',
      limited: false,
    }

    const data = { state: 'ready', payload, synced_at: '2026-10-31T10:00:00Z' }
    const emptyData = { state: 'ready', payload: { items: [], timezone: 'Europe/London', today: '2026-10-31' }, synced_at: '2026-10-31T10:00:00Z' }
    const errorData = { state: 'error', error: 'Could not sync Google Calendar events.', payload: { items: [] }, synced_at: '2026-10-31T10:00:00Z' }
    const loadingData = { state: 'loading', payload: null }

    const context = {
      now: new Date('2026-10-31T10:00:00Z'),
      layout: { widgets: [{ id: 'task.agenda', size: 'm' }] },
      removeWidget: () => {},
      setEditing: () => {},
      openPalette: () => {},
      manifests: [manifest],
    }

    const cards = [
      { id: 'm', label: '1. Medium (356×170)', width: 356, height: 170, data },
      { id: 'l', label: '2. Large (356×356)', width: 356, height: 356, data },
      { id: 'm', label: '3. Empty State (356×170)', width: 356, height: 170, data: emptyData },
      { id: 'm', label: '4. Error State (356×170)', width: 356, height: 170, data: errorData },
      { id: 'm', label: '5. Loading Skeleton (356×170)', width: 356, height: 170, data: loadingData },
    ]

    createRoot(document.getElementById('proof')).render(
      h(DashboardContext.Provider, { value: context },
        h('main', { className: 'today-dashboard bento-foundation widget-home agenda-shots' },
          cards.map(({ id, label, width, height, data: cardData }, idx) =>
            h('section', { className: 'agenda-shot', key: `${id}-${idx}` },
              h('p', { className: 'agenda-shot-label' }, label),
              h('div', { className: 'agenda-shot-frame', style: { width, height } },
                h(WidgetPresentation, { manifest, data: cardData, size: id, tile: false, refresh: () => {} })
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
      .agenda-shots { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px; padding: 40px; }
      .agenda-shot { display: grid; gap: 12px; }
      .agenda-shot-label { margin: 0; color: #8e8e93; font: 500 13px/18px Inter, ui-sans-serif, system-ui, sans-serif; }
      .agenda-shot-frame { display: flex; min-width: 0; min-height: 0; }
      .agenda-shot-frame > .home-widget { width: 100%; height: 100%; }
      .agenda-shot-frame .today-slot-toolbar { display: none; }
    `
    document.head.append(style)
  })

  await page.locator('.agenda-label').first().waitFor()
  await page.evaluate(() => document.fonts.ready)

  const debug = await page.evaluate(() => {
    const frame = document.querySelector('.agenda-shot-frame')
    return Array.from(frame.querySelectorAll('*')).map(el => {
      const s = getComputedStyle(el)
      return {
        tag: el.tagName,
        cls: el.className,
        bg: s.backgroundColor,
        bgImg: s.backgroundImage,
        radius: s.borderRadius,
        border: s.border,
        boxShadow: s.boxShadow,
        w: el.clientWidth,
        h: el.clientHeight,
        rect: el.getBoundingClientRect()
      }
    }).filter(x => x.bg !== 'rgba(0, 0, 0, 0)' || x.bgImg !== 'none' || x.boxShadow !== 'none' || x.border.includes('solid'))
  })
  console.log('DEBUG DOM:', JSON.stringify(debug, null, 2))

  const outDir = join(import.meta.dirname, '../../ui-review')
  const artifactDir = '/home/wayne/.gemini/antigravity/brain/b0c64af4-1d6e-4597-b36d-db5d6b5523a1/agenda-shots'

  await page.screenshot({ path: join(outDir, 'agenda-after.png'), fullPage: true })
  await page.screenshot({ path: join(artifactDir, 'agenda-all.png'), fullPage: true })

  await page.locator('.agenda-shot-frame').nth(0).screenshot({ path: join(outDir, 'agenda-medium.png') })
  await page.locator('.agenda-shot-frame').nth(0).screenshot({ path: join(artifactDir, 'agenda-medium.png') })

  await page.locator('.agenda-shot-frame').nth(1).screenshot({ path: join(outDir, 'agenda-large.png') })
  await page.locator('.agenda-shot-frame').nth(1).screenshot({ path: join(artifactDir, 'agenda-large.png') })

  await page.locator('.agenda-shot-frame').nth(2).screenshot({ path: join(outDir, 'agenda-empty.png') })
  await page.locator('.agenda-shot-frame').nth(2).screenshot({ path: join(artifactDir, 'agenda-empty.png') })

  await page.locator('.agenda-shot-frame').nth(3).screenshot({ path: join(outDir, 'agenda-error.png') })
  await page.locator('.agenda-shot-frame').nth(3).screenshot({ path: join(artifactDir, 'agenda-error.png') })

  await page.locator('.agenda-shot-frame').nth(4).screenshot({ path: join(outDir, 'agenda-loading.png') })
  await page.locator('.agenda-shot-frame').nth(4).screenshot({ path: join(artifactDir, 'agenda-loading.png') })

  console.log('PASS: captured agenda screenshots to ui-review and artifact folder')
} finally {
  await browser.close()
}
