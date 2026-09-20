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

export function checkDirectHandoff() {
  if (typeof window === 'undefined' || !window.location) return false
  const hash = window.location.hash || ''
  if (!hash.includes('token=') && !hash.includes('deviceId=')) return false
  try {
    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const token = params.get('token')
    const deviceId = params.get('deviceId') || params.get('device_id')
    if (token && deviceId) {
      let permissions = {}
      try {
        const pRaw = params.get('permissions')
        if (pRaw) permissions = JSON.parse(pRaw)
      } catch {}
      if (!permissions || Object.keys(permissions).length === 0) {
        try {
          const old = JSON.parse(safeStorage.getItem(IDENTITY_KEY) || '{}')
          if (old?.permissions && Object.keys(old.permissions).length > 0) {
            permissions = old.permissions
          }
        } catch {}
      }
      const held = {
        relayUrl: params.get('relayUrl') || params.get('r') || '',
        hostUrl: params.get('hostUrl') || params.get('h') || window.location.origin,
        deviceId,
        token,
        permissions,
        name: params.get('name') || 'Direct LAN Companion',
      }
      safeStorage.setItem(IDENTITY_KEY, JSON.stringify(held))
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
      } catch {}
      return true
    }
  } catch {}
  return false
}

export function identity() {
  checkDirectHandoff()
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
  return Boolean(held?.deviceId && held?.token && (held?.relayUrl || held?.hostUrl))
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
  if (ops.length > OUTBOX_LIMIT) {
    console.warn(`Sync outbox exceeded limit of ${OUTBOX_LIMIT}. Oldest operations were dropped.`)
  }
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
 * app is hosted: an `https://…/pair#s=…&r=…&h=…` link, which a phone's own camera
 * app opens directly, or an `amethyst://pair?s=…&r=…&h=…` fallback that only this
 * scanner and the clipboard can act on. Both carry the relay address and local LAN
 * host address alongside the secret.
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
  const res = {
    secret,
    relayUrl: (fields.get('r') || '').replace(/\/+$/, ''),
  }
  const h = fields.get('h')
  if (h) res.hostUrl = h.replace(/\/+$/, '')
  return res
}

/** Whether this page can do the crypto pairing needs.
 *
 * `crypto.subtle` only exists in a secure context, so a phone that loaded this
 * app over plain http from a LAN address has none of it -- `isSecureContext` is
 * false and `crypto.randomUUID` is undefined too. Checked before anything else
 * because the alternative is what it used to do: fail three calls in with
 * "Cannot read properties of undefined (reading 'importKey')", which tells
 * somebody holding a phone nothing whatsoever.
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function canPair() {
  return true
}

/** Named so a caller can say which thing went wrong rather than printing a
 *  sentence. `reason` is one of: insecure, offline, relay, expired, invalid,
 *  timeout. */
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
 * Supports direct LAN pairing when available and falls back to relay.
 * The offer and the answer are both sealed under a key derived from that code,
 * so neither relay nor local wire can inspect or alter them.
 */
export async function pair(relayOrOptions, pairSecret, name, { hostUrl: directHost = '', signal } = {}) {
  let base = ''
  let hostUrl = directHost
  let secret = ''
  let devName = name

  if (typeof relayOrOptions === 'object' && relayOrOptions !== null) {
    base = String(relayOrOptions.relayUrl || '').trim().replace(/\/+$/, '')
    hostUrl = String(relayOrOptions.hostUrl || '').trim().replace(/\/+$/, '')
    secret = readPayload(relayOrOptions.secret || '').secret
    devName = relayOrOptions.name || name
  } else {
    base = String(relayOrOptions || '').trim().replace(/\/+$/, '')
    const payload = readPayload(pairSecret)
    secret = payload.secret
    if (!hostUrl && payload.hostUrl) hostUrl = payload.hostUrl
    if (!base && payload.relayUrl) base = payload.relayUrl
  }

  if (!base && !hostUrl) {
    // If running in browser with same origin, consider current origin as host
    if (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('file://')) {
      hostUrl = window.location.origin.replace(/\/+$/, '')
    } else {
      throw new PairError('invalid', 'there is no computer address or relay to pair through')
    }
  }
  if (secret.length < 16) throw new PairError('invalid', 'that is not a pairing code')

  const key = await pairKey(secret)
  const requestId = generateUUID()

  const sealed = await seal({ name: devName, role: 'control' }, {
    opId: requestId, deviceId: 'pairing', key,
  })
  const deadline = Date.now() + PAIR_TIMEOUT_MS
  let answer = null
  let opened = null

  // 1. First attempt Direct LAN Claim if hostUrl is reachable
  if (hostUrl) {
    try {
      const directReq = await fetch(`${hostUrl}/api/pair/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, ...sealed }),
        signal,
      })
      if (directReq.ok) {
        // Poll direct host for approval
        while (Date.now() < deadline) {
          if (signal?.aborted) throw new PairError('timeout', 'pairing aborted')
          let got = null
          try {
            got = await fetch(`${hostUrl}/api/pair/claim?request_id=${encodeURIComponent(requestId)}`, { signal })
          } catch {
            break // Fall through to relay or retry
          }
          if (got.status === 403) {
            throw new PairError('invalid', 'Pairing was rejected by your computer')
          }
          if (got.ok) {
            const data = await got.json()
            if (data.refused === 'pending_approval') {
              await sleep(PAIR_INTERVAL_MS)
              continue
            }
            if (data.refused === 'rejected') {
              throw new PairError('invalid', 'Pairing was rejected by your computer')
            }
            if (data.refused) {
              throw new PairError('expired', 'That code has expired -- show a new one on your computer')
            }
            if (data.ciphertext && data.nonce) {
              try {
                opened = await unseal(data.nonce, data.ciphertext, {
                  opId: String(data.request_id ?? ''), deviceId: 'pairing', key,
                })
                answer = data
                break
              } catch {
                throw new PairError('invalid', 'The answer did not open under that code')
              }
            }
          }
          await sleep(PAIR_INTERVAL_MS)
        }
      }
    } catch (err) {
      if (err instanceof PairError) throw err
      // Direct LAN failed, will attempt relay if available
    }
  }

  // 2. If direct LAN did not answer and we have a relay, run relay loop
  if (!answer && base) {
    let offered = false
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new PairError('timeout', 'pairing aborted')
      if (!offered) {
        try {
          const req = await fetch(`${base}/pair`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ request_id: requestId, ...sealed }),
            signal,
          })
          if (!req.ok) throw new PairError('relay', `the relay would not take the offer (HTTP ${req.status})`)
          offered = true
        } catch (e) {
          if (e instanceof PairError) throw e
          throw new PairError('offline', 'could not reach the relay from this device')
        }
      }

      let gotAnswer = null
      const answerDeadline = Date.now() + 15000
      while (Date.now() < answerDeadline && Date.now() < deadline) {
        if (signal?.aborted) throw new PairError('timeout', 'pairing aborted')
        let got
        try {
          got = await fetch(`${base}/pair?request_id=${encodeURIComponent(requestId)}`, { signal })
        } catch {
          throw new PairError('offline', 'lost the relay while waiting for an answer')
        }
        if (got.status === 200) { gotAnswer = await got.json(); break }
        await sleep(PAIR_INTERVAL_MS)
      }

      if (!gotAnswer) continue

      if (gotAnswer.refused === 'pending_approval') {
        await sleep(PAIR_INTERVAL_MS)
        continue
      }
      if (gotAnswer.refused === 'rejected') {
        throw new PairError('invalid', 'Pairing was rejected by your computer')
      }
      if (gotAnswer.refused) {
        throw new PairError('expired', 'That code has expired -- show a new one on your machine')
      }

      try {
        opened = await unseal(gotAnswer.nonce, gotAnswer.ciphertext, {
          opId: String(gotAnswer.request_id ?? ''), deviceId: 'pairing', key,
        })
        answer = gotAnswer
        break
      } catch {
        throw new PairError('invalid', 'The answer did not open under that code')
      }
    }
  }

  if (!answer || !opened) {
    throw new PairError(
      'timeout',
      'Your computer did not respond to the pairing request. Check that Amethyst is running and approve the connection.',
    )
  }

  // Store group key
  await storeGroupKey(unb64(opened.group_key))

  const held = {
    relayUrl: base,
    hostUrl: hostUrl || (typeof window !== 'undefined' ? window.location.origin : ''),
    deviceId: opened.device_id,
    token: opened.token,
    permissions: opened.permissions || {},
    name: devName,
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
  
  // RELOAD STATE HERE to merge with any optimistic changes that happened during the fetch
  const currentState = replica.load()
  
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
    if (replica.apply(currentState, { op_id: row.op_id, ...opened })) applied += 1
  }

  currentState.pendingAck = taken
  replica.save(currentState)
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
