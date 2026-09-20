/**
 * Messages the relay owes somebody, and the record that each is owed once.
 *
 * The 24-hour reply window is the only deadline here a sleeping laptop cannot
 * meet, so the "Got it" ack is the one piece of work that genuinely has to
 * happen in the cloud. It used to be `ctx.waitUntil(sendAck(...))` -- a single
 * fetch, inside the request that received the delivery, with a `catch` that
 * logged and moved on. A Graph 500 or a rate limit therefore lost the ack
 * silently, and nothing anywhere recorded that it had been meant to go.
 *
 * This is the row that says what is owed. What keeps trying until it is sent or
 * definitively refused is the `instagram_ack` job type
 * (`src/jobs/types/instagram_ack.ts`) -- the same three steps the bespoke
 * Workflow here used to run, now on the generic job layer, because a receipt
 * was never the only work with a deadline.
 *
 * The row is keyed by the delivery's body hash, which is the same key the
 * delivery itself is stored under and the same one the job's idempotency key is
 * built from -- so Meta re-delivering does not buy a second ack, for the same
 * reason it does not buy a second reel.
 */

import type { Env } from './index.ts';

export type OutboundState = 'pending' | 'sent' | 'skipped' | 'failed';

export async function recordOutbound(
	env: Env,
	bodyHash: string,
	senderId: string,
	state: OutboundState,
	note?: string,
): Promise<void> {
	await env.DB.prepare(
		'INSERT INTO outbound (body_hash, sender_id, kind, state, note, created_at, updated_at)' +
			" VALUES (?, ?, 'ack', ?, ?, ?, ?)" +
			' ON CONFLICT (body_hash) DO UPDATE SET state = excluded.state,' +
			' note = excluded.note, updated_at = excluded.updated_at',
	)
		.bind(bodyHash, senderId, state, note ?? null, nowSeconds(), nowSeconds())
		.run();
	invalidateOutboundSummary();
}

export async function outboundState(env: Env, bodyHash: string): Promise<OutboundState | null> {
	const row = await env.DB.prepare('SELECT state FROM outbound WHERE body_hash = ?')
		.bind(bodyHash)
		.first<{ state: OutboundState }>();
	return row?.state ?? null;
}

/** What the laptop is shown about work the relay did on its behalf. */
let _cachedSummary: Record<string, number> | null = null;

export async function outboundSummary(env: Env): Promise<Record<string, number>> {
	if (_cachedSummary) return _cachedSummary;
	const rows = await env.DB.prepare(
		'SELECT state, COUNT(*) AS n FROM outbound GROUP BY state',
	).all<{ state: string; n: number }>();
	const summary: Record<string, number> = {};
	for (const row of rows.results ?? []) summary[row.state] = row.n;
	_cachedSummary = summary;
	return summary;
}

/** Invalidate the cache when outbound state changes. */
export function invalidateOutboundSummary(): void {
	_cachedSummary = null;
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}
