import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(new URL('.', import.meta.url).pathname, '..')

console.log('--- Verifying Theme Color System Integrity ---')

// 1. Verify store.jsx definitions
const storeContent = readFileSync(join(ROOT, 'src/store.jsx'), 'utf-8')
assert(storeContent.includes("export const THEMES = ['system', 'graphite', 'ink', 'nocturne', 'nvidia', 'paper', 'sand', 'claude', 'cursor']"), 'store.jsx: THEMES array invalid')
assert(storeContent.includes("export const DARK_THEMES = ['graphite', 'ink', 'nocturne', 'nvidia']"), 'store.jsx: DARK_THEMES array invalid')
assert(storeContent.includes("export const LIGHT_THEMES = ['paper', 'sand', 'claude', 'cursor']"), 'store.jsx: LIGHT_THEMES array invalid')
assert(storeContent.includes("root.setAttribute('data-theme-mode', isDark ? 'dark' : 'light')"), 'store.jsx: data-theme-mode missing')
assert(storeContent.includes("--color-accent-50"), 'store.jsx: BoardUI accent ramp 50 missing')
assert(storeContent.includes("--color-accent-500"), 'store.jsx: BoardUI accent ramp 500 missing')
assert(storeContent.includes("--color-accent-950"), 'store.jsx: BoardUI accent ramp 950 missing')
console.log('✓ store.jsx: Theme and accent ramp contracts verified')

// 2. Verify index.css palettes and selectors
const cssContent = readFileSync(join(ROOT, 'src/index.css'), 'utf-8')
const requiredPalettes = ['graphite', 'ink', 'nocturne', 'nvidia', 'paper', 'sand', 'claude', 'cursor']
for (const theme of requiredPalettes) {
  assert(cssContent.includes(`:root[data-theme='${theme}']`), `index.css: missing :root[data-theme='${theme}']`)
}
const legacyPalettes = [":root[data-theme='apple']", ":root[data-theme='anthropic']", ":root[data-theme='cohere']", ":root[data-theme='sunshine']", ":root[data-theme='stripe']"]
for (const legacy of legacyPalettes) {
  assert(!cssContent.includes(legacy), `index.css: contains unexpected legacy theme selector ${legacy}`)
}
assert(!cssContent.includes("[data-theme='light']"), "index.css: stale [data-theme='light'] found")
assert(!cssContent.includes('[data-theme="light"]'), 'index.css: stale [data-theme="light"] found')
assert(!cssContent.includes("[data-theme='dark']"), "index.css: stale [data-theme='dark'] found")
console.log('✓ index.css: 8 curated palettes declared and mode selectors unified')

// 3. Verify Settings.jsx
const settingsContent = readFileSync(join(ROOT, 'src/views/Settings.jsx'), 'utf-8')
for (const theme of requiredPalettes) {
  assert(settingsContent.includes(`id: '${theme}'`), `Settings.jsx: missing ${theme} in THEME_CHOICES`)
}
console.log('✓ Settings.jsx: All 8 curated themes present in THEME_CHOICES and mockups')

// 4. Verify CommandPalette.jsx
const cmdContent = readFileSync(join(ROOT, 'src/components/CommandPalette.jsx'), 'utf-8')
for (const theme of requiredPalettes) {
  assert(cmdContent.includes(`id: '${theme}'`), `CommandPalette.jsx: missing ${theme} in THEMES`)
}
console.log('✓ CommandPalette.jsx: All 8 curated themes present')

// 5. Verify OnboardingWizard.jsx & SplashScreenWizard.jsx
const obContent = readFileSync(join(ROOT, 'src/components/OnboardingWizard.jsx'), 'utf-8')
for (const theme of requiredPalettes) {
  assert(obContent.includes(`id: '${theme}'`), `OnboardingWizard.jsx: missing ${theme}`)
}
const splashContent = readFileSync(join(ROOT, 'src/components/SplashScreenWizard.jsx'), 'utf-8')
for (const theme of requiredPalettes) {
  assert(splashContent.includes(`id: '${theme}'`), `SplashScreenWizard.jsx: missing ${theme}`)
}
console.log('✓ OnboardingWizard & SplashScreenWizard: Theme choices aligned')

// 6. Verify Skiper26.jsx
const skiperContent = readFileSync(join(ROOT, 'src/components/ui/skiper/Skiper26.jsx'), 'utf-8')
assert(skiperContent.includes("[data-theme-mode='dark']::view-transition-new(root)"), 'Skiper26.jsx: data-theme-mode transition missing')
assert(skiperContent.includes("const DARK_THEMES = ['graphite', 'ink', 'nocturne', 'nvidia']"), 'Skiper26.jsx: DARK_THEMES mismatch')
console.log('✓ Skiper26.jsx: View transition CSS and dark theme list aligned')

// 7. Verify nexus-ui questions and featured-icon
const questionsContent = readFileSync(join(ROOT, 'src/components/nexus-ui/questions.tsx'), 'utf-8')
assert(!questionsContent.includes('border-purple-500'), 'questions.tsx: contains hardcoded border-purple-500')
assert(!questionsContent.includes('bg-purple-600'), 'questions.tsx: contains hardcoded bg-purple-600')
assert(questionsContent.includes('accent'), 'questions.tsx: semantic accent token missing')

const iconContent = readFileSync(join(ROOT, 'src/components/foundations/featured-icon/featured-icon.tsx'), 'utf-8')
assert(!iconContent.includes('bg-purple-500/15 text-purple-400'), 'featured-icon.tsx: hardcoded purple brand class found')
assert(iconContent.includes('bg-accent-500/15 text-accent-500'), 'featured-icon.tsx: accent brand class missing')
console.log('✓ nexus-ui questions and featured-icon: bound to semantic accent')

console.log('\nAll Theme Color System assertions passed successfully! 🚀')
