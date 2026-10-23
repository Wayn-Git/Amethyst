import test from 'node:test'
import assert from 'node:assert/strict'
import { mapEventsToActivityItems } from '../src/components/agents/agent-activity/map-events.js'

test('mapEventsToActivityItems maps searches, tools, and reasoning properly', () => {
  const events = [
    { type: 'thought', text: 'Analyzing requirements' },
    { type: 'tool', call: { name: 'search_web', arguments: { query: 'react performance' } } },
    { type: 'tool', call: { name: 'edit_file', arguments: { TargetFile: 'App.tsx' } } },
  ]
  const items = mapEventsToActivityItems(events)
  assert.equal(items.length, 3)
  assert.equal(items[0].type, 'step')
  assert.equal(items[1].type, 'search')
  assert.equal(items[2].type, 'tool')
  assert.equal(items[2].target, 'App.tsx')
})
