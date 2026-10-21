import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('message-bubble exports expected tone variants and collapsible components', () => {
  const code = readFileSync(join(process.cwd(), 'frontend/src/components/agents/message-bubble.tsx'), 'utf8')
  assert.ok(code.includes('MessageBubbleCollapsible'))
  assert.ok(code.includes('variant') && code.includes('soft') && code.includes('solid'))
})

test('message exports MessageGroup and conversational wrappers', () => {
  const code = readFileSync(join(process.cwd(), 'frontend/src/components/agents/message.tsx'), 'utf8')
  assert.ok(code.includes('MessageGroup'))
  assert.ok(code.includes('MessageAvatar'))
  assert.ok(code.includes('MessageContent'))
})
