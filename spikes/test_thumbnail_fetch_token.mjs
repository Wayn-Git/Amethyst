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
    // Token is never hardcoded: pass AME_PAIRING_TOKEN in the environment.
    const token = process.env.AME_PAIRING_TOKEN || "REDACTED";
    const host = "http://192.168.1.2:8000";
    const redact = (u) => u.replace(token, "REDACTED");
    const urlWithQuery = host + "/api/library/832224/thumbnail?token=" + encodeURIComponent(token);
    const urlHeader = host + "/api/library/832224/thumbnail";

    const results = {};

    // 1. Fetch with query param (?token=...)
    try {
      const r1 = await fetch(urlWithQuery);
      const b1 = await r1.blob();
      results.queryParam = {
        url: redact(urlWithQuery),
        status: r1.status,
        statusText: r1.statusText,
        ok: r1.ok,
        contentType: r1.headers.get("content-type"),
        blobSize: b1.size,
        blobType: b1.type
      };
    } catch (e1) {
      results.queryParam = { error: e1.message, name: e1.name };
    }

    // 2. Fetch with Authorization header (Bearer token)
    try {
      const r2 = await fetch(urlHeader, {
        headers: { "Authorization": "Bearer " + token }
      });
      const b2 = await r2.blob();
      results.authHeader = {
        url: urlHeader,
        status: r2.status,
        statusText: r2.statusText,
        ok: r2.ok,
        contentType: r2.headers.get("content-type"),
        blobSize: b2.size,
        blobType: b2.type
      };
    } catch (e2) {
      results.authHeader = { error: e2.message, name: e2.name };
    }

    // 3. Test image load in DOM (how <img> behaves)
    const imgResult = await new Promise((res) => {
      const img = new Image();
      img.onload = () => res({ loaded: true, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = (err) => res({ loaded: false, error: 'img onerror triggered' });
      img.src = urlWithQuery;
    });
    results.imgElement = imgResult;

    return results;
  })()`;

  const res = await evaluate(code);
  import('fs').then(fs => {
    fs.writeFileSync('spikes/evidence/thumbnail_token_fetch_verified.json', JSON.stringify(res, null, 2));
    console.log('Thumbnail fetch result with token:');
    console.log(JSON.stringify(res, null, 2));
    ws.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

