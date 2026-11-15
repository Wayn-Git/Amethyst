// Use Node 22+ global WebSocket

const res = await fetch('http://127.0.0.1:9222/json')
const pages = await res.json()
const page = pages.find((p) => p.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1000000)
    const onMsg = (evt) => {
      const d = JSON.parse(evt.data)
      if (d.id === id) {
        ws.removeEventListener('message', onMsg)
        resolve(d.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

// Click Library
const clickRes = await send('Runtime.evaluate', {
  expression: `(() => {
    const btn = document.querySelector('button[aria-label="Library"]')
    if (btn) {
      btn.click()
      return 'clicked'
    }
    return 'not_found'
  })()`,
  returnByValue: true,
})
console.log('Click result:', clickRes?.result?.value)

await new Promise((r) => setTimeout(r, 2000))

// Inspect DOM
const domRes = await send('Runtime.evaluate', {
  expression: `(() => {
    const imgs = Array.from(document.querySelectorAll('img'))
    const cards = Array.from(document.querySelectorAll('.r'))
    return {
      cardCount: cards.length,
      imgCount: imgs.length,
      imgs: imgs.map(i => ({
        srcPrefix: i.src ? i.src.slice(0, 45) : '',
        srcType: i.src?.startsWith('data:') ? 'data:' : i.src?.startsWith('blob:') ? 'blob:' : 'other',
        w: i.naturalWidth,
        h: i.naturalHeight,
        complete: i.complete,
      })),
      bodyTextSnippet: document.body.innerText.slice(0, 300)
    }
  })()`,
  returnByValue: true,
})

console.log('DOM Inspection:', JSON.stringify(domRes?.result?.value, null, 2))
ws.close()
