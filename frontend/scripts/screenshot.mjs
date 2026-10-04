import { chromium } from 'playwright-core';

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Set onboardingDone: true in localStorage so splash wizard does not block the view
  await page.addInitScript(() => {
    try {
      const existing = JSON.parse(localStorage.getItem('amethyst_prefs') || '{}');
      localStorage.setItem('amethyst_prefs', JSON.stringify({ ...existing, onboardingDone: true, theme: 'dark' }));
    } catch {
      localStorage.setItem('amethyst_prefs', JSON.stringify({ onboardingDone: true, theme: 'dark' }));
    }
  });

  await page.goto('http://localhost:8000/converter', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  try {
    const skipBtn = page.getByText('Skip for now');
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
      await page.waitForTimeout(500);
    }
  } catch (e) {
    console.log('No skip button found');
  }

  const baseDir = '/home/wayne/.gemini/antigravity/brain/dd709a3b-56ab-4545-904b-9ce2400095c6';

  // 1. Dark Main View
  await page.screenshot({ path: `${baseDir}/ui_dark.png` });
  console.log('Saved dark screenshot');

  // 2. Light Main View
  await page.evaluate(() => {
    const existing = JSON.parse(localStorage.getItem('amethyst_prefs') || '{}');
    localStorage.setItem('amethyst_prefs', JSON.stringify({ ...existing, onboardingDone: true, theme: 'light' }));
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.classList.remove('dark-mode');
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${baseDir}/ui_light.png` });
  console.log('Saved light screenshot');

  // Switch back to dark mode
  await page.evaluate(() => {
    const existing = JSON.parse(localStorage.getItem('amethyst_prefs') || '{}');
    localStorage.setItem('amethyst_prefs', JSON.stringify({ ...existing, onboardingDone: true, theme: 'dark' }));
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.add('dark-mode');
  });
  await page.waitForTimeout(400);

  // Helper to click studio by component ID via the quick launcher select or nav
  async function selectStudio(value) {
    const select = page.locator('.fc-studio-quick-select').first();
    await select.selectOption(value);
    await page.waitForTimeout(600);
  }

  // 3. Color Studio
  await selectStudio('color-converter');
  await page.screenshot({ path: `${baseDir}/ui_color_lab.png` });
  console.log('Saved color lab screenshot');

  // 4. Unit Converter
  await selectStudio('unit-converter');
  await page.screenshot({ path: `${baseDir}/ui_unit_converter.png` });
  console.log('Saved unit converter screenshot');

  // 5. Image Studio
  await selectStudio('image-resizer');
  await page.screenshot({ path: `${baseDir}/ui_image_resizer.png` });
  console.log('Saved image resizer screenshot');

  // 6. PDF Suite
  await selectStudio('pdf-tools');
  await page.screenshot({ path: `${baseDir}/ui_pdf_tools.png` });
  console.log('Saved PDF tools screenshot');

  // 7. QR Vector Generator
  await selectStudio('qr-code');
  await page.screenshot({ path: `${baseDir}/ui_qr_generator.png` });
  console.log('Saved QR generator screenshot');

  // 8. Code Formatter
  await selectStudio('code-formatter');
  await page.screenshot({ path: `${baseDir}/ui_code_formatter.png` });
  console.log('Saved code formatter screenshot');

  await browser.close();
}

capture().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
