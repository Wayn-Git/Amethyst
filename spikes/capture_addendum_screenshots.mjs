import fs from 'fs';
import { execSync } from 'child_process';

async function main() {
  const pid = execSync('adb shell pidof app.amethyst.companion').toString().trim();
  execSync(`adb forward --remove-all && adb forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);

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

  function shoot(filename) {
    execSync(`adb exec-out screencap -p > spikes/evidence/${filename}`);
    console.log(`Saved screenshot: spikes/evidence/${filename}`);
  }

  // 1. Ensure on Library tab
  await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Library' || b.textContent.trim() === 'Library');
    if (btn) btn.click();
    return true;
  })()`);
  await new Promise(r => setTimeout(r, 600));

  // 2. Open Phone-Saved Reel: ea279a21337da9ae (iOS animation physics)
  console.log('Opening phone-saved reel ea279a21337da9ae...');
  await evaluate(`(() => {
    // Find item with ea279a21337da9ae in saved items and trigger click
    const cards = Array.from(document.querySelectorAll('.m-lib-card, [class*="lib-card"], div'));
    const target = cards.find(c => c.textContent.includes('Why does iOS feel so nice'));
    if (target) {
      target.click();
      return 'clicked card';
    }
    // Fallback: trigger directly via window event or companion state if exposed
    return 'card not found directly in DOM';
  })()`);
  await new Promise(r => setTimeout(r, 800));

  // Check if detail item view opened, or select via React / store
  const isItemView = await evaluate(`Boolean(document.querySelector('.m-lib-detail, [class*="detail"], button[class*="on"]'))`);
  console.log('Detail view open:', isItemView);

  // If not open, let's trigger it by clicking the first card
  if (!isItemView) {
    await evaluate(`(() => {
      const firstCard = document.querySelector('.m-lib-card, [class*="card"]');
      if (firstCard) firstCard.click();
    })()`);
    await new Promise(r => setTimeout(r, 800));
  }

  // Ensure on Overview tab
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const overBtn = btns.find(b => b.textContent.trim().startsWith('Overview'));
    if (overBtn) overBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  shoot('diagnosis_phone_saved_overview.png');

  // Switch to Links tab
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const linkBtn = btns.find(b => b.textContent.trim().startsWith('Links'));
    if (linkBtn) linkBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  shoot('diagnosis_phone_saved_links.png');

  // Switch to Notes tab
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const noteBtn = btns.find(b => b.textContent.trim().startsWith('Notes'));
    if (noteBtn) noteBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  shoot('diagnosis_phone_saved_notes.png');

  // Go back to Library
  await evaluate(`(() => {
    const backBtn = document.querySelector('button[aria-label="Back"], button.m-back-btn, [class*="back"]');
    if (backBtn) backBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 800));

  // 3. Open PC-synced Reel: 832224 ("You vibe coded an app...")
  console.log('Opening PC-synced reel 832224...');
  await evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('.m-lib-card, [class*="card"], div'));
    const target = cards.find(c => c.textContent.includes('vibe coded an app'));
    if (target) {
      target.click();
      return 'clicked pc synced card';
    }
    return 'not found';
  })()`);
  await new Promise(r => setTimeout(r, 800));

  // Ensure Overview tab
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const overBtn = btns.find(b => b.textContent.trim().startsWith('Overview'));
    if (overBtn) overBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  shoot('diagnosis_pc_synced_overview.png');

  // Switch to Links tab
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const linkBtn = btns.find(b => b.textContent.trim().startsWith('Links'));
    if (linkBtn) linkBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  shoot('diagnosis_pc_synced_links.png');

  // Switch to Notes tab
  await evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const noteBtn = btns.find(b => b.textContent.trim().startsWith('Notes'));
    if (noteBtn) noteBtn.click();
  })()`);
  await new Promise(r => setTimeout(r, 500));
  shoot('diagnosis_pc_synced_notes.png');

  ws.close();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

