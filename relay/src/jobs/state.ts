/**
 * What a relayed job is, and the only moves it may make.
 *
 * Deliberately the same state set and the same bounded backoff as
 * `backend/jobs/state.py`, with one addition the machine does not need:
 * `synced`. A completed job is finished as far as the Worker is concerned and
 * unfinished as far as the system is concerned -- the result is still in the
 * cloud. `synced` is the laptop saying it has it, and it is the only state in
 * which artifacts are deleted.
 */

/** The states a job passes through, and the only values `state` ever holds. */
export const STATES = [
	'queued', // written down, no workflow has taken it yet
	'running', // a workflow instance is executing its steps
	'waiting', // backing off after a transient failure
	'completed', // the work is done and the result is staged
	'failed', // out of attempts, or refused outright
	'cancelled',
	'synced', // the laptop has it; artifacts deleted
] as const;

export type JobState = (typeof STATES)[number];

/** Once here a job does not run again. */
export const TERMINAL: ReadonlySet<JobState> = new Set<JobState>([
	'completed',
	'failed',
	'cancelled',
	'synced',
]);

/** What the laptop may take on a sync, and what it may acknowledge. */
export const COLLECTABLE: ReadonlySet<JobState> = new Set<JobState>(['completed', 'failed']);

export const TRANSITIONS: Record<JobState, ReadonlySet<JobState>> = {
	queued: new Set<JobState>(['running', 'waiting', 'cancelled', 'failed']),
	// `queued` from `running` is a lost instance being re-dispatched by the cron.
	running: new Set<JobState>(['queued', 'waiting', 'completed', 'failed', 'cancelled']),
	waiting: new Set<JobState>(['queued', 'running', 'cancelled', 'failed']),
	// Terminal, except that a collected job becomes `synced` and a failed one may
	// be asked for again by a person.
	completed: new Set<JobState>(['synced']),
	failed: new Set<JobState>(['queued', 'synced']),
	cancelled: new Set<JobState>([]),
	synced: new Set<JobState>([]),
};

export class IllegalTransition extends Error {}

/** Refuse a move the table does not allow, rather than writing it and finding out later. */
export function assertTransition(from: JobState, to: JobState): void {
	if (!STATES.includes(to)) throw new IllegalTransition(`${to} is not a job state`);
	if (!TRANSITIONS[from]?.has(to)) throw new IllegalTransition(`${from} -> ${to}`);
}

/**
 * Bounded backoff, doubling from 15 seconds and capped at an hour -- the same
 * curve `backend/jobs/state.py` uses, so a job that fails in the cloud and a
 * job that fails on the machine wait the same length of time.
 */
export const BACKOFF_BASE_SECONDS = 15;
export const BACKOFF_CAP_SECONDS = 3600;

export function backoffFor(attempts: number, base = BACKOFF_BASE_SECONDS,
                           cap = BACKOFF_CAP_SECONDS): number {
	return Math.min(base * 2 ** Math.max(attempts - 1, 0), cap);
}

export interface Job {
	id: string;
	kind: string;
	idempotencyKey: string;
	state: JobState;
	params: Record<string, unknown>;
	progress: JobProgress | null;
	result: Record<string, unknown> | null;
	artifacts: string[];
	attempts: number;
	maxAttempts: number;
	lastError: string | null;
	origin: JobOrigin;
	createdAt: number;
	updatedAt: number;
	startedAt: number | null;
	finishedAt: number | null;
	syncedAt: number | null;
}

export interface JobProgress {
	/** The step key currently running, or the one that finished last. */
	step: string;
	done: number;
	total: number;
	note?: string;
}

/** Which credential asked for the job. Decides what may be read back about it. */
export type JobOrigin = 'desktop' | 'client' | 'webhook';

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * What a *remote client* is told about a job it created: enough to poll, and
 * nothing about what the Worker holds. A phone that shared a link learns that
 * the link was fetched; it does not learn the title, the text, or the key of
 * anything staged, because the phone is not the thing this content is for.
 */
export function publicView(job: Job): Record<string, unknown> {
	return {
		id: job.id,
		kind: job.kind,
		state: job.state,
		progress: job.progress,
		attempts: job.attempts,
		created_at: job.createdAt,
		updated_at: job.updatedAt,
		error: job.state === 'failed' ? job.lastError : null,
	};
}

/** What the laptop is told: the above, plus the result it came for. */
export function desktopView(job: Job): Record<string, unknown> {
	return {
		...publicView(job),
		params: job.params,
		key: job.idempotencyKey,
		origin: job.origin,
		result: job.result,
		artifacts: job.artifacts,
		last_error: job.lastError,
		finished_at: job.finishedAt,
	};
}
