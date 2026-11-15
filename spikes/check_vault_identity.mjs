async function main() {
  const pageRes = await fetch('http://127.0.0.1:9222/json');
  const pages = await pageRes.json();
  const page = pages.find(p => p.type === 'page') || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let counter = 1;
  function evaluate(expr) {
    return new Promise((resolve, reject) => {
      const id = counter++;
      const timer = setTimeout(() => reject(new Error('timeout for ' + id)), 10000);
      const onMsg = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          clearTimeout(timer);
          ws.removeEventListener('message', onMsg);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result?.result?.value);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression: expr, awaitPromise: true, returnByValue: true }
      }));
    });
  }

  const code = `(async () => {
    const sec = window.Capacitor?.Plugins?.SecureStorage;
    let secIdentity = null;
    if (sec) {
      try {
        const res = await sec.internalGetItem({ prefixedKey: "amethyst_amethyst.sync.identity.v1" });
        secIdentity = res?.data;
      } catch (e) {
        secIdentity = "ERROR: " + e.message;
      }
    }

    // Also check window.__getSecureKey if exposed
    let windowIdentity = null;
    try {
      if (typeof window.__getSecureKey === 'function') {
        windowIdentity = await window.__getSecureKey('amethyst.sync.identity.v1');
      }
    } catch (e) {
      windowIdentity = "ERROR: " + e.message;
    }

    return {
      hasPlugin: Boolean(sec),
      secIdentity,
      windowIdentity,
      localStorageKeys: Object.keys(localStorage),
      pcHost: localStorage.getItem("amethyst.pc_host"),
      localKey: localStorage.getItem("amethyst_local_key") ? 'EXISTS' : null
    };
  })()`;

  const result = await evaluate(code);
  console.log('Result:', JSON.stringify(result, null, 2));
  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

