/**
 * Starting a job, at most once per attempt.
 *
 * The instance id is derived from the job id and the attempt number, and
 * Cloudflare refuses a duplicate id -- so "this job is already in flight" is
 * the platform's answer rather than a check of ours that a second request could
 * race past. The attempt number is in the id because a job the sweep puts back
 * needs a *new* instance, and reusing the id would be refused forever.
 *
 * No binding is not a broken relay. A Workers account without Workflows, or a
 * deployment that predates them, runs the job inline instead: the same steps in
 * the same order through the same ledger, just inside the request that asked
 * for it. It loses the retries and it says so in the row. That is worse than a
 * Workflow and much better than a 500.
 */

import type { JobEnv } from './registry.ts';
import { runJob, type StepLike } from './runner.ts';
import type { Job } from './state.ts';

export interface JobParams {
	jobId: string;
}

export interface DispatchEnv extends JobEnv {
	JOBS?: Workflow<JobParams>;
}

/** Bounded, and unique per attempt. */
export function instanceIdFor(job: Job): string {
	return `job-${job.id}-${Math.max(job.attempts, 0)}`;
}

/** A `StepLike` that simply runs the work. What "no Workflows" degrades to. */
export const inlineStep: StepLike = {
	async do<T>(_name: string, configOrCallback: unknown, maybeCallback?: unknown): Promise<T> {
		const callback = (typeof configOrCallback === 'function' ? configOrCallback : maybeCallback) as
			() => Promise<T>;
		return callback();
	},
};

export async function dispatch<E extends DispatchEnv>(
	env: E,
	job: Job,
	waitUntil?: (promise: Promise<unknown>) => void,
): Promise<'workflow' | 'inline'> {
	if (env.JOBS) {
		try {
			await env.JOBS.create({ id: instanceIdFor(job), params: { jobId: job.id } });
		} catch (err) {
			// The id already exists: this attempt is already running. That is the
			// idempotency working, not a failure.
			console.log('job already dispatched', job.id, String(err));
		}
		return 'workflow';
	}
	const inline = runJob(env, job.id, inlineStep).catch((err) => {
		console.error('inline job run failed', job.id, String(err));
	});
	if (waitUntil) waitUntil(inline);
	else await inline;
	return 'inline';
}
