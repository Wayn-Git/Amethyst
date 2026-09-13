/* Reading a widget back out of the transcript.
 *
 * This is the half of the widget system that has to be right twice: the
 * backend writes the envelope and this reads it, and a conversation reopened
 * after a restart is rendered entirely from what this function returns. The
 * renderers themselves need a browser and are covered by `smoke.mjs`;
 * `envelope.js` has no React in it so that this file can exist:
 *
 *     npm run test:widgets
 */

import { strict as assert } from 'node:assert'
import { FENCE, parseWidgetEnvelope, WIDGET_TYPES } from '../src/components/widgets/envelope.js'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    failures.push({ name, message: err.message })
  }
}

/** The backend's `to_envelope`, so the two formats are asserted against each
 *  other rather than each against its own idea of the format. */
function envelope(type, data) {
  return '```' + FENCE + '\n' + JSON.stringify({ type, data }, null, 2) + '\n```'
}

const RECIPE = {
  title: 'Pancakes',
  servings: 4,
  ingredients: [{ name: 'flour', amount: 200, unit: 'g' }],
  steps: [{ title: 'Mix', text: 'Combine everything.', timer_seconds: null }],
}

/* ------------------------------------------------------------- the happy path */

test('an envelope round-trips', () => {
  assert.deepEqual(parseWidgetEnvelope(envelope('recipe', RECIPE)), {
    type: 'recipe',
    data: RECIPE,
  })
})

test('every widget type is recognised', () => {
  for (const type of WIDGET_TYPES) {
    const parsed = parseWidgetEnvelope(envelope(type, { any: 'shape' }))
    assert.equal(parsed?.type, type, `${type} was not recognised`)
  }
})

test('surrounding whitespace is tolerated', () => {
  assert.ok(parseWidgetEnvelope('\n\n' + envelope('quiz', { a: 1 }) + '\n  '))
})

/* ------------------------------------------------------------------ prose */

test('ordinary prose is not a widget', () => {
  assert.equal(parseWidgetEnvelope('Here is a recipe for pancakes.'), null)
  assert.equal(parseWidgetEnvelope(''), null)
  assert.equal(parseWidgetEnvelope(null), null)
  assert.equal(parseWidgetEnvelope(undefined), null)
})

test('an ordinary code block is not a widget', () => {
  assert.equal(parseWidgetEnvelope('```json\n{"type":"recipe","data":{}}\n```'), null)
})

test('an answer that merely quotes an envelope is still prose', () => {
  // Otherwise a model explaining the widget format turns its own example into
  // a widget, and the explanation disappears.
  assert.equal(parseWidgetEnvelope('As I was saying:\n\n' + envelope('recipe', RECIPE)), null)
  assert.equal(parseWidgetEnvelope(envelope('recipe', RECIPE) + '\n\nAnd that is that.'), null)
})

/* --------------------------------------------------------------- corruption */

test('a corrupt payload is not a widget', () => {
  assert.equal(parseWidgetEnvelope('```' + FENCE + '\nnot json\n```'), null)
  assert.equal(parseWidgetEnvelope('```' + FENCE + '\n[1,2,3]\n```'), null)
  assert.equal(parseWidgetEnvelope('```' + FENCE + '\nnull\n```'), null)
})

test('an unknown type is not a widget', () => {
  // A build that does not know the type has no renderer for it, and prose is a
  // better answer than an empty box.
  assert.equal(parseWidgetEnvelope(envelope('horoscope', { sign: 'leo' })), null)
})

test('a missing or non-object data is not a widget', () => {
  assert.equal(parseWidgetEnvelope('```' + FENCE + '\n{"type":"recipe"}\n```'), null)
  assert.equal(parseWidgetEnvelope(envelope('recipe', null)), null)
  assert.equal(parseWidgetEnvelope(envelope('recipe', 'a string')), null)
})

test('an unterminated envelope is not a widget', () => {
  // What a half-arrived message looks like. It must not throw.
  const full = envelope('recipe', RECIPE)
  for (let n = 0; n <= full.length; n += 1) {
    assert.doesNotThrow(() => parseWidgetEnvelope(full.slice(0, n)), `prefix of length ${n}`)
  }
})

test('the fence inside a string does not end the envelope', () => {
  const parsed = parseWidgetEnvelope(envelope('translation', { source: '```' + FENCE }))
  assert.equal(parsed?.data.source, '```' + FENCE)
})

/* ---------------------------------------------------------------- report */

for (const f of failures) console.log(`FAIL  ${f.name}\n      ${f.message}`)
console.log(`\n${passed} passed, ${failures.length} failed`)
process.exit(failures.length ? 1 : 0)
