import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('SplashScreenWizard integrates the 7 modern onboarding screens', () => {
  const content = fs.readFileSync('frontend/src/components/SplashScreenWizard.jsx', 'utf8')
  assert.match(content, /StepSplash/)
  assert.match(content, /StepWelcome/)
  assert.match(content, /StepProfile/)
  assert.match(content, /StepAiEngine/)
  assert.match(content, /StepStorage/)
  assert.match(content, /StepMobile/)
  assert.match(content, /StepLaunch/)
  assert.equal(content.includes('StepCloudflare'), false, 'Should not contain StepCloudflare')
  assert.equal(content.includes('StepMobileShortcuts'), false, 'Should not contain StepMobileShortcuts')
})

test('StepLaunch renders setup summary with verified rows and Open Amethyst CTA', () => {
  const content = fs.readFileSync('frontend/src/components/onboarding/StepLaunch.jsx', 'utf8')
  assert.match(content, /You’re all set|You're all set/)
  assert.match(content, /Open Amethyst/)
  assert.match(content, /Your setup/)
  assert.match(content, /Profile/)
  assert.match(content, /AI engine/)
  assert.match(content, /Storage/)
  assert.match(content, /Mobile/)
})
