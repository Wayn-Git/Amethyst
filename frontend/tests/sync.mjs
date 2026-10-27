/* The phone's half of the merge.
 *
 * `backend/sync/ops.py` and `src/lib/sync/replica.js` implement one rule in two
 * languages, and a phone that merged differently would converge to a different
 * answer with nothing anywhere reporting it. The crypto side of that pairing is
 * covered by `tests/test_sync_interop.py`, which seals in each language and
 * opens in the other; this covers the merge and the projection into the
 * preference blob the rest of the interface reads:
 *
 *     npm run test:sync
 */

import { strict as assert } from 'node:assert'

const store = new Map()
globalThis.window = { localStorage: {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}}
globalThis.localStorage = globalThis.window.localStorage

const { Clock, wins, formatStamp } = await import('../src/lib/sync/hlc.js')
const replica = await import('../src/lib/sync/replica.js')
const client = await import('../src/lib/sync/client.js')
const { projectPreferences } = client
const remote = await import('../src/lib/sync/remote.js')

let passed = 0
const failures = []

function test(name, fn) {
  store.clear()
  try { fn(); passed += 1 } catch (err) { failures.push({ name, message: err.message }) }
}

const op = (id, hlc, key, fields, entity = 'settings') =>
  ({ op_id: id, hlc, entity, key, fields })

// -- the clock ----------------------------------------------------------

test('stamps rise even when the wall clock does not', () => {
  const clock = new Clock('dev-a', () => 1000)
  const stamps = Array.from({ length: 20 }, () => clock.tick())
  assert.deepEqual(stamps, [...stamps].sort())
})

test('a wall clock stepping backwards does not rewind the order', () => {
  const ticks = [5000, 4000, 3000, 4500, 6000][Symbol.iterator]()
  const clock = new Clock('dev-a', () => ticks.next().value)
  const stamps = Array.from({ length: 5 }, () => clock.tick())
  assert.deepEqual(stamps, [...stamps].sort())
})

test('observing a stamp from ahead carries the clock forward', () => {
  const clock = new Clock('dev-b', () => 1000)
  const ahead = formatStamp(9_000_000, 0, 'dev-a')
  assert.ok(clock.observe(ahead) > ahead)
})

test('device id makes the order total', () => {
  const a = formatStamp(1000, 0, 'dev-a')
  const b = formatStamp(1000, 0, 'dev-b')
  assert.ok(wins(b, a) && !wins(a, b))
  assert.ok(!wins(a, a), 'a tie must not overwrite, so replay is free')
})

// -- the merge ----------------------------------------------------------

test('an op applies', () => {
  const state = replica.load()
  assert.equal(replica.apply(state, op('op-1', formatStamp(1, 0, 'a'), 'ui.theme', { value: 'ink' })), true)
  assert.deepEqual(replica.read(state, 'settings', 'ui.theme'), { value: 'ink' })
})

test('a redelivered op is refused', () => {
  const state = replica.load()
  const one = op('op-1', formatStamp(1, 0, 'a'), 'ui.theme', { value: 'ink' })
  assert.equal(replica.apply(state, one), true)
  assert.equal(replica.apply(state, one), false)
})

test('a stale op does not overwrite a newer field', () => {
  const state = replica.load()
  replica.apply(state, op('late', formatStamp(9, 0, 'a'), 'ui.theme', { value: 'ink' }))
  replica.apply(state, op('early', formatStamp(1, 0, 'a'), 'ui.theme', { value: 'paper' }))
  assert.deepEqual(replica.read(state, 'settings', 'ui.theme'), { value: 'ink' })
})

test('replicas converge whatever order ops arrive in', () => {
  const made = [
    op('o1', formatStamp(1, 0, 'a'), 'ui.theme', { value: 'ink' }),
    op('o2', formatStamp(2, 0, 'b'), 'ui.theme', { value: 'paper' }),
    op('o3', formatStamp(2, 0, 'a'), 'ui.sendWith', { value: 'enter' }),
    op('o4', formatStamp(3, 0, 'c'), 'ui.theme', { value: 'sand' }),
    op('o5', formatStamp(1, 5, 'b'), 'ui.sendWith', { value: 'mod+enter' }),
  ]
  const orderings = [made, [...made].reverse(), [made[3], made[0], made[4], made[1], made[2]]]
  const results = orderings.map((ordering) => {
    store.clear()
    const state = replica.load()
    for (const o of ordering) replica.apply(state, o)
    // Compared by sorted entries, not by raw JSON: object key order follows
    // insertion, so three replicas holding identical values still serialise
    // differently. That is not divergence, and asserting on it would be
    // asserting on the arrival order the test is meant to prove irrelevant.
    const rows = replica.readAll(state, 'settings')
    return JSON.stringify(Object.keys(rows).sort().map((k) => [k, rows[k]]))
  })
  assert.equal(new Set(results).size, 1, `diverged: ${results.join(' vs ')}`)
})

test('concurrent edits to different fields both survive', () => {
  const state = replica.load()
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'task-1', { title: 'renamed' }, 'tasks'))
  replica.apply(state, op('o2', formatStamp(1, 0, 'b'), 'task-1', { due_at: '2026-01-01' }, 'tasks'))
  assert.deepEqual(replica.read(state, 'tasks', 'task-1'), { title: 'renamed', due_at: '2026-01-01' })
})

test('a local change is recorded and stamped', () => {
  const state = replica.load()
  const made = replica.emit(state, new Clock('phone', () => 1000), 'settings', 'ui.theme', { value: 'ink' })
  assert.equal(made.entity, 'settings')
  assert.deepEqual(replica.read(state, 'settings', 'ui.theme'), { value: 'ink' })
})

// -- what the interface actually reads ----------------------------------

test('synced preferences reach the preference blob', () => {
  const state = replica.load()
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'ui.theme', { value: 'nocturne' }))
  replica.save(state)
  assert.deepEqual(projectPreferences(), { theme: 'nocturne' })
  assert.equal(JSON.parse(localStorage.getItem('amethyst.ui.v1')).theme, 'nocturne')
})

test('device-local preferences are left alone', () => {
  // The whole point of the allowlist: a phone and a laptop should not agree on
  // panel width, and syncing one onto the other is a bug rather than a feature.
  localStorage.setItem('amethyst.ui.v1', JSON.stringify({ panelWidth: 372, theme: 'paper' }))
  const state = replica.load()
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'ui.theme', { value: 'nocturne' }))
  replica.save(state)
  projectPreferences()
  const after = JSON.parse(localStorage.getItem('amethyst.ui.v1'))
  assert.equal(after.panelWidth, 372)
  assert.equal(after.theme, 'nocturne')
})

test('a boolean does not come back as the string "false"', () => {
  // "false" is truthy. Without the restore step this silently inverted every
  // confirmation setting on the phone.
  localStorage.setItem('amethyst.ui.v1', JSON.stringify({ confirmDestructive: true }))
  const state = replica.load()
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'ui.confirmDestructive', { value: 'false' }))
  replica.save(state)
  projectPreferences()
  assert.equal(JSON.parse(localStorage.getItem('amethyst.ui.v1')).confirmDestructive, false)
})

// -- the outbox ---------------------------------------------------------

test('a local request is queued for sending', () => {
  localStorage.setItem('amethyst.sync.identity.v1', JSON.stringify({
    deviceId: 'phone', token: 't', relayUrl: 'https://r', name: 'p',
  }))
  assert.equal(client.queued(), 0)
  client.change('intents', 'i1', { kind: 'turn', state: 'pending' })
  assert.equal(client.queued(), 1)
})

test('the outbox is bounded', () => {
  // A phone on a train queues what it is asked to. What it must not do is queue
  // for a week and then ask the machine to run two hundred stale turns.
  localStorage.setItem('amethyst.sync.identity.v1', JSON.stringify({
    deviceId: 'phone', token: 't', relayUrl: 'https://r', name: 'p',
  }))
  for (let i = 0; i < 260; i++) client.change('intents', `i${i}`, { kind: 'turn' })
  const held = client.queued()
  assert.ok(held <= 200, `outbox grew to ${held}`)
  const outbox = JSON.parse(localStorage.getItem('amethyst.sync.outbox.v1'))
  assert.equal(outbox[outbox.length - 1].key, 'i259', 'the newest must be the ones kept')
})

test('a change made before pairing is not queued', () => {
  assert.equal(client.change('intents', 'i1', { kind: 'turn' }), null)
  assert.equal(client.queued(), 0)
})

// -- reading the replica the way the views do ---------------------------

test('the transcript is ordered by the write order, not the timestamp', () => {
  // The bug this guards: created_at is second-precision, a turn writes the
  // question and the answer inside one second, and the tiebreak used to be a
  // random uuid -- so the answer rendered above the question about half the time.
  const state = replica.load()
  const at = '2026-09-16 12:00:00'
  replica.apply(state, op('o2', formatStamp(2, 0, 'a'), 'm-b',
    { conversation_id: 'c1', role: 'assistant', content: 'an answer', created_at: at, seq: 2 }, 'messages'))
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'm-a',
    { conversation_id: 'c1', role: 'user', content: 'a question', created_at: at, seq: 1 }, 'messages'))
  replica.save(state)
  assert.deepEqual(remote.messages('c1').map((m) => m.content), ['a question', 'an answer'])
})

test('archived conversations are not listed', () => {
  const state = replica.load()
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'c1', { title: 'Live', archived: 0 }, 'conversations'))
  replica.apply(state, op('o2', formatStamp(1, 0, 'a'), 'c2', { title: 'Gone', archived: 1 }, 'conversations'))
  replica.save(state)
  assert.deepEqual(remote.conversations().map((c) => c.title), ['Live'])
})

test('a run still going is reported so the phone can say so', () => {
  const state = replica.load()
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'r1',
    { conversation_id: 'c1', phase: 'reasoning' }, 'agent_runs'))
  replica.save(state)
  assert.equal(remote.runPhase('c1'), 'reasoning')
})

test('a finished run is not reported as live', () => {
  const state = replica.load()
  replica.apply(state, op('o1', formatStamp(1, 0, 'a'), 'r1',
    { conversation_id: 'c1', phase: 'completed' }, 'agent_runs'))
  replica.save(state)
  assert.equal(remote.runPhase('c1'), null)
})

// -- what a device with no backend shows -------------------------------
//
// The routing decision in App.jsx, as a table. The bug being guarded against
// is the one that shipped: a phone rendered the boot screen, waited ninety
// seconds for a server behind somebody's router, and stranded the pairing
// controls inside a Settings page it could never reach.

function screenFor({ phase, verified, paired, remoteFirst, phone, forceDesktop }) {
  // Form factor first, and before reachability. A phone is never the machine,
  // whether or not a backend answers it.
  if (phone && !forceDesktop) return paired ? 'remote' : 'pair'
  if (phase === 'ready' && verified) return 'workbench'
  if (paired) return 'remote'
  if (phase === 'down' || remoteFirst) return 'pair'
  return 'boot'
}

test('a phone on the same network as the machine still gets the remote control', () => {
  // The bug this whole screen exists to prevent, in its second form. The first
  // was a phone with no backend being shown a boot spinner forever. This is a
  // phone WITH one: at home the server answers, `verified` goes true, and the
  // old rule handed a four-column desktop workbench to a 390px screen.
  assert.equal(screenFor({ phase: 'ready', verified: true, paired: true, phone: true }), 'remote')
  assert.equal(screenFor({ phase: 'ready', verified: true, paired: false, phone: true }), 'pair')
})

test('a phone that asked for the workbench anyway gets it', () => {
  assert.equal(
    screenFor({ phase: 'ready', verified: true, paired: true, phone: true, forceDesktop: true }),
    'workbench',
  )
})

test('a desktop window dragged narrow is not a phone', () => {
  // `useCompact` handles that case by turning the rail into a drawer. Narrow is
  // not the same question as handheld, and answering it the same way would
  // throw away somebody's workbench because they resized a window.
  assert.equal(screenFor({ phase: 'ready', verified: true, paired: true, phone: false }), 'workbench')
})

test('a paired phone goes straight to remote, without waiting for a wake', () => {
  assert.equal(screenFor({ phase: 'waking', paired: true }), 'remote')
  assert.equal(screenFor({ phase: 'down', paired: true }), 'remote')
})

test('an optimistic ready is not mistaken for a reachable backend', () => {
  // The bug that made every other case here unreachable: `phase` opens at
  // 'ready' before anything has been asked, so a phone rendered the whole
  // workbench and let each fetch fail on its own.
  assert.equal(screenFor({ phase: 'ready', verified: false, paired: true }), 'remote')
  assert.equal(screenFor({ phase: 'ready', verified: false, paired: false }), 'boot')
  assert.equal(screenFor({ phase: 'ready', verified: true, paired: true }), 'workbench')
})

test('an unpaired device whose backend never answers is offered pairing', () => {
  assert.equal(screenFor({ phase: 'down', verified: false, paired: false }), 'pair')
})

test('asking to pair does not require waiting out the wake', () => {
  assert.equal(screenFor({ phase: 'waking', verified: false, paired: false, remoteFirst: true }), 'pair')
})

test('a laptop whose server is merely slow still sees the boot screen', () => {
  // The case that must not regress into a pairing prompt: a real machine three
  // seconds into a cold start is booting, not unpaired.
  assert.equal(screenFor({ phase: 'waking', verified: false, paired: false }), 'boot')
})

test('a verified backend always wins', () => {
  assert.equal(screenFor({ phase: 'ready', verified: true, paired: true }), 'workbench')
  assert.equal(screenFor({ phase: 'ready', verified: true, paired: false }), 'workbench')
})

// -- what a phone was handed ---------------------------------------------
//
// The parser is the whole zero-typing claim. If it drops the relay address the
// person is back to typing a workers.dev URL on a phone keyboard, which is the
// step this flow exists to remove.

const { readPayload } = client

test('a link a camera opened carries both halves', () => {
  const read = readPayload(
    'https://amethyst.example.com/pair#s=ABCD2345EFGH6789ABCD2345EFGH6789'
    + '&r=https%3A%2F%2Frelay.workers.dev',
  )
  assert.equal(read.secret, 'ABCD2345EFGH6789ABCD2345EFGH6789')
  assert.equal(read.relayUrl, 'https://relay.workers.dev')
})

test('the scheme fallback carries both halves too', () => {
  const read = readPayload(
    'amethyst://pair?s=ABCD2345EFGH6789ABCD2345EFGH6789&r=https%3A%2F%2Frelay.workers.dev',
  )
  assert.equal(read.secret, 'ABCD2345EFGH6789ABCD2345EFGH6789')
  assert.equal(read.relayUrl, 'https://relay.workers.dev')
})

test('a code read off a screen and typed still works', () => {
  // Grouped in fours is how the machine prints it, and lower case is how a
  // phone keyboard offers it. Refusing either would be picking a fight over
  // punctuation with somebody already doing the tedious version.
  const read = readPayload('abcd2345 efgh6789 abcd2345 efgh6789')
  assert.equal(read.secret, 'ABCD2345EFGH6789ABCD2345EFGH6789')
  assert.equal(read.relayUrl, '')
})

test('an older machine\'s payload, with no relay in it, still yields a secret', () => {
  assert.equal(
    readPayload('amethyst://pair?s=ABCD2345EFGH6789ABCD2345EFGH6789').secret,
    'ABCD2345EFGH6789ABCD2345EFGH6789',
  )
})

test('nothing in, nothing out', () => {
  assert.deepEqual(readPayload(''), { secret: '', relayUrl: '' })
  assert.deepEqual(readPayload(null), { secret: '', relayUrl: '' })
  assert.deepEqual(readPayload(undefined), { secret: '', relayUrl: '' })
})

test('a trailing slash on the relay does not survive into the identity', () => {
  // It is concatenated with `/pair` and `/ops`, so a double slash here is a
  // 404 at the relay rather than a cosmetic problem.
  assert.equal(readPayload('amethyst://pair?s=AAAA&r=https%3A%2F%2Fr.dev%2F').relayUrl, 'https://r.dev')
})

if (failures.length) {
  for (const f of failures) console.error(`FAIL  ${f.name}\n      ${f.message}`)
  console.error(`\n${passed} passed, ${failures.length} failed`)
  process.exit(1)
}
console.log(`${passed} passed`)
