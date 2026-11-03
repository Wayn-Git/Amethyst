import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const manifests = JSON.parse(readFileSync(new URL('../src/dev/widgets/manifests.json', import.meta.url), 'utf8'))
  .filter(item => ['glance.clock', 'glance.weather', 'glance.music', 'task.today'].includes(item.id))
let layout = { widgets: [
  { id: 'glance.clock', size: 's', x: 0, y: 0, w: 1, h: 1, height: 3 },
  { id: 'glance.weather', size: 'm', x: 1, y: 0, w: 2, h: 1, height: 3 },
  { id: 'glance.music', size: 'm', x: 3, y: 0, w: 2, h: 1, height: 3 },
] }
let saveCount = 0
let failNextSave = false
const browserRoot = join(homedir(), '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(browserRoot)
  .filter(name => name.startsWith('chromium-')).sort().reverse()
  .map(name => join(browserRoot, name, 'chrome-linux64/chrome')).find(existsSync)
if (!executablePath) throw new Error('Install Playwright Chromium or set CHROMIUM_PATH')

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
page.setDefaultTimeout(10000)
await page.addInitScript(() => {
  localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' }))
  localStorage.setItem('amethyst.ui.forceDesktop', '1')
})
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/api/widgets') return route.fulfill({ json: { widgets: manifests.map(manifest => ({ manifest, enabled: true, error: null })) } })
  if (url.pathname === '/api/layout') {
    if (route.request().method() === 'PUT') {
      if (failNextSave) {
        failNextSave = false
        return route.fulfill({ status: 500, json: { detail: 'Fixture save failure' } })
      }
      saveCount += 1
      layout = route.request().postDataJSON()
    }
    return route.fulfill({ json: layout })
  }
  if (url.pathname.endsWith('/settings')) return route.fulfill({ json: {} })
  if (url.pathname.endsWith('/data')) return route.fulfill({ json: { state: 'ok', payload: { zones: [] }, synced_at: new Date().toISOString() } })
  return route.fulfill({ json: { items: [] } })
})

try {
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5177'}/today`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-slot-id="glance.clock"]').waitFor()
  const clock = page.locator('[data-slot-id="glance.clock"]')
  assert.equal(await clock.evaluate(node => node.getBoundingClientRect().width), 170)
  const mediumWidth = await page.locator('[data-slot-id="glance.weather"]').evaluate(node => node.getBoundingClientRect().width)
  assert.ok(Math.abs(mediumWidth - 356) < 0.01)

  await page.getByRole('button', { name: 'Edit layout' }).click()
  const moveHandle = page.getByRole('button', { name: 'Move Clock' })
  await moveHandle.focus()
  const keyboardSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/layout' && response.request().method() === 'PUT')
  await page.keyboard.press('ArrowRight')
  await keyboardSave
  assert.equal(layout.widgets.find(item => item.id === 'glance.clock').x, 1)
  assert.equal(new Set(layout.widgets.map(item => item.id)).size, layout.widgets.length)
  assert.equal(layout.widgets.every(item => ['x', 'y', 'w', 'h'].every(key => Number.isInteger(item[key]))), true)

  const viewport = await page.locator('.today-grid-viewport').boundingBox()
  let handle = await moveHandle.boundingBox()
  let slot = await clock.boundingBox()
  let grabX = handle.x + handle.width / 2 - slot.x, grabY = handle.y + handle.height / 2 - slot.y
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(viewport.x + 1050, viewport.y + 500, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.waitForTimeout(250)
  assert.equal(saveCount, 1, 'Escape must cancel the preview without saving it')

  handle = await moveHandle.boundingBox()
  slot = await clock.boundingBox()
  grabX = handle.x + handle.width / 2 - slot.x
  grabY = handle.y + handle.height / 2 - slot.y
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(viewport.x + 4 * 186 + 10 + grabX, viewport.y + 2 * 186 + 10 + grabY, { steps: 4 })
  const dragSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/layout' && response.request().method() === 'PUT')
  await page.mouse.up()
  await dragSave
  assert.deepEqual([layout.widgets[0].x, layout.widgets[0].y], [4, 2])
  assert.equal(await clock.evaluate(node => node.style.left), '744px')
  assert.equal(await clock.evaluate(node => node.style.top), '372px')

  const resizeSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/layout' && response.request().method() === 'PUT')
  await page.locator('[data-slot-id="glance.clock"] .today-slot-sizes').getByText('L', { exact: true }).click()
  await resizeSave
  assert.equal(layout.widgets.find(item => item.id === 'glance.clock').h, 2)
  assert.equal(await clock.evaluate(node => node.style.height), '356px')
  await page.locator('.today-actions').getByRole('button', { name: 'Add widget' }).click()
  const taskRow = page.locator('.today-catalog-row[aria-label="Today list"]')
  await taskRow.getByRole('button', { name: 'Choose Today list' }).click()
  const addSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/layout' && response.request().method() === 'PUT')
  await taskRow.getByRole('button', { name: 'Add M', exact: true }).click()
  await addSave
  assert.equal(layout.widgets.some(item => item.id === 'task.today' && Number.isInteger(item.x) && Number.isInteger(item.y)), true)
  const removeSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/layout' && response.request().method() === 'PUT')
  await page.locator('.today-actions').getByRole('button', { name: 'Add widget' }).click()
  const addedTaskRow = page.locator('.today-catalog-row[aria-label="Today list"]')
  await addedTaskRow.getByRole('button', { name: 'Choose Today list' }).click()
  await addedTaskRow.getByRole('button', { name: 'Remove', exact: true }).click()
  await removeSave
  assert.equal(layout.widgets.some(item => item.id === 'task.today'), false)
  await page.getByRole('button', { name: 'Close Add widget' }).click()
  failNextSave = true
  const failedSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/layout' && response.request().method() === 'PUT')
  await page.locator('[data-slot-id="glance.clock"] .today-slot-sizes').getByText('S', { exact: true }).click()
  await failedSave
  await page.getByRole('alert').filter({ hasText: 'Layout not saved' }).waitFor()
  assert.equal(layout.widgets.find(item => item.id === 'glance.clock').size, 'l')
  assert.equal(await clock.evaluate(node => node.style.height), '356px')
  await page.getByRole('button', { name: 'Add widget' }).click()
  const clockRow = page.locator('.today-catalog-row[aria-label="Clock"]')
  await clockRow.getByRole('button', { name: 'Choose Clock' }).click()
  const designOption = clockRow.locator('.catalog-design-option[data-design="clock-sm-01"]')
  const previewSize = await designOption.locator('.catalog-live-preview').evaluate(node => {
    const { width, height } = node.getBoundingClientRect()
    return [width, height]
  })
  assert.deepEqual(previewSize, [356, 356])
  const designSave = page.waitForResponse(response => new URL(response.url()).pathname === '/api/layout' && response.request().method() === 'PUT')
  await designOption.getByRole('button', { name: 'Use design · keeps L' }).click()
  await designSave
  assert.equal(layout.widgets.find(item => item.id === 'glance.clock').size, 'l')
  assert.equal(layout.widgets.find(item => item.id === 'glance.clock').design, 'clock-sm-01')
  console.log('dashboard-grid-ui: move, cancel, drag, resize, add/remove, rollback, exact preview size, and size-preserving design switch verified — ok')
} finally {
  await browser.close()
}
