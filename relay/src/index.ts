/**
 * AMETHYST's relay: the part of AMETHYST that has to be awake.
 *
 * A closed laptop is not a slow endpoint, it is a down one. Meta retries a
 * failed webhook and then disables the subscription, so pointing Meta at a
 * machine that sleeps does not mean "deliveries arrive late" -- it means being
 * silently unsubscribed with no error anywhere. This Worker exists to answer
 * that 200, and to do the two other things that have deadlines a sleeping
 * laptop cannot meet: the 24-hour reply window, and the 60-day token refresh.
 *
 * It is always on and it is never trusted. Every delivery is stored as the
 * exact bytes Meta sent plus the exact signature header, and the laptop
 * verifies that signature again before anything reaches the library. A
 * compromised relay can lose a reel; it cannot invent one.
 *
 * It began as one webhook and grew a second half: a **generic durable job
 * layer** (`src/jobs/`) for work that has to continue while the desktop is
 * unavailable. Instagram's receipt is now one job type among several rather
 * than the only thing here that retries. The rule has not changed -- the relay
 * *captures* and *fetches*; it does not think.
 *
 * What it deliberately does NOT do: run the agent, hold a library, run ffmpeg,
 * transcribe, enrich, or keep anything the machine has collected. No free
 * platform has a persistent disk, ADR-0004 makes the filesystem the source of
 * truth for text, and the keys that would pay for a transcription live in the
 * machine's keychain where a remote client cannot reach them.
 */

export interface Env extends JobEnv {
	DB: D1Database;
	/** Meta's app secret. Verifies the HMAC on every delivery. */
	APP_SECRET: string;
	/** Echoed back during Meta's one-time handshake, and nothing else. */
	VERIFY_TOKEN: string;
	/** What the laptop presents to POST /sync. */
	RELAY_TOKEN: string;
	/**
	 * What a GitHub Actions worker presents to POST /worker/report, and the only
	 * thing it may do. Optional: a relay without it simply has no worker
	 * mailbox, and every other route is unchanged. Deliberately the weakest of
	 * the three -- it lives in two GitHub accounts' Actions secrets, which makes
	 * it the most exposed and it is worth the least if taken.
	 */
	WORKER_TOKEN?: string;
	/**
	 * Optional. Where someone asks for their data to be deleted. Left unset, the
	 * policy page says to message the Instagram account, which is true and does
	 * not publish an email address to be scraped.
	 */
	CONTACT?: string;
	/**
	 * The job workflow (src/jobs/workflow.ts). Optional so a relay deployed
	 * before it existed keeps working: without the binding a job runs inline,
	 * inside the request that asked for it, and loses only the retries.
	 */
	JOBS?: Workflow<JobParams>;
	/**
	 * Where a job's bytes are staged, when there are bytes. Optional because R2
	 * is the one Cloudflare product that wants a card on file, and the promise
	 * at the top of the README is "nothing, and no card" -- see
	 * src/jobs/artifacts.ts for what a relay without it does instead.
	 */
	ARTIFACTS?: R2Bucket;
}

/** Meta's deliveries are kilobytes. Matches backend/instagram/signature.py. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Above this the queue is not a queue, it is somebody filling the table. The
 * webhook still answers 200 -- refusing only makes Meta retry -- but nothing
 * more is written. Matches MAX_QUEUED in backend/instagram/store.py.
 */
const MAX_QUEUED = 500;

/**
 * How long since the laptop last called /sync before it counts as away. It
 * polls every 15 seconds, so two minutes is unambiguous rather than marginal.
 * This is the whole basis of the ack DM: with the laptop running the Worker
 * stays quiet and the laptop sends the real `Saved: {title}` a moment later.
 */
const OFFLINE_AFTER_SECONDS = 120;

/** Rows the laptop never came back for. Meta's own CDN assets die at ~7 days. */
const KEEP_SECONDS = 8 * 24 * 60 * 60;

/** Refresh this far ahead of expiry. A lapsed token cannot be refreshed at all. */
const TOKEN_REFRESH_DAYS = 14;

const GRAPH = 'https://graph.instagram.com/v23.0';

/** The housekeeping schedule, as written in wrangler.jsonc. */
const DAILY_CRON = '17 3 * * *';

// The durable job layer. Every retryable piece of work the relay does runs
// through it, including the Instagram receipt that used to have a Workflow of
// its own -- see src/jobs/ for the shape and src/jobs/types/ for the work.
export { JobWorkflow } from './jobs/workflow.ts';
import { authenticate, authenticateDevice, bearer, sameSecret } from './auth.ts';
import { acceptOps, ackOps, opsForSync, pruneOps } from './ops.ts';
import { answerPairing, offerPairing, pairingsForSync, prunePairings, takePairing } from './pairing.ts';
import { isBrowserRoute, preflight, withCors } from './cors.ts';
import { ackReports, isWorker, pruneReports, report, reportsForSync } from './workers.ts';
import {
	ackJobs,
	createJob,
	jobsForSync,
	readArtifact,
	readJob,
	SYNC_BATCH,
	sweepJobs,
} from './jobs/api.ts';
import { dispatch, type JobParams } from './jobs/dispatch.ts';
import type { JobEnv } from './jobs/registry.ts';
import { creatableKinds, typeFor } from './jobs/registry.ts';
import { JobStore, MAX_OPEN_JOBS } from './jobs/store.ts';
import { publicView } from './jobs/state.ts';
import { registerJobTypes } from './jobs/types/index.ts';
import { outboundSummary } from './outbound.ts';

// ---------------------------------------------------------------- primitives

const enc = new TextEncoder();

async function hmacHex(secret: string, raw: ArrayBuffer): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	return hex(await crypto.subtle.sign('HMAC', key, raw));
}

async function sha256Hex(raw: ArrayBuffer): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', raw));
}

function hex(buf: ArrayBuffer): string {
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = '';
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** btoa() is byte-wise, so anything non-ASCII has to be encoded first. */
function toBase64Utf8(text: string): string {
	return toBase64(enc.encode(text).buffer as ArrayBuffer);
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}


const now = () => Math.floor(Date.now() / 1000);

// -------------------------------------------------------------------- state

const _stateCache = new Map<string, string>();
let _lastWrittenPullAt = 0;

export async function getState(env: Env, key: string): Promise<string | null> {
	if (_stateCache.has(key)) {
		return _stateCache.get(key)!;
	}
	const row = await env.DB.prepare('SELECT value FROM state WHERE key = ?')
		.bind(key)
		.first<{ value: string }>();
	if (row?.value !== undefined && row?.value !== null) {
		_stateCache.set(key, row.value);
		return row.value;
	}
	return null;
}

async function setState(env: Env, key: string, value: string): Promise<void> {
	if (_stateCache.get(key) === value) {
		return;
	}
	_stateCache.set(key, value);
	await env.DB.prepare(
		'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)' +
			' ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
	)
		.bind(key, value, now())
		.run();
}

export async function allowedSenders(env: Env): Promise<string[]> {
	try {
		const raw = await getState(env, 'allow_senders');
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return [];
	}
}

/**
 * Whether the laptop is there. Everything conditional in this Worker hangs off
 * this one question, so it is asked in one place.
 */
async function laptopIsAway(env: Env): Promise<boolean> {
	const last = Number((await getState(env, 'last_pull_at')) ?? 0);
	return now() - last > OFFLINE_AFTER_SECONDS;
}

// ------------------------------------------------------------------- queue

/**
 * Cached delivery queue depth. The real count is stored in the state table
 * and updated on every enqueue/prune/delete, so /sync never needs a full
 * table scan. The in-memory copy is a fast path for the common case.
 */
let _cachedQueueDepth: number | null = null;

async function queueDepth(env: Env): Promise<number> {
	if (_cachedQueueDepth !== null) return _cachedQueueDepth;
	const row = await env.DB.prepare("SELECT value FROM state WHERE key = 'queue_depth'")
		.first<{ value: string }>();
	if (row) {
		_cachedQueueDepth = Number(row.value) || 0;
	} else {
		// First call: seed the cache from the real count.
		const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM deliveries')
			.first<{ n: number }>();
		_cachedQueueDepth = count?.n ?? 0;
		await setQueueDepth(env, _cachedQueueDepth);
	}
	return _cachedQueueDepth;
}

async function setQueueDepth(env: Env, n: number): Promise<void> {
	_cachedQueueDepth = n;
	await env.DB.prepare(
		"INSERT INTO state (key, value, updated_at) VALUES ('queue_depth', ?, ?)" +
			" ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
	)
		.bind(String(n), now())
		.run();
}

/** Recount and persist. Called after mutations that change the row count. */
async function recountQueue(env: Env): Promise<void> {
	const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM deliveries').first<{ n: number }>();
	const n = row?.n ?? 0;
	await setQueueDepth(env, n);
}

/** Returns false when the row was already here -- a retry, or a replay. */
async function enqueue(
	env: Env,
	kind: string,
	bodyHash: string,
	body: string,
	signature: string | null,
	senderId: string | null,
): Promise<boolean> {
	const result = await env.DB.prepare(
		'INSERT INTO deliveries (kind, body_hash, body, signature, sender_id, received_at)' +
			' VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (body_hash) DO NOTHING',
	)
		.bind(kind, bodyHash, body, signature, senderId, now())
		.run();
	const inserted = (result.meta.changes ?? 0) > 0;
	if (inserted) {
		_cachedQueueDepth = (_cachedQueueDepth ?? 0) + 1;
	}
	return inserted;
}

// -------------------------------------------------------------- graph calls

async function appsecretProof(env: Env, token: string): Promise<string> {
	const primary = (env.APP_SECRET || '').split(',')[0].trim();
	return hmacHex(primary, enc.encode(token).buffer as ArrayBuffer);
}

/**
 * "Got it." Sent only while the laptop is away, only to a sender on the
 * allowlist, and only when replies are switched on at all.
 *
 * The wording is load-bearing. It says received, not saved: the reel has not
 * been transcribed, enriched or written to the library and will not be until
 * the machine is running. Claiming otherwise would be the one thing this
 * codebase does not do.
 */
export async function sendAckOnce(
	env: Env,
	senderId: string,
): Promise<{ ok: boolean; status: number; detail: string }> {
	const token = await getState(env, 'access_token');
	if (!token) return { ok: false, status: 0, detail: 'no access token' };

	const proof = await appsecretProof(env, token);
	const url = `${GRAPH}/me/messages?appsecret_proof=${proof}`;
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({
				recipient: { id: senderId },
				message: {
					text: "Got it — I'll save this to your library once your machine is next running.",
				},
			}),
		});
		if (response.ok) return { ok: true, status: response.status, detail: '' };
		const detail = await response.text();
		console.warn('ack failed', response.status, detail);
		return { ok: false, status: response.status, detail: detail.slice(0, 300) };
	} catch (err) {
		// A network error is exactly the case worth another attempt, so it is
		// reported as a failure rather than swallowed the way it used to be.
		return { ok: false, status: 0, detail: String(err) };
	}
}

// ------------------------------------------------------------------- routes

/**
 * Meta's one-time handshake. The GET carries no signature -- only POSTs are
 * signed -- so the verify token is the whole check, compared in constant time.
 */
async function handshake(url: URL, env: Env): Promise<Response> {
	const mode = url.searchParams.get('hub.mode');
	const token = url.searchParams.get('hub.verify_token') ?? '';
	const challenge = url.searchParams.get('hub.challenge');
	if (mode !== 'subscribe' || !challenge) {
		return new Response('no', { status: 403 });
	}
	if (!sameSecret(token, env.VERIFY_TOKEN)) {
		// Meta's dashboard shows this as "the handshake was refused", which is
		// the truth; anything looser here would let a stranger confirm the
		// subscription was live with a token they guessed.
		return new Response('no', { status: 403 });
	}
	return new Response(challenge, { headers: { 'content-type': 'text/plain' } });
}

async function delivery(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const declared = request.headers.get('content-length');
	if (declared && Number(declared) > MAX_BODY_BYTES) {
		return json({ error: 'too large' }, 413);
	}
	const raw = await request.arrayBuffer();
	if (raw.byteLength > MAX_BODY_BYTES) return json({ error: 'too large' }, 413);

	// Over the bytes that arrived, never over a re-serialised model.
	const header = request.headers.get('x-hub-signature-256') ?? '';
	const [scheme, digest] = header.split('=');
	if (scheme?.trim().toLowerCase() !== 'sha256' || !digest) {
		return json({ error: 'unsigned' }, 403);
	}
	const secrets = (env.APP_SECRET || '').split(',').map((s) => s.trim()).filter(Boolean);
	let matched = false;
	for (const sec of secrets) {
		const expected = await hmacHex(sec, raw);
		if (sameSecret(digest.trim(), expected)) {
			matched = true;
			break;
		}
	}
	if (!matched) {
		console.warn('refused: signature did not match any configured secret');
		return json({ error: 'bad signature' }, 403);
	}

	// Past this line the bytes came from something holding the app secret. The
	// laptop will still check them again -- this Worker is not the authority.
	if ((await queueDepth(env)) >= MAX_QUEUED) {
		// 200 on purpose. A 4xx here only makes Meta retry what we are choosing
		// not to store, for hours.
		console.warn('queue full at', MAX_QUEUED);
		return json({ status: 'backlogged' });
	}

	const text = new TextDecoder().decode(raw);
	const senderId = senderOf(text);
	// Computed once: it is both the delivery's identity and the ack's, which is
	// what makes one re-delivery buy neither a second reel nor a second ack.
	const bodyHash = await sha256Hex(raw);
	const stored = await enqueue(env, 'instagram', bodyHash, toBase64(raw), header, senderId);

	// After the response, never before it: Meta wants a 200 in seconds and a
	// Graph round trip is not something to make it wait for.
	if (stored && senderId) {
		ctx.waitUntil(
			laptopIsAway(env).then((away) =>
				away ? startJob(env, 'instagram_ack', { sender_id: senderId, body_hash: bodyHash },
				                'webhook', ctx.waitUntil.bind(ctx)) : undefined,
			),
		);
	}
	return json({ status: stored ? 'queued' : 'duplicate' });
}

/**
 * Who sent this, if it was a direct message. A shallow read on purpose: the
 * route classification that decides what a delivery *is* lives in
 * backend/instagram/webhook.py and is not repeated here.
 */
function senderOf(text: string): string | null {
	try {
		const body = JSON.parse(text);
		for (const entry of body?.entry ?? []) {
			for (const item of entry?.messaging ?? []) {
				if (item?.message?.is_echo) continue; // our own reply coming back
				if (item?.sender?.id) return String(item.sender.id);
			}
		}
	} catch {
		// A body Meta signed and we cannot read is still stored; the laptop's
		// parser is the one whose opinion counts.
	}
	return null;
}

/**
 * A link from a phone, the same journey `POST /api/share/capture` gives it on
 * the machine itself.
 *
 * The token is checked here and then echoed into the row, so the laptop can
 * check it again with `share.check` rather than taking this Worker's word for
 * it. That costs nothing: the share token is already in D1, because the check
 * cannot happen here without it.
 *
 * The body is read four ways because the senders genuinely differ: curl sends
 * JSON, an Android shortcut's HTTP action sends form fields, and some share
 * targets send the bare URL as text/plain with no fields at all. The 400s this
 * used to return named neither the shape it got nor the one it wanted, so a
 * shortcut that failed looked like an endpoint that did not exist.
 */
async function share(request: Request, env: Env): Promise<Response> {
	const stored = await getState(env, 'share_token');
	const presented = bearer(request.headers.get('authorization'));
	if (!stored) return json({ error: 'no such endpoint: /share' }, 404);
	if (!presented || !sameSecret(presented, stored)) {
		return json({ error: 'that token is not the one this relay holds' }, 401);
	}

	const raw = await request.arrayBuffer();
	if (raw.byteLength > MAX_BODY_BYTES) return json({ error: 'too large' }, 413);
	const text = new TextDecoder().decode(raw);
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
	let payload: { url?: string; text?: string; kind?: string; note?: string } = {};
	if (type === 'application/x-www-form-urlencoded') {
		const fields = new URLSearchParams(text);
		payload = { url: fields.get('url') ?? fields.get('text') ?? undefined, kind: fields.get('kind') ?? undefined,
		            note: fields.get('note') ?? undefined };
	} else if (type === 'application/json') {
		try {
			payload = JSON.parse(text) ?? {};
			if (!payload.url && payload.text) payload.url = payload.text;
		} catch {
			return json({ error: 'that body is not JSON' }, 400);
		}
	} else {
		// text/plain -- and anything unlabelled.
		// If text contains an embedded URL anywhere, extract it.
		const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
		const candidate = match
			? match[0]
			: text
					.split(/\r?\n/)
					.map((line) => line.trim())
					.find((line) => /^[a-z][a-z0-9+.-]*:\/\//i.test(line));
		payload = { url: candidate };
	}
	const url = new URL(request.url);
	payload.url = payload.url || url.searchParams.get('url') || url.searchParams.get('text') || undefined;
	if (payload.url) {
		const match = payload.url.match(/https?:\/\/[^\s<>"')\]]+/i);
		if (match) {
			const raw = payload.url;
			payload.url = match[0];
			if (!payload.note) {
				const extra = raw.replace(match[0], '').trim();
				if (extra) payload.note = extra;
			}
		}
	}
	if (!payload.url) {
		// Self-diagnosing on purpose: "400 Bad Request" in a toast names
		// nothing. This says what arrived, so the next failure is readable
		// from the phone that produced it.
		return json(
			{ error: `a url is required; got a ${type || 'no'} content-type body of ${raw.byteLength} bytes` },
			400,
		);
	}
	// A share is a `url_ingest` job now, not a row in the delivery queue. The
	// journey it gives the link is the same one -- `LibraryService.capture_url`
	// on the machine -- but as a job it gets what a queued blob could not: the
	// fetch happens while the page still exists, a phone can poll it, and a
	// failure says why instead of vanishing.
	//
	// `POST /jobs` with kind `url_ingest` is the same thing said explicitly. This
	// route stays because it is what is already written into phone shortcuts, and
	// because "send a link" deserves a URL you can type from memory.
	return startJob(
		env,
		'url_ingest',
		{ url: payload.url, kind: payload.kind ?? null, note: payload.note ?? null },
		'client',
	);
}

/**
 * Create and dispatch a job from inside the Worker, rather than from a request
 * that named a kind. The webhook and `/share` both arrive here.
 */
async function startJob(
	env: Env,
	kind: string,
	input: Record<string, unknown>,
	origin: 'client' | 'desktop' | 'webhook',
	waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
	registerJobTypes();
	const type = typeFor(kind);
	if (!type) return json({ error: `'${kind}' is not a job this relay runs` }, 500);
	let params: Record<string, unknown>;
	try {
		params = type.accept(input);
	} catch (err) {
		return json({ error: String(err instanceof Error ? err.message : err) }, 400);
	}
	const store = new JobStore(env.DB);
	if ((await store.openCount()) >= MAX_OPEN_JOBS) {
		return json({ error: 'the relay is backlogged; try again once the machine has synced' }, 503);
	}
	const { job, created } = await store.create(type.kind, type.key(params), {
		params,
		maxAttempts: type.maxAttempts,
		origin,
	});
	if (created) await dispatch(env, job, waitUntil);
	return json({ status: created ? 'queued' : 'duplicate', ...publicView(job) }, created ? 201 : 200);
}

/**
 * The laptop's one round trip: acknowledge what it took last time, push the
 * config this Worker needs to act while it is away, take the next batch, and
 * take the current access token in case the cron rotated it.
 *
 * One endpoint rather than four because the laptop does all four on every poll,
 * and four endpoints would be four chances for them to fall out of step.
 */
async function sync(request: Request, env: Env): Promise<Response> {
	const presented = bearer(request.headers.get('authorization'));
	if (!presented || !sameSecret(presented, env.RELAY_TOKEN)) {
		return json({ error: 'that token is not the one this relay holds' }, 401);
	}

	let payload: {
		ack?: number[];
		/** Jobs the machine took last time. Acknowledged late, on purpose. */
		job_ack?: string[];
		/** Worker reports the machine took last time. Late for the same reason. */
		worker_ack?: string[];
		/** Sealed ops this device made since the last poll. */
		ops?: unknown;
		/** Ops it took last time. Acknowledged late, like everything else here. */
		op_ack?: string[];
		config?: Record<string, unknown>;
		limit?: number;
	} = {};
	try {
		payload = (await request.json()) ?? {};
	} catch {
		return json({ error: 'that body is not JSON' }, 400);
	}

	const ack = (payload.ack ?? []).map(Number).filter(Number.isFinite).slice(0, 200);
	if (ack.length) {
		await env.DB.prepare(
			`DELETE FROM deliveries WHERE id IN (${ack.map(() => '?').join(',')})`,
		)
			.bind(...ack)
			.run();
		// Decrement cache; clamp to 0. Exact count is not critical here --
		// recountQueue on the next prune corrects any drift.
		_cachedQueueDepth = Math.max(0, (_cachedQueueDepth ?? 0) - ack.length);
	}

	// The laptop owns every one of these. The Worker holds a mirror so it can
	// answer while the laptop is away, and the mirror is refreshed on every poll
	// rather than set once and left to rot.
	const config = payload.config ?? {};
	const mirror: Array<[string, string | null]> = [
		['access_token', str(config.access_token)],
		['token_expires_on', str(config.token_expires_on)],
		['share_token', str(config.share_token)],
		['allow_senders', Array.isArray(config.allow_senders) ? JSON.stringify(config.allow_senders) : null],
		['reply_on_save', config.reply_on_save === undefined ? null : config.reply_on_save ? '1' : '0'],
		// Who is paired, as {id, role, token_hash}. The machine's `devices` table
		// is the authority and this is the mirror, refreshed on every poll, so a
		// device revoked there stops being recognised here within one -- the same
		// property the share token above already has. Hashes, never tokens: this
		// Worker must recognise a device without being able to become one.
		['devices', Array.isArray(config.devices) ? JSON.stringify(config.devices) : null],
	];
	for (const [key, value] of mirror) {
		if (value !== null) await setState(env, key, value);
	}
	const currentTime = now();
	_stateCache.set('last_pull_at', String(currentTime));
	if (currentTime - _lastWrittenPullAt >= 60) {
		_lastWrittenPullAt = currentTime;
		await env.DB.prepare(
			'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)' +
				' ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
		)
			.bind('last_pull_at', String(currentTime), currentTime)
			.run();
	}

	// Before the read below, so a job whose bytes the machine has just confirmed
	// is gone from this answer rather than offered again.
	const jobsSynced = await ackJobs(env, payload.job_ack);
	// Same order and the same reason: a report whose result the machine has
	// just confirmed is gone from this answer rather than offered again.
	const workersSynced = await ackReports(env, payload.worker_ack);

	// The host syncs as a device like any other -- its ops fan out to the phones
	// and theirs reach it. Its id comes from the mirror it just pushed; before
	// anything is paired it is the only caller here, and a stable placeholder
	// keeps the fan-out arithmetic in src/ops.ts honest.
	// A pairing the machine has just completed, sealed, on its way back to the
	// device that asked. Carried in the config mirror rather than on a route of
	// its own for the reason `/sync` is one endpoint: the machine does this on
	// the same poll it was already making.
	if (Array.isArray(config.pair_answers)) {
		for (const answer of config.pair_answers.slice(0, 8)) await answerPairing(env, answer);
	}

	const self = str(config.device_id) ?? 'desktop';
	const opsStored = await acceptOps(env, payload.ops, self);
	const opsSynced = await ackOps(env, self, payload.op_ack);

	// So a token this Worker's cron refreshed reaches the keychain. Null when it
	// is still the one the laptop just told us it held, so the common case is
	// not a credential travelling back and forth on every poll.
	const held = await getState(env, 'access_token');
	const rotated = held && held !== str(config.access_token) ? held : null;

	// Read-only queries: degrade gracefully if D1 is struggling. Writes above
	// already succeeded, so the system state is consistent; these are just
	// what the laptop sees on this poll.
	const limit = Math.min(Math.max(Number(payload.limit) || 25, 1), 100);
	let deliveries: unknown[] = [];
	try {
		const { results } = await env.DB.prepare(
			'SELECT id, kind, body, signature, sender_id, received_at FROM deliveries' +
				' ORDER BY id LIMIT ?',
		)
			.bind(limit)
			.all();
		deliveries = results ?? [];
	} catch { /* stale list is fine */ }

	let outboundSummaryResult: Record<string, number> = {};
	try { outboundSummaryResult = await outboundSummary(env); } catch (err) { console.error('outboundSummary error:', err); }

	let jobsResult: Record<string, unknown> = { ready: [], pending: [], counts: {} };
	try { jobsResult = await jobsForSync(env, Math.min(limit, SYNC_BATCH)); } catch (err) { console.error('jobsForSync error:', err); }

	let workersResult: unknown[] = [];
	try { workersResult = (await reportsForSync(env, Math.min(limit, SYNC_BATCH))) ?? []; } catch (err) { console.error('reportsForSync error:', err); }

	let opsResult: unknown[] = [];
	try { opsResult = await opsForSync(env, self); } catch (err) { console.error('opsForSync error:', err); }

	let pairingsResult: unknown[] = [];
	try { pairingsResult = await pairingsForSync(env); } catch (err) { console.error('pairingsForSync error:', err); }

	return json({
		deliveries,
		queued: await queueDepth(env),
		access_token: rotated,
		token_expires_on: rotated ? await getState(env, 'token_expires_on') : null,
		outbound: outboundSummaryResult,
		jobs: jobsResult,
		jobs_synced: jobsSynced,
		workers: workersResult,
		workers_synced: workersSynced,
		ops: opsResult,
		pairings: pairingsResult,
		ops_stored: opsStored,
		ops_synced: opsSynced,
	});
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// ------------------------------------------------------------------ policy

/**
 * The privacy policy, which Meta requires a URL for before an app can be set
 * Live -- and webhooks do not fire until it is.
 *
 * It is served from here rather than from a page somewhere else because this is
 * the only host in the system with a stable public address, and because a policy
 * ought to live next to the code it describes. Every claim below is one the code
 * on this page actually keeps: the retention figure is `KEEP_SECONDS`, the queue
 * really is emptied by `/sync`, and Groq really is the only third party any of
 * this content reaches.
 */
function policyPage(env: Env): Response {
	const contact = env.CONTACT
		? `<a href="mailto:${env.CONTACT}">${env.CONTACT}</a>`
		: 'a direct message to the Instagram account this app serves';
	const days = Math.round(KEEP_SECONDS / 86400);
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy policy — AMETHYST relay</title>
<style>
 :root { color-scheme: light dark; }
 body { max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem 6rem;
        font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; }
 h1 { font-size: 1.5rem; margin-bottom: .25rem; }
 h2 { font-size: 1.05rem; margin-top: 2.25rem; }
 .sub { opacity: .65; margin-top: 0; }
 li { margin: .35rem 0; }
 code { font-size: .9em; }
</style></head><body>
<h1>Privacy policy</h1>
<p class="sub">For the personal Instagram integration behind <code>amethyst-relay</code>.</p>

<h2>What this is</h2>
<p>A personal tool run by one individual, for their own use. It saves Instagram
reels and posts that person sends or is mentioned on into their own private
notes on their own computer. It is not a product, it is not offered to other
people, and there is no company behind it.</p>

<h2>What it receives</h2>
<p>Only what Instagram delivers about the account it serves, and only when
someone deliberately sends something to that account:</p>
<ul>
  <li>the Instagram-scoped sender ID of whoever sent the message — an opaque
      number, not a username, email or phone number</li>
  <li>the message itself: its text, or the title and temporary media link of a
      shared reel</li>
  <li>for a comment mention, the post's public caption and link</li>
</ul>
<p>Nothing is collected from anyone who does not message the account. There is
no tracking, no analytics, no advertising, and no profile is built about anyone.</p>

<h2>Where it goes, and for how long</h2>
<p>A message is held briefly in a queue on Cloudflare's infrastructure, then
transferred to the owner's own computer and <strong>deleted from the queue</strong>.
That normally takes seconds. If the computer is switched off it takes until it is
switched back on. Anything never collected is deleted automatically after
${days} days.</p>
<p>Once on that computer, the content is stored in the owner's private notes and
is not published anywhere.</p>

<h2>Who else sees it</h2>
<ul>
  <li><strong>Cloudflare</strong> — hosts the queue described above.</li>
  <li><strong>Groq</strong> — when a shared reel has no caption, its audio is sent
      for transcription so the owner can search it later. Nothing else is sent.</li>
</ul>
<p>No data is sold, shared for advertising, or given to anyone else.</p>

<h2>Deleting your data</h2>
<p>If you have sent something to this account and want it removed, ask via
${contact}. Anything still in the queue is deleted immediately; anything already
saved is deleted from the owner's notes. Because a queued message is deleted
within seconds of being collected, there is usually nothing left here to delete.</p>

<h2>Changes</h2>
<p>If this policy changes, the page changes. There is no mailing list to notify.</p>
</body></html>`;
	return new Response(html, {
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
	});
}

// --------------------------------------------------------------------- cron

/**
 * Keep the access token alive. This is the job that cannot live on the laptop:
 * a long-lived token refreshes only while it is still valid, so an absence
 * spanning the expiry is not a delay, it is a permanent break needing a re-paste
 * by hand. Fourteen days of margin, checked daily, somewhere always awake.
 */
async function refreshToken(env: Env): Promise<void> {
	const token = await getState(env, 'access_token');
	const expiresOn = await getState(env, 'token_expires_on');
	if (!token || !expiresOn) return;

	const expires = Date.parse(`${expiresOn}T00:00:00Z`);
	if (Number.isNaN(expires)) return;
	const daysLeft = Math.floor((expires - Date.now()) / 86_400_000);
	if (daysLeft > TOKEN_REFRESH_DAYS) return;
	if (daysLeft < 0) {
		console.error('the Instagram token lapsed on', expiresOn, '-- it must be replaced by hand');
		return;
	}

	const proof = await appsecretProof(env, token);
	const url = `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&appsecret_proof=${proof}`;
	const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
	if (!response.ok) {
		console.error('token refresh refused', response.status, await response.text());
		return;
	}
	const data = (await response.json()) as { access_token?: string; expires_in?: number };
	if (!data.access_token) return;

	const renewed = new Date(Date.now() + (data.expires_in ?? 60 * 24 * 3600) * 1000);
	await setState(env, 'access_token', data.access_token);
	await setState(env, 'token_expires_on', renewed.toISOString().slice(0, 10));
	console.log('refreshed the Instagram token, good until', renewed.toISOString().slice(0, 10));
}

/** Rows nobody ever came back for. Meta's own CDN assets die before this. */
async function prune(env: Env): Promise<void> {
	await env.DB.prepare('DELETE FROM deliveries WHERE received_at < ?')
		.bind(now() - KEEP_SECONDS)
		.run();
	await recountQueue(env);
}

// -------------------------------------------------------------------- entry

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, '') || '/';

		// Answered before anything else looks at the request. A preflight carries
		// no credential and no body by definition, so there is nothing here to
		// authenticate or validate -- and a 404 for one, which is what this used
		// to return, reads to the browser as "this endpoint does not exist" and
		// cancels the request that was about to follow it.
		if (request.method === 'OPTIONS' && isBrowserRoute(path)) {
			return preflight();
		}
		if (isBrowserRoute(path)) {
			return withCors(await this.route(request, env, ctx, url, path));
		}
		return this.route(request, env, ctx, url, path);
	},

	async route(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
		url: URL,
		path: string,
	): Promise<Response> {

		// Deliberately says nothing about queue depth, credentials or whether the
		// laptop is around. Anyone can reach this, and it answers before the
		// configuration check so a half-deployed relay can still be pinged.
		if (path === '/health') return json({ ok: true });

		// The sync layer's two routes sit ABOVE the Instagram-secrets gate below,
		// because neither needs a Meta credential. Syncing a laptop with a phone
		// is a use of this relay on its own, and requiring an Instagram app to be
		// configured before two of your own devices can agree on a theme would be
		// an accident of the order these features were built in.
		// Pairing: the only unauthenticated door, because it is the one exchange
		// that happens before a device has a credential. Both halves are sealed
		// under a secret shown as a QR code on the machine's screen, so a stranger
		// posting here writes a row the machine fails to open and discards. See
		// src/pairing.ts for why noise is the only thing to defend against.
		if (path === '/pair' && request.method === 'POST') {
			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return json({ error: 'that body is not JSON' }, 400);
			}
			const taken = await offerPairing(env, body);
			return taken
				? json({ offered: true })
				: json({ error: 'that is not a pairing offer, or too many are open' }, 429);
		}
		if (path === '/pair' && request.method === 'GET') {
			const answer = await takePairing(env, url.searchParams.get('request_id') ?? '');
			return answer ? json(answer) : json({ waiting: true }, 202);
		}

		// The sync mailbox for a device that is not the host. Its own credential
		// and one capability: exchange sealed ops as itself. It cannot take a
		// delivery, read a job artifact, or see the config mirror -- the same
		// per-capability narrowing that makes `remoteCreatable` a property of a
		// job type rather than a flag on a token.
		if (path === '/ops' && request.method === 'POST') {
			const device = await authenticateDevice(request, (key) => getState(env, key));
			if (!device) return json({ error: 'that token is not one this relay holds' }, 401);
			let body: { ops?: unknown; op_ack?: string[] } = {};
			try {
				body = (await request.json()) ?? {};
			} catch {
				return json({ error: 'that body is not JSON' }, 400);
			}
			const stored = await acceptOps(env, body.ops, device);
			const synced = await ackOps(env, device, body.op_ack);
			return json({ ops: await opsForSync(env, device), ops_stored: stored, ops_synced: synced });
		}

		// Meta will not let an app go Live without a privacy policy URL, and
		// webhooks do not fire until it is Live. Both names because the dashboard
		// asks for a deletion route separately and the answer is the same page.
		if (path === '/privacy' || path === '/data-deletion') return policyPage(env);

		// The machine's own round trip. It needs RELAY_TOKEN and nothing else:
		// this relay started as Instagram capture, but syncing a laptop with a
		// phone is a use of it on its own, and requiring Meta's app secret before
		// two of your own devices can agree on a theme would be an accident of
		// the order these features were built in rather than a decision.
		if (path === '/sync' && request.method === 'POST') {
			if (!env.RELAY_TOKEN) {
				console.warn('no RELAY_TOKEN is set; run: wrangler secret put RELAY_TOKEN');
				return json({ error: 'no such endpoint' }, 404);
			}
			return sync(request, env);
		}

		// Everything below is Instagram capture, which needs all three. A Worker
		// deployed but not yet given its secrets is not half-working, it is not
		// working -- and it answers 404 rather than 500, the same way
		// backend/instagram/signature.py refuses when any of the three is missing.
		// An endpoint that announces itself with an error is an endpoint worth
		// guessing at.
		if (!env.APP_SECRET || !env.VERIFY_TOKEN || !env.RELAY_TOKEN) {
			console.warn('no secrets are set; run: wrangler secret put APP_SECRET (and the other two)');
			return json({ error: 'no such endpoint' }, 404);
		}

		if (path === '/ig/webhook') {
			if (request.method === 'GET') return await handshake(url, env);
			if (request.method === 'POST') return delivery(request, env, ctx);
			return json({ error: 'method not allowed' }, 405);
		}
		if (path === '/share' && request.method === 'POST') return share(request, env);


		// The worker mailbox. Its own credential, and one verb: a runner may say
		// what happened and may not read anything back -- not its own report, not
		// anybody else's. See src/workers.ts for why that is the whole surface.
		if (path === '/worker/report' && request.method === 'POST') {
			if (!isWorker(request, env)) {
				return json({ error: 'that token is not one this relay holds' }, 401);
			}
			return report(request, env);
		}

		// The generic layer. Every route below authenticates first and then asks
		// the registry -- none of them knows what a job *does*, which is what
		// makes a new job type a file under src/jobs/types/ and nothing else.
		if (path === '/jobs' || path.startsWith('/jobs/')) {
			registerJobTypes();
			const caller = await authenticate(request, env, (key) => getState(env, key));
			if (!caller) {
				return json({ error: 'that token is not one this relay holds' }, 401);
			}
			if (path === '/jobs' && request.method === 'POST') {
				return createJob(request, env, caller, ctx.waitUntil.bind(ctx));
			}
			if (path === '/jobs' && request.method === 'GET') {
				// Deliberately not a listing. The machine gets its list from /sync,
				// which is one round trip and already knows what it has taken; a
				// second way to enumerate jobs would be a second thing to keep in
				// step, and for a client it would be somebody else's jobs.
				return json({ kinds: creatableKinds(caller) });
			}
			const parts = path.split('/').filter(Boolean); // jobs, {id}, artifact, {key…}
			if (parts.length === 2 && request.method === 'GET') {
				return readJob(env, caller, parts[1]);
			}
			if (parts.length > 3 && parts[2] === 'artifact' && request.method === 'GET') {
				// The key is a path, so it is the rest of the URL rather than one
				// segment. It came from the result the machine was just handed.
				return readArtifact(env, caller, parts[1], parts.slice(3).join('/'));
			}
			return json({ error: 'no such endpoint' }, 404);
		}

		return json({ error: 'no such endpoint' }, 404);
	},

	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		registerJobTypes();
		// Two schedules, and the difference matters. The frequent one is the job
		// layer's heartbeat: it is what re-dispatches a job whose Workflow
		// instance is gone and what promotes one out of its backoff, so a job
		// that failed at 09:00 is tried again at 09:05 rather than at 03:17
		// tomorrow. The daily one is the housekeeping that has always been here.
		const daily = event.cron === DAILY_CRON;
		ctx.waitUntil(
			(async () => {
				try {
					const swept = await sweepJobs(env, { waitUntil: ctx.waitUntil.bind(ctx) });
					if (swept.dispatched) {
						console.log('re-dispatched', swept.dispatched, 'job(s)');
					}
				} catch (err) {
					console.error('the job sweep failed', err);
				}
				if (!daily) return;
				try {
					await refreshToken(env);
				} catch (err) {
					console.error('token refresh failed', err);
				}
				try {
					await prune(env);
				} catch (err) {
					console.error('prune failed', err);
				}
				try {
					const dropped = (await pruneOps(env)) + (await prunePairings(env));
					if (dropped) console.log('pruned', dropped, 'stale sync row(s)');
				} catch (err) {
					console.error('the sync prune failed', err);
				}
				try {
					// Jobs nobody came back for, and every byte they staged. Per job
					// rather than one statement, so an R2 object never outlives the row
					// that names it -- an orphan there is a bucket nothing can clean.
					const removed = await new JobStore(env.DB).prune(env.ARTIFACTS);
					if (removed) console.log('pruned', removed, 'job(s)');
					// And reports no laptop ever came back for. A mailbox that is
					// never emptied stops being a mailbox.
					const stale = await pruneReports(env);
					if (stale) console.log('pruned', stale, 'worker report(s)');
				} catch (err) {
					console.error('the job prune failed', err);
				}
			})(),
		);
	},
};
