import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateMath } from '../src/components/damon/calculator.js'

test('evaluateMath returns result for standard arithmetic', () => {
  const res = evaluateMath('2 + 2')
  assert.equal(res?.result, '4')
  assert.equal(res?.type, 'math')
})

test('evaluateMath returns result for leading equals', () => {
  const res = evaluateMath('=10 * 5')
  assert.equal(res?.result, '50')
  assert.equal(res?.type, 'math')
})

test('evaluateMath returns error for malformed expression 2+6%6&7', () => {
  const res = evaluateMath('2+6%6&7')
  assert.ok(res, 'Expected a result object for 2+6%6&7')
  assert.equal(res?.type, 'math-error')
  assert.match(res?.error, /unexpected '&'|unsupported operator/i)
})

test('evaluateMath returns error for unmatched parentheses', () => {
  const res = evaluateMath('(2 + 3 * 4')
  assert.ok(res)
  assert.equal(res?.type, 'math-error')
})

test('evaluateMath returns null for plain non-math text', () => {
  const res = evaluateMath('hello world')
  assert.equal(res, null)
})

