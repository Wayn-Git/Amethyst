import WebSocket from '../relay/node_modules/ws/index.js';

export async function evalInWebView(expression, awaitPromise = false) {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.type === 'page') || pages[0];
  if (!page) throw new Error('No WebView page found');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP eval timeout after 30s'));
    }, 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression,
          returnByValue: true,
          awaitPromise
        }
      }));
    });

    ws.on('message', (data) => {
      clearTimeout(timeout);
      const msg = JSON.parse(data.toString());
      ws.close();
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.exception?.description || 'CDP Eval Exception'));
      } else {
        resolve(msg.result?.result?.value);
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

// Memory heap measurement via CDP
export async function getHeapUsage() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find(p => p.type === 'page') || pages[0];
  if (!page) throw new Error('No WebView page found');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP heap timeout'));
    }, 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 2,
        method: 'Runtime.getHeapUsage'
      }));
    });

    ws.on('message', (data) => {
      clearTimeout(timeout);
      const msg = JSON.parse(data.toString());
      ws.close();
      if (msg.result) {
        resolve(msg.result);
      } else {
        reject(new Error('No heap result'));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

if (process.argv[2]) {
  const expr = process.argv.slice(2).join(' ');
  evalInWebView(expr, true)
    .then(val => {
      console.log('EVAL RESULT:', JSON.stringify(val, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('EVAL ERROR:', err);
      process.exit(1);
    });
}

