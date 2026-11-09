import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appPath = path.resolve(__dirname, '../src/App.jsx')
const chatPath = path.resolve(__dirname, '../src/views/Chat.jsx')
const companionPath = path.resolve(__dirname, '../src/mobile/Companion.jsx')

test('App.jsx wires AppleErrorBanner for oauth expiration events', () => {
  const content = fs.readFileSync(appPath, 'utf8')
  assert.match(content, /import\s+.*AppleErrorBanner.*from/, 'App.jsx must import AppleErrorBanner')
  assert.match(content, /<AppleErrorBanner/, 'App.jsx must render AppleErrorBanner')
  assert.match(content, /amethyst:auth-expired/, 'App.jsx must listen for amethyst:auth-expired event')
})

test('Chat.jsx wires ModelRateLimitCard for 429/rate-limit notes', () => {
  const content = fs.readFileSync(chatPath, 'utf8')
  assert.match(content, /import\s+.*ModelRateLimitCard.*from/, 'Chat.jsx must import ModelRateLimitCard')
  assert.match(content, /<ModelRateLimitCard/, 'Chat.jsx must render ModelRateLimitCard')
})

test('Companion.jsx wires DynamicIslandStatus for transport state', () => {
  const content = fs.readFileSync(companionPath, 'utf8')
  assert.match(content, /import\s+.*DynamicIslandStatus.*from/, 'Companion.jsx must import DynamicIslandStatus')
  assert.match(content, /<DynamicIslandStatus/, 'Companion.jsx must render DynamicIslandStatus')
})

