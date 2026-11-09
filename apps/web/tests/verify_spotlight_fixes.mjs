import { chromium } from 'playwright-core'

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })

  console.log('Navigating to http://127.0.0.1:8000...')
  await page.goto('http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)

  // Open Spotlight
  await page.keyboard.press('Control+k')
  const palette = page.locator('.palette.damon-spotlight')
  await palette.waitFor({ state: 'visible', timeout: 8000 })
  console.log('Spotlight opened!')

  // Check Clean toggle button
  const toggleBtn = page.locator('.damon-compact-toggle-btn')
  const btnText = await toggleBtn.innerText()
  console.log('Initial Toggle Button state:', btnText)

  // Ensure in Full mode first to inspect recents cards
  if (btnText.includes('Clean')) {
    await toggleBtn.click()
    await page.waitForTimeout(300)
  }

  // 1. Check Recents view (Empty query)
  // Ensure cards grid does NOT horizontally overflow!
  const cardsGrid = page.locator('.damon-cards-grid')
  if (await cardsGrid.count() > 0) {
    const overflowInfo = await cardsGrid.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      hasOverflow: el.scrollWidth > el.clientWidth,
      display: window.getComputedStyle(el).display,
      gridColumns: window.getComputedStyle(el).gridTemplateColumns,
      overflowX: window.getComputedStyle(el).overflowX
    }))
    console.log('Cards Grid check:', JSON.stringify(overflowInfo))
    if (overflowInfo.hasOverflow) {
      console.error('FAIL: Cards grid still overflows horizontally!')
    } else {
      console.log('PASS: Zero horizontal overflow in cards grid!')
    }
  }

  // Check Footer height & styling
  const footer = page.locator('.damon-footer')
  const footerBox = await footer.boundingBox()
  console.log('Footer height:', footerBox?.height, 'px')

  // Capture Screenshot 1: Recents Dark Mode
  await page.screenshot({ path: '/tmp/spotlight_dark_recents.png' })
  console.log('Saved /tmp/spotlight_dark_recents.png')

  // 2. Switch to Light Mode and check styling
  console.log('Testing Light Mode...')
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme-mode', 'light')
    document.documentElement.setAttribute('data-theme', 'paper')
    document.documentElement.classList.remove('dark', 'dark-mode')
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: '/tmp/spotlight_light_recents.png' })
  console.log('Saved /tmp/spotlight_light_recents.png')

  // Switch back to Dark Mode
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme-mode', 'dark')
    document.documentElement.setAttribute('data-theme', 'graphite')
    document.documentElement.classList.add('dark', 'dark-mode')
  })
  await page.waitForTimeout(200)

  // 3. Test Library Tab filtering
  console.log('Clicking Library tab...')
  const libraryTab = page.locator('button.damon-tab:has-text("Library")')
  await libraryTab.click()
  await page.waitForTimeout(400)

  // Verify Library view is active (chips bar and split layout)
  const libSplit = page.locator('.damon-library-split-root')
  const isLibVisible = await libSplit.isVisible()
  console.log('Library split view visible:', isLibVisible)

  // Type a query in Library tab
  const input = page.locator('.damon-input')
  await input.fill('react')
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/spotlight_library_query.png' })
  console.log('Saved /tmp/spotlight_library_query.png')

  // 4. Test Clean / Compact Search Bar mode
  await input.fill('')
  await page.waitForTimeout(200)
  console.log('Clicking Clean mode toggle...')
  await toggleBtn.click()
  await page.waitForTimeout(400)

  const isCompactNow = await palette.evaluate((el) => el.classList.contains('is-compact'))
  const compactBox = await palette.boundingBox()
  console.log('Has is-compact class:', isCompactNow, 'Height:', compactBox?.height, 'px')
  await page.screenshot({ path: '/tmp/spotlight_compact_clean.png' })
  console.log('Saved /tmp/spotlight_compact_clean.png')

  // Type in compact mode to verify automatic expansion
  await input.fill('discord')
  await page.waitForTimeout(400)
  const expandedBox = await palette.boundingBox()
  console.log('Expanded height when typing in compact mode:', expandedBox?.height, 'px')
  await page.screenshot({ path: '/tmp/spotlight_compact_typing.png' })
  console.log('Saved /tmp/spotlight_compact_typing.png')

  // 4. Test Standalone Spotlight Mode (?spotlight=1)
  console.log('Testing standalone spotlight mode (?spotlight=1)...')
  const spotlightPage = await browser.newPage({ viewport: { width: 1000, height: 750 } })
  await spotlightPage.goto('http://127.0.0.1:8000/?spotlight=1', { waitUntil: 'domcontentloaded' })
  await spotlightPage.waitForTimeout(800)

  const hasAppSidebar = await spotlightPage.locator('.app-sidebar').count()
  const hasWorkbench = await spotlightPage.locator('.wb-frame, .workbench').count()
  const hasSpotlight = await spotlightPage.locator('.palette.damon-spotlight').count()
  const isSpotlightOnlyClass = await spotlightPage.evaluate(() => document.documentElement.classList.contains('spotlight-only-mode'))
  console.log('Standalone mode check:', { hasAppSidebar, hasWorkbench, hasSpotlight, isSpotlightOnlyClass })
  if (hasAppSidebar !== 0 || hasWorkbench !== 0 || hasSpotlight === 0 || !isSpotlightOnlyClass) {
    throw new Error('Standalone spotlight mode failed: app elements detected or spotlight missing!')
  }
  await spotlightPage.screenshot({ path: '/tmp/spotlight_standalone_clean.png' })
  console.log('Saved /tmp/spotlight_standalone_clean.png')

  await browser.close()
  console.log('All spotlight checks finished successfully!')
}

run().catch((err) => {
  console.error('Test error:', err)
  process.exit(1)
})
