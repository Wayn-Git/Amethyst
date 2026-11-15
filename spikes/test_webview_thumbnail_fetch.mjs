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
      const timer = setTimeout(() => reject(new Error('timeout for ' + id)), 15000);
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

  const evalCode = `(async () => {
    const origin = window.location.origin;
    const pcHost = localStorage.getItem('amethyst.pc_host');
    const identityRaw = localStorage.getItem('amethyst_device_identity');
    const pairingRaw = localStorage.getItem('amethyst_pairing');
    const pairingVaultRaw = localStorage.getItem('amethyst_pairing_vault');

    let parsedIdentity = null;
    try { parsedIdentity = JSON.parse(identityRaw); } catch {}

    const hostBase = pcHost || parsedIdentity?.hostUrl || '';

    // Attempt 1: Fetch using hostBase if present, or http://192.168.1.2:8000
    const testHost = hostBase || 'http://192.168.1.2:8000';
    const targetUrl = testHost.replace(/\\/+$/, '') + '/api/library/832224/thumbnail';

    let fetchResult = {
      targetUrl,
      status: null,
      statusText: null,
      error: null,
      errorName: null,
      headers: {},
      ok: false,
    };

    try {
      const resp = await fetch(targetUrl, { method: 'GET', mode: 'cors' });
      fetchResult.status = resp.status;
      fetchResult.statusText = resp.statusText;
      fetchResult.ok = resp.ok;
      resp.headers.forEach((v, k) => { fetchResult.headers[k] = v; });
    } catch (e) {
      fetchResult.error = e.message || String(e);
      fetchResult.errorName = e.name;
      fetchResult.stack = e.stack;
    }

    // Attempt 2: Fetch with auth token header if available
    let authFetchResult = null;
    const token = parsedIdentity?.token || parsedIdentity?.authToken;
    if (token) {
      authFetchResult = { targetUrl };
      try {
        const resp2 = await fetch(targetUrl, {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        authFetchResult.status = resp2.status;
        authFetchResult.ok = resp2.ok;
      } catch (e) {
        authFetchResult.error = e.message;
      }
    }

    return {
      origin,
      pcHost,
      identity: parsedIdentity,
      pairing: pairingRaw,
      pairingVault: pairingVaultRaw ? 'exists' : null,
      hostBase,
      fetchResult,
      authFetchResult
    };
  })()`;

  const report = await evaluate(evalCode);
  import('fs').then(fs => {
    fs.writeFileSync('spikes/evidence/webview_thumbnail_fetch_report.json', JSON.stringify(report, null, 2));
    console.log('Result:', JSON.stringify(report, null, 2));
    ws.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

