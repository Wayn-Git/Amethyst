import test from 'node:test'
import assert from 'node:assert/strict'
import { formatQuestionSubmission } from '../src/components/agents/approval-card/format-submission.js'

test('formatQuestionSubmission correctly formats answers array for api', () => {
  const answers = {
    'q-0': { value: 'opt-1', label: 'Use TypeScript' },
    'q-1': ['auth', 'billing'],
    'q-2': 'Custom user preference'
  }
  const result = formatQuestionSubmission(answers)
  assert.deepEqual(result, ['Use TypeScript', 'auth, billing', 'Custom user preference'])
})

test('formatQuestionSubmission handles empty or skipped entries', () => {
  const answers = {
    'q-0': null,
    'q-1': { status: 'skipped' },
    'q-2': [{ label: 'Option A' }, { value: 'Option B' }]
  }
  const result = formatQuestionSubmission(answers)
  assert.deepEqual(result, ['[No Preference]', '[No Preference]', 'Option A, Option B'])
})
