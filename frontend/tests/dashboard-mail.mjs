import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
const id = process.env.TEST_WIDGET || 'need.inbox'
const calls = []
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true, theme: 'paper' })); localStorage.setItem('amethyst.ui.forceDesktop', '1') })
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname
  calls.push(path)
  let json = {}
  if (path === '/api/widgets') json = { widgets: [{ enabled: true, manifest: { id, title: id, sizes: ['m'], source: { type: 'local' }, refresh: { mode: 'poll', interval_s: 900 }, empty: 'No items.' } }] }
  else if (path === '/api/layout') json = { widgets: [{ id, size: 'm', height: 4 }] }
  else if (path === '/api/widgets/comm.tone/rewrite') json = { id: 1, tone: 'formal', text: 'Rewritten fixture', reference: 'revision-fixture' }
  else if (path.endsWith('/actions/rewrite')) json = { draft_id: 'gate-fixture', action: 'rewrite', item: { text: 'Rewritten fixture' } }
  else if (path.endsWith('/actions/approve')) json = { draft_id: 'gate-fixture', action: 'approve', item: { id: 1 }, state: 'awaiting-approval' }
  else if (path.endsWith('/data') && id === 'comm.unread') json = { state: 'ok', payload: { items: [{ id: 'sender@example.com', from: 'Sender', items: [{ id: 1, subject: 'Fixture subject', date: '2026-10-24', snippet: 'Fixture snippet' }] }] } }
  else if (path.endsWith('/data')) json = { state: 'ok', synced_at: new Date().toISOString(), payload: { items: [{ id: 1, subject: 'Fixture subject', from: 'sender@example.com', date: '2026-10-24', snippet: 'Fixture snippet', reason: 'Direct question' }], ranked: true } }
  else if (path.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => path.endsWith(p))) json = []
  return route.fulfill({ json })
})
try {
  await page.goto(process.env.BASE || 'http://127.0.0.1:5177')
  const widget = page.locator(`[data-widget="${id}"]`)
  if (id === 'need.drafts') {
    await widget.getByRole('button', { name: 'Approve', exact: true }).click()
    await widget.getByRole('button', { name: 'Approve local change', exact: true }).waitFor()
    assert.equal(await widget.getByRole('button', { name: 'Send (send scope disabled)' }).isDisabled(), true)
  } else if (id === 'need.waiting') {
    await widget.getByRole('button', { name: 'Draft nudge', exact: true }).click()
    await widget.getByLabel('Nudge recipient', { exact: true }).fill('recipient@example.com')
    assert.equal(await widget.getByLabel('Nudge text', { exact: true }).inputValue(), 'Following up on Fixture subject.')
  } else if (id === 'comm.tone') {
    await widget.getByLabel('Saved draft', { exact: true }).selectOption('1')
    await widget.getByLabel('Tone', { exact: true }).selectOption('formal')
    await widget.getByRole('button', { name: 'Generate rewrite', exact: true }).click()
    assert.equal(await widget.getByLabel('Rewritten draft', { exact: true }).inputValue(), 'Rewritten fixture')
    await widget.getByRole('button', { name: 'Review rewrite', exact: true }).click()
    await widget.getByRole('button', { name: 'Approve rewrite', exact: true }).waitFor()
  } else if (id === 'comm.unread') await widget.getByText('Sender · 1 unread').waitFor()
  else await widget.getByText('Why: Direct question').waitFor()
  if (!['need.waiting', 'comm.tone'].includes(id)) assert.equal(await widget.getByText('Fixture snippet').count(), 1)
  assert.equal(calls.some(path => /composio|send/.test(path)), false)
  console.log(`${id}: passed`)
} finally { await browser.close() }
