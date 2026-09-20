/**
 * The jobs table, and the step ledger that makes a retry safe.
 *
 * Nothing above this module issues SQL for jobs -- the same rule
 * `backend/jobs/store.py` states on the other side. The two files are
 * consciously the same shape: create-or-return by idempotency key, a state
 * machine that refuses illegal moves, and a ledger a step is run inside.
 */

import {
	COLLECTABLE,
	type Job,
	type JobOrigin,
	type JobProgress,
	type JobState,
	TERMINAL,
	assertTransition,
	backoffFor,
	nowSeconds,
} from './state.ts';

/** Above this the queue is not a queue, it is somebody filling the table. */
export const MAX_OPEN_JOBS = 200;

/**
 * How long a job the laptop never came back for is kept. Shorter than the
 * delivery queue's eight days on purpose: a delivery is Meta's bytes and cannot
 * be re-requested, whereas a job's input is a URL that still exists.
 */
export const KEEP_SECONDS = 7 * 24 * 60 * 60;

interface Row {
	id: string;
	kind: string;
	idempotency_key: string;
	state: string;
	params: string;
	progress: string | null;
	result: string | null;
	artifacts: string | null;
	attempts: number;
	max_attempts: number;
	last_error: string | null;
	origin: string;
	created_at: number;
	updated_at: number;
	started_at: number | null;
	finished_at: number | null;
	synced_at: number | null;
}

function parse<T>(text: string | null, fallback: T): T {
	if (!text) return fallback;
	try {
		return JSON.parse(text) as T;
	} catch {
		return fallback;
	}
}

function hydrate(row: Row): Job {
	return {
		id: row.id,
		kind: row.kind,
		idempotencyKey: row.idempotency_key,
		state: row.state as JobState,
		params: parse<Record<string, unknown>>(row.params, {}),
		progress: parse<JobProgress | null>(row.progress, null),
		result: parse<Record<string, unknown> | null>(row.result, null),
		artifacts: parse<string[]>(row.artifacts, []),
		attempts: row.attempts,
		maxAttempts: row.max_attempts,
		lastError: row.last_error,
		origin: row.origin as JobOrigin,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		syncedAt: row.synced_at,
	};
}

export class JobStore {
	// Written out rather than a parameter property: `node --test` runs these
	// files through Node's type stripping, which has no way to emit the
	// assignment a parameter property implies.
	private db: D1Database;
	constructor(db: D1Database) {
		this.db = db;
	}

	// ---- creating

	/**
	 * The job for this key, creating it only if there is not one already.
	 *
	 * This is what "a retry creates nothing" is made of. A phone whose share
	 * timed out and was pressed again, a webhook re-delivered, a page reloaded
	 * mid-job: all three arrive here with the same key and all three get the job
	 * that already exists, in whatever state it has reached.
	 */
	async create(
		kind: string,
		idempotencyKey: string,
		options: {
			params?: Record<string, unknown>;
			maxAttempts?: number;
			origin?: JobOrigin;
		} = {},
	): Promise<{ job: Job; created: boolean }> {
		const existing = await this.byKey(idempotencyKey);
		if (existing) return { job: existing, created: false };

		const stamp = nowSeconds();
		const job: Job = {
			id: crypto.randomUUID(),
			kind,
			idempotencyKey,
			state: 'queued',
			params: options.params ?? {},
			progress: null,
			result: null,
			artifacts: [],
			attempts: 0,
			maxAttempts: options.maxAttempts ?? 3,
			lastError: null,
			origin: options.origin ?? 'client',
			createdAt: stamp,
			updatedAt: stamp,
			startedAt: null,
			finishedAt: null,
			syncedAt: null,
		};
		const result = await this.db
			.prepare(
				'INSERT INTO jobs (id, kind, idempotency_key, state, params, attempts,' +
					' max_attempts, origin, created_at, updated_at)' +
					' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' +
					' ON CONFLICT (idempotency_key) DO NOTHING',
			)
			.bind(
				job.id,
				job.kind,
				job.idempotencyKey,
				job.state,
				JSON.stringify(job.params),
				0,
				job.maxAttempts,
				job.origin,
				stamp,
				stamp,
			)
			.run();
		if ((result.meta.changes ?? 0) === 0) {
			// Two requests with the same key in the same instant. The unique index
			// is the arbiter rather than the read above, which can only ever be
			// advisory.
			const found = await this.byKey(idempotencyKey);
			if (found) return { job: found, created: false };
		}
		return { job, created: true };
	}

	// ---- reading

	async get(id: string): Promise<Job | null> {
		const row = await this.db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<Row>();
		return row ? hydrate(row) : null;
	}

	async byKey(key: string): Promise<Job | null> {
		const row = await this.db
			.prepare('SELECT * FROM jobs WHERE idempotency_key = ?')
			.bind(key)
			.first<Row>();
		return row ? hydrate(row) : null;
	}

	/** How many jobs are still somebody's problem. The backlog guard reads this. */
	async openCount(): Promise<number> {
		const row = await this.db
			.prepare("SELECT COUNT(*) AS n FROM jobs WHERE state IN ('queued','running','waiting')")
			.first<{ n: number }>();
		return row?.n ?? 0;
	}

	/**
	 * What the laptop takes on a sync: finished work it has not confirmed yet.
	 *
	 * Failures are included deliberately. A job that could not be done is still
	 * something the person asked for, and a relay that only reported successes
	 * would leave "I shared that link and nothing happened" with no answer
	 * anywhere.
	 */
	async collectable(limit: number): Promise<Job[]> {
		const states = [...COLLECTABLE].map((state) => `'${state}'`).join(',');
		const { results } = await this.db
			.prepare(
				`SELECT * FROM jobs WHERE state IN (${states}) AND synced_at IS NULL` +
					' ORDER BY created_at, rowid LIMIT ?',
			)
			.bind(limit)
			.all<Row>();
		return (results ?? []).map(hydrate);
	}

	/** Jobs still in flight, so a reconnecting laptop can say what is coming. */
	async pending(limit: number): Promise<Job[]> {
		const { results } = await this.db
			.prepare(
				"SELECT * FROM jobs WHERE state IN ('queued','running','waiting')" +
					' ORDER BY created_at, rowid LIMIT ?',
			)
			.bind(limit)
			.all<Row>();
		return (results ?? []).map(hydrate);
	}

	async counts(): Promise<Record<string, number>> {
		const { results } = await this.db
			.prepare('SELECT state, COUNT(*) AS n FROM jobs GROUP BY state')
			.all<{ state: string; n: number }>();
		const summary: Record<string, number> = {};
		for (const row of results ?? []) summary[row.state] = row.n;
		return summary;
	}

	/**
	 * Single-query replacement for collectable + pending. UNION ALL instead of
	 * two separate SELECT * calls. Counts stays separate (it is a cheap GROUP BY).
	 */
	async syncBundle(limit: number): Promise<{
		ready: Job[];
		pending: Job[];
	}> {
		const collectableStates = [...COLLECTABLE].map((s) => `'${s}'`).join(',');
		const { results } = await this.db
			.prepare(
				`SELECT *, 0 AS _tag FROM jobs
				WHERE state IN (${collectableStates}) AND synced_at IS NULL
				ORDER BY created_at, rowid LIMIT ?
				UNION ALL
				SELECT *, 1 AS _tag FROM jobs
				WHERE state IN ('queued','running','waiting')
				ORDER BY created_at, rowid LIMIT ?`,
			)
			.bind(limit, limit)
			.all<Row & { _tag: number }>();

		const ready: Job[] = [];
		const pendingJobs: Job[] = [];
		for (const row of results ?? []) {
			if (row._tag === 0) ready.push(hydrate(row));
			else pendingJobs.push(hydrate(row));
		}
		return { ready, pending: pendingJobs };
	}

	// ---- writing

	/** Move state, or refuse. The only way `state` changes. */
	async enter(job: Job, state: JobState, fields: Partial<Row> = {}): Promise<Job> {
		assertTransition(job.state, state);
		const stamp = nowSeconds();
		const startedAt = state === 'running' ? (job.startedAt ?? stamp) : job.startedAt;
		const finishedAt = TERMINAL.has(state) ? (job.finishedAt ?? stamp) : job.finishedAt;
		await this.db
			.prepare(
				'UPDATE jobs SET state = ?, updated_at = ?, started_at = ?, finished_at = ?,' +
					' attempts = ?, last_error = ?, result = ?, artifacts = ?, progress = ?' +
					' WHERE id = ?',
			)
			.bind(
				state,
				stamp,
				startedAt,
				finishedAt,
				fields.attempts ?? job.attempts,
				fields.last_error !== undefined ? fields.last_error : job.lastError,
				fields.result !== undefined ? fields.result : JSON.stringify(job.result),
				fields.artifacts !== undefined ? fields.artifacts : JSON.stringify(job.artifacts),
				fields.progress !== undefined ? fields.progress : JSON.stringify(job.progress),
				job.id,
			)
			.run();
		return { ...job, ...hydratePartial(fields), state, updatedAt: stamp, startedAt, finishedAt };
	}

	/** One more attempt is starting. */
	async begin(job: Job): Promise<Job> {
		const next = job.state === 'running' ? job : await this.enter(job, 'running');
		const attempts = next.attempts + 1;
		await this.db
			.prepare('UPDATE jobs SET attempts = ?, updated_at = ? WHERE id = ?')
			.bind(attempts, nowSeconds(), job.id)
			.run();
		return { ...next, attempts };
	}

	async progress(job: Job, progress: JobProgress): Promise<Job> {
		await this.db
			.prepare('UPDATE jobs SET progress = ?, updated_at = ? WHERE id = ?')
			.bind(JSON.stringify(progress), nowSeconds(), job.id)
			.run();
		return { ...job, progress };
	}

	/** Remember what was staged, so cleanup needs no bucket listing. */
	async addArtifact(job: Job, key: string): Promise<Job> {
		const artifacts = job.artifacts.includes(key) ? job.artifacts : [...job.artifacts, key];
		await this.db
			.prepare('UPDATE jobs SET artifacts = ?, updated_at = ? WHERE id = ?')
			.bind(JSON.stringify(artifacts), nowSeconds(), job.id)
			.run();
		return { ...job, artifacts };
	}

	async complete(job: Job, result: Record<string, unknown> | null): Promise<Job> {
		return this.enter(job, 'completed', {
			result: JSON.stringify(result ?? {}),
			last_error: null,
		});
	}

	/**
	 * Back off and try again, or stop having said why.
	 *
	 * Returns the delay a caller should sleep for before re-entering, or null
	 * when the job has spent its attempts. The Worker does not own a timer, so
	 * the wait itself belongs to whoever is running the job -- a Workflow step
	 * sleep, or the daily sweep.
	 */
	async fail(job: Job, error: string, options: { retry?: boolean } = {}): Promise<{
		job: Job;
		retryInSeconds: number | null;
	}> {
		const retry = options.retry !== false && job.attempts < job.maxAttempts;
		if (!retry) {
			return { job: await this.enter(job, 'failed', { last_error: error }), retryInSeconds: null };
		}
		return {
			job: await this.enter(job, 'waiting', { last_error: error }),
			retryInSeconds: backoffFor(job.attempts),
		};
	}

	/**
	 * The laptop has it. This is the only place artifacts are deleted, and it
	 * happens after the confirmation rather than after the send -- the whole
	 * reason a result can be taken twice and lost never.
	 */
	async markSynced(job: Job, bucket: R2Bucket | undefined): Promise<Job> {
		for (const key of job.artifacts) {
			if (bucket) await bucket.delete(key);
		}
		const stamp = nowSeconds();
		const synced = await this.enter(job, 'synced', { artifacts: JSON.stringify([]) });
		await this.db
			.prepare('UPDATE jobs SET synced_at = ? WHERE id = ?')
			.bind(stamp, job.id)
			.run();
		return { ...synced, artifacts: [], syncedAt: stamp };
	}

	// ---- the step ledger

	/** Has this step already happened, and what did it answer? */
	async recorded(job: Job, stepKey: string): Promise<{ done: boolean; result: unknown }> {
		const row = await this.db
			.prepare('SELECT result FROM job_steps WHERE job_id = ? AND step_key = ?')
			.bind(job.id, stepKey)
			.first<{ result: string | null }>();
		if (!row) return { done: false, result: null };
		return { done: true, result: parse<unknown>(row.result, null) };
	}

	async record(job: Job, stepKey: string, result: unknown): Promise<void> {
		await this.db
			.prepare(
				'INSERT INTO job_steps (job_id, step_key, result, created_at) VALUES (?, ?, ?, ?)' +
					' ON CONFLICT (job_id, step_key) DO NOTHING',
			)
			.bind(job.id, stepKey, result === undefined ? null : JSON.stringify(result), nowSeconds())
			.run();
	}

	async steps(job: Job): Promise<string[]> {
		const { results } = await this.db
			.prepare('SELECT step_key FROM job_steps WHERE job_id = ? ORDER BY created_at, rowid')
			.bind(job.id)
			.all<{ step_key: string }>();
		return (results ?? []).map((row) => row.step_key);
	}

	// ---- housekeeping

	/**
	 * Jobs whose workflow instance is gone: `running`, untouched for longer than
	 * any step is allowed to take. Back to `queued` if they have attempts left.
	 *
	 * The counterpart of `JobStore.reclaim_expired` on the machine, and it exists
	 * for the same reason: a row that goes on claiming to be running is a row
	 * somebody is reading and believing.
	 */
	async reclaimStalled(staleAfterSeconds: number): Promise<Job[]> {
		const { results } = await this.db
			.prepare("SELECT * FROM jobs WHERE state = 'running' AND updated_at < ?")
			.bind(nowSeconds() - staleAfterSeconds)
			.all<Row>();
		const reclaimed: Job[] = [];
		for (const row of results ?? []) {
			const job = hydrate(row);
			const note = 'the workflow running this job stopped answering';
			reclaimed.push(
				job.attempts >= job.maxAttempts
					? await this.enter(job, 'failed', { last_error: note })
					: await this.enter(job, 'queued', { last_error: note }),
			);
		}
		return reclaimed;
	}

	/** Waiting jobs whose backoff has run out become claimable again. */
	async promoteDue(): Promise<Job[]> {
		const { results } = await this.db
			.prepare("SELECT * FROM jobs WHERE state = 'waiting' ORDER BY updated_at LIMIT 50")
			.all<Row>();
		const due: Job[] = [];
		for (const row of results ?? []) {
			const job = hydrate(row);
			if (job.updatedAt + backoffFor(job.attempts) > nowSeconds()) continue;
			due.push(await this.enter(job, 'queued'));
		}
		return due;
	}

	/**
	 * Rows nobody came back for, and every byte they staged.
	 *
	 * Deletion is per job rather than one sweeping statement so the R2 objects go
	 * with the row that names them. A pruned row whose artifacts survived would
	 * be a bucket nothing can ever clean, which is the failure mode "minimise
	 * cloud retention" is actually about.
	 */
	async prune(bucket: R2Bucket | undefined, keepSeconds = KEEP_SECONDS): Promise<number> {
		const cutoff = nowSeconds() - keepSeconds;
		const { results } = await this.db
			.prepare(
				"SELECT * FROM jobs WHERE (synced_at IS NOT NULL AND synced_at < ?)" +
					' OR (created_at < ?)',
			)
			.bind(cutoff, cutoff)
			.all<Row>();
		let removed = 0;
		for (const row of results ?? []) {
			const job = hydrate(row);
			for (const key of job.artifacts) {
				if (bucket) await bucket.delete(key);
			}
			await this.db.prepare('DELETE FROM job_steps WHERE job_id = ?').bind(job.id).run();
			await this.db.prepare('DELETE FROM jobs WHERE id = ?').bind(job.id).run();
			removed += 1;
		}
		return removed;
	}
}

/** The fields `enter` was given, back in the shape the in-memory job holds. */
function hydratePartial(fields: Partial<Row>): Partial<Job> {
	const patch: Partial<Job> = {};
	if (fields.attempts !== undefined) patch.attempts = fields.attempts;
	if (fields.last_error !== undefined) patch.lastError = fields.last_error;
	if (fields.result !== undefined) patch.result = parse<Record<string, unknown> | null>(fields.result, null);
	if (fields.artifacts !== undefined) patch.artifacts = parse<string[]>(fields.artifacts, []);
	if (fields.progress !== undefined) patch.progress = parse<JobProgress | null>(fields.progress, null);
	return patch;
}
