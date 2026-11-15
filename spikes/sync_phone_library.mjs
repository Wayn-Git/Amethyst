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

// Trigger collections sync
const syncEval = await send('Runtime.evaluate', {
  expression: `(async () => {
    const base = localStorage.getItem('amethyst.pc_host') || 'http://192.168.1.2:8000';
    // get token from vault/identity
    let token = '';
    try {
      const { storedIdentity } = await import('/src/lib/credentials.js');
      token = storedIdentity()?.token || '';
    } catch {}
    if (!token) {
      try {
        const raw = localStorage.getItem('amethyst.sync.identity.v1');
        const parsed = JSON.parse(raw);
        token = parsed?.token || '';
      } catch {}
    }

    const res = await fetch(base + '/api/library?limit=500', {
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    const data = await res.json();
    const current = JSON.parse(localStorage.getItem('amethyst.mobile.collections.v1') || '{}');
    current.items = data.items;
    current.lastSyncedAt = new Date().toISOString();
    localStorage.setItem('amethyst.mobile.collections.v1', JSON.stringify(current));
    return {
      syncedCount: data.items.length,
      webpThumbCount: data.items.filter(it => it.thumbnail_url && it.thumbnail_url.startsWith('data:')).length,
      samplePrefix: data.items[0]?.thumbnail_url ? data.items[0].thumbnail_url.slice(0, 30) : null
    };
  })()`,
  awaitPromise: true,
  returnByValue: true,
})

console.log('Sync result:', JSON.stringify(syncEval?.result?.value, null, 2))
ws.close()

