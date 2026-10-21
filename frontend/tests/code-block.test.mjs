import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('code-block component exists and contains line numbering and status indicators', () => {
  const code = readFileSync(join(process.cwd(), 'frontend/src/components/agents/code-block.tsx'), 'utf8')
  assert.ok(code.includes('showLineNumbers'))
  assert.ok(code.includes('highlightLines'))
  assert.ok(code.includes('Writing…') || code.includes('streaming'))
})
