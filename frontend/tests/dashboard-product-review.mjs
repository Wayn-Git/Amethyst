// Read-only visual consistency review with empty API fixtures.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache,n,'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args:['--no-sandbox'] })
const results = []
try {
 const page = await browser.newPage({ viewport:{ width:1440,height:1000 } })
 await page.addInitScript(() => { localStorage.setItem('amethyst.ui.v1', JSON.stringify({ onboardingDone:true, theme:'paper', themeMode:'light' })); localStorage.setItem('amethyst.ui.forceDesktop','1') })
 await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname
  let json = {}
  if (path.endsWith('/health')) json = { status:'ok', providers:[], capabilities:[], mcp_servers:[], tools:0, skills:0 }
  else if (['/conversations','/confirmations','/models','/providers','/journal','/mcp/servers','/skills','/tools','/agents'].some(p => path.endsWith(p))) json = []
  else if (path.includes('/library')) json = { items:[],total:0,tags:[],kinds:[] }
  else if (path === '/api/widgets' || path === '/api/layout') json = { widgets:[] }
  return route.fulfill({ json })
 })
 let errors = []
 page.on('pageerror', e => errors.push(e.message))
 for (const path of ['/today','/library','/code','/capabilities','/settings']) {
  errors = []
  await page.goto((process.env.BASE || 'http://127.0.0.1:5178') + path)
  await page.waitForTimeout(1000)
  const observation = await page.evaluate(() => ({ title:document.title, headings:[...document.querySelectorAll('h1,h2')].map(e => e.textContent).slice(0,12), buttons:document.querySelectorAll('button').length, font:getComputedStyle(document.body).fontFamily, overflow:document.documentElement.scrollWidth > innerWidth }))
  await page.screenshot({ path:`../ui-review/product-${path.slice(1)}.png`, fullPage:true })
  results.push({ path,...observation,errors })
 }
 console.log(JSON.stringify(results,null,2))
 writeFileSync('../ui-review/product-review.json',JSON.stringify(results,null,2))
} finally { await browser.close() }
