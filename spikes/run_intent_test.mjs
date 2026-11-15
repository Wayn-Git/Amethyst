import fs from 'fs';
import { execSync } from 'child_process';

async function run() {
  console.log('=== Item 2: Licensed Reels Intent Verification ===');

  const pid = execSync('adb shell pidof app.amethyst.companion').toString().trim();
  console.log('App PID:', pid);
  execSync(`adb forward --remove-all && adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);

  const pageRes = await fetch('http://127.0.0.1:9222/json');
  const pages = await pageRes.json();
  const page = pages.find(p => p.type === 'page') || pages[0];
  console.log('Connecting to WebView:', page.title);

  let msgIdCounter = 3000;
  function cdpEval(expr) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const reqId = ++msgIdCounter;
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('CDP timeout for req ' + reqId));
      }, 30000);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: reqId,
          method: 'Runtime.evaluate',
          params: { expression: expr, awaitPromise: true, returnByValue: true }
        }));
      };

      ws.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.id !== reqId) return;
        clearTimeout(timer);
        ws.close();
        if (data.result?.exceptionDetails) {
          reject(new Error(data.result.exceptionDetails.exception?.description || 'CDP exception'));
        } else {
          resolve(data.result?.result?.value);
        }
      };

      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  // 1. Mount the licensed reel card in WebView DOM
  console.log('1. Rendering licensed reel card in WebView...');
  const shortcode = 'DdXGIh1JE4m';
  const songName = 'Runaway (feat. Pusha T)';
  const artistName = 'Kanye West';
  const caption = 'The evolution of AI-generated video between 2023 and 2026...';

  const mountCardFn = (sc, song, artist, cap) => {
    let old = document.getElementById('spike_licensed_card');
    if (old) old.remove();

    const container = document.createElement('div');
    container.id = 'spike_licensed_card';
    container.style.position = 'fixed';
    container.style.top = '100px';
    container.style.left = '20px';
    container.style.right = '20px';
    container.style.height = '420px';
    container.style.zIndex = '999999';
    container.style.backgroundColor = '#18181b';
    container.style.borderRadius = '24px';
    container.style.padding = '20px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.justifyContent = 'space-between';
    container.style.boxShadow = '0 20px 40px rgba(0,0,0,0.6)';

    // Music pill
    const pill = document.createElement('div');
    pill.style.display = 'inline-flex';
    pill.style.alignItems = 'center';
    pill.style.gap = '8px';
    pill.style.padding = '6px 14px';
    pill.style.borderRadius = '999px';
    pill.style.background = 'rgba(255,255,255,0.12)';
    pill.style.color = '#fff';
    pill.style.fontSize = '12px';
    pill.style.fontWeight = '600';
    pill.innerText = '🎵 ' + song + ' • ' + artist;
    container.appendChild(pill);

    // Caption
    const capP = document.createElement('p');
    capP.style.color = 'rgba(255,255,255,0.85)';
    capP.style.fontSize = '13px';
    capP.style.lineHeight = '1.4';
    capP.innerText = cap;
    container.appendChild(capP);

    // Button
    const btn = document.createElement('button');
    btn.id = 'spike_open_ig_btn';
    btn.innerText = 'Open in Instagram';
    btn.style.width = '100%';
    btn.style.height = '46px';
    btn.style.borderRadius = '14px';
    btn.style.background = 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)';
    btn.style.color = '#fff';
    btn.style.fontWeight = '600';
    btn.style.border = 'none';
    btn.style.fontSize = '14px';

    const targetUrl = 'https://www.instagram.com/reel/' + sc + '/';
    btn.onclick = () => {
      window.open(targetUrl, '_system');
    };
    container.appendChild(btn);

    document.body.appendChild(container);
    return { mounted: true, targetUrl };
  };

  const mountRes = await cdpEval('(' + mountCardFn.toString() + ')(' +
    JSON.stringify(shortcode) + ',' +
    JSON.stringify(songName) + ',' +
    JSON.stringify(artistName) + ',' +
    JSON.stringify(caption) + ')');

  console.log('Card mounted in WebView:', mountRes);

  // Capture screenshot of card in app
  execSync('adb exec-out screencap -p > spikes/evidence/licensed_reel_card_rendered.png');
  console.log('Captured spikes/evidence/licensed_reel_card_rendered.png');

  // 2. Trigger the "Open in Instagram" click via CDP
  console.log('2. Clicking "Open in Instagram" button...');
  await cdpEval('(() => { const b = document.getElementById("spike_open_ig_btn"); if (b) b.click(); })()');

  // Wait 2s for Android Activity Manager to launch intent
  await new Promise(r => setTimeout(r, 2000));

  // Check focused app
  const focusCheck = execSync('adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp"').toString().trim();
  console.log('Current Focus:\n' + focusCheck);

  // Check activity stack for intent
  const activityDump = execSync('adb shell dumpsys activity a | grep -E "ActivityRecord\\{.*(instagram|Password|amethyst)" | head -n 10').toString().trim();
  console.log('Activity Stack Excerpt:\n' + activityDump);

  // Capture screenshot of device screen showing Instagram / App Lock
  execSync('adb exec-out screencap -p > spikes/evidence/licensed_reel_instagram_opened.png');
  console.log('Captured spikes/evidence/licensed_reel_instagram_opened.png');

  const intentDispatched = focusCheck.includes('PasswordActivity') || focusCheck.includes('com.instagram.android');
  console.log('Verified: External Instagram Intent dispatched and focused:', intentDispatched);

  // Clean up and bring Amethyst companion back to front
  console.log('Bringing Amethyst back to front...');
  execSync('adb shell am start -n app.amethyst.companion/.MainActivity');
  await new Promise(r => setTimeout(r, 1000));
  await cdpEval('(() => { const c = document.getElementById("spike_licensed_card"); if (c) c.remove(); })()');

  const intentEvidence = {
    testedAt: new Date().toISOString(),
    shortcode: 'DdXGIh1JE4m',
    songName,
    artistName,
    cardRendered: true,
    targetUrl: mountRes.targetUrl,
    intentDispatchedSuccessfully: intentDispatched,
    focusedWindow: focusCheck,
    activityStack: activityDump,
    screenshots: [
      'spikes/evidence/licensed_reel_card_rendered.png',
      'spikes/evidence/licensed_reel_instagram_opened.png'
    ]
  };

  fs.writeFileSync('spikes/evidence/t2_licensed_intent_evidence.json', JSON.stringify(intentEvidence, null, 2));
  console.log('Wrote spikes/evidence/t2_licensed_intent_evidence.json successfully!');
}

run().catch(err => {
  console.error('Fatal error in intent test:', err);
  process.exit(1);
});
