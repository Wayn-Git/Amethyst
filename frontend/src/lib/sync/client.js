/**
 * The phone's side of the relay.
 *
 * Two things happen here: pairing once, and then a poll that exchanges sealed
 * ops. Neither talks to the machine directly -- a laptop has no public address
 * and is usually asleep -- so both go through the Worker, which carries what it
 * cannot read.
 *
 * The discipline is `RelayPoller`'s, deliberately, because the failure it
 * guards against is the same one: ops taken on one poll are acknowledged on the
 * *next*, so a browser tab closed between applying and acknowledging gets them
 * again rather than losing them. Taking an op twice costs nothing -- the replica
 * refuses the second -- and losing one is silent and permanent.
 *
 * The outbox is emptied only after the relay has confirmed storing it, for the
 * same reason and in the same place.
 */

import { safeStorage } from '../storage.js'
import { pairKey, seal, unseal, unb64 } from './crypto.js'
import { forgetGroupKey, groupKey, storeGroupKey } from './keystore.js'
import { Clock } from './hlc.js'
import * as replica from './replica.js'

const IDENTITY_KEY = 'amethyst.sync.identity.v1'
const OUTBOX_KEY = 'amethyst.sync.outbox.v1'

/**
 * How many unsent requests a phone will hold.
 *
 * A phone on a train queues what it is asked to and sends it when it can, which
 * is the point. What it must not do is queue for a week and then, on
 * reconnecting, ask the machine to run two hundred turns nobody is waiting for
 * any more -- so the oldest are dropped, and the newest, which is what somebody
 * most recently meant, are kept.
 */
const OUTBOX_LIMIT = 200

/** How long to wait for the machine to answer a pairing offer. It answers on
 *  its next relay poll, which is every fifteen seconds when it is awake. */
const PAIR_TIMEOUT_MS = 120_000
const PAIR_INTERVAL_MS = 3_000

export function identity() {
  try {
    const raw = safeStorage.getItem(IDENTITY_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function paired() {
  const held = identity()
  // The key itself is not checked here: it lives in IndexedDB and reading it is
  // asynchronous, while every caller of this is a render. `sync()` checks it,
  // which is the only place its absence can actually be acted on.
  return Boolean(held?.deviceId && held?.token && held?.relayUrl)
}

export async function forget() {
  safeStorage.removeItem(IDENTITY_KEY)
  safeStorage.removeItem(OUTBOX_KEY)
  // The merged transcript goes too. It is the unpaired machine's, and a device
  // that pairs with a different one next would otherwise open on somebody
  // else's conversations.
  replica.clear()
  // Awaited: the IndexedDB delete is the part that outlives the tab, and a
  // caller that navigates straight to the pairing screen used to race it.
  await forgetGroupKey()
}

function outbox() {
  try {
    return JSON.parse(safeStorage.getItem(OUTBOX_KEY) || '[]')
  } catch {
    return []
  }
}

function setOutbox(ops) {
  const kept = ops.length > OUTBOX_LIMIT ? ops.slice(-OUTBOX_LIMIT) : ops
  safeStorage.setItem(OUTBOX_KEY, JSON.stringify(kept))
}

/** How many requests are waiting to go out. Shown, so a phone with no signal
 *  says so rather than looking like one that has nothing to say. */
export function queued() {
  return outbox().length
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/**
 * Read whatever somebody scanned, tapped or typed.
 *
 * The machine prints one of two things depending on whether it knows where this
 * app is hosted: an `https://…/pair#s=…&r=…` link, which a phone's own camera
 * app opens directly, or an `amethyst://pair?s=…&r=…` fallback that only this
 * scanner and the clipboard can act on. Both carry the relay address alongside
 * the secret, which is what removes the field somebody used to have to type.
 *
 * The secret rides in the *fragment* of the https form on purpose: a fragment
 * is never sent to a server, so it stays out of access logs and out of the
 * `Referer` of anything the page loads afterwards.
 *
 * A bare code is still accepted. Somebody reading the grouped text off a screen
 * types the part that looks like "the code", and refusing that would be picking
 * a fight over punctuation.
 */
export function readPayload(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { secret: '', relayUrl: '' }

  let fields = null
  try {
    const url = new URL(raw)
    // The https form carries them after the `#`, the custom-scheme form after
    // the `?`. Try the fragment first and fall back, rather than branching on
    // the protocol -- it is the same two names either way.
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    const fromHash = new URLSearchParams(hash)
    fields = fromHash.get('s') ? fromHash : url.searchParams
  } catch {
    // Not a URL. Either a bare code, or the `s=…` tail of one somebody
    // half-copied.
    fields = new URLSearchParams(raw.includes('=') ? raw.split('?').pop() : '')
  }

  const secret = (fields.get('s') || (raw.includes('=') ? '' : raw))
    .replace(/\s+/g, '')
    .toUpperCase()
  return { secret, relayUrl: (fields.get('r') || '').replace(/\/+$/, '') }
}

/** Named so a caller can say which thing went wrong rather than printing a
 *  sentence. `reason` is one of: offline, relay, expired, invalid, timeout. */
export class PairError extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'PairError'
    this.reason = reason
  }
}

/**
 * Pair this browser with a machine, using the code it printed.
 *
 * The offer and the answer are both sealed under a key derived from that code,
 * so the relay carries the handshake without being able to complete or read it.
 * The machine answering at all is the proof it knew the code -- that is what an
 * AEAD tag is -- so there is no second round trip.
 */
export async function pair(relayUrl, pairSecret, name, { signal } = {}) {
  const base = String(relayUrl || '').trim().replace(/\/+$/, '')
  const secret = readPayload(pairSecret).secret
  if (!base) throw new PairError('invalid', 'there is no relay address to pair through')
  if (secret.length < 16) throw new PairError('invalid', 'that is not a pairing code')

  const key = await pairKey(secret)
  const requestId = crypto.randomUUID()

  const sealed = await seal({ name, role: 'control' }, {
    opId: requestId, deviceId: 'pairing', key,
  })
  let offered
  try {
    offered = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: requestId, ...sealed }),
      signal,
    })
  } catch {
    throw new PairError('offline', 'could not reach the relay from this device')
  }
  if (!offered.ok) {
    throw new PairError('relay', `the relay would not take the offer (HTTP ${offered.status})`)
  }

  const deadline = Date.now() + PAIR_TIMEOUT_MS
  let answer = null
  while (Date.now() < deadline) {
    let got
    try {
      got = await fetch(`${base}/pair?request_id=${encodeURIComponent(requestId)}`, { signal })
    } catch {
      throw new PairError('offline', 'lost the relay while waiting for an answer')
    }
    if (got.status === 200) { answer = await got.json(); break }
    await sleep(PAIR_INTERVAL_MS)
  }
  if (!answer) {
    throw new PairError(
      'timeout',
      'the machine never answered. Check it is running and that its relay is switched on.',
    )
  }
  // The machine says so when it has no pairing open, which is nearly always a
  // code that sat on screen past its five minutes. Worth distinguishing: the
  // fix is "show a new one", and a timeout reads as "your laptop is asleep".
  if (answer.refused) {
    throw new PairError('expired', 'that code has expired -- show a new one on your machine')
  }

  let opened
  try {
    opened = await unseal(answer.nonce, answer.ciphertext, {
      opId: String(answer.request_id ?? ''), deviceId: 'pairing', key,
    })
  } catch {
    throw new PairError('invalid', 'the answer did not open under that code')
  }
  // Imported non-extractable before anything is written down, so the bytes
  // exist only for the length of this call and no copy of them is persisted.
  await storeGroupKey(unb64(opened.group_key))

  const held = {
    relayUrl: base,
    deviceId: opened.device_id,
    token: opened.token,
    name,
  }
  safeStorage.setItem(IDENTITY_KEY, JSON.stringify(held))
  return held
}

/**
 * One round trip: hand over what this browser changed, take what the machine
 * did, merge it. Returns what happened, and never throws for a network failure
 * -- an unreachable relay is the normal state of a phone, not an error.
 */
export async function sync() {
  const held = identity()
  if (!paired()) return { synced: false, reason: 'not paired' }

  const key = await groupKey()
  if (!key) return { synced: false, reason: 'no key on this device' }
  const state = replica.load()
  const pending = outbox()

  const sealedOps = []
  for (const op of pending.slice(0, 100)) {
    const { nonce, ciphertext } = await seal(
      { hlc: op.hlc, entity: op.entity, key: op.key, fields: op.fields },
      { opId: op.op_id, deviceId: held.deviceId, key },
    )
    sealedOps.push({ op_id: op.op_id, from_device: held.deviceId, nonce, ciphertext })
  }

  // Acknowledged late: what was taken last time goes back now, not when it was
  // taken. A tab closed in between re-takes rather than loses.
  const acking = state.pendingAck ?? []

  let payload
  try {
    const response = await fetch(`${held.relayUrl}/ops`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${held.token}`,
      },
      body: JSON.stringify({ ops: sealedOps, op_ack: acking }),
    })
    if (response.status === 401) return { synced: false, reason: 'revoked' }
    if (!response.ok) return { synced: false, reason: `HTTP ${response.status}` }
    payload = await response.json()
  } catch {
    return { synced: false, reason: 'offline' }
  }

  // Confirmed stored, so the outbox can let them go -- and not a moment before.
  if (sealedOps.length) {
    const sent = new Set(sealedOps.map((op) => op.op_id))
    setOutbox(outbox().filter((op) => !sent.has(op.op_id)))
  }

  const clock = new Clock(held.deviceId)
  const taken = []
  let applied = 0
  for (const row of payload.ops ?? []) {
    taken.push(row.op_id)
    let opened
    try {
      opened = await unseal(row.nonce, row.ciphertext, {
        opId: row.op_id, deviceId: row.from_device, key,
      })
    } catch {
      // Sealed under a key this browser does not hold. Acknowledged anyway:
      // it will never open, and leaving it would block the queue behind it.
      continue
    }
    clock.observe(opened.hlc)
    if (replica.apply(state, { op_id: row.op_id, ...opened })) applied += 1
  }

  state.pendingAck = taken
  replica.save(state)
  return { synced: true, applied, sent: sealedOps.length }
}

/**
 * Push what arrived into the preference blob the rest of the interface reads.
 *
 * The replica is the sync layer's own store; `amethyst.ui.v1` is what every
 * view already reads through `loadPrefs`. Without this step a phone would sync
 * perfectly and look exactly the same, which is indistinguishable from not
 * working. Keys are stored as `ui.<name>` and land here without the prefix.
 *
 * Returns what actually changed, so the caller knows whether anything needs
 * re-applying to the document -- the theme and accent are written to
 * documentElement outside React and nothing else would pick them up.
 */
export function projectPreferences() {
  const rows = replica.readAll(replica.load(), 'settings')
  if (!Object.keys(rows).length) return {}

  let current = {}
  try {
    current = JSON.parse(safeStorage.getItem('amethyst.ui.v1') || '{}')
  } catch { /* unreadable; treated as empty, and overwritten below */ }

  const changed = {}
  for (const [key, fields] of Object.entries(rows)) {
    if (!key.startsWith('ui.')) continue
    const name = key.slice(3)
    const before = current[name]
    // Everything crosses as text. Restore the shape the interface expects, or a
    // boolean comes back as the string "false" -- which is truthy, and would
    // silently invert every confirmation setting on the phone.
    const raw = fields.value
    const value = typeof before === 'boolean' ? raw === 'true' || raw === '1' : raw
    if (value !== before) { changed[name] = value; current[name] = value }
  }
  if (Object.keys(changed).length) {
    safeStorage.setItem('amethyst.ui.v1', JSON.stringify(current))
  }
  return changed
}

/** Record a local change and queue it. Applied to the replica immediately, so
 *  the interface reflects it whether or not the relay is reachable. */
export function change(entity, key, fields) {
  const held = identity()
  if (!held?.deviceId) return null
  const state = replica.load()
  const op = replica.emit(state, new Clock(held.deviceId), entity, key, fields)
  replica.save(state)
  setOutbox([...outbox(), op])
  return op
}

export { replica }
