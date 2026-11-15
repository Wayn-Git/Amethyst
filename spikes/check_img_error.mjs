async function main() {
  const pageRes = await fetch('http://127.0.0.1:9222/json');
  const pages = await pageRes.json();
  const page = pages.find(p => p.type === 'page') || pages[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  const consoleLogs = [];
  ws.addEventListener('message', (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.method === 'Console.messageAdded') {
      consoleLogs.push(msg.params.message);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLogs.push(msg.params);
    }
    if (msg.method === 'Log.entryAdded') {
      consoleLogs.push(msg.params.entry);
    }
    if (msg.method === 'Security.visibleSecurityStateChanged') {
      consoleLogs.push(msg.params);
    }
  });

  // Enable console and log domains
  let counter = 1;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = counter++;
      const onMsg = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          ws.removeEventListener('message', onMsg);
          resolve(msg.result);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Console.enable');
  await send('Log.enable');

  const evalRes = await send('Runtime.evaluate', {
    expression: `(async () => {
      // Token is never hardcoded: pass AME_PAIRING_TOKEN in the environment.
      const token = process.env.AME_PAIRING_TOKEN || "REDACTED";
      const url = "http://192.168.1.2:8000/api/library/832224/thumbnail?token=" + encodeURIComponent(token);
      console.log("[TestImg] Setting img src to", url);
      const img = new Image();
      return new Promise((resolve) => {
        img.onload = () => resolve({ ok: true, w: img.width });
        img.onerror = (e) => {
          console.error("[TestImg Error]", e);
          resolve({ ok: false });
        };
        img.src = url;
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  await new Promise(r => setTimeout(r, 1000));
  console.log('Eval result:', evalRes);
  console.log('Console logs captured:', JSON.stringify(consoleLogs, null, 2));

  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

