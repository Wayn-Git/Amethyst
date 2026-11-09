import test from 'node:test'
import assert from 'node:assert/strict'
import { EASE_OUT, SPRING_PRESS } from '../src/lib/ease.ts'
import { textShimmerStyle } from '../src/lib/text-shimmer.ts'

test('motion ease tokens define valid cubic-bezier arrays', () => {
  assert.equal(EASE_OUT.length, 4)
  assert.equal(SPRING_PRESS.type, 'spring')
})

test('textShimmerStyle generates correct animation css duration', () => {
  const style = textShimmerStyle(2.0)
  assert.match(style.animation, /2s linear infinite/)
})
