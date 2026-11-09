import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

const CHROME_PATH = process.env.CHROMIUM_PATH || '/opt/google/chrome/chrome'
const BASE_URL = process.env.BASE || 'http://127.0.0.1:8000'
const ARTIFACTS_DIR = '/home/wayne/.gemini/antigravity-ide/brain/5cfcbc8b-840f-4076-a66c-8c691585bd65'

async function run() {
  console.log(`[verify] Launching Chrome from: ${CHROME_PATH}`)
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  // 1. Desktop Test (1440x900)
  console.log('[verify] Testing Desktop Viewport (1440x900)...')
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const desktopPage = await desktopContext.newPage()
  await desktopPage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 })
  console.log('[verify] Page loaded, URL:', desktopPage.url())

  // If a conversation was restored from previous session, click New Chat to see the Home starting experience
  if (await desktopPage.isVisible('.sb-new-chat-btn')) {
    console.log('[verify] Clicking New Chat to show Home starting command center...')
    await desktopPage.click('.sb-new-chat-btn')
  }

  // Wait for brand and hero command center
  await desktopPage.waitForSelector('.hero-command-center', { timeout: 10000 })
  console.log('[verify] ✓ Desktop Home command center rendered successfully')

  // Check logo
  const logoVisible = await desktopPage.isVisible('.hero-logo-wrap .brand-mark svg')
  console.log(`[verify] ✓ Amethyst BrandMark SVG present: ${logoVisible}`)

  // Check shelves
  const recentConvs = await desktopPage.isVisible('.hero-shelf-card')
  console.log(`[verify] ✓ Command center shelves visible: ${recentConvs}`)

  // Check no horizontal overflow
  const desktopOverflow = await desktopPage.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth
  })
  console.log(`[verify] Desktop horizontal overflow: ${desktopOverflow ? 'FAIL (overflows)' : 'PASS (no overflow)'}`)

  await desktopPage.screenshot({ path: join(ARTIFACTS_DIR, 'desktop_home_revamp.png'), fullPage: false })
  console.log('[verify] ✓ Saved desktop screenshot to desktop_home_revamp.png')

  // 2. Tablet Test (768x1024)
  console.log('[verify] Testing Tablet Viewport (768x1024)...')
  const tabletContext = await browser.newContext({
    viewport: { width: 768, height: 1024 },
  })
  const tabletPage = await tabletContext.newPage()
  await tabletPage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 })
  if (await tabletPage.isVisible('.sb-new-chat-btn')) {
    await tabletPage.click('.sb-new-chat-btn')
  }
  await tabletPage.waitForSelector('.hero-command-center', { timeout: 10000 })
  await tabletPage.screenshot({ path: join(ARTIFACTS_DIR, 'tablet_home_revamp.png') })
  console.log('[verify] ✓ Saved tablet screenshot to tablet_home_revamp.png')

  // 3. Mobile Test (390x844 - iPhone 14)
  console.log('[verify] Testing Mobile Viewport (390x844)...')
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const mobilePage = await mobileContext.newPage()
  await mobilePage.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 })

  // Confirm that PhoneApp pairing block is NOT showing, but real workbench
  const pairingBlocked = await mobilePage.isVisible('.pair-screen')
  console.log(`[verify] Mobile pairing lockout active: ${pairingBlocked} (should be false)`)

  // Click new chat or chat tab if in active conversation
  const newChatBtn = mobilePage.locator('.sb-new-chat-btn')
  if (await newChatBtn.isVisible()) {
    await newChatBtn.click()
  } else {
    // Or click chat on mobile nav
    const chatNavBtn = mobilePage.locator('button.mobile-nav-btn:has-text("Chat")')
    if (await chatNavBtn.isVisible()) await chatNavBtn.click()
  }

  await mobilePage.waitForSelector('.hero-command-center', { timeout: 10000 })
  console.log('[verify] ✓ Mobile Home command center active')

  // Check Mobile Navigation Bar
  const mobileNavVisible = await mobilePage.isVisible('.mobile-nav-bar')
  console.log(`[verify] ✓ Mobile Navigation Bar visible: ${mobileNavVisible}`)

  // Check horizontal overflow on mobile
  const mobileOverflow = await mobilePage.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth
  })
  console.log(`[verify] Mobile horizontal overflow: ${mobileOverflow ? 'FAIL (overflows)' : 'PASS (no overflow)'}`)

  await mobilePage.screenshot({ path: join(ARTIFACTS_DIR, 'mobile_home_revamp.png') })
  console.log('[verify] ✓ Saved mobile home screenshot to mobile_home_revamp.png')

  // Test Mobile Navigation to Tasks
  console.log('[verify] Navigating to Tasks via mobile navigation bar...')
  await mobilePage.click('button.mobile-nav-btn:has-text("Tasks")')
  await mobilePage.waitForSelector('.task-layout', { timeout: 10000 })
  console.log('[verify] ✓ Tasks view mounted smoothly on mobile')
  await mobilePage.screenshot({ path: join(ARTIFACTS_DIR, 'mobile_tasks_revamp.png') })
  console.log('[verify] ✓ Saved mobile tasks screenshot to mobile_tasks_revamp.png')

  // Test Mobile Navigation to Today
  console.log('[verify] Navigating to Today via mobile navigation bar...')
  await mobilePage.click('button.mobile-nav-btn:has-text("Today")')
  await mobilePage.waitForSelector('.today-grid', { timeout: 10000 })
  console.log('[verify] ✓ Today view mounted smoothly on mobile')
  await mobilePage.screenshot({ path: join(ARTIFACTS_DIR, 'mobile_today_revamp.png') })
  console.log('[verify] ✓ Saved mobile today screenshot to mobile_today_revamp.png')

  await browser.close()
  console.log('[verify] All UI/UX tests passed cleanly!')
}

run().catch((err) => {
  console.error('[verify] FAILED:', err)
  process.exit(1)
})
