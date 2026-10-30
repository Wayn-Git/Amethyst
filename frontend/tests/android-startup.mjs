import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'

const root = resolve('frontend/dist')
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname.startsWith('/api/')) { res.writeHead(503, {'Content-Type':'application/json'}); res.end('{}'); return }
    const file = url.pathname === '/startup.js' ? resolve('frontend/src/mobile/startup.js') : join(root, url.pathname === '/' ? 'index.html' : url.pathname)
    const body = await readFile(file)
    const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}
    res.writeHead(200, {'Content-Type':types[extname(file)] || 'application/octet-stream'}); res.end(body)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const cache = join(process.env.HOME, '.cache/ms-playwright')
const chromiumDir = (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort().at(-1)
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || join(cache, chromiumDir, 'chrome-linux64/chrome'),args:['--no-sandbox']})
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[], fonts=[]
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (['fonts.googleapis.com','api.fontshare.com'].includes(url.hostname)) fonts.push(url.href)
    return url.origin === origin ? route.continue() : route.abort()
  })
  await page.goto(origin, {waitUntil:'domcontentloaded'})
  await page.getByRole('heading', {name:'Connect to your computer'}).waitFor({timeout:10000})
  assert.deepEqual(errors, [])
  assert.deepEqual(fonts, [])
  // Exercise a rejected import and a stalled native bootstrap without resetting storage.
  for (const mode of ['reject','timeout']) {
    await page.evaluate(async (mode) => {
      document.getElementById('root').innerHTML='<section data-startup="loading">Opening…</section>'
      const {startApplication}=await import('/startup.js')
      const load=mode==='reject' ? () => Promise.reject(new Error('Native startup fixture failed')) : () => new Promise(()=>{})
      void startApplication(load,{timeout:30})
    },mode)
    await page.getByRole('heading',{name:'Amethyst could not start'}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Try again'}).count(),1)
  }
  console.log('PASS: offline production startup, no remote fonts, failed startup and timeout recovery')
} finally { await browser.close(); await new Promise(done=>server.close(done)) }
