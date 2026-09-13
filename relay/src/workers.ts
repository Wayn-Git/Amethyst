/**
 * The worker mailbox: one route in, one list out.
 *
 * A GitHub Actions runner finishes a task and has nowhere to put the answer --
 * the laptop that asked has no public address and is often asleep. So it posts
 * here, and `backend/instagram/relay.py` collects on the sync it was making
 * anyway. The relay holds the answer and understands none of it.
 *
 * **A third credential, weaker than both the others.** `WORKER_TOKEN` may write
 * a report and do nothing else: it cannot read one back, cannot create a job,
 * cannot take a delivery, cannot see what any other worker said. That is the
 * whole point of it being separate from `RELAY_TOKEN` -- a token that lives in
 * two GitHub accounts' Actions secrets is the most exposed of the three, and it
 * is worth the least if taken.
 *
 * **A report is bytes, not truth.** Nothing here parses a result, and nothing
 * downstream trusts one: `backend/workers/reports.py` re-checks the shape, the
 * state and the size before a row exists on the laptop. This side caps what it
 * will store and stops there.
 */

import { bearer, sameSecret } from './auth.ts';

/** A result is a summary. A worker with more to say sends references to it. */
export const MAX_REPORT_BYTES = 256 * 1024;
/** Above this the mailbox is not a mailbox, it is somebody filling the table. */
export const MAX_OPEN_REPORTS = 500;
/** How many reports one sync takes. Matches the delivery and job batches. */
export const SYNC_BATCH = 25;

const STATES = new Set(['queued', 'running', 'completed', 'failed']);
const TERMINAL = new Set(['completed', 'failed']);

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

const now = () => Math.floor(Date.now() / 1000);

export interface WorkerEnv {
	DB: D1Database;
	/** What a GitHub Actions runner presents. Set with `wrangler secret put`. */
	WORKER_TOKEN?: string;
}

/** Whether this request is a worker. Deliberately not a `Caller`: see auth.ts. */
export function isWorker(request: Request, env: WorkerEnv): boolean {
	const presented = bearer(request.headers.get('authorization'));
	return Boolean(presented && env.WORKER_TOKEN && sameSecret(presented, env.WORKER_TOKEN));
}

/**
 * A worker saying what happened.
 *
 * Last write wins, with one exception: a terminal row is never overwritten by a
 * non-terminal one. Progress pings and the final result race each other over
 * the open internet, and a `running` landing after a `completed` would undo the
 * answer -- the one ordering mistake that actually loses work here.
 */
export async function report(request: Request, env: WorkerEnv): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = ((await request.json()) ?? {}) as Record<string, unknown>;
	} catch {
		return json({ error: 'that body is not JSON' }, 400);
	}

	const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
	const state = typeof body.state === 'string' ? body.state.trim() : '';
	if (!jobId || jobId.length > 200 || !STATES.has(state)) {
		return json({ error: 'a report needs a job_id and a known state' }, 400);
	}

	const result = body.result === undefined ? null : JSON.stringify(body.result);
	const progress = body.progress === undefined ? null : JSON.stringify(body.progress);
	if (result && result.length > MAX_REPORT_BYTES) {
		// Refused rather than truncated: half a JSON document is not a document,
		// and a worker that exceeds this has a bug worth seeing in its run log.
		return json({ error: `a result may be at most ${MAX_REPORT_BYTES} bytes` }, 413);
	}

	const existing = await env.DB.prepare('SELECT state FROM worker_reports WHERE job_id = ?')
		.bind(jobId)
		.first<{ state: string }>();
	if (existing && TERMINAL.has(existing.state) && !TERMINAL.has(state)) {
		return json({ ok: true, ignored: 'this job has already reported a result' });
	}

	if (!existing) {
		const open = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM worker_reports WHERE synced_at IS NULL',
		).first<{ n: number }>();
		if ((open?.n ?? 0) >= MAX_OPEN_REPORTS) {
			return json({ error: 'the relay is backlogged; try again shortly' }, 503);
		}
	}

	const error = typeof body.error === 'string' ? body.error.slice(0, 2000) : null;
	const lane = typeof body.lane === 'string' ? body.lane.slice(0, 32) : null;
	await env.DB.prepare(
		'INSERT INTO worker_reports (job_id, state, progress, result, error, lane, created_at, updated_at)' +
			' VALUES (?, ?, ?, ?, ?, ?, ?, ?)' +
			' ON CONFLICT(job_id) DO UPDATE SET state = excluded.state,' +
			'  progress = excluded.progress, result = excluded.result, error = excluded.error,' +
			'  lane = COALESCE(excluded.lane, worker_reports.lane), updated_at = excluded.updated_at,' +
			// A job that reports again after being collected is offered again. It
			// is the same discipline the deliveries queue follows: the laptop's
			// acknowledgement is what deletes, and a new fact undoes it.
			'  synced_at = NULL',
		)
		.bind(jobId, state, progress, result, error, lane, now(), now())
		.run();

	return json({ ok: true });
}

/** What `/sync` says about workers: everything the laptop has not confirmed. */
export async function reportsForSync(env: WorkerEnv, limit: number): Promise<unknown[]> {
	const { results } = await env.DB.prepare(
		'SELECT job_id, state, progress, result, error, lane, updated_at FROM worker_reports' +
			' WHERE synced_at IS NULL ORDER BY updated_at, rowid LIMIT ?',
	)
		.bind(limit)
		.all<Record<string, unknown>>();
	return (results ?? []).map((row) => ({
		job_id: row.job_id,
		state: row.state,
		progress: row.progress ? JSON.parse(String(row.progress)) : null,
		result: row.result ? JSON.parse(String(row.result)) : null,
		error: row.error,
		lane: row.lane,
		updated_at: row.updated_at,
	}));
}

/**
 * The laptop confirming it has these.
 *
 * A terminal report is deleted; a `running` one is only marked, because the
 * worker has not finished and deleting it would lose the result still to come.
 */
export async function ackReports(env: WorkerEnv, ids: unknown): Promise<number> {
	if (!Array.isArray(ids) || !ids.length) return 0;
	const taken = ids.slice(0, 100).map(String);
	const marks = taken.map(() => '?').join(',');
	const deleted = await env.DB.prepare(
		`DELETE FROM worker_reports WHERE job_id IN (${marks})` +
			" AND state IN ('completed', 'failed')",
	)
		.bind(...taken)
		.run();
	await env.DB.prepare(
		`UPDATE worker_reports SET synced_at = ? WHERE job_id IN (${marks}) AND synced_at IS NULL`,
	)
		.bind(now(), ...taken)
		.run();
	return deleted.meta?.changes ?? taken.length;
}

/** Rows nobody came back for. Run by the daily cron. */
export async function pruneReports(env: WorkerEnv, keepSeconds = 7 * 24 * 60 * 60): Promise<number> {
	const cutoff = now() - keepSeconds;
	const done = await env.DB.prepare('DELETE FROM worker_reports WHERE updated_at < ?')
		.bind(cutoff)
		.run();
	return done.meta?.changes ?? 0;
}
