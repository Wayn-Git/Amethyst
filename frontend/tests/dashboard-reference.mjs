import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fixtures } from '../src/dev/widgets/fixtures.js'
import { WIDGETS } from '../src/dashboard/registry.js'
const manifests = JSON.parse(readFileSync(new URL('../src/dev/widgets/manifests.json', import.meta.url)))
assert.deepEqual(Object.keys(fixtures).sort(), manifests.map(m => m.id).sort(), 'Every manifest needs a labelled fixture')
assert.deepEqual(Object.keys(WIDGETS).sort(), manifests.map(m => m.id).sort(), 'Every registered component is reviewed')
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const reports = []
try {
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
 const errors = [], apiRequests = []
 page.on('pageerror', e => errors.push(e.message))
 page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests.push(r.url()) })
 const groups = process.argv.slice(2).length ? process.argv.slice(2) : ['glance','needs-you','communication','agent','library','tasks','developer','feed','system','dashboard']
 for (const group of groups) {
  const expected = manifests.filter(m => m.group === group).reduce((n,m) => n + m.sizes.length, 0)
  for (const theme of ['paper', 'graphite']) for (const width of [1440,390]) {
   await page.setViewportSize({ width, height: 1000 })
   await page.goto(`${process.env.BASE || 'http://127.0.0.1:5178'}/dev/widgets?group=${group}&theme=${theme}`)
   await page.waitForFunction(n => document.querySelectorAll('.review-example').length === n && !document.querySelector('.widget-skeleton'), expected).catch(async error => { console.error({ group, theme, width, expected, errors, body: (await page.locator('body').innerText()).slice(0, 2000) }); throw error })
   await page.evaluate(() => document.fonts.ready)
   await page.waitForTimeout(150)
   assert.equal(await page.getByText('This widget could not render.', { exact: true }).count(), 0, `${group}: render error`)
   const duplicateIds = await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))] })
   assert.deepEqual(duplicateIds, [], `${group}: unique control and label ids across sizes`)
   const overflow = await page.evaluate(() => [...document.querySelectorAll('.home-widget, .widget-content, .review-grid')].filter(e => e.scrollWidth > e.clientWidth + 2).map(e => ({ widget: e.closest('[data-widget]')?.dataset.widget, class: e.className, width: e.clientWidth, scroll: e.scrollWidth })))
   reports.push({ group, theme, width, overflow })
   for (const state of ['loading','empty','error','stale','not-connected']) {
    await page.getByLabel('State', { exact: true }).selectOption(state)
    assert.equal(await page.locator('.review-example').count(), expected)
    if (state === 'loading') assert.equal(await page.locator('.widget-skeleton').count(), expected)
    if (state === 'error') assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).count(), expected)
    assert.equal(await page.getByText('This widget could not render.', { exact: true }).count(), 0, `${group} ${state}: render error`)
   }
  }
  console.log(`CHECKED ${group}: ${expected} sizes, 6 states, 2 widths, 2 themes`)
 }
 assert.deepEqual(errors, [], 'No uncaught render errors')
 assert.deepEqual(apiRequests, [], 'Gallery must never call a real API')
 const failures = reports.filter(r => r.overflow.length)
 assert.deepEqual(failures, [], 'No tile or page overflow')
 console.log(`PASS: ${manifests.filter(m => groups.includes(m.group)).length} widgets, all manifest sizes, six states, mobile/desktop, Paper/Graphite; no screenshots`)
} finally { await browser.close() }
