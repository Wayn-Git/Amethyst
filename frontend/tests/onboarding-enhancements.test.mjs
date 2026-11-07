import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.resolve(__dirname, '../src/components/onboarding')

test('BrandIcon exports and handles brand SVG mappings', () => {
  const brandIconCode = fs.readFileSync(path.join(srcDir, 'BrandIcon.jsx'), 'utf8')
  assert.ok(brandIconCode.includes('COMPOSIO_PATH'), 'Must define official Composio SVG path')
  assert.ok(brandIconCode.includes('SLACK_PATH'), 'Must define official Slack SVG path')
  assert.ok(brandIconCode.includes('siGoogledrive'), 'Must map Google Drive icon')
  assert.ok(brandIconCode.includes('siGithub'), 'Must map GitHub icon')
  assert.ok(brandIconCode.includes('siLinear'), 'Must map Linear icon')
  assert.ok(brandIconCode.includes('siNotion'), 'Must map Notion icon')
  assert.ok(brandIconCode.includes('siGmail'), 'Must map Gmail icon')
  assert.ok(brandIconCode.includes('siGooglecalendar'), 'Must map Google Calendar icon')
  assert.ok(brandIconCode.includes('siSpotify'), 'Must map Spotify icon')
  assert.ok(brandIconCode.includes('siDiscord'), 'Must map Discord icon')
  assert.ok(brandIconCode.includes('siFigma'), 'Must map Figma icon')
  assert.ok(brandIconCode.includes('siJira'), 'Must map Jira icon')
})

test('StepAiEngine uses AiProviderIcon for real brand icons', () => {
  const code = fs.readFileSync(path.join(srcDir, 'StepAiEngine.jsx'), 'utf8')
  assert.ok(code.includes("import AiProviderIcon from '../AiProviderIcon.jsx'"), 'Imports AiProviderIcon')
  assert.ok(code.includes('provider="ollama"'), 'Renders Ollama brand icon')
  assert.ok(code.includes('provider={p.slug}'), 'Renders cloud provider brand icons')
  assert.ok(!code.includes("letter: 'G'"), 'Does not use plain letter placeholders for Groq/Gemini')
  assert.ok(!code.includes("letter: 'K'"), 'Does not use plain letter placeholders for Kilo')
})

test('StepStorage has BrandIcon, expandable 20+ toolkits, and search filter', () => {
  const code = fs.readFileSync(path.join(srcDir, 'StepStorage.jsx'), 'utf8')
  assert.ok(code.includes("import BrandIcon from './BrandIcon.jsx'"), 'Imports BrandIcon')
  assert.ok(code.includes('name="composio"'), 'Composio uses BrandIcon')
  assert.ok(code.includes('name="googledrive"'), 'Google Drive uses BrandIcon')
  assert.ok(code.includes('BASE_TOOLKITS'), 'Defines base toolkits catalog')
  assert.ok(code.includes('isExploring'), 'Has exploration toggle for full toolkit library')
  assert.ok(code.includes('searchQuery'), 'Has search query filter for toolkits')
  assert.ok(code.includes('api.composioToolkits'), 'Queries Composio catalog for dynamic toolkits')
})

test('StepMobile has concentric corner geometry and direct APK download', () => {
  const code = fs.readFileSync(path.join(srcDir, 'StepMobile.jsx'), 'utf8')
  const css = fs.readFileSync(path.join(srcDir, 'onboarding.css'), 'utf8')

  // Concentric segmented tab switcher
  assert.ok(code.includes('onb-tab-group'), 'Uses onb-tab-group container')
  assert.ok(code.includes('onb-tab-btn'), 'Uses onb-tab-btn items')
  assert.ok(css.includes('.onb-tab-group'), 'CSS defines .onb-tab-group')
  assert.ok(css.includes('border-radius: 10px'), 'Container radius is 10px')
  assert.ok(css.includes('border-radius: 7px'), 'Inner button radius is 7px for concentric fit (10px - 3px)')

  // Concentric QR container
  assert.ok(code.includes('onb-qr-wrapper'), 'Uses onb-qr-wrapper')
  assert.ok(code.includes('onb-qr-card'), 'Uses onb-qr-card')
  assert.ok(css.includes('.onb-qr-wrapper'), 'CSS defines .onb-qr-wrapper')
  assert.ok(css.includes('.onb-qr-card'), 'CSS defines .onb-qr-card')

  // Direct APK download link & QR
  assert.ok(code.includes('href="/amethyst-companion.apk"'), 'Download link points directly to APK')
  assert.ok(code.includes('download="amethyst-companion.apk"'), 'Anchor has download attribute for companion APK')
  assert.ok(code.includes('directApkUrl'), 'Derives direct LAN APK URL for phone camera QR')
})
