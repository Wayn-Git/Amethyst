import { strict as assert } from 'node:assert'

// Test runner for agent stage state machine
let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    failures.push({ name, error: err })
    console.error(`FAIL: ${name}`)
    console.error(err)
  }
}

// Dynamic import of target module under test
const {
  WEB_TOOLS,
  PHRASE_POOLS,
  classifyTool,
  computeAgentStage,
  StageEngine,
} = await import('../src/hooks/agentStageCore.js')

// 1. Web Tool Classification
test('classifies explicit web tools as searching', () => {
  assert.equal(classifyTool('web_search'), 'searching')
  assert.equal(classifyTool('search_web'), 'searching')
  assert.equal(classifyTool('fetch_web_page'), 'searching')
  assert.equal(classifyTool('browser_navigate'), 'searching')
})

test('classifies grep and local files as generic tool, not web search', () => {
  assert.equal(classifyTool('grep'), 'tool')
  assert.equal(classifyTool('grep_search'), 'tool')
  assert.equal(classifyTool('code_search'), 'tool')
  assert.equal(classifyTool('read_file'), 'tool')
})

test('classifies connectors as generic tool', () => {
  assert.equal(classifyTool('gmail_send'), 'tool')
  assert.equal(classifyTool('composio_action'), 'tool')
  assert.equal(classifyTool('mcp__server__tool'), 'tool')
})

// 2. Stage Derivation
test('derives waiting_approval stage when awaiting approval', () => {
  const stage = computeAgentStage({
    running: true,
    status: { state: 'awaiting_approval' },
  })
  assert.equal(stage, 'waiting_approval')
})

test('derives reconnecting stage when reconnecting or retrying', () => {
  assert.equal(computeAgentStage({ running: true, status: { state: 'reconnecting' } }), 'reconnecting')
  assert.equal(computeAgentStage({ running: true, status: { state: 'retrying' } }), 'reconnecting')
})

test('derives error stage when error object is provided', () => {
  assert.equal(computeAgentStage({ running: true, error: new Error('boom') }), 'error')
})

test('derives searching when live tool is in WEB_TOOLS', () => {
  assert.equal(computeAgentStage({ running: true, liveTool: { name: 'web_search' } }), 'searching')
})

test('derives tool when live tool is generic', () => {
  assert.equal(computeAgentStage({ running: true, liveTool: { name: 'terminal.run' } }), 'tool')
})

test('derives writing_answer when liveBuffer is streaming and tool is null', () => {
  assert.equal(computeAgentStage({ running: true, liveBuffer: 'Hello world' }), 'writing_answer')
})

test('derives reasoning when liveReasoning is present or status is thinking', () => {
  assert.equal(computeAgentStage({ running: true, liveReasoning: 'Let me think...' }), 'reasoning')
  assert.equal(computeAgentStage({ running: true, status: { state: 'thinking' } }), 'reasoning')
})

// 3. StageEngine Phrase Rotation & Delay
test('starts rotating only after 3s in the same stage, then every 3.5s', () => {
  let currentTime = 10000
  const engine = new StageEngine(() => currentTime)
  engine.setStage('reasoning')

  const initialPhrase = engine.getDisplayLabel()
  assert.ok(PHRASE_POOLS.reasoning.includes(initialPhrase))

  // At 2s (delta < 3s): must not rotate
  currentTime += 2000
  engine.tick()
  assert.equal(engine.getDisplayLabel(), initialPhrase)

  // At 3.2s: first rotation eligible
  currentTime += 1200
  engine.tick()
  const secondPhrase = engine.getDisplayLabel()
  assert.notEqual(secondPhrase, initialPhrase)

  // At 5.0s (less than 3.5s interval): must not rotate again
  currentTime += 1800
  engine.tick()
  assert.equal(engine.getDisplayLabel(), secondPhrase)

  // At 6.8s (3.6s after last rotation): rotates
  currentTime += 1800
  engine.tick()
  const thirdPhrase = engine.getDisplayLabel()
  assert.notEqual(thirdPhrase, secondPhrase)
})

test('exhausts all phrases in a pool before repeating and avoids consecutive repeats', () => {
  let currentTime = 10000
  const engine = new StageEngine(() => currentTime)
  engine.setStage('reasoning')
  engine.setLastEventAt(currentTime)

  const poolSize = PHRASE_POOLS.reasoning.length
  const seen = new Set()
  let prev = null

  for (let i = 0; i < poolSize; i++) {
    const phrase = engine.getDisplayLabel()
    assert.ok(PHRASE_POOLS.reasoning.includes(phrase))
    assert.notEqual(phrase, prev)
    seen.add(phrase)
    prev = phrase
    currentTime += 4000
    engine.setLastEventAt(currentTime)
    engine.tick()
  }

  // Entire pool must have been exhausted
  assert.equal(seen.size, poolSize)
})

// 4. Stall Monitor & Slow Tool Handling
test('stall monitor triggers at 15s and 20s of silence during reasoning', () => {
  let currentTime = 10000
  const engine = new StageEngine(() => currentTime)
  engine.setStage('reasoning')
  engine.setLastEventAt(currentTime)

  // Advance 14s
  currentTime += 14000
  engine.tick()
  assert.ok(!engine.getDisplayLabel().includes('Still working'))
  assert.ok(!engine.getDisplayLabel().includes('Provider seems slow'))

  // Advance to 16s
  currentTime += 2000
  engine.tick()
  assert.equal(engine.getDisplayLabel(), 'Still working...')

  // Advance to 21s
  currentTime += 5000
  engine.tick()
  assert.equal(engine.getDisplayLabel(), 'Provider seems slow')
})

test('slow tool displays "Still running <tool>" instead of generic stall', () => {
  let currentTime = 10000
  const engine = new StageEngine(() => currentTime)
  engine.setStage('tool', { name: 'test_suite_runner' })
  engine.setLastEventAt(currentTime)

  // Under 10s: normal tool phrase
  currentTime += 8000
  engine.tick()
  assert.ok(!engine.getDisplayLabel().startsWith('Still running'))

  // Over 10s: must display Still running test_suite_runner
  currentTime += 3000
  engine.tick()
  assert.equal(engine.getDisplayLabel(), 'Still running test_suite_runner')
})

test('suspends stall monitor during waiting_approval and reconnecting', () => {
  let currentTime = 10000
  const engine = new StageEngine(() => currentTime)
  engine.setStage('waiting_approval')
  engine.setLastEventAt(currentTime)

  // Advance 30s
  currentTime += 30000
  engine.tick()
  assert.equal(engine.getDisplayLabel(), 'Waiting for your approval')

  // Switch to reconnecting
  engine.setStage('reconnecting')
  currentTime += 30000
  engine.tick()
  assert.equal(engine.getDisplayLabel(), 'Reconnecting to provider...')
})

// 5. Timer Formatting & Pausing during waiting_approval
test('timer displays strictly at 10s+ and pauses during waiting_approval', () => {
  let currentTime = 10000
  const engine = new StageEngine(() => currentTime)
  engine.startTurn(currentTime)
  engine.setStage('reasoning')

  // At 5s: showTimer must be false
  currentTime += 5000
  engine.tick()
  assert.equal(engine.getElapsedSeconds(), 5)
  assert.equal(engine.shouldShowTimer(), false)

  // At 10s: showTimer must be true
  currentTime += 5000
  engine.tick()
  assert.equal(engine.getElapsedSeconds(), 10)
  assert.equal(engine.shouldShowTimer(), true)

  // Pause turn during waiting_approval
  engine.setStage('waiting_approval')
  currentTime += 20000 // user takes 20s to decide
  engine.tick()

  // Elapsed time must NOT have advanced during approval wait
  assert.equal(engine.getElapsedSeconds(), 10)

  // Resume turn into tool execution
  engine.setStage('tool', { name: 'bun_test' })
  currentTime += 5000
  engine.tick()
  assert.equal(engine.getElapsedSeconds(), 15)
})

console.log(`\nTests completed: ${passed} passed, ${failures.length} failed.`)
if (failures.length > 0) {
  process.exit(1)
}
