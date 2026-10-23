import { strict as assert } from 'node:assert'

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

const {
  computeApprovalScope,
  formatToolArguments,
} = await import('../src/components/agents/toolApprovalUtils.js')

// 1. Scoped Security Policy
test('computes command prefix scope for terminal commands instead of global wildcard', () => {
  const scope1 = computeApprovalScope('terminal.run', { command: 'bun test tests/a11y.test.tsx' })
  assert.equal(scope1.tool, 'terminal.run')
  assert.equal(scope1.pattern, 'bun test*')
  assert.notEqual(scope1.pattern, '*')

  const scope2 = computeApprovalScope('bash', { CommandLine: 'pytest backend/tests/test_director.py -v' })
  assert.equal(scope2.tool, 'bash')
  assert.equal(scope2.pattern, 'pytest*')

  const scope3 = computeApprovalScope('terminal.run', { command: 'git status' })
  assert.equal(scope3.pattern, 'git status*')
})

test('computes directory prefix scope for filesystem mutations instead of root wildcard', () => {
  const scope = computeApprovalScope('filesystem.write', { path: '/home/wayne/Documents/GitHub/amethyst/frontend/src/App.jsx' })
  assert.equal(scope.tool, 'filesystem.write')
  assert.ok(scope.pathPrefix.includes('frontend/src'))
  assert.notEqual(scope.pathPrefix, '/')
})

test('computes strict tool scope for generic API tools', () => {
  const scope = computeApprovalScope('web_search', { query: 'test' })
  assert.equal(scope.tool, 'web_search')
})

// 2. Argument formatting for details view
test('formats terminal arguments extracting command and directory', () => {
  const details = formatToolArguments('terminal.run', {
    command: 'bun test tests/a11y.test.tsx',
    directory: 'ui-components',
  })
  assert.equal(details.command, 'bun test tests/a11y.test.tsx')
  assert.equal(details.directory, 'ui-components')
})

test('formats filesystem arguments extracting path and content preview', () => {
  const details = formatToolArguments('filesystem.write', {
    path: 'frontend/src/test.js',
    content: 'console.log("hello")',
  })
  assert.equal(details.path, 'frontend/src/test.js')
  assert.ok(details.contentPreview)
})

console.log(`\nToolApprovalCard tests completed: ${passed} passed, ${failures.length} failed.`)
if (failures.length > 0) {
  process.exit(1)
}
