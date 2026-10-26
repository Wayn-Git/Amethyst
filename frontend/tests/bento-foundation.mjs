import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const cache = join(process.env.HOME, '.cache/ms-playwright')
const executablePath = readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache,n,'chrome-linux64/chrome')).find(existsSync)
const browser = await chromium.launch({ executablePath, args:['--no-sandbox'] })
try {
 const page = await browser.newPage()
 const errors = []; page.on('pageerror', error => errors.push(error.message))
 await page.goto(process.env.BASE || 'http://127.0.0.1:5177/dev/ui')
 await page.getByRole('heading',{name:'Shape, space, signal.'}).waitFor()
 for (const width of [1536,1440,1024,768,390,360]) {
  await page.setViewportSize({width,height:1000})
  for (const theme of ['paper','graphite','ink','nocturne','nvidia','sand','claude','cursor','system']) {
   await page.getByLabel('Theme',{exact:true}).selectOption(theme)
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true,`${theme} ${width} overflow`)
   assert.equal(await page.locator('.ui-tile').first().evaluate(el => getComputedStyle(el).borderRadius),'24px')
   assert.equal(await page.locator('.bento-grid').first().evaluate(el => getComputedStyle(el).gap),'16px')
  }
 }
 await page.setViewportSize({width:1440,height:1000})
 const defaults = page.getByRole('region',{name:'default controls'})
 await defaults.getByRole('checkbox').click(); assert.equal(await defaults.getByRole('checkbox').getAttribute('aria-checked'),'true')
 await defaults.getByRole('switch').click(); assert.equal(await defaults.getByRole('switch').getAttribute('aria-checked'),'false')
 await defaults.getByRole('radio',{name:'Day',exact:true}).focus(); await page.keyboard.press('ArrowRight')
 assert.equal(await defaults.getByRole('radio',{name:'Week',exact:true}).getAttribute('aria-checked'),'true')
 await defaults.getByRole('button',{name:'default menu'}).click()
 await page.getByRole('menuitem',{name:'Example action'}).waitFor()
 await page.keyboard.press('Escape')
 await page.waitForFunction(() => document.activeElement?.textContent === 'default menu')
 for (const state of ['disabled','loading']) {
  const region = page.getByRole('region',{name:`${state} controls`})
  assert.equal(await region.getByRole('button',{name:'primary',exact:true}).isDisabled(),true)
  assert.equal(await region.getByRole('textbox').isDisabled(),true)
  assert.equal(await region.getByRole('combobox').isDisabled(),true)
 }
 await page.emulateMedia({reducedMotion:'reduce'})
 assert.equal(await defaults.getByRole('button',{name:'primary',exact:true}).evaluate(el => getComputedStyle(el).transitionDuration),'0s')
 assert.equal(await page.getByText('No measurement.',{exact:true}).count(),1)
 assert.equal(await page.getByText('No measurements.',{exact:true}).count(),1)
 assert.deepEqual(errors,[])
 console.log('PASS: nine themes × six widths; controls, keyboard, reduced motion, honest missing-data states')
} finally { await browser.close() }
