import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('blurred-text does not reference undefined muted-foreground', () => {
  const file = readFileSync(join(process.cwd(), 'frontend/src/components/arc/streaming-text/blurred-text.tsx'), 'utf8')
  assert.equal(file.includes('text-muted-foreground'), false, 'Must not use undefined text-muted-foreground')
  assert.ok(file.includes('var(--text') || file.includes('text-dim') || file.includes('inherit'), 'Must use Amethyst tokens')
})

test('streaming-response component file exists and exports StreamingResponse', () => {
  const file = readFileSync(join(process.cwd(), 'frontend/src/components/agents/streaming-response.tsx'), 'utf8')
  assert.ok(file.includes('StreamingResponse'))
})
