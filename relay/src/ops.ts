/**
 * The sync mailbox: sealed bytes in, sealed bytes out, nothing understood.
 *
 * This is the third mailbox in this Worker and the simplest, because it is the
 * only one whose contents the relay has no business reading. `deliveries` holds
 * Meta's exact bytes so the laptop can re-verify a signature; `worker_reports`
 * holds a result the laptop re-validates. Both are plaintext because something
 * downstream needs to parse them. An op is carried between two of one person's
 * own devices, so it arrives sealed and leaves sealed, and the strongest
 * statement this file can make is that it could not read one if it tried.
 *
 * Fan-out is why `op_acks` exists rather than a `synced_at` column. A delivery
 * has exactly one taker, so "taken" is a property of the row. An op has as many
 * takers as the user has devices, and deleting on first collection would lose it
 * for the second. So the row survives until every registered device but the
 * sender has acked, and the daily cron clears whatever nobody came back for --
 * a device that is never coming back must not pin a row forever.
 */

/** One sync takes this many ops. The same batch size as every other mailbox. */
export const SYNC_BATCH = 100;

/** A sealed op is a few hundred bytes. This is the ceiling on somebody's bug. */
export const MAX_OP_BYTES = 64 * 1024;

/** Above this the relay stops accepting: a queue, not a library. */
export const MAX_OPEN_OPS = 5_000;

/** What an op that nobody collected is kept for, matching the delivery prune. */
export const KEEP_SECONDS = 8 * 24 * 60 * 60;

const now = () => Math.floor(Date.now() / 1000);

export interface OpsEnv {
	DB: D1Database;
}

/** The envelope, as it travels. `payload` is opaque and stays that way. */
export interface SealedOp {
	op_id: string;
	from_device: string;
	nonce: string;
	ciphertext: string;
}

function usable(op: unknown): op is SealedOp {
	if (!op || typeof op !== 'object') return false;
	const o = op as Record<string, unknown>;
	return (
		typeof o.op_id === 'string' && o.op_id.length > 0 && o.op_id.length <= 64 &&
		typeof o.from_device === 'string' && o.from_device.length > 0 && o.from_device.length <= 64 &&
		typeof o.nonce === 'string' && o.nonce.length <= 64 &&
		typeof o.ciphertext === 'string' && o.ciphertext.length <= MAX_OP_BYTES
	);
}

/**
 * Take what a device uploaded.
 *
 * `INSERT OR IGNORE` is the whole of duplicate handling: an op id is chosen by
 * the device that made the change and never reused, so a retried upload -- the
 * normal outcome of a sync that timed out after writing -- collides and writes
 * nothing. The count returned is of rows *stored*, so a device that uploads the
 * same batch twice is told the truth about it rather than reassured twice.
 */
export async function acceptOps(env: OpsEnv, uploaded: unknown, fromDevice: string): Promise<number> {
	if (!Array.isArray(uploaded) || uploaded.length === 0) return 0;

	const open = await env.DB.prepare('SELECT count(*) AS n FROM ops').first<{ n: number }>();
	if ((open?.n ?? 0) >= MAX_OPEN_OPS) return 0;

	const stamp = now();
	const statements = [];
	for (const candidate of uploaded.slice(0, SYNC_BATCH)) {
		if (!usable(candidate)) continue;
		// The sender is taken from the authenticated device, not from the body: a
		// device may upload only as itself, or it could forge the one field the
		// AEAD binds its own ciphertext to.
		statements.push(
			env.DB.prepare(
				'INSERT OR IGNORE INTO ops (op_id, from_device, ciphertext, nonce, created_at)' +
					' VALUES (?, ?, ?, ?, ?)',
			).bind(candidate.op_id, fromDevice, candidate.ciphertext, candidate.nonce, stamp),
		);
	}
	if (!statements.length) return 0;
	const results = await env.DB.batch(statements);
	return results.reduce((total, r) => total + (r.meta?.changes ?? 0), 0);
}

/**
 * What this device has not taken yet: everything it did not send and has not
 * acked. Ordered oldest first so a device that has been away catches up in the
 * order the changes were made -- which matters for the entities whose rows are
 * created by one device and then edited by it.
 */
export async function opsForSync(env: OpsEnv, deviceId: string, limit = SYNC_BATCH): Promise<SealedOp[]> {
	const { results } = await env.DB.prepare(
		'SELECT op_id, from_device, ciphertext, nonce FROM ops' +
			' WHERE from_device != ?' +
			'   AND op_id NOT IN (SELECT op_id FROM op_acks WHERE device_id = ?)' +
			// By rowid -- insertion order -- rather than by `created_at`, which is
		// whole seconds. A device uploads a batch inside one second routinely, and
		// ordering by a second plus a random op id hands them over shuffled. The
		// merge converges regardless, but an entity whose row is created and then
		// updated by one device needs its create to arrive first.
		' ORDER BY rowid LIMIT ?',
	)
		.bind(deviceId, deviceId, Math.min(Math.max(limit, 1), SYNC_BATCH))
		.all<SealedOp>();
	return results ?? [];
}

/**
 * Record that a device has taken these, and delete whatever everybody now has.
 *
 * Acknowledged late, on the poll *after* the one that handed them over -- the
 * same discipline `deliveries` uses and for the same reason. An op acked before
 * it has been applied is one a crash halfway through applying it loses for good;
 * an op applied twice is free, because `sync_seen` on the far side refuses the
 * second and the merge is idempotent regardless.
 */
export async function ackOps(env: OpsEnv, deviceId: string, opIds: unknown): Promise<number> {
	if (!Array.isArray(opIds) || opIds.length === 0) return 0;
	const ids = opIds
		.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64)
		.slice(0, SYNC_BATCH);
	if (!ids.length) return 0;

	await env.DB.batch(
		ids.map((id) =>
			env.DB.prepare('INSERT OR IGNORE INTO op_acks (op_id, device_id) VALUES (?, ?)').bind(
				id,
				deviceId,
			),
		),
	);
	await collect(env);
	return ids.length;
}

/**
 * Delete every op that every live device has taken.
 *
 * The device list is the mirror the host pushes on each sync, so a device
 * revoked on the machine stops holding rows here within one poll -- the same
 * "rotating it there revokes it here" property the share token already has.
 * With no mirror yet, nothing is deleted: forgetting who is owed is a reason to
 * keep an op, not to drop it.
 */
export async function collect(env: OpsEnv): Promise<number> {
	const row = await env.DB.prepare("SELECT value FROM state WHERE key = 'devices'").first<{
		value: string;
	}>();
	if (!row?.value) return 0;

	let devices: Array<{ id?: unknown }>;
	try {
		devices = JSON.parse(row.value);
	} catch {
		return 0;
	}
	const ids = devices.map((d) => String(d?.id ?? '')).filter(Boolean);
	if (!ids.length) return 0;

	// "Every device that is not the sender has acked it." Expressed as a count so
	// it stays one statement: an op is owed to (devices - 1) takers, because the
	// device that made the change is never sent its own.
	const marks = ids.map(() => '?').join(',');
	const result = await env.DB.prepare(
		`DELETE FROM ops WHERE op_id IN (
			SELECT o.op_id FROM ops o
			LEFT JOIN op_acks a ON a.op_id = o.op_id AND a.device_id IN (${marks})
			WHERE o.from_device IN (${marks})
			GROUP BY o.op_id
			HAVING count(a.device_id) >= ?
		)`,
	)
		.bind(...ids, ...ids, Math.max(ids.length - 1, 0))
		.run();

	const deleted = result.meta?.changes ?? 0;
	if (deleted) await env.DB.prepare('DELETE FROM op_acks WHERE op_id NOT IN (SELECT op_id FROM ops)').run();
	return deleted;
}

/**
 * The daily sweep. An op nobody collected in eight days belongs to a device that
 * is not coming back, and keeping it forever would make this table the one thing
 * here that grows without bound.
 */
export async function pruneOps(env: OpsEnv): Promise<number> {
	const cutoff = now() - KEEP_SECONDS;
	const result = await env.DB.prepare('DELETE FROM ops WHERE created_at < ?').bind(cutoff).run();
	await env.DB.prepare('DELETE FROM op_acks WHERE op_id NOT IN (SELECT op_id FROM ops)').run();
	return result.meta?.changes ?? 0;
}
