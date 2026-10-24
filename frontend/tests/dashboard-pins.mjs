// Isolated browser proof: no accounts, screenshots or real backend required.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const base = process.env.BASE || 'http://127.0.0.1:5177'
const root = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(root).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(root, n, 'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.setDefaultTimeout(15000)
const requests = []
const failures = []
const escaped = []
await page.route('**://pin.invalid/**', route => { escaped.push(route.request().url()); return route.abort() })
page.on('requestfailed', r => { if (r.url().includes('pin.invalid')) failures.push([r.url(), r.failure()?.errorText]) })
const writes = []
let items = []
let action = null
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname
  let json = {}
  if (path === '/api/widgets/dash.pin/actions/add') {
    writes.push(request.postDataJSON()); action = 'add'
    json = { draft_id: 'pin-draft' }
  } else if (path === '/api/widgets/dash.pin/actions/delete') {
    action = 'delete'; json = { draft_id: 'remove-draft' }
  } else if (path.includes('/drafts/')) {
    assert.equal(request.postDataJSON().approved, true)
    if (action === 'add') items = [{ id: 1, data: malicious }]
    else items = []
    json = { state: 'applied' }
  } else if (path.endsWith('/health')) json = { status: 'ok', providers: [], capabilities: [], mcp_servers: [], tools: 0, skills: 0 }
  else if (['/conversations', '/confirmations', '/models', '/providers', '/journal', '/mcp/servers'].some(p => path.endsWith(p))) json = []
  else if (path === '/api/widgets') json = { widgets: [] }
  else if (path === '/api/layout') json = { widgets: [] }
  return route.fulfill({ json })
})
const malicious = {
  title: 'Security fixture',
  html: `<h2>Saved answer</h2><p id="probe">Visible</p>
    <script>parent.document.body.dataset.compromised = 'yes'; fetch('https://pin.invalid/script')</script>
    <img src="https://pin.invalid/image"><iframe src="https://pin.invalid/frame"></iframe>
    <link rel="stylesheet" href="https://pin.invalid/style"><meta http-equiv="refresh" content="0;url=https://pin.invalid/refresh">
    <a href="https://pin.invalid/link">Navigation</a><form action="https://pin.invalid/form"><button>Submit</button></form>
    <svg><a href="https://pin.invalid/svg"><text>SVG link</text></a><foreignObject><iframe src="https://pin.invalid/nested"></iframe></foreignObject><rect width="20" height="20" fill="url(https://pin.invalid/paint)" /></svg>
    <div onclick="location='https://pin.invalid/click'" style="background:url(https://pin.invalid/background)">Click</div>`,
  css: `@import url('https://pin.invalid/import'); p { background-image: url('https://pin.invalid/css'); } </style><meta http-equiv="refresh" content="0;url=https://pin.invalid/css-escape">`,
  js: `document.querySelector('#probe').textContent = parent.localStorage.getItem('pin-secret'); location='https://pin.invalid/js'`,
  scripts: ['https://pin.invalid/cdn'],
}
await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone: true })); localStorage.setItem('amethyst.ui.forceDesktop', '1'); localStorage.setItem('pin-secret', 'private-value') })
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: ResponseArtifactBox } = await import('/src/components/ResponseArtifactBox.jsx')
    const { default: SandboxedUi } = await import('/src/components/widgets/SandboxedUi.jsx')
    const { default: Pins } = await import('/src/dashboard/widgets/Pins.jsx')
    const el = document.createElement('div'); el.id = 'pin-test'; document.body.append(el)
    window.pinTestRoot = createRoot(el)
    window.renderPinButton = () => window.pinTestRoot.render(React.createElement(ResponseArtifactBox, { conversationId: 'fixture-chat', item: { rowId: 7 }, text: 'Saved answer for the pin fixture.' }))
    window.renderChatUi = () => window.pinTestRoot.render(React.createElement(SandboxedUi, { data: { title: 'Chat fixture', html: '<p id=chat-probe>Before</p>', js: "document.querySelector('#chat-probe').textContent = 'Interactive chat'" } }))
    window.renderPins = data => window.pinTestRoot.render(React.createElement(Pins, { data, refresh: async () => window.pinTestRoot.render(React.createElement(Pins, { data: { items: [] }, refresh: async () => {} })) }))
    window.renderPinButton()
  })
  await page.getByRole('button', { name: 'Pin to Home', exact: true }).click()
  await page.getByRole('region', { name: 'Review Home pin' }).waitFor()
  assert.deepEqual(items, [])
  assert.deepEqual(writes, [{ conversation_id: 'fixture-chat', message_id: 7 }])
  await page.getByRole('button', { name: 'Approve pin', exact: true }).click()
  await page.getByText('Pinned to Home', { exact: true }).waitFor()
  page.on('request', r => { if (r.url().includes('pin.invalid')) requests.push(r.url()) })
  await page.evaluate(data => window.renderPins(data), { items })
  await page.getByText('pinned from chat · Offline snapshot', { exact: true }).waitFor()
  const iframe = page.locator('#pin-test iframe')
  await iframe.waitFor()
  assert.equal(await iframe.getAttribute('sandbox'), '')
  const frame = await (await iframe.elementHandle()).contentFrame()
  await frame.getByText('Saved answer', { exact: true }).waitFor()
  assert.equal(await frame.locator('#probe').textContent(), 'Visible')
  const result = await frame.evaluate(async () => {
    const blocked = fn => { try { fn(); return false } catch { return true } }
    const dom = blocked(() => parent.document.body)
    const storage = blocked(() => parent.localStorage.getItem('pin-secret'))
    const ownStorage = blocked(() => localStorage.getItem('pin-secret'))
    let network = false
    try { await fetch('https://pin.invalid/fetch') } catch { network = true }
    const xhr = blocked(() => { const x = new XMLHttpRequest(); x.open('GET', 'https://pin.invalid/xhr', false); x.send() })
    window.pinSocket = new WebSocket('wss://pin.invalid/socket')
    return { dom, storage, ownStorage, network, xhr }
  })
  assert.deepEqual(result, { dom: true, storage: true, ownStorage: true, network: true, xhr: true })
  assert.equal(await frame.locator('script[src],a,form,meta[http-equiv=refresh],iframe,object,embed,link,[onclick],[href],[src]').count(), 0)
  await frame.getByText('Click', { exact: true }).click()
  await page.waitForTimeout(350)
  assert.equal(await frame.evaluate(() => window.pinSocket.readyState), 3)
  assert.deepEqual(escaped, [])
  assert.ok(requests.every(url => failures.some(([failed, reason]) => failed === url && (reason === 'csp' || reason.includes('ERR_BLOCKED_BY_CSP')))), JSON.stringify({ requests, failures }))
  assert.equal(await page.evaluate(() => document.body.dataset.compromised), undefined)
  // Re-mounting represents reopening Home; persisted declarations recreate the frame.
  await page.evaluate(() => window.renderPinButton())
  await page.evaluate(data => window.renderPins(data), { items })
  await page.locator('#pin-test iframe').waitFor()
  await page.getByRole('button', { name: 'Remove Security fixture', exact: true }).click()
  assert.equal(items.length, 1)
  await page.getByRole('button', { name: 'Approve removal', exact: true }).click()
  await page.locator('#pin-test iframe').waitFor({ state: 'detached' })
  assert.deepEqual(items, [])
  await page.evaluate(() => window.renderChatUi())
  const chatFrame = page.frameLocator('#pin-test iframe')
  await chatFrame.getByText('Interactive chat', { exact: true }).waitFor()
  assert.equal(await page.locator('#pin-test iframe').getAttribute('sandbox'), 'allow-scripts allow-forms')
  console.log('PASS dash.pin: reviewed chat pin/removal, declaration-only request, replay, CSP network denial, parent DOM/storage isolation, inert navigation and script payloads')
} finally { await browser.close() }
