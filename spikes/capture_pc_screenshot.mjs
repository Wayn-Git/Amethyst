import { spawn } from 'child_process';
import fs from 'fs';

async function main() {
  const chrome = spawn('/opt/google/chrome/chrome', [
    '--headless=new',
    '--remote-debugging-port=9333',
    '--user-data-dir=/tmp/chrome-pc-shot',
    '--window-size=1440,900',
    'http://127.0.0.1:8000/library'
  ]);

  // Wait for CDP to be available
  let page = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch('http://127.0.0.1:9333/json');
      const pages = await res.json();
      page = pages.find(p => p.type === 'page');
      if (page) break;
    } catch {}
  }

  if (!page) {
    chrome.kill();
    throw new Error('Chrome CDP not reachable');
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let idCounter = 1;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      const handler = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Wait for library cards or grid to render
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const evalRes = await send('Runtime.evaluate', {
      expression: 'document.querySelectorAll(".lib-card, .lib-grid, .lib-card-title").length',
      returnByValue: true
    });
    console.log('Detected library elements:', evalRes?.result?.value);
    if (evalRes?.result?.value > 0) break;
  }

  // Capture screenshot
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/home/wayne/Documents/GitHub/amethyst/spikes/evidence/diagnosis_pc_library_screen.png', Buffer.from(shot.data, 'base64'));
  console.log('Saved screenshot: spikes/evidence/diagnosis_pc_library_screen.png');

  ws.close();
  chrome.kill();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

