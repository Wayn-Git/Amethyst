/**
 * Running one job's steps, exactly once each, however many attempts it takes.
 *
 * Deliberately free of `cloudflare:workers`: it takes a `StepLike`, which is
 * what `WorkflowStep` already is and what a test can be. The Workflow class in
 * `workflow.ts` is four lines because of that, and everything worth asserting
 * about retries, idempotency and state transitions can be asserted without a
 * workerd instance.
 *
 * Two layers of idempotency, and they guard different failures:
 *
 *   - `step.do` -- Workflows' own. A step that already returned inside *this*
 *     instance is not re-run when a later step fails.
 *   - `job_steps` -- ours, in D1. A step that already returned is not re-run
 *     when the *instance itself* is lost and the sweep dispatches a new one.
 *
 * The second is the one that matters here, because a Worker eviction, a deploy
 * or a D1 blip all end an instance without ending the job.
 */

import { type JobEnv, type JobType, Unretryable, DEFAULT_RETRIES, typeFor } from './registry.ts';
import { stage } from './artifacts.ts';
import type { Job } from './state.ts';
import { JobStore } from './store.ts';

/** As much of `WorkflowStep` as a job needs. A test supplies its own. */
export interface StepLike {
	do<T>(name: string, callback: () => Promise<T>): Promise<T>;
	do<T>(name: string, config: unknown, callback: () => Promise<T>): Promise<T>;
}

/** A step that refused rather than failed, on its way back out of `step.do`. */
interface Refusal {
	__refused: string;
}

function isRefusal(value: unknown): value is Refusal {
	return typeof value === 'object' && value !== null && '__refused' in value;
}

export interface RunOutcome {
	state: Job['state'];
	/** Seconds to wait before the next attempt, when there is to be one. */
	retryInSeconds: number | null;
	ranSteps: string[];
}

/**
 * Take one job from wherever it is to wherever it gets to.
 *
 * Returns rather than throws: a job that failed is a row saying so, not an
 * exception escaping into a Workflow that will then retry the whole thing from
 * the top -- which is precisely what the step ledger exists to prevent.
 */
export async function runJob<E extends JobEnv>(
	env: E,
	jobId: string,
	step: StepLike,
): Promise<RunOutcome> {
	const store = new JobStore(env.DB);
	const found = await store.get(jobId);
	if (!found) return { state: 'cancelled', retryInSeconds: null, ranSteps: [] };
	let job: Job = found;

	// A second instance for a job that has already finished does nothing. This
	// is the case a duplicate dispatch actually takes -- the platform refuses a
	// duplicate instance id, but a *re*-dispatch after a sweep gets a new one.
	if (job.state === 'completed' || job.state === 'failed' || job.state === 'synced' ||
	    job.state === 'cancelled') {
		return { state: job.state, retryInSeconds: null, ranSteps: [] };
	}

	const type = typeFor(job.kind) as JobType<E> | undefined;
	if (!type) {
		// Nothing will ever be able to run this: the kind was removed, or the row
		// outlived the deploy that knew it. A person's problem, not a retry's.
		const { job: failed } = await store.fail(
			job,
			`nothing here knows how to run a '${job.kind}' job`,
			{ retry: false },
		);
		return { state: failed.state, retryInSeconds: null, ranSteps: [] };
	}

	job = await store.begin(job);
	const done: Record<string, unknown> = {};
	const ranSteps: string[] = [];

	for (const [index, definition] of type.steps.entries()) {
		const already = await store.recorded(job, definition.key);
		if (already.done) {
			// The proof that a lost instance costs nothing: this step's answer is
			// the one the earlier attempt got, and its side effects are not
			// repeated.
			done[definition.key] = already.result;
			continue;
		}

		job = await store.progress(job, {
			step: definition.key,
			done: index,
			total: type.steps.length,
		});

		const currentJob = job;
		const callback = async (): Promise<unknown> => {
			try {
				const value = await definition.run({
					env,
					job: currentJob,
					params: currentJob.params,
					done,
					stage: async (name, body, contentType) => {
						const ref = await stage(env.ARTIFACTS, currentJob, name, body, contentType);
						// Against `job`, not `currentJob`: a step that stages two files
						// must not have the second write clobber the first's key.
						if (ref) job = await store.addArtifact(job, ref.key);
						return ref;
					},
				});
				// After the work returned, never before it: a crash in the middle
				// leaves no row and the step runs again. At-least-once for the step
				// in flight, exactly-once for every step before it.
				await store.record(currentJob, definition.key, value ?? null);
				return value ?? null;
			} catch (err) {
				if (err instanceof Unretryable) {
					// Not recorded. The job is about to stop for good, and a ledger
					// row would only make a person's retry skip the step that was the
					// reason they retried.
					return { __refused: String(err.message || err) } satisfies Refusal;
				}
				throw err;
			}
		};

		let value: unknown;
		try {
			value = await step.do(definition.key, definition.retries ?? type.retries ?? DEFAULT_RETRIES,
			                      callback);
		} catch (err) {
			// Workflows has spent this step's retries. The job goes to `waiting`
			// with a backoff and the sweep dispatches it again -- with the ledger
			// intact, so it resumes here rather than at the top.
			const outcome = await store.fail(job, `${definition.key}: ${describe(err)}`);
			return { state: outcome.job.state, retryInSeconds: outcome.retryInSeconds, ranSteps };
		}

		if (isRefusal(value)) {
			const outcome = await store.fail(job, `${definition.key}: ${value.__refused}`, {
				retry: false,
			});
			return { state: outcome.job.state, retryInSeconds: null, ranSteps };
		}
		done[definition.key] = value;
		ranSteps.push(definition.key);
	}

	const finished = await store.complete(job, type.result(job.params, done));
	return { state: finished.state, retryInSeconds: null, ranSteps };
}

function describe(err: unknown): string {
	if (err instanceof Error) return `${err.name}: ${err.message}`;
	return String(err);
}
