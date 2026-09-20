/**
 * What the phone knows, and how it merges what arrives.
 *
 * The machine keeps its replica in SQLite; this one is a plain object in
 * localStorage, because a phone holds a view rather than a library and because
 * the merge rule does not care what it is stored in. The rule is the same one
 * `backend/sync/ops.py` implements and has to stay the same one: per-field
 * last-write-wins, a stamp per field, a tie does not overwrite.
 *
 * Shape, under one key:
 *
 *   { entity: { key: { fields: {name: value}, stamps: {name: hlc} } } }
 *
 * `seen` is the duplicate guard, the browser's `sync_seen`. It is a list rather
 * than a set only because it has to survive `JSON.stringify`, and it is trimmed
 * rather than allowed to grow: an op id is 36 bytes and localStorage is a few
 * megabytes, so "small" would stop being true eventually.
 */

import { safeStorage } from '../storage.js'
import { wins } from './hlc.js'
import { generateUUID } from './crypto.js'

const KEY = 'amethyst.sync.v1'

/** Enough that no op still in flight can fall off the end; the relay keeps 8 days. */
const SEEN_LIMIT = 5000

export function load() {
  try {
    const raw = safeStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return { entities: {}, seen: [] }
    return { entities: parsed.entities ?? {}, seen: parsed.seen ?? [] }
  } catch {
    return { entities: {}, seen: [] }
  }
}

export function save(state) {
  if (state.seen.length > SEEN_LIMIT) state.seen = state.seen.slice(-SEEN_LIMIT)
  safeStorage.setItem(KEY, JSON.stringify(state))
}

/** Every field of one row, merged. */
export function read(state, entity, key) {
  return state.entities?.[entity]?.[key]?.fields ?? null
}

/** Every row of one entity, as {key: fields}. */
export function readAll(state, entity) {
  const rows = state.entities?.[entity] ?? {}
  return Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row.fields]))
}

/**
 * Merge one op. Returns whether anything changed.
 *
 * The three refusals here are the same three the machine makes, in the same
 * order, because a phone that merged differently would converge to a different
 * answer and neither side would ever notice.
 */
export function apply(state, op) {
  if (state.seen.includes(op.op_id)) return false      // a duplicate delivery
  state.seen.push(op.op_id)

  if (!op.entity || !op.key || !op.fields) return false
  const rows = (state.entities[op.entity] ??= {})
  const row = (rows[op.key] ??= { fields: {}, stamps: {} })

  let changed = false
  for (const [name, value] of Object.entries(op.fields)) {
    if (!wins(op.hlc, row.stamps[name])) continue      // something later won
    row.fields[name] = value
    row.stamps[name] = op.hlc
    changed = true
  }
  return changed
}

/** Record a local change and return the op that carries it. */
export function emit(state, clock, entity, key, fields) {
  const stamp = clock.tick()
  const rows = (state.entities[entity] ??= {})
  const row = (rows[key] ??= { fields: {}, stamps: {} })
  for (const [name, value] of Object.entries(fields)) {
    row.fields[name] = value
    row.stamps[name] = stamp
  }
  return {
    op_id: generateUUID(),
    hlc: stamp,
    entity,
    key,
    fields,
  }
}

/** Drop everything this device merged. Called when a pairing is forgotten: the
 *  transcript belongs to the machine that was unpaired, and leaving it behind
 *  would show the next pairing the previous one's conversations. */
export function clear() {
  safeStorage.removeItem(KEY)
}
