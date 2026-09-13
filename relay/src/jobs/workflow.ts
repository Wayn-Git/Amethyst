/**
 * The durable half, and deliberately the thinnest file here.
 *
 * Everything worth understanding about how a job runs is in `runner.ts`, which
 * has no `cloudflare:workers` import and can therefore be tested without a
 * workerd instance. This class is the adapter: it hands Workflows' `step` to
 * that runner and gets out of the way.
 *
 * One Workflow for every kind rather than one per kind. A Workflow binding is a
 * deploy-time declaration, so a Workflow per job type would mean editing
 * `wrangler.jsonc` and redeploying to add a capability -- which is exactly the
 * plumbing the registry exists to remove.
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import type { Env } from '../index.ts';
import type { JobParams } from './dispatch.ts';
import { runJob } from './runner.ts';
import { registerJobTypes } from './types/index.ts';

export class JobWorkflow extends WorkflowEntrypoint<Env, JobParams> {
	async run(event: Readonly<WorkflowEvent<JobParams>>, step: WorkflowStep): Promise<void> {
		// A Workflow instance is its own isolate: the registration the fetch
		// handler did is not visible here.
		registerJobTypes();
		// One pass, then the instance ends. A job that asked for another attempt
		// is `waiting` with a backoff, and the five-minute sweep dispatches it
		// again as a *new* instance with the ledger intact.
		//
		// Deliberately not `step.sleep` and re-entering here: a step name is
		// unique within an instance, so a second pass would either collide with
		// the first pass's names or need them mangled per attempt -- and an
		// instance that sleeps for an hour is an instance whose failure to wake
		// leaves a job nothing is watching. The sweep watches.
		await runJob(this.env, event.payload.jobId, step);
	}
}
