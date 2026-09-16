/**
 * The replica, shaped the way the views already expect.
 *
 * `Chat.jsx` and the sidebar read conversations and messages in the shape the
 * API returns them. The sync layer stores rows keyed by entity and id with a
 * stamp per field, which is right for merging and wrong for rendering. Rather
 * than teach every view a second shape, this translates -- so a phone with no
 * backend can hand the same views the same objects.
 *
 * Everything here is a read of what has already been merged. No network, no
 * decryption, no ordering decisions: `client.sync()` has done all of that by
 * the time anything in this file runs.
 */

import { change, replica } from './client.js'

/** Newest first, archived hidden, matching what the API's list does. */
export function conversations() {
  const rows = replica.readAll(replica.load(), 'conversations')
  return Object.entries(rows)
    .filter(([, row]) => !truthy(row.archived))
    .map(([id, row]) => ({
      id,
      title: row.title || 'Untitled',
      provider: row.provider || '',
      model: row.model || '',
      pinned: truthy(row.pinned),
      archived: truthy(row.archived),
    }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.title.localeCompare(b.title))
}

/**
 * One conversation's transcript, oldest first.
 *
 * Sorted by `seq`, which is the machine's own write order carried across
 * explicitly. It used to sort by `created_at` and break ties on the id, and
 * that was wrong in the most visible way possible: `created_at` has
 * second precision, a turn writes the question and the answer inside the same
 * second, and the tiebreak was a random uuid -- so a real transcript rendered
 * the answer above the question about half the time.
 */
export function messages(conversationId) {
  const rows = replica.readAll(replica.load(), 'messages')
  return Object.entries(rows)
    .filter(([, row]) => row.conversation_id === conversationId)
    .map(([uuid, row]) => ({
      id: uuid,
      role: row.role,
      content: row.content ?? '',
      created_at: row.created_at,
      seq: Number(row.seq ?? 0),
    }))
    // `seq` first; `created_at` only for a row published before the column
    // existed, which has none.
    .sort((a, b) => a.seq - b.seq
      || String(a.created_at).localeCompare(String(b.created_at))
      || a.id.localeCompare(b.id))
}

/** Whether the machine is mid-turn in this conversation, so the phone can say so. */
export function runPhase(conversationId) {
  const rows = replica.readAll(replica.load(), 'agent_runs')
  const live = Object.values(rows)
    .filter((row) => row.conversation_id === conversationId)
    .filter((row) => !['completed', 'stopped', 'cancelled', 'failed', 'interrupted'].includes(row.phase))
  return live.length ? live[live.length - 1].phase : null
}

/**
 * Ask the machine to run a turn.
 *
 * Queued, not sent: the outbox goes out on the next poll, so this works with no
 * signal and the tap is not lost. What comes back is not a reply but the
 * transcript, swept out by the machine after it has run -- which is why there is
 * nothing here that waits for one.
 */
export function ask(conversationId, text) {
  return change('intents', crypto.randomUUID(), {
    kind: 'turn',
    state: 'pending',
    payload: JSON.stringify({ conversation_id: conversationId, text }),
  })
}

/** What this device has asked for and what became of it, newest first. */
export function asked() {
  const rows = replica.readAll(replica.load(), 'intents')
  return Object.entries(rows)
    .map(([id, row]) => ({ id, ...row, payload: parse(row.payload) }))
    .filter((row) => row.kind === 'turn')
    .reverse()
}

function parse(raw) {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

/** SQLite has no boolean; 1, "1" and true all mean the same thing here. */
function truthy(value) {
  return value === true || value === 1 || value === '1'
}
