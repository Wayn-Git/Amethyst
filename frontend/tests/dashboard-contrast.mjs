import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const cache=join(process.env.HOME,'.cache/ms-playwright')
const executablePath=readdirSync(cache).filter(n=>n.startsWith('chromium-')).sort().reverse().map(n=>join(cache,n,'chrome-linux64/chrome')).find(existsSync)
const browser=await chromium.launch({executablePath,args:['--no-sandbox']})
const failures=[]
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 for(const group of ['glance','needs-you','communication','agent','library','tasks','developer','feed','system','dashboard']) {
  await page.goto(`${process.env.BASE||'http://127.0.0.1:5178'}/dev/widgets?group=${group}`)
  await page.waitForFunction(()=>document.querySelector('.home-widget')&&!document.querySelector('.widget-skeleton'))
  await page.getByLabel('State',{exact:true}).selectOption('all')
  for(const theme of ['paper','graphite','ink','nocturne','nvidia','sand','claude','cursor','system']) {
  await page.getByLabel('Theme',{exact:true}).selectOption(theme)
  const result=await page.evaluate(()=>{
   const context=document.createElement('canvas').getContext('2d')
   function rgb(color){context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].map((n,i)=>i===3?n/255:n)}
   const blend=(a,b)=>a.slice(0,3).map((n,i)=>n*a[3]+b[i]*(1-a[3]))
   function background(node){if(!node)return [255,255,255];const c=rgb(getComputedStyle(node).backgroundColor);return c[3]===1?c.slice(0,3):blend(c,background(node.parentElement))}
   function lum(rgb){return rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)}
   const bad=[]
   for(const node of document.querySelectorAll('.home-widget *')){
    const text=[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('').slice(0,70)
    if(!text||!node.getClientRects().length||node.closest('[disabled],[aria-hidden=true],svg'))continue
    const style=getComputedStyle(node)
    if(style.visibility==='hidden'||Number(style.opacity)<1)continue
    const bg=background(node), fg=blend(rgb(style.color),bg), a=lum(bg),b=lum(fg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05)
    const minimum=parseFloat(style.fontSize)>=24||(parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700)?3:4.5
    if(ratio+.05<minimum)bad.push({widget:node.closest('[data-widget]')?.dataset.widget,text,ratio:Math.round(ratio*100)/100,color:style.color,background:bg,tag:node.tagName,class:node.className})
   }
   return bad
  })
  failures.push(...result.map(item=>({...item,theme})))
  }
 }
 writeFileSync(new URL('../../ui-review/contrast.json',import.meta.url),JSON.stringify(failures,null,2))
 assert.equal(failures.length,0,`${failures.length} text contrast failures; see ui-review/contrast.json`)
 console.log('PASS: visible widget text meets AA contrast across nine themes and all six states in the labelled fixture set')
}finally{await browser.close()}
