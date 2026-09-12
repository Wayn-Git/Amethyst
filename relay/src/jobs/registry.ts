/**
 * What a job type is, and the only thing the Worker knows about one.
 *
 * The whole point of this file is that `src/index.ts` and `src/jobs/runner.ts`
 * contain no `if (kind === ...)`. Adding a capability is adding a module under
 * `types/` that declares its steps and registering it -- the same bargain
 * `backend/jobs/runner.py` offers on the machine, and the same one skills offer
 * the agent: new behaviour is content, not new plumbing.
 *
 * A type declares three things and nothing else:
 *
 *   `accept`  - turn whatever a client sent into params, or refuse. This is the
 *               validation boundary; past it, params are trusted.
 *   `key`     - what makes two requests the same job. Chosen from the facts, so
 *               a phone pressing share twice creates one job.
 *   `steps`   - the units that are retried and recorded. Each runs at most once
 *               per job however many attempts the job takes.
 */

import type { Job } from './state.ts';

/** The bindings any job type may rely on. The Worker's `Env` extends this. */
export interface JobEnv {
	DB: D1Database;
	/** Optional on purpose -- see src/jobs/artifacts.ts. */
	ARTIFACTS?: R2Bucket;
}

export class Refused extends Error {}

/**
 * This will not work on the next attempt either -- a URL that 404s, a body that
 * is not what it claimed. Spending three attempts and an hour of backoff to
 * prove that again is not resilience. The same class, and the same reasoning,
 * as `backend.jobs.Unretryable`.
 */
export class Unretryable extends Error {}

export interface StepContext<E extends JobEnv = JobEnv> {
	env: E;
	job: Job;
	params: Record<string, unknown>;
	/** What earlier steps of this job returned, by step key. */
	done: Record<string, unknown>;
	/**
	 * Put bytes where the laptop can collect them. Answers null when no bucket
	 * is bound, which every type must handle rather than assume.
	 */
	stage(name: string, body: ArrayBuffer, contentType: string): Promise<ArtifactLike | null>;
}

export interface ArtifactLike {
	key: string;
	name: string;
	bytes: number;
	content_type: string;
}

export interface StepDefinition<E extends JobEnv = JobEnv> {
	/** Stable across versions: it is the ledger's primary key. */
	key: string;
	run(ctx: StepContext<E>): Promise<unknown>;
	/** Overrides the type's retry policy for one step. */
	retries?: RetryPolicy;
	timeout?: string;
}

export interface RetryPolicy {
	limit: number;
	delay: string;
	backoff: 'constant' | 'linear' | 'exponential';
}

export const DEFAULT_RETRIES: RetryPolicy = {
	limit: 3,
	delay: '15 seconds',
	backoff: 'exponential',
};

export interface JobType<E extends JobEnv = JobEnv> {
	kind: string;
	/**
	 * Whether a remote client -- a phone holding the share token -- may create
	 * this kind. False means only the desktop's own token can, which is how a
	 * job type that touches a provider credential stays out of reach of the
	 * weaker credential.
	 */
	remoteCreatable: boolean;
	maxAttempts?: number;
	retries?: RetryPolicy;
	/** Validate and normalise what a client sent. Throws `Refused` to say no. */
	accept(input: Record<string, unknown>): Record<string, unknown>;
	/** What makes two requests the same job. */
	key(params: Record<string, unknown>): string;
	steps: StepDefinition<E>[];
	/** What the laptop is handed. Built from the recorded step answers. */
	result(params: Record<string, unknown>, done: Record<string, unknown>): Record<string, unknown>;
}

const TYPES = new Map<string, JobType<any>>();

/** Make a kind creatable. Registering twice replaces, so a reload is safe. */
export function register<E extends JobEnv>(type: JobType<E>): JobType<E> {
	TYPES.set(type.kind, type);
	return type;
}

export function typeFor(kind: string): JobType<any> | undefined {
	return TYPES.get(kind);
}

export function registeredKinds(): string[] {
	return [...TYPES.keys()].sort();
}

/** What a client may be told exists, and what it may ask for. */
export function creatableKinds(origin: 'desktop' | 'client' | 'webhook'): string[] {
	return registeredKinds().filter(
		(kind) => origin !== 'client' || TYPES.get(kind)?.remoteCreatable === true,
	);
}
