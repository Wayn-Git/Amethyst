import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache,n,'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args:['--no-sandbox'] })
const failures = []
try {
 const page = await browser.newPage()
 for (const group of ['glance','needs-you','communication','agent','library','tasks','developer','feed','system','dashboard']) {
  await page.goto(`${process.env.BASE || 'http://127.0.0.1:5178'}/dev/widgets?group=${group}`)
  await page.waitForFunction(() => document.querySelector('.home-widget') && !document.querySelector('.widget-skeleton'))
  for (const theme of ['paper','graphite','ink','nocturne','nvidia','sand','claude','cursor','system']) {
   await page.getByLabel('Theme', { exact:true }).selectOption(theme)
   for (const width of [360,390,768,1024,1440,2560]) {
    await page.setViewportSize({ width, height:1000 })
    const issues = await page.evaluate(() => {
     const issues = []
     if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('page overflow')
     for (const node of document.querySelectorAll('.home-widget, .home-widget *')) {
      const style = getComputedStyle(node)
      if (['auto','scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 2) issues.push(`nested scroll: ${node.closest('[data-widget]').dataset.widget} ${node.className}`)
      if (node.matches('.widget-content') && node.scrollWidth > node.clientWidth + 2) issues.push(`tile overflow: ${node.closest('[data-widget]').dataset.widget}`)
     }
     return [...new Set(issues)]
    })
    if (issues.length) failures.push({ group,theme,width,issues })
   }
  }
  console.log(`CHECKED ${group}: nine themes, 360–2560 px`)
 }
 await page.emulateMedia({ reducedMotion:'reduce' })
 assert.equal(await page.locator('.home-widget button').first().evaluate(n => getComputedStyle(n).transitionDuration), '0s')
 assert.deepEqual(failures, [], 'Responsive and nested-scroll checks')
 console.log('PASS: all 80 widgets across nine themes and six widths; reduced motion')
} finally { await browser.close() }
