/**
 * The one exchange that happens before a device has a credential.
 *
 * Every other route here is authenticated, because every other route is used by
 * something that has already been paired. Pairing is the bootstrap, so `POST
 * /pair` is the only door that answers an unauthenticated caller -- and it is
 * built on the assumption that it will be knocked on by strangers.
 *
 * What makes that safe is that the relay is not a participant. Both halves are
 * sealed under a key derived from a 160-bit secret shown as a QR code on the
 * machine's screen, so this Worker carries two opaque blobs and can neither read
 * them nor produce one that the far side will open. A stranger posting here
 * writes a row that the machine tries to open, fails to open, and discards --
 * `backend/sync/devices.py`, `accept`.
 *
 * So the only thing an attacker gains is noise, and the only defence needed is
 * against noise: a hard cap on how many pending exchanges exist, a size cap on
 * each, and a TTL shorter than the pairing window on the machine.
 *
 * Rows live in `state` rather than a table of their own. They are two writes and
 * a read in the lifetime of an exchange that lasts five minutes, and a table for
 * that would be a migration for nothing.
 */

const REQUEST_PREFIX = 'pair_req:';
const RESPONSE_PREFIX = 'pair_res:';

/** Shorter than PAIRING_TTL_SECONDS on the machine, so this side gives up first. */
export const PAIR_TTL_SECONDS = 240;

/** A sealed handshake is a few hundred bytes. */
export const MAX_PAIR_BYTES = 8 * 1024;

/** Enough for a retry and a second device; not enough to be a place to put data. */
export const MAX_PENDING_PAIRINGS = 8;

const now = () => Math.floor(Date.now() / 1000);

export interface PairEnv {
	DB: D1Database;
}

interface Envelope {
	request_id: string;
	nonce: string;
	ciphertext: string;
}

function usable(body: unknown): body is Envelope {
	if (!body || typeof body !== 'object') return false;
	const b = body as Record<string, unknown>;
	return (
		typeof b.request_id === 'string' && b.request_id.length > 0 && b.request_id.length <= 64 &&
		typeof b.nonce === 'string' && b.nonce.length <= 64 &&
		typeof b.ciphertext === 'string' && b.ciphertext.length <= MAX_PAIR_BYTES
	);
}

async function put(env: PairEnv, key: string, value: string): Promise<void> {
	await env.DB.prepare(
		'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)' +
			' ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
	)
		.bind(key, value, now())
		.run();
}

/** A control device offering itself. Returns false when the door is full. */
export async function offerPairing(env: PairEnv, body: unknown): Promise<boolean> {
	if (!usable(body)) return false;

	const open = await env.DB.prepare(
		"SELECT count(*) AS n FROM state WHERE key LIKE 'pair_req:%'",
	).first<{ n: number }>();
	if ((open?.n ?? 0) >= MAX_PENDING_PAIRINGS) return false;

	await put(env, REQUEST_PREFIX + body.request_id, JSON.stringify(body));
	return true;
}

/**
 * What the machine collects on its next sync. Plural because two people can
 * scan the same screen, and because a retry looks exactly like a second offer.
 */
export async function pairingsForSync(env: PairEnv): Promise<Envelope[]> {
	const cutoff = now() - PAIR_TTL_SECONDS;
	const { results } = await env.DB.prepare(
		"SELECT value FROM state WHERE key LIKE 'pair_req:%' AND updated_at >= ? LIMIT ?",
	)
		.bind(cutoff, MAX_PENDING_PAIRINGS)
		.all<{ value: string }>();

	const out: Envelope[] = [];
	for (const row of results ?? []) {
		try {
			const parsed = JSON.parse(row.value);
			if (usable(parsed)) out.push(parsed);
		} catch {
			// A row that is not an envelope is one nothing can answer. The sweep
			// below removes it; there is nothing to report to the machine.
		}
	}
	return out;
}

/**
 * The machine's sealed answer, and the end of the exchange: the request is
 * deleted here so a second machine cannot answer it and a retry cannot race.
 */
export async function answerPairing(env: PairEnv, body: unknown): Promise<boolean> {
	if (!usable(body)) return false;
	await put(env, RESPONSE_PREFIX + body.request_id, JSON.stringify(body));
	await env.DB.prepare('DELETE FROM state WHERE key = ?')
		.bind(REQUEST_PREFIX + body.request_id)
		.run();
	return true;
}

/**
 * The control device collecting its answer, once. Deleted on read: it carries
 * the device's token and the group key, sealed, and there is no reason for a
 * queue on someone else's computer to keep a copy after it has been delivered.
 */
export async function takePairing(env: PairEnv, requestId: string): Promise<Envelope | null> {
	if (!requestId || requestId.length > 64) return null;
	const key = RESPONSE_PREFIX + requestId;
	const row = await env.DB.prepare(
		'SELECT value FROM state WHERE key = ? AND updated_at >= ?',
	)
		.bind(key, now() - PAIR_TTL_SECONDS)
		.first<{ value: string }>();
	if (!row?.value) return null;

	await env.DB.prepare('DELETE FROM state WHERE key = ?').bind(key).run();
	try {
		const parsed = JSON.parse(row.value);
		return usable(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** The daily sweep, so an abandoned handshake does not sit in `state` forever. */
export async function prunePairings(env: PairEnv): Promise<number> {
	const result = await env.DB.prepare(
		"DELETE FROM state WHERE (key LIKE 'pair_req:%' OR key LIKE 'pair_res:%') AND updated_at < ?",
	)
		.bind(now() - PAIR_TTL_SECONDS)
		.run();
	return result.meta?.changes ?? 0;
}
