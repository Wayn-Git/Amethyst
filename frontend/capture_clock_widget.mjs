import { chromium } from 'playwright-core';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const cache = join(process.env.HOME, '.cache/ms-playwright');
  const executablePath = process.env.CHROMIUM_PATH || readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => join(cache, n, 'chrome-linux64/chrome')).find(existsSync);
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 2600 }, deviceScaleFactor: 2 });

  await page.route('**/__widget_preview__', route => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="/node_modules/@tugan/widgets/dist/styles.css">
  <style>
    body {
      margin: 0;
      background: #090a0c;
      color: #f5f5f7;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    #root {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 40px;
      width: 100%;
      max-width: 1200px;
    }
    .hero-title {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #ffffff;
      margin-bottom: 4px;
      text-align: center;
    }
    .hero-sub {
      font-size: 14px;
      color: #8e8e93;
      text-align: center;
      margin-bottom: 16px;
    }
    .comp-section {
      background: #141518;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 28px;
      padding: 36px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
      box-sizing: border-box;
    }
    .comp-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      padding-bottom: 16px;
      margin-bottom: 28px;
    }
    .comp-name {
      font-size: 16px;
      font-weight: 600;
      color: #ffffff;
      letter-spacing: -0.01em;
    }
    .comp-badge {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      color: #a1a1aa;
    }
    .tiles-row {
      display: flex;
      gap: 28px;
      align-items: flex-start;
      flex-wrap: wrap;
      justify-content: center;
      width: 100%;
    }
    .tile-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .tile-size-label {
      font-size: 12px;
      font-weight: 500;
      color: #71717a;
    }
  </style>
</head>
<body>
  <div id="root"></div>
</body>
</html>`
  }));

  await page.goto('http://127.0.0.1:5177/__widget_preview__');

  const dialJson = JSON.parse(readFileSync('/tmp/comp_dial.json', 'utf-8'));
  const arcJson = JSON.parse(readFileSync('/tmp/comp_arc_chrono.json', 'utf-8'));

  await page.evaluate(async ({ dialJson, arcJson }) => {
    const { default: runtime } = await import('/@react-refresh');
    runtime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import('/src/index.css').catch(() => {});
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { WidgetRenderer } = await import('/node_modules/.vite/deps/@tugan_widgets.js');

    const root = createRoot(document.getElementById('root'));
    const h = React.createElement;

    root.render(
      h('div', { style: { width: '100%', display: 'flex', flexDirection: 'column', gap: '36px' } },
        h('div', null,
          h('div', { className: 'hero-title' }, 'iOS / macOS Expressive Clock Widgets'),
          h('div', { className: 'hero-sub' }, 'Generated via Amethyst Widget Factory · Small (160×160), Medium (340×160), Large (340×340)')
        ),

        // Composition 1: Complication Dial
        h('div', { className: 'comp-section' },
          h('div', { className: 'comp-header' },
            h('span', { className: 'comp-name' }, '1 · Complication Dial (Alabaster #F5F5F7 · WED 24 · 6/9 Sub-dials · Red Second Hand)'),
            h('span', { className: 'comp-badge' }, 'Analog Classic')
          ),
          h('div', { className: 'tiles-row' },
            h('div', { className: 'tile-wrapper' },
              h('span', { className: 'tile-size-label' }, 'Small (160×160)'),
              h(WidgetRenderer, { template: dialJson.template, data: { ...dialJson.data, selectedSize: 'small' }, theme: 'light' })
            ),
            h('div', { className: 'tile-wrapper' },
              h('span', { className: 'tile-size-label' }, 'Medium (340×160)'),
              h(WidgetRenderer, { template: dialJson.template, data: { ...dialJson.data, selectedSize: 'medium' }, theme: 'light' })
            ),
            h('div', { className: 'tile-wrapper' },
              h('span', { className: 'tile-size-label' }, 'Large (340×340)'),
              h(WidgetRenderer, { template: dialJson.template, data: { ...dialJson.data, selectedSize: 'large' }, theme: 'light' })
            )
          )
        ),

        // Composition 2: Arc Chrono
        h('div', { className: 'comp-section' },
          h('div', { className: 'comp-header' },
            h('span', { className: 'comp-name' }, '2 · Arc Chrono (Grey #E5E5EA · 24h Dial · Indigo-Violet Daylight Arc · 7hr 30m Badge)'),
            h('span', { className: 'comp-badge' }, '24H Daylight Arc')
          ),
          h('div', { className: 'tiles-row' },
            h(WidgetRenderer, { template: arcJson.template, data: arcJson.data, theme: 'light' })
          )
        )
      )
    );
  }, { dialJson, arcJson });

  await page.waitForTimeout(2500);
  const outPath = '/home/wayne/.gemini/antigravity-ide/brain/9e0e660f-6647-4d1f-a232-2b4d11920a46/clock_widgets_preview.png';
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('Saved preview to', outPath);
  await browser.close();
}

main().catch(console.error);
