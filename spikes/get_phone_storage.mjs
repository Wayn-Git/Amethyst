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
        params: { expression: expr, returnByValue: true }
      }));
    });
  }

  const savedRaw = await evaluate('localStorage.getItem("amethyst_saved_items") || "[]"');
  const cachedRaw = await evaluate('localStorage.getItem("amethyst.cached_library") || "[]"');
  const collectionsRaw = await evaluate('localStorage.getItem("amethyst.collections") || "{}"');

  const data = {
    saved: JSON.parse(savedRaw),
    cached: JSON.parse(cachedRaw),
    collections: JSON.parse(collectionsRaw)
  };

  import('fs').then(fs => {
    fs.writeFileSync('spikes/evidence/phone_storage.json', JSON.stringify(data, null, 2));
    console.log(`Exported phone storage: ${data.saved.length} saved pipeline items, ${data.cached.length} cached library items.`);
    ws.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

